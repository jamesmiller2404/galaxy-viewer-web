import fs from "node:fs";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import { loadSpice, type SpiceApi } from "./spice";
import { MOON_CATALOG } from "./catalog";
import { SURFACE_FEATURES } from "./features";
import { classForTarget, precisionForTarget, targetsForMode } from "./targets";
import {
  add,
  computeOffsets,
  dot,
  geodeticToEcef,
  mat3MultiplyVec,
  norm,
  raDecFromVec,
  sub,
  unit,
  wrapDegrees
} from "./utils";
import { ARCSEC_PER_RAD, DEG2RAD } from "./constants";
import type { OrbitsRequest, OrbitsResponse, SceneRequest, SceneResponse, Vec3 } from "./types";

type WorkerRequest =
  | { id: number; type: "scene"; args: SceneRequest }
  | { id: number; type: "orbits"; args: OrbitsRequest };

type WorkerResponse =
  | { id: number; ok: true; result: SceneResponse | OrbitsResponse }
  | { id: number; ok: false; error: string };

let spice: SpiceApi | null = null;
let kernelsLoaded = false;
let jupiterRadiusKm: number | null = null;

const metaKernelPath = process.env.SPICE_META_KERNEL ?? path.resolve(process.cwd(), "data/spice/meta/jupiter.tm");

async function ensureSpice() {
  if (!spice) {
    spice = await loadSpice();
  }
  if (!kernelsLoaded) {
    if (!fs.existsSync(metaKernelPath)) {
      throw new Error(`Metakernel not found at ${metaKernelPath}`);
    }
    spice.furnsh(metaKernelPath);
    kernelsLoaded = true;
  }
  return spice;
}

function extractState(result: unknown) {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) {
      return { state: result[0] as number[], lt: result[1] as number | undefined };
    }
    if (result.length >= 6 && typeof result[0] === "number") {
      return { state: result as number[], lt: undefined };
    }
  }
  if (result && typeof result === "object") {
    const maybe = result as {
      state?: number[] | { r?: number[]; v?: number[] };
      lt?: number;
      lightTime?: number;
    };
    if (Array.isArray(maybe.state)) {
      return { state: maybe.state, lt: maybe.lt ?? maybe.lightTime };
    }
    if (maybe.state && typeof maybe.state === "object") {
      const r = (maybe.state as { r?: number[] }).r;
      const v = (maybe.state as { v?: number[] }).v;
      if (Array.isArray(r) && Array.isArray(v)) {
        return { state: [...r, ...v], lt: maybe.lt ?? maybe.lightTime };
      }
    }
  }
  throw new Error("Unexpected spkezr response shape.");
}

function spkezrState(api: SpiceApi, target: string, et: number, frame: string, abcorr: string, observer: string) {
  const result = api.spkezr(target, et, frame, abcorr, observer);
  const { state } = extractState(result);
  if (!Array.isArray(state) || state.length < 6) {
    throw new Error("Invalid state vector.");
  }
  return {
    pos: { x: state[0], y: state[1], z: state[2] } as Vec3,
    vel: { x: state[3], y: state[4], z: state[5] } as Vec3
  };
}

function safeSpkezrState(
  api: SpiceApi,
  target: string,
  et: number,
  frame: string,
  abcorr: string,
  observer: string
) {
  try {
    return spkezrState(api, target, et, frame, abcorr, observer);
  } catch {
    return null;
  }
}

function getJupiterRadius(api: SpiceApi) {
  if (jupiterRadiusKm) return jupiterRadiusKm;
  try {
    const result = api.bodvrd("JUPITER", "RADII", 3) as unknown;
    let values: number[] | undefined;
    if (Array.isArray(result)) {
      values = Array.isArray(result[1]) ? (result[1] as number[]) : (result as number[]);
    } else if (result && typeof result === "object") {
      const maybe = result as { values?: number[]; radii?: number[] };
      values = maybe.values ?? maybe.radii;
    }
    if (values && values.length > 0) {
      jupiterRadiusKm = values[0];
    }
  } catch {
    jupiterRadiusKm = null;
  }
  if (!jupiterRadiusKm) {
    jupiterRadiusKm = 71492;
  }
  return jupiterRadiusKm;
}

