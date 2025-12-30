import React, { useEffect, useMemo, useRef, useState } from "react";
import { defaultParameters, GalaxyParameters } from "@domain/parameters";
import { findPreset, presets } from "@domain/presets";
import { GalaxyRenderer } from "@gl/renderer";
import "./styles.css";

const nebulaThemeVars: Record<string, string> = {
  "--bg": "#0a0f1b",
  "--panel": "#111827",
  "--panel-border": "#1f2937",
  "--accent": "#ff8c5a",
  "--accent-2": "#5eead4",
  "--text": "#e5e7eb",
  "--muted": "#9ca3af",
  "--input": "#0f172a",
  "--input-border": "#1f2937",
  "--glow": "rgba(255, 140, 90, 0.24)"
};

type WorkerResult =
  | { type: "result"; id: number; count: number; buffer: ArrayBuffer }
  | { type: "error"; id: number; message: string };

const scrubMultiplier = (event: PointerEvent | React.PointerEvent) => {
  if (event.shiftKey) return 10;
  if (event.altKey) return 0.1;
  return 1;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GalaxyRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentRequestId = useRef(0);
  const [params, setParams] = useState<GalaxyParameters>({ ...defaultParameters });
  const [presetName, setPresetName] = useState<string>("Default");
  const [status, setStatus] = useState("Ready");
  const [generating, setGenerating] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [tiltSupported, setTiltSupported] = useState(false);
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [tiltStatus, setTiltStatus] = useState<string | null>(null);
  const tiltOrigin = useRef<{ beta: number; gamma: number; yaw: number; pitch: number } | null>(
    null
  );
  const [controlsOpen, setControlsOpen] = useState<boolean>(true);

  // Apply theme tokens to CSS variables
  useEffect(() => {
    Object.entries(nebulaThemeVars).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setTiltSupported("DeviceOrientationEvent" in window);
    const ensureOpenOnDesktop = () => {
      if (window.innerWidth > 920) {
        setControlsOpen(true);
      }
    };
    window.addEventListener("resize", ensureOpenOnDesktop);
    return () => window.removeEventListener("resize", ensureOpenOnDesktop);
  }, []);

  // Init renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GalaxyRenderer(canvas);
    rendererRef.current = renderer;
    try {
      renderer.init();
      renderer.resize();
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
    };
  }, []);

  // Canvas interactions (orbit + zoom) with touch support
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
    const pinchScale = 0.04;

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
        renderer.orbit(dx * 0.005, -dy * 0.005);
        if (tiltEnabled) {
          tiltOrigin.current = null;
        }
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
  }, [rendererReady, tiltEnabled]);

  // Worker setup
  useEffect(() => {
    const worker = new Worker(new URL("./domain/generator.worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const msg = event.data;
      if (msg.type === "result") {
        if (msg.id !== currentRequestId.current) return;
        const data = new Float32Array(msg.buffer);
        rendererRef.current?.setStars({ data, count: msg.count });
        setStatus(`Stars: ${msg.count.toLocaleString()}`);
        setGenerating(false);
      } else if (msg.type === "error") {
        if (msg.id !== currentRequestId.current) return;
        setStatus(`Generation failed: ${msg.message}`);
        setGenerating(false);
      }
    };
    return () => {
      worker.postMessage({ type: "terminate" });
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Trigger generation when params change (debounced)
  useEffect(() => {
    if (!workerRef.current) return;
    const timeout = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const requestId = currentRequestId.current + 1;
      currentRequestId.current = requestId;
      setGenerating(true);
      setStatus("Generating...");
      worker.postMessage({ type: "generate", id: requestId, params });
    }, 180);
    return () => clearTimeout(timeout);
  }, [params]);

  useEffect(() => {
    if (!rendererReady || !tiltSupported || tiltEnabled) return;
    const motionEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<PermissionState>;
    };

    const activateTilt = async () => {
      try {
        if (typeof motionEvent?.requestPermission === "function") {
          const permission = await motionEvent.requestPermission();
          if (permission !== "granted") {
            setTiltStatus("Tilt blocked by permission");
            return;
          }
        }
        setTiltEnabled(true);
        setTiltStatus("Tilt steering active");
      } catch {
        setTiltStatus("Tilt unavailable");
      }
    };

    activateTilt();
  }, [rendererReady, tiltSupported, tiltEnabled]);

  useEffect(() => {
    if (!rendererReady || !tiltEnabled) return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const { beta, gamma } = event;
      if (beta === null || gamma === null) return;
      if (!tiltOrigin.current) {
        const { yaw, pitch } = renderer.getAngles();
        tiltOrigin.current = { beta, gamma, yaw, pitch };
        return;
      }
      const origin = tiltOrigin.current;
      const yaw = origin.yaw + degToRad((gamma - origin.gamma) * 1.15);
      const pitch = origin.pitch + degToRad((beta - origin.beta) * 0.85);
      renderer.setAngles(yaw, pitch);
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, [rendererReady, tiltEnabled]);

  const presetOptions = useMemo(() => presets.map((p) => p.name), []);

  const updateParam = (key: keyof GalaxyParameters, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const loadPreset = (name: string) => {
    const preset = findPreset(name);
    if (!preset) return;
    setPresetName(name);
    setParams(preset);
  };

  const resetDefault = () => {
    setPresetName("Default");
    setParams({ ...defaultParameters });
  };

  const handleZoom = (delta: number) => {
    rendererRef.current?.zoom(delta);
  };

  return (
    <div className="page">
      <header className="title-banner">
        <div className="title-text">
          <h1>Nebula Galaxy</h1>
          <p className="title-subtitle">Procedural galaxy viewer (web)</p>
        </div>
        <div className="title-status">
          {status}
          {generating ? " - working..." : ""}
        </div>
      </header>

      <div className="layout">
        <section className="panel viewport-panel">
          <div className="panel-heading">Viewport</div>
          <div className="canvas-shell">
            <canvas ref={canvasRef} className="viewport" />
            <div className="zoom-controls" aria-label="Zoom controls">
              <button className="zoom-btn" onClick={() => handleZoom(-8)} aria-label="Zoom in">
                +
              </button>
              <button className="zoom-btn" onClick={() => handleZoom(8)} aria-label="Zoom out">
                -
              </button>
            </div>
            <div className="hint">
              Drag to orbit | Pinch or use + / - to zoom
              {tiltSupported ? " | Tilt to steer on mobile" : ""}
            </div>
            {tiltStatus && <div className="tilt-chip">{tiltStatus}</div>}
          </div>
        </section>

        <section className={`panel controls-panel ${controlsOpen ? "is-open" : "is-closed"}`}>
          <div
            className="controls-header"
            onClick={() => {
              if (!controlsOpen) setControlsOpen(true);
            }}
          >
            <button
              className="controls-grip"
              aria-label={controlsOpen ? "Hide controls" : "Show controls"}
              onClick={() => setControlsOpen((open) => !open)}
              type="button"
            />
            <div className="controls-heading">
              <div className="panel-heading">Controls</div>
              <button
                className="btn ghost sheet-toggle"
                type="button"
                aria-expanded={controlsOpen}
                onClick={() => setControlsOpen((open) => !open)}
              >
                {controlsOpen ? "Hide" : "Show"}
              </button>
            </div>
            <div className="controls-meta">
              <div className="stack">
                <label className="small-label">Preset</label>
                <select
                  value={presetName}
                  onChange={(e) => loadPreset(e.target.value)}
                  className="select"
                >
                  {presetOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="chip-row quick-actions">
                <button className="btn secondary" onClick={resetDefault}>
                  Reset defaults
                </button>
                <button className="btn secondary" onClick={() => setParams((p) => ({ ...p }))}>
                  Refresh
                </button>
              </div>
            </div>
          </div>
          <div className="controls-scroll">
            <div className="scrub-hint">
              <span className="scrub-handle" aria-hidden="true">
                {"<>"}
              </span>
              <div className="scrub-text">
                Drag any label to scrub values. Hold Shift for 10x steps and Alt for 0.1x precision.
              </div>
            </div>

            <div className="controls-grid">
              <Section title="Galaxy disk">
                <NumericField
                  label="Star count"
                  value={params.starCount}
                  min={1000}
                  max={5_000_000}
                  step={10_000}
                  decimals={0}
                  onChange={(v) => updateParam("starCount", v)}
                />
                <NumericField
                  label="Arm count"
                  value={params.armCount}
                  min={1}
                  max={8}
                  step={1}
                  decimals={0}
                  onChange={(v) => updateParam("armCount", v)}
                />
                <NumericField
                  label="Arm twist"
                  value={params.armTwist}
                  min={0}
                  max={12}
                  step={0.1}
                  decimals={1}
                  onChange={(v) => updateParam("armTwist", v)}
                />
                <NumericField
                  label="Arm spread"
                  value={params.armSpread}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={2}
                  onChange={(v) => updateParam("armSpread", v)}
                />
                <NumericField
                  label="Disk radius"
                  value={params.diskRadius}
                  min={5}
                  max={120}
                  step={0.5}
                  decimals={1}
                  onChange={(v) => updateParam("diskRadius", v)}
                />
                <NumericField
                  label="Vertical thickness"
                  value={params.verticalThickness}
                  min={0}
                  max={5}
                  step={0.05}
                  decimals={2}
                  onChange={(v) => updateParam("verticalThickness", v)}
                />
              </Section>

              <Section title="Noise & light">
                <NumericField
                  label="Noise"
                  value={params.noise}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={2}
                  onChange={(v) => updateParam("noise", v)}
                />
                <NumericField
                  label="Core falloff"
                  value={params.coreFalloff}
                  min={0.1}
                  max={6}
                  step={0.1}
                  decimals={2}
                  onChange={(v) => updateParam("coreFalloff", v)}
                />
                <NumericField
                  label="Brightness"
                  value={params.brightness}
                  min={0.1}
                  max={2.5}
                  step={0.05}
                  decimals={2}
                  onChange={(v) => updateParam("brightness", v)}
                />
              </Section>

              <Section title="Bulge">
                <NumericField
                  label="Bulge radius"
                  value={params.bulgeRadius}
                  min={0.1}
                  max={80}
                  step={0.1}
                  decimals={1}
                  onChange={(v) => updateParam("bulgeRadius", v)}
                />
                <NumericField
                  label="Bulge star count"
                  value={params.bulgeStarCount}
                  min={0}
                  max={100000}
                  step={1000}
                  decimals={0}
                  onChange={(v) => updateParam("bulgeStarCount", v)}
                />
                <NumericField
                  label="Bulge falloff"
                  value={params.bulgeFalloff}
                  min={0.5}
                  max={10}
                  step={0.1}
                  decimals={1}
                  onChange={(v) => updateParam("bulgeFalloff", v)}
                />
                <NumericField
                  label="Bulge vertical scale"
                  value={params.bulgeVerticalScale}
                  min={0.1}
                  max={4}
                  step={0.05}
                  decimals={2}
                  onChange={(v) => updateParam("bulgeVerticalScale", v)}
                />
                <NumericField
                  label="Bulge brightness"
                  value={params.bulgeBrightness}
                  min={0.1}
                  max={6}
                  step={0.05}
                  decimals={2}
                  onChange={(v) => updateParam("bulgeBrightness", v)}
                />
              </Section>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      <div className="field-grid">{children}</div>
    </div>
  );
}

function NumericField({
  label,
  value,
  min,
  max,
  step,
  decimals,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const startX = useRef(0);
  const startValue = useRef(value);
  const isDragging = useRef(false);
  const activePointerId = useRef<number | null>(null);

  useEffect(() => setDraft(value), [value]);

  const commit = (next: number) => {
    const rounded = roundTo(clampNumber(next, min, max), decimals);
    setDraft(rounded);
    onChange(rounded);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (Number.isNaN(parsed)) {
      setDraft(value);
      return;
    }
    commit(parsed);
  };

  const handleStep = (delta: number) => {
    commit(draft + delta * step);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointerId.current = e.pointerId;
    startX.current = e.clientX;
    startValue.current = draft;
    isDragging.current = true;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging.current || e.pointerId !== activePointerId.current) return;
    const delta = e.clientX - startX.current;
    const next = startValue.current + delta * step * scrubMultiplier(e);
    commit(next);
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId.current) return;
    isDragging.current = false;
    activePointerId.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  };

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    },
    []
  );

  return (
    <label className="field">
      <div
        className="field-label"
        onPointerDown={handlePointerDown}
        title="Drag to scrub. Shift=10x, Alt=0.1x."
      >
        <span className="scrub-handle" aria-hidden="true">
          {"<>"}
        </span>
        <span className="field-label-text">{label}</span>
        <span className="scrub-pill" aria-hidden="true">
          drag
        </span>
      </div>
      <div className="field-input">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={handleInput}
          className="input"
        />
        <div className="steppers">
          <button type="button" onClick={() => handleStep(1)} aria-label="Increment">
            +
          </button>
          <button type="button" onClick={() => handleStep(-1)} aria-label="Decrement">
            –
          </button>
        </div>
      </div>
    </label>
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function roundTo(value: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
