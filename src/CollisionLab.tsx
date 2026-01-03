import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mat4, vec3, vec4 } from "gl-matrix";
import { GalaxyRenderer } from "@gl/renderer";
import { GalaxyParameters } from "@domain/parameters";
import { findPreset, presets } from "@domain/presets";
import {
  capGalaxyStars,
  clampCollisionStars,
  makeGalaxyInstance,
  resolvePreset,
  scaleGalaxy
} from "@domain/collision";

const STAR_CAP_PER_GALAXY = 30_000;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SUBSTEPS = 1;
const DEFAULT_SOFTENING = 3.0;
const DEFAULT_G = 24.0;
const ZOOM_MIN = 10;
const ZOOM_MAX = 400;
const DEFAULT_ZOOM_DISTANCE = 90;
const GALAXY_SEPARATION = 40;
const VELOCITY_HANDLE_SCALE = 12;
const MAX_VECTOR_SPEED = 12;
const VECTOR_DRAW_SCALE = VELOCITY_HANDLE_SCALE;
const DEFAULT_VECTOR_SPEED = 1.5;

type GalaxySelection = {
  name: string;
  params: GalaxyParameters;
  massScale: number;
  color: string;
};

type VelocityVector = { vx: number; vy: number };

type ViewState = {
  target: [number, number, number];
  angles: { yaw: number; pitch: number };
  distance: number;
  viewport: { width: number; height: number };
  useOrtho: boolean;
};

type VectorLinkMode = "mirror" | "match" | "free";

type Props = {
  currentParams: GalaxyParameters;
  isMobile: boolean;
  onExit: () => void;
};

type WorkerMessage =
  | { type: "ready"; count: number }
  | { type: "frame"; positions: ArrayBufferLike; countA: number; countB: number; shared: boolean }
  | { type: "stats"; stepMs: number; simFps: number }
  | { type: "error"; message: string };

const capForCollision = (params: GalaxyParameters) => capGalaxyStars(params, STAR_CAP_PER_GALAXY);