async function computeScene(args: SceneRequest): Promise<SceneResponse> {
  const api = await ensureSpice();
  const abcorr = args.quality === "high" ? "LT+S" : "LT";
  const et = api.str2et(args.timeUTC);
  const bodyToJ2000 = api.pxform("IAU_JUPITER", "J2000", et) as number[] | number[][];
  let observerOffset: Vec3 | null = null;
  if (args.observer.kind === "topocentric") {
    const obsEcef = geodeticToEcef(args.observer.latDeg, args.observer.lonDeg, args.observer.altM);
    const xf = api.pxform("ITRF93", "J2000", et) as number[] | number[][];
    observerOffset = mat3MultiplyVec(xf, obsEcef);
  }

  const jupiterState = spkezrState(api, "JUPITER", et, "J2000", abcorr, "EARTH");
  const jupiterPos = observerOffset ? sub(jupiterState.pos, observerOffset) : jupiterState.pos;
  const jupiterRaDec = raDecFromVec(jupiterPos);
  const jupiterRadius = getJupiterRadius(api);
  const angularRadiusArcsec = Math.atan(jupiterRadius / Math.max(jupiterRaDec.rangeKm, 1e-9)) * 206264.806;
  const lineOfSight = unit(jupiterPos);
  const earthState = safeSpkezrState(api, "EARTH", et, args.frame3d, "NONE", "JUPITER");
  const earthDirection = earthState ? unit(earthState.pos) : { x: 1, y: 0, z: 0 };

  const moons = [];
  for (const target of targetsForMode(args.mode)) {
    const moonState = safeSpkezrState(api, target, et, "J2000", abcorr, "EARTH");
    if (!moonState) continue;
    const moonPos = observerOffset ? sub(moonState.pos, observerOffset) : moonState.pos;
    const moonRaDec = raDecFromVec(moonPos);
    const offsets = computeOffsets(moonRaDec.raRad, moonRaDec.decRad, jupiterRaDec.raRad, jupiterRaDec.decRad);
    const rel = sub(moonPos, jupiterPos);
    const onDisk = offsets.separation <= angularRadiusArcsec;
    const dz = dot(rel, lineOfSight);
    const events = onDisk
      ? {
          onDisk,
          ...(dz < 0 ? { transit: true } : { occulted: true })
        }
      : { onDisk };
    const systemState = safeSpkezrState(api, target, et, args.frame3d, "NONE", "JUPITER");
    if (!systemState) continue;
    moons.push({
      key: target,
      displayName: MOON_CATALOG[target]?.displayName ?? target,
      class: classForTarget(target),
      precisionClass: precisionForTarget(target),
      sky: {
        apparent: { raDeg: moonRaDec.raDeg, decDeg: moonRaDec.decDeg },
        offsetArcsec: {
          east: offsets.eastArcsec,
          north: offsets.northArcsec,
          separation: offsets.separation,
          positionAngleDeg: offsets.positionAngleDeg
        }
      },
      system: {
        jupiterCentricKm: systemState.pos,
        rangeFromJupiterKm: norm(systemState.pos)
      },
      events
    });
  }

  const features = SURFACE_FEATURES.map((feature) => {
    const baseLonDeg = feature.lonDeg;
    const driftDegPerDay = feature.driftDegPerDay ?? 0;
    const referenceUTC = feature.referenceUTC;
    const refEt = referenceUTC ? api.str2et(referenceUTC) : et;
    const dtDays = (et - refEt) / 86400;
    const lonDeg = wrapDegrees(baseLonDeg + driftDegPerDay * dtDays);
    const latRad = feature.latDeg * DEG2RAD;
    const lonRad = lonDeg * DEG2RAD;
    const cosLat = Math.cos(latRad);
    const featureBody = {
      x: jupiterRadius * cosLat * Math.cos(lonRad),
      y: jupiterRadius * cosLat * Math.sin(lonRad),
      z: jupiterRadius * Math.sin(latRad)
    };
    const featureJ2000 = mat3MultiplyVec(bodyToJ2000, featureBody);
    const featureToObserver = add(jupiterPos, featureJ2000);
    const featureRaDec = raDecFromVec(featureToObserver);
    const offsets = computeOffsets(featureRaDec.raRad, featureRaDec.decRad, jupiterRaDec.raRad, jupiterRaDec.decRad);
    const cosAlpha = Math.max(0, -dot(unit(featureJ2000), lineOfSight));
    const onDisk = offsets.separation <= angularRadiusArcsec;
    const visible = onDisk && cosAlpha > 0;
    const distanceKm = Math.max(jupiterRaDec.rangeKm, 1e-9);
    const sizeScale = cosAlpha;
    const sizeArcsec = {
      eastWest: (feature.sizeKm.eastWest / distanceKm) * ARCSEC_PER_RAD * sizeScale,
      northSouth: (feature.sizeKm.northSouth / distanceKm) * ARCSEC_PER_RAD * sizeScale
    };

    return {
      key: feature.key,
      displayName: feature.displayName,
      system: { latDeg: feature.latDeg, lonDeg },
      sky: {
        offsetArcsec: {
          east: offsets.eastArcsec,
          north: offsets.northArcsec,
          separation: offsets.separation,
          positionAngleDeg: offsets.positionAngleDeg
        }
      },
      appearance: {
        onDisk,
        visible,
        sizeArcsec
      },
      style: feature.color ? { color: feature.color } : undefined
    };
  });

  return {
    meta: {
      requestTimeUTC: args.timeUTC,
      et,
      mode: args.mode,
      quality: args.quality,
      abcorr,
      observer: {
        kind: args.observer.kind,
        ...(args.observer.kind === "topocentric"
          ? {
              latDeg: args.observer.latDeg,
              lonDeg: args.observer.lonDeg,
              altM: args.observer.altM
            }
          : {})
      },
      frames: {
        sky: "J2000",
        system: args.frame3d
      },
      cache: { bucketSec: 0, etag: "" }
    },
    jupiter: {
      apparent: { raDeg: jupiterRaDec.raDeg, decDeg: jupiterRaDec.decDeg },
      distanceKm: jupiterRaDec.rangeKm,
      angularRadiusArcsec
    },
    earthDirection,
    moons,
    features
  };
}

