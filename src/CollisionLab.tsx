import React, { useEffect, useMemo, useRef, useState } from "react";
import { GalaxyRenderer } from "@gl/renderer";
import { GalaxyParameters } from "@domain/parameters";
import { findPreset, presets } from "@domain/presets";
import { clampCollisionStars, makeGalaxyInstance, resolvePreset, scaleGalaxy } from "@domain/collision";

const MOBILE_STAR_CAP = 15_000;
const DESKTOP_STAR_CAP = 30_000;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SUBSTEPS = 2;
const DEFAULT_SOFTENING = 3.0;
const DEFAULT_G = 24.0;

type GalaxySelection = {
  name: string;
  params: GalaxyParameters;
  massScale: number;
  color: string;
};

type Props = {
  currentParams: GalaxyParameters;
  isMobile: boolean;
  onExit: () => void;
};

type WorkerMessage =
  | { type: "ready"; count: number }
  | { type: "frame"; positions: ArrayBuffer; countA: number; countB: number }
  | { type: "error"; message: string };

export function CollisionLab({ currentParams, isMobile, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GalaxyRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const baseBufferRef = useRef<Float32Array | null>(null);
  const starCountRef = useRef(0);
  const [rendererReady, setRendererReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [impactOffset, setImpactOffset] = useState(12);
  const [relativeSpeed, setRelativeSpeed] = useState(1.5);
  const [timeScale, setTimeScale] = useState(1);
  const [status, setStatus] = useState("Select presets and start the collision");
  const [starSize, setStarSize] = useState(0.35);

  const [galaxyA, setGalaxyA] = useState<GalaxySelection>(() => {
    const base = makeGalaxyInstance("Andromeda (M31)", resolvePreset("Andromeda (M31)"), {
      color: "#ff9f6d",
      massScale: 1
    });
    return { ...base };
  });
  const [galaxyB, setGalaxyB] = useState<GalaxySelection>(() => {
    const base = makeGalaxyInstance("Spiral (Sa)", resolvePreset("Spiral (Sa)"), {
      color: "#7bd8ff",
      massScale: 1
    });
    return { ...base };
  });

  const presetOptions = useMemo(() => presets.map((p) => p.name), []);
  const totalStars = useMemo(() => {
    const a = galaxyA.params;
    const b = galaxyB.params;
    return a.starCount + a.bulgeStarCount + b.starCount + b.bulgeStarCount;
  }, [galaxyA.params, galaxyB.params]);

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
      renderer.setPlanarView();
      setRendererReady(true);
    } catch (error) {
      console.error(error);
      setStatus("Failed to init WebGL");
    }
    const onResize = () => {
      renderer.resize();
      renderer.render();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rendererReady) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStarSizeScale(starSize);
    renderer.render();
  }, [rendererReady, starSize]);

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
          renderer.zoom(delta * pinchScale);
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
        renderer.pan2D(dx, dy);
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
      renderer.zoom(-e.deltaY * 0.05);
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
  }, [rendererReady]);

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
      if (msg.type === "ready") {
        setStatus(`Ready · Stars: ${msg.count.toLocaleString()}`);
        return;
      }
      if (msg.type === "frame") {
        const positions = new Float32Array(msg.positions);
        syncPositionsToBuffer(positions, msg.countA, msg.countB);
      }
    };
    return () => {
      worker.postMessage({ type: "terminate" });
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const syncPositionsToBuffer = (positions: Float32Array, countA: number, countB: number) => {
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
      renderer.setStars({ data: buffer, count: total });
    }

    const buffer = baseBufferRef.current!;
    for (let i = 0; i < total; i++) {
      buffer[i * 5] = positions[i * 2];
      buffer[i * 5 + 1] = positions[i * 2 + 1];
      buffer[i * 5 + 2] = 0;
    }
    renderer.updateStarBuffer(buffer);
  };

  // Re-init worker when galaxies change
  useEffect(() => {
    if (!workerRef.current) return;
    setLoading(true);
    setStatus("Generating galaxies...");
    const cap = isMobile ? MOBILE_STAR_CAP : DESKTOP_STAR_CAP;
    const aParams = galaxyA.params;
    const bParams = galaxyB.params;
    const capped = clampCollisionStars(aParams, bParams, cap);
    const countA = capped.a.starCount + capped.a.bulgeStarCount;
    const countB = capped.b.starCount + capped.b.bulgeStarCount;

    const separation = 40;
    const offset = impactOffset * 0.5;

    const payload = {
      dt: DEFAULT_DT * timeScale,
      substeps: DEFAULT_SUBSTEPS,
      softening: DEFAULT_SOFTENING,
      gConst: DEFAULT_G,
      galaxies: [
        {
          count: countA,
          mass: effectiveMass(capped.a, galaxyA.massScale),
          diskScale: Math.max(6, capped.a.diskRadius * 0.3),
          center: [-separation, offset],
          velocity: [0, relativeSpeed],
          seed: 1337
        },
        {
          count: countB,
          mass: effectiveMass(capped.b, galaxyB.massScale),
          diskScale: Math.max(6, capped.b.diskRadius * 0.3),
          center: [separation, -offset],
          velocity: [0, -relativeSpeed],
          seed: 4242
        }
      ]
    };
    workerRef.current.postMessage({ type: "pause" });
    baseBufferRef.current = null;
    starCountRef.current = 0;
    workerRef.current.postMessage({ type: "init", payload });
    workerRef.current.postMessage({ type: "start" });
    setRunning(true);
    setLoading(false);
    setStatus("Running collision sim...");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galaxyA, galaxyB, impactOffset, relativeSpeed, isMobile, timeScale]);

  const pause = () => {
    workerRef.current?.postMessage({ type: "pause" });
    setRunning(false);
  };

  const start = () => {
    workerRef.current?.postMessage({ type: "start" });
    setRunning(true);
  };

  const reset = () => {
    // Re-init to regenerate disks and reset centers.
    setGalaxyA((g) => ({ ...g }));
    setGalaxyB((g) => ({ ...g }));
    setStatus("Reset · Ready");
  };

  const setFromPreset = (target: "A" | "B", name: string) => {
    const presetParams = findPreset(name) ?? resolvePreset(name);
    const next = makeGalaxyInstance(name, presetParams, {
      color: target === "A" ? "#ff9f6d" : "#7bd8ff",
      massScale: 1
    });
    if (target === "A") setGalaxyA({ ...next });
    else setGalaxyB({ ...next });
  };

  const useCurrentParams = (target: "A" | "B") => {
    const next = makeGalaxyInstance("My galaxy", currentParams, {
      color: target === "A" ? "#ff9f6d" : "#7bd8ff",
      massScale: 1
    });
    if (target === "A") setGalaxyA(next);
    else setGalaxyB(next);
  };

  const scaleResolution = (target: "A" | "B", scale: number) => {
    if (target === "A") {
      setGalaxyA((prev) => ({ ...prev, params: scaleGalaxy(prev.params, scale) }));
    } else {
      setGalaxyB((prev) => ({ ...prev, params: scaleGalaxy(prev.params, scale) }));
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

  return (
    <div className="layout">
      <section className="panel viewport-panel">
        <div className="panel-heading-row">
          <div className="panel-heading">Collision viewport</div>
          <div className="heading-actions">
            <button className="btn secondary" onClick={onExit} type="button">
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
        </div>
        <div className="canvas-shell">
          <canvas ref={canvasRef} className="viewport" />
          <div className="scene-badge">
            <div className="scene-title">Galaxy collision lab</div>
            <div className="scene-meta">{status}</div>
          </div>
          <div className="hint">
            Drag to pan · Pinch or scroll to zoom · Total stars: {totalStars.toLocaleString()}
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
                  <span className="field-label-text">Relative speed</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.25}
                  value={relativeSpeed}
                  onChange={(e) => setRelativeSpeed(parseFloat(e.target.value))}
                />
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
              <div className="title-status">Total stars: {totalStars.toLocaleString()}</div>
              <div className="title-status">
                Star cap: {(isMobile ? MOBILE_STAR_CAP : DESKTOP_STAR_CAP).toLocaleString()}
              </div>
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

function effectiveMass(params: GalaxyParameters, massScale: number) {
  const base = (params.starCount + params.bulgeStarCount) / 60000;
  return massScale * Math.max(0.5, base);
}