export function CollisionLab({ currentParams, isMobile, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GalaxyRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const baseBufferRef = useRef<Float32Array | null>(null);
  const starCountRef = useRef(0);
  const latestFrameRef = useRef<
    { positions: ArrayBufferLike; countA: number; countB: number; shared: boolean } | null
  >(null);
  const framePendingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const vectorDragRef = useRef<{ target: "A" | "B"; pointerId: number } | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [impactOffset, setImpactOffset] = useState(12);
  const [timeScale, setTimeScale] = useState(2);
  const [status, setStatus] = useState("Select presets and start the collision");
  const [starSize, setStarSize] = useState(0.35);
  const [zoomDistance, setZoomDistance] = useState(DEFAULT_ZOOM_DISTANCE);
  const [viewState, setViewState] = useState<ViewState>({
    target: [0, 0, 0],
    angles: { yaw: -Math.PI / 2, pitch: 0 },
    distance: DEFAULT_ZOOM_DISTANCE,
    viewport: { width: 0, height: 0 },
    useOrtho: true
  });
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [perfStats, setPerfStats] = useState({ renderFps: 0, uploadMs: 0, simFps: 0, simStepMs: 0 });

  const [galaxyA, setGalaxyA] = useState<GalaxySelection>(() => {
    const base = makeGalaxyInstance("Andromeda (M31)", capForCollision(resolvePreset("Andromeda (M31)")), {
      color: "#ff9f6d",
      massScale: 1
    });
    return { ...base };
  });
  const [galaxyB, setGalaxyB] = useState<GalaxySelection>(() => {
    const base = makeGalaxyInstance("Spiral (Sa)", capForCollision(resolvePreset("Spiral (Sa)")), {
      color: "#7bd8ff",
      massScale: 1
    });
    return { ...base };
  });
  const [velocityA, setVelocityA] = useState<VelocityVector>({ vx: 0, vy: DEFAULT_VECTOR_SPEED });
  const [velocityB, setVelocityB] = useState<VelocityVector>({ vx: 0, vy: -DEFAULT_VECTOR_SPEED });
  const [vectorLinkMode, setVectorLinkMode] = useState<VectorLinkMode>("free");

  const presetOptions = useMemo(() => presets.map((p) => p.name), []);
  const totalStars = useMemo(() => {
    const a = galaxyA.params;
    const b = galaxyB.params;
    return a.starCount + a.bulgeStarCount + b.starCount + b.bulgeStarCount;
  }, [galaxyA.params, galaxyB.params]);
  const centers = useMemo(() => makeGalaxyCenters(impactOffset), [impactOffset]);
  const velocityStats = useMemo(
    () => ({
      A: vectorToPolar(velocityA),
      B: vectorToPolar(velocityB)
    }),
    [velocityA, velocityB]
  );
  const vectors = useMemo(
    () => [
      { id: "A" as const, color: galaxyA.color, center: centers.A, vector: velocityA },
      { id: "B" as const, color: galaxyB.color, center: centers.B, vector: velocityB }
    ],
    [centers, galaxyA.color, galaxyB.color, velocityA, velocityB]
  );
  const showVectors = !running;

  const getLatestViewState = useCallback((): ViewState | null => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    const cameraState = renderer?.getCameraState?.();
    if (!renderer || !canvas || !cameraState || !cameraState.useOrtho) return null;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    return {
      target: [cameraState.target[0], cameraState.target[1], cameraState.target[2] ?? 0],
      angles: cameraState.angles,
      distance: cameraState.distance,
      viewport: { width, height },
      useOrtho: cameraState.useOrtho
    };
  }, []);

  const syncViewState = useCallback(() => {
    const latest = getLatestViewState();
    if (!latest) return;
    setViewState(latest);
  }, [getLatestViewState]);

  const updateZoomDistance = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setZoomDistance(renderer.getZoomDistance());
    syncViewState();
  }, [syncViewState]);

  const applyZoomDelta = useCallback(
    (delta: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.zoom(delta);
      updateZoomDistance();
    },
    [updateZoomDistance]
  );

  const handleZoomSlider = useCallback(
    (distance: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.setZoomDistance(distance);
      updateZoomDistance();
    },
    [updateZoomDistance]
  );

  const buildViewProjection = useCallback(
    (state: ViewState) => {
      const target = vec3.fromValues(state.target[0], state.target[1], state.target[2] ?? 0);
      const forward = vec3.fromValues(
        Math.cos(state.angles.pitch) * Math.cos(state.angles.yaw),
        Math.sin(state.angles.pitch),
        Math.cos(state.angles.pitch) * Math.sin(state.angles.yaw)
      );
      const eye = vec3.scaleAndAdd(vec3.create(), target, forward, state.distance);
      const up = vec3.fromValues(0, 1, 0);
      const view = mat4.create();
      mat4.lookAt(view, eye, target, up);
      const { width, height } = state.viewport;
      const aspect = width / Math.max(1, height);
      const projection = mat4.create();
      if (state.useOrtho) {
        const size = state.distance;
        mat4.ortho(projection, -size * aspect, size * aspect, -size, size, -500, 500);
      } else {
        mat4.perspective(projection, degToRad(60), Math.max(0.1, aspect), 0.1, 1000);
      }
      const vp = mat4.multiply(mat4.create(), projection, view);
      const invVp = mat4.invert(mat4.create(), vp) ?? null;
      return { vp, invVp };
    },
    []
  );

  const worldToScreen = useCallback(
    (point: [number, number], state?: ViewState) => {
      const next = state ?? getLatestViewState() ?? viewState;
      const { width, height } = next.viewport;
      if (width <= 0 || height <= 0) return null;
      const { vp } = buildViewProjection(next);
      const world = vec4.fromValues(point[0], point[1], 0, 1);
      const clip = vec4.transformMat4(vec4.create(), world, vp);
      const w = clip[3] || 1;
      const xNdc = clip[0] / w;
      const yNdc = clip[1] / w;
      return {
        x: (xNdc * 0.5 + 0.5) * width,
        y: (1 - (yNdc * 0.5 + 0.5)) * height
      };
    },
    [buildViewProjection, getLatestViewState, viewState]
  );

  const screenToWorld = useCallback(
    (x: number, y: number, state?: ViewState) => {
      const next = state ?? getLatestViewState() ?? viewState;
      const { width, height } = next.viewport;
      if (width <= 0 || height <= 0) return null;
      const { invVp } = buildViewProjection(next);
      if (!invVp) return null;
      const xNdc = (x / width) * 2 - 1;
      const yNdc = 1 - (y / height) * 2;
      const clip = vec4.fromValues(xNdc, yNdc, 0, 1);
      const world = vec4.transformMat4(vec4.create(), clip, invVp);
      const w = world[3] || 1;
      return { x: world[0] / w, y: world[1] / w };
    },
    [buildViewProjection, getLatestViewState, viewState]
  );

  const enterFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell?.requestFullscreen) return;
    setFullscreenMode(true);
    shell.requestFullscreen().catch(() => setFullscreenMode(false));
  }, []);

  const exitFullscreen = useCallback(() => {
    setFullscreenMode(false);
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) return;
    document.exitFullscreen?.().catch(() => {
      /* ignore fullscreen exit errors */
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (fullscreenMode) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, fullscreenMode]);

  const handleExit = useCallback(() => {
    if (fullscreenMode) {
      exitFullscreen();
    }
    onExit();
  }, [exitFullscreen, fullscreenMode, onExit]);

  // Init renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GalaxyRenderer(canvas);
    rendererRef.current = renderer;
    try {
      renderer.init();
      renderer.resize();
      renderer.setStarSizeScale(starSize);
      renderer.setPlanarView(DEFAULT_ZOOM_DISTANCE);
      updateZoomDistance();
      setRendererReady(true);
    } catch (error) {
      console.error(error);
      setStatus("Failed to init WebGL");
    }
    const onResize = () => {
      renderer.resize();
      renderer.render();
      updateZoomDistance();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [updateZoomDistance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rendererReady) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStarSizeScale(starSize);
    renderer.render();
  }, [rendererReady, starSize]);

  useEffect(() => {
    if (!rendererReady) return;
    updateZoomDistance();
    syncViewState();
  }, [rendererReady, syncViewState, updateZoomDistance]);

  // Track render FPS on the main thread.
  useEffect(() => {
    if (!rendererReady) return;
    let frames = 0;
    let last = performance.now();
    let rafId: number;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        const fps = Math.round((frames * 1000) / (now - last));
        setPerfStats((prev) => ({ ...prev, renderFps: fps }));
        frames = 0;
        last = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [rendererReady]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => {
      const isActive = document.fullscreenElement === shellRef.current;
      setFullscreenMode(isActive);
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.resize();
        renderer.render();
        updateZoomDistance();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [updateZoomDistance]);

  useEffect(() => {
    if (!rendererReady) return;
    if (typeof ResizeObserver === "undefined") return;
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.resize();
      renderer.render();
      updateZoomDistance();
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [rendererReady, updateZoomDistance]);

  // Pointer controls (pan + zoom)
  useEffect(() => {
    if (!rendererReady) return;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const activePointers = new Map<number, { x: number; y: number }>();
    let draggingId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let lastPinchDistance: number | null = null;
    const pinchScale = 0.12;

    const updatePointer = (e: PointerEvent) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };

    const currentPinchDistance = () => {
      if (activePointers.size < 2) return 0;
      const [a, b] = Array.from(activePointers.values());
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e: PointerEvent) => {
      updatePointer(e);
      if (activePointers.size === 1) {
        draggingId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
      } else {
        draggingId = null;
        lastPinchDistance = currentPinchDistance();
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      updatePointer(e);

      if (activePointers.size >= 2) {
        const dist = currentPinchDistance();
        if (lastPinchDistance !== null && dist > 0) {
          const delta = lastPinchDistance - dist;
          applyZoomDelta(delta * pinchScale);
        }
        lastPinchDistance = dist;
        return;
      }

      lastPinchDistance = null;
      if (draggingId === e.pointerId) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        renderer.pan2D(-dx, dy);
        syncViewState();
      }
    };
    const onUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (draggingId === e.pointerId) {
        draggingId = null;
      }
      if (activePointers.size < 2) {
        lastPinchDistance = null;
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignored */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoomDelta(-e.deltaY * 0.05);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [applyZoomDelta, rendererReady, syncViewState]);

  // Worker setup
  useEffect(() => {
    const worker = new Worker(new URL("./domain/collision.worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      if (msg.type === "error") {
        setStatus(`Simulation error: ${msg.message}`);
        setRunning(false);
        return;
      }
      if (msg.type === "stats") {
        setPerfStats((prev) => ({ ...prev, simFps: Math.round(msg.simFps), simStepMs: msg.stepMs }));
        return;
      }
      if (msg.type === "ready") {
        setStatus(`Ready - Stars: ${msg.count.toLocaleString()}`);
        return;
      }
      if (msg.type === "frame") {
        latestFrameRef.current = { positions: msg.positions, countA: msg.countA, countB: msg.countB, shared: msg.shared };
        if (!framePendingRef.current) {
          framePendingRef.current = true;
          rafIdRef.current = requestAnimationFrame(() => {
            framePendingRef.current = false;
            const frame = latestFrameRef.current;
            if (!frame) return;
            syncPositionsToBuffer(frame.positions, frame.countA, frame.countB);
          });
        }
      }
    };
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
        framePendingRef.current = false;
      }
      worker.postMessage({ type: "terminate" });
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const syncPositionsToBuffer = (positionsBuffer: ArrayBufferLike, countA: number, countB: number) => {
    const positions = new Float32Array(positionsBuffer);
    const total = positions.length / 2;
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!baseBufferRef.current || starCountRef.current !== total) {
      const buffer = new Float32Array(total * 5);
      // Static intensities/colors: warm for A, cool for B.
      for (let i = 0; i < total; i++) {
        const color = i < countA ? 0.6 + Math.random() * 0.25 : 0.2 + Math.random() * 0.25;
        const intensity = 0.6 + Math.random() * 0.6;
        buffer[i * 5 + 1] = 0;
        buffer[i * 5 + 3] = intensity;
        buffer[i * 5 + 4] = color;
      }
      baseBufferRef.current = buffer;
      starCountRef.current = total;
      const t0 = performance.now();
      renderer.setStars({ data: buffer, count: total });
      setPerfStats((prev) => ({ ...prev, uploadMs: performance.now() - t0 }));
    }

    const buffer = baseBufferRef.current!;
    for (let i = 0; i < total; i++) {
      buffer[i * 5] = positions[i * 2];
      buffer[i * 5 + 1] = positions[i * 2 + 1];
      buffer[i * 5 + 2] = 0;
    }
    const t1 = performance.now();
    renderer.updateStarBuffer(buffer);
    setPerfStats((prev) => ({ ...prev, uploadMs: performance.now() - t1 }));
  };

  // Re-init worker when galaxies change
  useEffect(() => {
    if (!workerRef.current) return;
    setLoading(true);
    setStatus("Generating galaxies...");
    const capped = clampCollisionStars(galaxyA.params, galaxyB.params, STAR_CAP_PER_GALAXY);

    const payload = {
      dt: DEFAULT_DT,
      timeScale,
      substeps: DEFAULT_SUBSTEPS,
      softening: DEFAULT_SOFTENING,
      gConst: DEFAULT_G,
      galaxies: [
        {
          params: capped.a,
          mass: effectiveMass(capped.a, galaxyA.massScale),
          center: centers.A,
          velocity: [velocityA.vx, velocityA.vy],
          seed: 1337
        },
        {
          params: capped.b,
          mass: effectiveMass(capped.b, galaxyB.massScale),
          center: centers.B,
          velocity: [velocityB.vx, velocityB.vy],
          seed: 4242
        }
      ]
    };
    workerRef.current.postMessage({ type: "pause" });
    baseBufferRef.current = null;
    starCountRef.current = 0;
    workerRef.current.postMessage({ type: "init", payload });
    setRunning(false);
    setLoading(false);
    setStatus("Ready to play");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galaxyA, galaxyB, centers, velocityA, velocityB, isMobile]);

  // Adjust time scale without re-seeding galaxies.
  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "setTimeScale", value: timeScale });
  }, [timeScale]);

  useEffect(
    () => () => {
      if (typeof document === "undefined") return;
      if (document.fullscreenElement === shellRef.current) {
        const exitPromise = document.exitFullscreen?.();
        if (exitPromise) {
          exitPromise.catch(() => {
            /* ignore fullscreen exit errors */
          });
        }
      }
    },
    []
  );

  const pause = () => {
    workerRef.current?.postMessage({ type: "pause" });
    setRunning(false);
    setStatus("Paused");
  };

  const start = () => {
    workerRef.current?.postMessage({ type: "start" });
    setRunning(true);
    setStatus("Running collision sim...");
  };

  const reset = () => {
    // Re-init to regenerate disks and reset centers.
    pause();
    setGalaxyA((g) => ({ ...g }));
    setGalaxyB((g) => ({ ...g }));
    setVelocityPair({ vx: 0, vy: DEFAULT_VECTOR_SPEED }, { vx: 0, vy: -DEFAULT_VECTOR_SPEED });
    setVectorLinkMode("free");
    setImpactOffset(12);
    setStatus("Reset - Ready");
  };

  const setFromPreset = (target: "A" | "B", name: string) => {
    const presetParams = capForCollision(findPreset(name) ?? resolvePreset(name));
    const next = makeGalaxyInstance(name, presetParams, {
      color: target === "A" ? "#ff9f6d" : "#7bd8ff",
      massScale: 1
    });
    if (target === "A") setGalaxyA({ ...next });
    else setGalaxyB({ ...next });
  };

  const useCurrentParams = (target: "A" | "B") => {
    const next = makeGalaxyInstance("My galaxy", capForCollision(currentParams), {
      color: target === "A" ? "#ff9f6d" : "#7bd8ff",
      massScale: 1
    });
    if (target === "A") setGalaxyA(next);
    else setGalaxyB(next);
  };

  const scaleResolution = (target: "A" | "B", scale: number) => {
    if (target === "A") {
      setGalaxyA((prev) => ({ ...prev, params: capForCollision(scaleGalaxy(prev.params, scale)) }));
    } else {
      setGalaxyB((prev) => ({ ...prev, params: capForCollision(scaleGalaxy(prev.params, scale)) }));
    }
  };

  const updateMassScale = (target: "A" | "B", massScale: number) => {
    const clamped = clampNumber(massScale, 0.2, 5);
    if (target === "A") setGalaxyA((prev) => ({ ...prev, massScale: clamped }));
    else setGalaxyB((prev) => ({ ...prev, massScale: clamped }));
  };

  const updateStarSize = (value: number) => {
    const renderer = rendererRef.current;
    setStarSize(value);
    renderer?.setStarSizeScale(value);
    renderer?.render();
  };

  const setVelocityPair = useCallback((a: VelocityVector, b: VelocityVector) => {
    setVelocityA(clampVector(a, MAX_VECTOR_SPEED));
    setVelocityB(clampVector(b, MAX_VECTOR_SPEED));
  }, []);

  const updateVelocity = useCallback(
    (target: "A" | "B", vec: VelocityVector, options?: { skipLink?: boolean }) => {
      const clamped = clampVector(vec, MAX_VECTOR_SPEED);
      if (target === "A") {
        setVelocityA(clamped);
        if (!options?.skipLink) {
          if (vectorLinkMode === "mirror") {
            setVelocityB(clampVector(mirrorVector(clamped), MAX_VECTOR_SPEED));
          } else if (vectorLinkMode === "match") {
            setVelocityB(clamped);
          }
        }
      } else {
        setVelocityB(clamped);
        if (!options?.skipLink) {
          if (vectorLinkMode === "mirror") {
            setVelocityA(clampVector(mirrorVector(clamped), MAX_VECTOR_SPEED));
          } else if (vectorLinkMode === "match") {
            setVelocityA(clamped);
          }
        }
      }
    },
    [vectorLinkMode]
  );

  const setVelocityFromPolar = useCallback(
    (target: "A" | "B", speed: number, angleDeg: number) => {
      updateVelocity(target, vectorFromPolar(speed, angleDeg));
    },
    [updateVelocity]
  );

  const applyVelocityPreset = useCallback(
    (preset: "head-on" | "grazing" | "orbit") => {
      if (preset === "head-on") {
        setVectorLinkMode("mirror");
        setImpactOffset(12);
        setVelocityPair(
          { vx: 0, vy: DEFAULT_VECTOR_SPEED * 1.1 },
          { vx: 0, vy: -DEFAULT_VECTOR_SPEED * 1.1 }
        );
        return;
      }
      if (preset === "grazing") {
        setVectorLinkMode("mirror");
        setImpactOffset(18);
        setVelocityPair(
          { vx: DEFAULT_VECTOR_SPEED * 0.5, vy: DEFAULT_VECTOR_SPEED * 1.15 },
          { vx: -DEFAULT_VECTOR_SPEED * 0.5, vy: -DEFAULT_VECTOR_SPEED * 1.15 }
        );
        return;
      }
      setVectorLinkMode("mirror");
      setImpactOffset(24);
      setVelocityPair(
        { vx: DEFAULT_VECTOR_SPEED * 0.9, vy: DEFAULT_VECTOR_SPEED * 0.8 },
        { vx: -DEFAULT_VECTOR_SPEED * 0.9, vy: -DEFAULT_VECTOR_SPEED * 0.8 }
      );
    },
    [setImpactOffset, setVectorLinkMode, setVelocityPair]
  );

  useEffect(() => {
    if (vectorLinkMode === "free") return;
    const target = vectorLinkMode === "mirror" ? mirrorVector(velocityA) : velocityA;
    const clamped = clampVector(target, MAX_VECTOR_SPEED);
    setVelocityB((prev) => (vectorsEqual(prev, clamped) ? prev : clamped));
  }, [vectorLinkMode, velocityA]);

  const handleVectorPointer = useCallback(
    (target: "A" | "B", clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const liveView = getLatestViewState();
      const world = screenToWorld(localX, localY, liveView ?? undefined);
      if (!world) return;
      const center = target === "A" ? centers.A : centers.B;
      const next = {
        vx: (world.x - center[0]) / VELOCITY_HANDLE_SCALE,
        vy: (world.y - center[1]) / VELOCITY_HANDLE_SCALE
      };
      updateVelocity(target, next);
    },
    [centers, getLatestViewState, screenToWorld, updateVelocity]
  );

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const drag = vectorDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      handleVectorPointer(drag.target, event.clientX, event.clientY);
    },
    [handleVectorPointer]
  );

  const endVectorDrag = useCallback(
    (event?: PointerEvent) => {
      const drag = vectorDragRef.current;
      if (!drag) return;
      if (event && "pointerId" in event && event.pointerId !== drag.pointerId) return;
      vectorDragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", endVectorDrag);
      window.removeEventListener("pointercancel", endVectorDrag);
    },
    [handleMove]
  );

  const startVectorDrag = useCallback(
    (target: "A" | "B", event: React.PointerEvent) => {
      event.stopPropagation();
      event.preventDefault();
      vectorDragRef.current = { target, pointerId: event.pointerId };
      handleVectorPointer(target, event.clientX, event.clientY);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", endVectorDrag);
      window.addEventListener("pointercancel", endVectorDrag);
    },
    [endVectorDrag, handleMove, handleVectorPointer]
  );

  useEffect(
    () => () => {
      endVectorDrag();
    },
    [endVectorDrag]
  );

  const statsA = velocityStats.A;
  const statsB = velocityStats.B;

  return (
    <div className="layout collision-layout">
      <section className="panel viewport-panel">
        <div className="panel-heading-row">
          <div className="panel-heading">Collision viewport</div>
          <div className="heading-actions">
            <button className="btn secondary" onClick={handleExit} type="button">
              Back to explorer
            </button>
          </div>
        </div>
        <div className="viewport-toolbar">
          <div className="zoom-controls" aria-label="Playback controls">
            <div className="zoom-row">
              <div className="zoom-label">Playback</div>
              <div className="zoom-value">{running ? "Playing" : "Paused"}</div>
            </div>
            <div className="chip-row">
              <button className="btn primary" disabled={loading} onClick={start} type="button">
                Play
              </button>
              <button className="btn secondary" onClick={pause} type="button">
                Pause
              </button>
              <button className="btn ghost" onClick={reset} type="button">
                Reset
              </button>
            </div>
          </div>
          <div className="zoom-controls" aria-label="Time scale">
            <div className="zoom-row">
              <div className="zoom-label">Time scale</div>
              <div className="zoom-value">{timeScale.toFixed(2)}x</div>
            </div>
            <input
              className="zoom-slider"
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={timeScale}
              onChange={(e) => setTimeScale(parseFloat(e.target.value))}
            />
          </div>
          <div className="zoom-controls" aria-label="Zoom controls">
            <div className="zoom-row">
              <div className="zoom-label">Zoom</div>
              <div className="zoom-value">{Math.round(zoomDistance)}</div>
            </div>
            <input
              className="zoom-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={distanceToSlider(zoomDistance)}
              onChange={(e) => handleZoomSlider(sliderToDistance(parseFloat(e.target.value)))}
              aria-valuemin={ZOOM_MIN}
              aria-valuemax={ZOOM_MAX}
              aria-valuenow={Math.round(zoomDistance)}
              aria-label="Zoom level"
            />
            <div className="zoom-legend" aria-hidden="true">
              <span>Wide</span>
              <span>Close</span>
            </div>
          </div>
        </div>
        <div className={`canvas-shell ${fullscreenMode ? "is-immersive" : ""}`} ref={shellRef}>
          <canvas ref={canvasRef} className="viewport" />
          {showVectors && (
            <div className="vector-overlay" aria-hidden="true">
              <svg
                className="vector-svg"
                viewBox={`0 0 ${Math.max(1, viewState.viewport.width)} ${Math.max(1, viewState.viewport.height)}`}
                preserveAspectRatio="none"
              >
                {vectors.map(({ id, color, center, vector }) => {
                  const start = worldToScreen(center);
                  const end = worldToScreen([
                    center[0] + vector.vx * VECTOR_DRAW_SCALE,
                    center[1] + vector.vy * VECTOR_DRAW_SCALE
                  ]);
                  if (!start || !end) return null;
                  return (
                    <g key={id} className="vector-path">
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeOpacity={0.9}
                      />
                      <circle cx={start.x} cy={start.y} r={4} fill={color} fillOpacity={0.75} />
                    </g>
                  );
                })}
              </svg>
              {vectors.map(({ id, color, center, vector }) => {
                const start = worldToScreen(center);
                const end = worldToScreen([
                  center[0] + vector.vx * VECTOR_DRAW_SCALE,
                  center[1] + vector.vy * VECTOR_DRAW_SCALE
                ]);
                if (!start || !end) return null;
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                return (
                  <React.Fragment key={id}>
                    <div
                      className="vector-base"
                      style={{ left: `${start.x}px`, top: `${start.y}px`, borderColor: color }}
                    />
                    <button
                      className="vector-handle"
                      style={{
                        left: `${end.x}px`,
                        top: `${end.y}px`,
                        color,
                        transform: `translate(-50%, -50%) rotate(${angle}rad)`
                      }}
                      onPointerDown={(e) => startVectorDrag(id, e)}
                      aria-label={`Drag to set galaxy ${id} velocity`}
                    >
                      <span className="vector-arrow" />
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
          <div className="scene-badge">
            <div className="scene-title">Galaxy collision lab</div>
            <div className="scene-meta">{status}</div>
          </div>
          <div className="perf-badge">
            <div>Render: {perfStats.renderFps.toFixed(0)} fps</div>
            <div>Sim: {perfStats.simFps.toFixed(0)} fps ({perfStats.simStepMs.toFixed(2)} ms)</div>
            <div>Upload: {perfStats.uploadMs.toFixed(2)} ms</div>
            <div>vA: {velocityA.vx.toFixed(2)}, {velocityA.vy.toFixed(2)}</div>
            <div>vB: {velocityB.vx.toFixed(2)}, {velocityB.vy.toFixed(2)}</div>
          </div>
          <div className="view-actions">
            <button
              className={`fullscreen-btn ${fullscreenMode ? "is-active" : ""}`}
              onClick={toggleFullscreen}
              type="button"
            >
              {fullscreenMode ? "Exit full view" : "Full Screen"}
            </button>
          </div>
          <div className="hint">
            Drag to pan | Drag the velocity arrows to set starting vectors | Pinch/scroll or use the zoom slider | Total
            stars: {totalStars.toLocaleString()}
          </div>
        </div>
      </section>

      <section className="panel controls-panel">
        <div className="panel-heading-row">
          <div className="panel-heading">Setup</div>
          <div className="title-status">{loading ? "Generating..." : "Ready"}</div>
        </div>
        <div className="controls-scroll">
          <div className="controls-grid">
            <div className="section">
              <div className="section-title">Galaxy A</div>
              <div className="field-grid">
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Preset</span>
                  </div>
                  <select
                    className="select"
                    value={galaxyA.name}
                    onChange={(e) => setFromPreset("A", e.target.value)}
                  >
                    {presetOptions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Mass scale</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.1}
                    value={galaxyA.massScale}
                    onChange={(e) => updateMassScale("A", parseFloat(e.target.value))}
                  />
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Resolution scale</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    defaultValue={1}
                    onChange={(e) => scaleResolution("A", parseFloat(e.target.value))}
                  />
                </label>
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <button className="btn secondary" type="button" onClick={() => useCurrentParams("A")}>
                  Use current galaxy
                </button>
                <div className="title-status">
                  Stars: {(galaxyA.params.starCount + galaxyA.params.bulgeStarCount).toLocaleString()}
                </div>
              </div>
              <div className="velocity-block">
                <div className="small-label">Velocity vector</div>
                <div className="field-grid velocity-grid">
                  <label className="field">
                    <div className="field-label">
                      <span className="field-label-text">Speed</span>
                    </div>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={MAX_VECTOR_SPEED}
                      step={0.05}
                      value={statsA.speed.toFixed(2)}
                      onChange={(e) => {
                        const next = parseFloat(e.target.value);
                        if (Number.isNaN(next)) return;
                        setVelocityFromPolar("A", clampNumber(next, 0, MAX_VECTOR_SPEED), statsA.angleDeg);
                      }}
                    />
                  </label>
                  <label className="field">
                    <div className="field-label">
                      <span className="field-label-text">Heading (°)</span>
                    </div>
                    <input
                      className="input"
                      type="number"
                      min={-360}
                      max={360}
                      step={1}
                      value={Math.round(statsA.angleDeg)}
                      onChange={(e) => {
                        const next = parseFloat(e.target.value);
                        if (Number.isNaN(next)) return;
                        setVelocityFromPolar("A", statsA.speed, wrapDegrees(next));
                      }}
                    />
                  </label>
                  <div className="field">
                    <div className="field-label">
                      <span className="field-label-text">Components</span>
                    </div>
                    <div className="title-status">
                      vx: {velocityA.vx.toFixed(2)} | vy: {velocityA.vy.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="chip-row" style={{ marginTop: 6 }}>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => updateVelocity("A", { vx: 0, vy: DEFAULT_VECTOR_SPEED })}
                  >
                    Reset vector
                  </button>
                  <div className="title-status">Max speed: {MAX_VECTOR_SPEED.toFixed(1)}</div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">Galaxy B</div>
              <div className="field-grid">
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Preset</span>
                  </div>
                  <select
                    className="select"
                    value={galaxyB.name}
                    onChange={(e) => setFromPreset("B", e.target.value)}
                  >
                    {presetOptions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Mass scale</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.1}
                    value={galaxyB.massScale}
                    onChange={(e) => updateMassScale("B", parseFloat(e.target.value))}
                  />
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Resolution scale</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    defaultValue={1}
                    onChange={(e) => scaleResolution("B", parseFloat(e.target.value))}
                  />
                </label>
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <button className="btn secondary" type="button" onClick={() => useCurrentParams("B")}>
                  Use current galaxy
                </button>
                <div className="title-status">
                  Stars: {(galaxyB.params.starCount + galaxyB.params.bulgeStarCount).toLocaleString()}
                </div>
              </div>
              <div className="velocity-block">
                <div className="small-label">Velocity vector</div>
                <div className="field-grid velocity-grid">
                  <label className="field">
                    <div className="field-label">
                      <span className="field-label-text">Speed</span>
                    </div>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={MAX_VECTOR_SPEED}
                      step={0.05}
                      value={statsB.speed.toFixed(2)}
                      onChange={(e) => {
                        const next = parseFloat(e.target.value);
                        if (Number.isNaN(next)) return;
                        setVelocityFromPolar("B", clampNumber(next, 0, MAX_VECTOR_SPEED), statsB.angleDeg);
                      }}
                    />
                  </label>
                  <label className="field">
                    <div className="field-label">
                      <span className="field-label-text">Heading (°)</span>
                    </div>
                    <input
                      className="input"
                      type="number"
                      min={-360}
                      max={360}
                      step={1}
                      value={Math.round(statsB.angleDeg)}
                      onChange={(e) => {
                        const next = parseFloat(e.target.value);
                        if (Number.isNaN(next)) return;
                        setVelocityFromPolar("B", statsB.speed, wrapDegrees(next));
                      }}
                    />
                  </label>
                  <div className="field">
                    <div className="field-label">
                      <span className="field-label-text">Components</span>
                    </div>
                    <div className="title-status">
                      vx: {velocityB.vx.toFixed(2)} | vy: {velocityB.vy.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="chip-row" style={{ marginTop: 6 }}>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => updateVelocity("B", { vx: 0, vy: -DEFAULT_VECTOR_SPEED })}
                  >
                    Reset vector
                  </button>
                  <div className="title-status">Max speed: {MAX_VECTOR_SPEED.toFixed(1)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Encounter</div>
            <div className="field-grid">
              <label className="field">
                <div className="field-label">
                  <span className="field-label-text">Impact offset</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={impactOffset}
                  onChange={(e) => setImpactOffset(parseFloat(e.target.value))}
                />
              </label>
              <label className="field">
                <div className="field-label">
                  <span className="field-label-text">Vector coupling</span>
                </div>
                <select
                  className="select"
                  value={vectorLinkMode}
                  onChange={(e) => setVectorLinkMode(e.target.value as VectorLinkMode)}
                >
                  <option value="mirror">Mirror (equal & opposite)</option>
                  <option value="match">Match (copy A → B)</option>
                  <option value="free">Independent</option>
                </select>
              </label>
              <label className="field">
                <div className="field-label">
                  <span className="field-label-text">Star size</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={starSize}
                  onChange={(e) => updateStarSize(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              <button className="btn secondary" type="button" onClick={() => applyVelocityPreset("head-on")}>
                Head-on
              </button>
              <button className="btn ghost" type="button" onClick={() => applyVelocityPreset("grazing")}>
                Grazing pass
              </button>
              <button className="btn ghost" type="button" onClick={() => applyVelocityPreset("orbit")}>
                Orbit attempt
              </button>
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              <div className="title-status">Total stars: {totalStars.toLocaleString()}</div>
              <div className="title-status">Star cap per galaxy: {STAR_CAP_PER_GALAXY.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampVector(vec: VelocityVector, maxMagnitude: number): VelocityVector {
  const mag = Math.hypot(vec.vx, vec.vy);
  if (!isFinite(mag)) return { vx: 0, vy: 0 };
  if (mag <= maxMagnitude) return { vx: vec.vx, vy: vec.vy };
  const scale = maxMagnitude / Math.max(1e-6, mag);
  return { vx: vec.vx * scale, vy: vec.vy * scale };
}

function vectorsEqual(a: VelocityVector, b: VelocityVector) {
  return Math.abs(a.vx - b.vx) < 1e-4 && Math.abs(a.vy - b.vy) < 1e-4;
}

function mirrorVector(vec: VelocityVector): VelocityVector {
  return { vx: -vec.vx, vy: -vec.vy };
}

function vectorFromPolar(speed: number, angleDeg: number): VelocityVector {
  const rad = degToRad(angleDeg);
  return { vx: speed * Math.cos(rad), vy: speed * Math.sin(rad) };
}

function vectorToPolar(vec: VelocityVector) {
  const speed = Math.hypot(vec.vx, vec.vy);
  const angleDeg = wrapDegrees((Math.atan2(vec.vy, vec.vx) * 180) / Math.PI);
  return { speed, angleDeg };
}

function makeGalaxyCenters(impactOffset: number): { A: [number, number]; B: [number, number] } {
  const offset = impactOffset * 0.5;
  return {
    A: [-GALAXY_SEPARATION, offset],
    B: [GALAXY_SEPARATION, -offset]
  };
}

function distanceToSlider(distance: number) {
  const span = ZOOM_MAX - ZOOM_MIN;
  const clamped = clampNumber(distance, ZOOM_MIN, ZOOM_MAX);
  return span ? ((ZOOM_MAX - clamped) / span) * 100 : 0;
}

function sliderToDistance(value: number) {
  const span = ZOOM_MAX - ZOOM_MIN;
  const clamped = clampNumber(value, 0, 100);
  return ZOOM_MAX - (clamped / 100) * span;
}

function effectiveMass(params: GalaxyParameters, massScale: number) {
  const base = (params.starCount + params.bulgeStarCount) / 60000;
  return massScale * Math.max(0.5, base);
}

function wrapDegrees(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}