async function computeOrbits(args: OrbitsRequest): Promise<OrbitsResponse> {
  const api = await ensureSpice();
  const et0 = api.str2et(args.timeUTC);
  const totalSeconds = Math.max(0, args.spanHours * 3600);
  const steps = Math.max(1, Math.floor(totalSeconds / args.stepSeconds));
  const dtSeconds = Array.from({ length: steps + 1 }, (_, i) => i * args.stepSeconds);
  const bodies: OrbitsResponse["bodies"] = {};

  for (const target of targetsForMode(args.mode)) {
    const posKm: number[] = [];
    let missing = false;
    for (const dt of dtSeconds) {
      const state = safeSpkezrState(api, target, et0 + dt, args.frame3d, "NONE", "JUPITER");
      if (!state) {
        missing = true;
        break;
      }
      posKm.push(state.pos.x, state.pos.y, state.pos.z);
    }
    if (missing) continue;
    bodies[target] = {
      class: classForTarget(target),
      precisionClass: precisionForTarget(target),
      posKm
    };
  }

  return {
    meta: {
      baseTimeUTC: args.timeUTC,
      et0,
      spanHours: args.spanHours,
      stepSeconds: args.stepSeconds,
      frame: args.frame3d,
      mode: args.mode
    },
    dtSeconds,
    bodies
  };
}

parentPort?.on("message", async (msg: WorkerRequest) => {
  const respond = (payload: WorkerResponse) => parentPort?.postMessage(payload);
  try {
    if (msg.type === "scene") {
      const result = await computeScene(msg.args);
      respond({ id: msg.id, ok: true, result });
    } else {
      const result = await computeOrbits(msg.args);
      respond({ id: msg.id, ok: true, result });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ id: msg.id, ok: false, error: message });
  }
});
