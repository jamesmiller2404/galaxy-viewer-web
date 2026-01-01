/// <reference lib="webworker" />
import { GalaxyParameters } from "./parameters";

type Inbound =
  | { type: "init"; payload: InitPayload }
  | { type: "start" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "terminate" };

type InitPayload = {
  dt: number;
  substeps: number;
  softening: number;
  gConst: number;
  galaxies: [GalaxyInit, GalaxyInit];
};

type GalaxyInit = {
  count: number;
  mass: number;
  diskScale: number;
  center: [number, number];
  velocity: [number, number];
  seed: number;
};

type Outbound =
  | { type: "frame"; positions: ArrayBufferLike; countA: number; countB: number; shared: boolean }
  | { type: "stats"; stepMs: number; simFps: number }
  | { type: "ready"; count: number }
  | { type: "error"; message: string };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const useSharedBuffer =
  typeof SharedArrayBuffer !== "undefined" &&
  (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

let positions: Float32Array | null = null;
let positionsBuffer: ArrayBufferLike | null = null;
let velocities: Float32Array | null = null;
let countA = 0;
let countB = 0;
let running = false;
let dt = 1 / 60;
let substeps = 1;
let gConst = 1;
let softening = 1;
let c1 = { x: 0, y: 0, vx: 0, vy: 0, mass: 1 };
let c2 = { x: 0, y: 0, vx: 0, vy: 0, mass: 1 };
let timer: number | null = null;
let timerIntervalMs = 16;
let accumStepMs = 0;
let accumSteps = 0;

ctx.onmessage = (event: MessageEvent<Inbound>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init":
        init(msg.payload);
        break;
      case "start":
        start();
        break;
      case "pause":
        stop();
        break;
      case "reset":
        reset();
        break;
      case "terminate":
        stop();
        positions = null;
        velocities = null;
        ctx.close();
        break;
    }
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    } satisfies Outbound);
  }
};

function init(payload: InitPayload) {
  dt = payload.dt;
  substeps = Math.max(1, Math.floor(payload.substeps));
  softening = payload.softening;
  gConst = payload.gConst;
  const [gA, gB] = payload.galaxies;
  countA = Math.max(0, gA.count);
  countB = Math.max(0, gB.count);
  const total = countA + countB;
  const bufferCtor = useSharedBuffer ? SharedArrayBuffer : ArrayBuffer;
  positionsBuffer = new bufferCtor(total * 2 * 4);
  positions = new Float32Array(positionsBuffer);
  velocities = new Float32Array(total * 2);
  accumStepMs = 0;
  accumSteps = 0;

  c1 = {
    x: gA.center[0],
    y: gA.center[1],
    vx: gA.velocity[0],
    vy: gA.velocity[1],
    mass: gA.mass
  };
  c2 = {
    x: gB.center[0],
    y: gB.center[1],
    vx: gB.velocity[0],
    vy: gB.velocity[1],
    mass: gB.mass
  };

  seedDisk(gA, 0);
  seedDisk(gB, countA);

  ctx.postMessage({ type: "ready", count: total } satisfies Outbound);
  // Send first frame so the main thread can initialize buffers.
  postFrame();
}

function seedDisk(galaxy: GalaxyInit, offset: number) {
  if (!positions || !velocities) return;
  const rand = mulberry32(galaxy.seed || 1 + offset * 17);
  for (let i = 0; i < galaxy.count; i++) {
    const idx = offset + i;
    const angle = rand() * Math.PI * 2;
    const u = Math.max(1e-4, rand());
    const r = -galaxy.diskScale * Math.log(1 - u); // exponential radius
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    positions[idx * 2] = galaxy.center[0] + x;
    positions[idx * 2 + 1] = galaxy.center[1] + y;

    // Circular velocity from self potential
    const accelMag = radialAccel(r, galaxy.mass);
    const vCirc = Math.sqrt(Math.max(0, r * accelMag));
    const jitter = 0.05 * vCirc;
    const vx = -Math.sin(angle) * (vCirc + jitter * (rand() - 0.5));
    const vy = Math.cos(angle) * (vCirc + jitter * (rand() - 0.5));
    velocities[idx * 2] = galaxy.velocity[0] + vx;
    velocities[idx * 2 + 1] = galaxy.velocity[1] + vy;
  }
}

function start() {
  if (timer !== null) return;
  running = true;
  timerIntervalMs = Math.max(16, (dt * 1000) / substeps);
  timer = setInterval(stepFrame, timerIntervalMs) as unknown as number;
}

function stop() {
  running = false;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function reset() {
  stop();
  if (positions && velocities) {
    // Re-seed to initial state by re-running init with existing config is complex; rely on caller to re-init.
    postFrame();
  }
}

function stepFrame() {
  if (!positions || !velocities || !running) return;
  const frameStart = performance.now();
  const subDt = dt / substeps;
  for (let s = 0; s < substeps; s++) {
    // Center-center interaction
    const dirCX = c2.x - c1.x;
    const dirCY = c2.y - c1.y;
    const invDist3C = invDistCube(dirCX, dirCY);
    const axC1 = gConst * c2.mass * dirCX * invDist3C;
    const ayC1 = gConst * c2.mass * dirCY * invDist3C;
    const axC2 = gConst * c1.mass * dirCX * invDist3C;
    const ayC2 = gConst * c1.mass * dirCY * invDist3C;
    c1.vx += axC1 * subDt;
    c1.vy += ayC1 * subDt;
    c2.vx -= axC2 * subDt;
    c2.vy -= ayC2 * subDt;
    c1.x += c1.vx * subDt;
    c1.y += c1.vy * subDt;
    c2.x += c2.vx * subDt;
    c2.y += c2.vy * subDt;

    // Stars
    for (let i = 0; i < positions.length; i += 2) {
      const px = positions[i];
      const py = positions[i + 1];
      const { ax, ay } = totalAccel(px, py);
      velocities[i] += 0.5 * subDt * ax;
      velocities[i + 1] += 0.5 * subDt * ay;
      positions[i] = px + subDt * velocities[i];
      positions[i + 1] = py + subDt * velocities[i + 1];
      const { ax: ax2, ay: ay2 } = totalAccel(positions[i], positions[i + 1]);
      velocities[i] += 0.5 * subDt * ax2;
      velocities[i + 1] += 0.5 * subDt * ay2;
    }
  }

  const stepDuration = performance.now() - frameStart;
  accumStepMs += stepDuration;
  accumSteps++;
  if (accumSteps >= 30) {
    const avg = accumStepMs / accumSteps;
    const simFps = 1000 / Math.max(1, timerIntervalMs);
    ctx.postMessage({ type: "stats", stepMs: avg, simFps } satisfies Outbound);
    accumSteps = 0;
    accumStepMs = 0;
  }
  postFrame();
}

function postFrame() {
  if (!positions || !positionsBuffer) return;
  const shared = useSharedBuffer;
  if (shared) {
    ctx.postMessage({ type: "frame", positions: positionsBuffer, countA, countB, shared } satisfies Outbound);
    return;
  }
  // In non-shared mode, clone so the worker keeps ownership for the next frame.
  const clone = (positionsBuffer as ArrayBuffer).slice(0);
  ctx.postMessage({ type: "frame", positions: clone, countA, countB, shared } satisfies Outbound);
}

function totalAccel(x: number, y: number) {
  const ax1 = accelFrom(c1.x, c1.y, c1.mass, x, y, gConst);
  const ax2 = accelFrom(c2.x, c2.y, c2.mass, x, y, gConst);
  return { ax: ax1.ax + ax2.ax, ay: ax1.ay + ax2.ay };
}

function accelFrom(cx: number, cy: number, mass: number, x: number, y: number, G: number) {
  const rx = x - cx;
  const ry = y - cy;
  const inv = invDistCube(rx, ry);
  return {
    ax: -G * mass * rx * inv,
    ay: -G * mass * ry * inv
  };
}

function invDistCube(dx: number, dy: number) {
  const dist2 = dx * dx + dy * dy + softening * softening;
  const invDist = 1 / Math.sqrt(dist2);
  return invDist * invDist * invDist;
}

function radialAccel(r: number, mass: number) {
  const denom = Math.pow(r * r + softening * softening, 1.5);
  if (!denom) return 0;
  return (gConst * mass * r) / denom;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
