import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JupiterRenderer } from "@gl/jupiterRenderer";
import type { SceneResponse } from "./types/jupiter";

type JupiterLabProps = {
  onExit: () => void;
};

const DEFAULT_FOV_ARCSEC = 240;
const MIN_FOV_ARCSEC = 80;
const MAX_FOV_ARCSEC = 1600;
const REFRESH_MS = 4000;
const REQUEST_TIMEOUT_MS = 120000;
const ORBIT_DEFAULT_DISTANCE = 2.2;
const ORBIT_MIN_DISTANCE = 0.6;
const ORBIT_MAX_DISTANCE = 6;
const JUPITER_RADIUS_KM = 71492;
const ORBIT_BODY_STRIDE = 7;
const JUPITER_SIZE = 120;
const MOON_SIZE = 16;
const COLOR_JUPITER: [number, number, number] = [1, 0.62, 0.33];
const COLOR_MOON: [number, number, number] = [0.22, 0.74, 0.97];
const COLOR_TRANSIT: [number, number, number] = [1, 0.55, 0.35];
const COLOR_OCCULTED: [number, number, number] = [0.55, 0.58, 0.66];
const REFERENCE_GRID_RADIUS = 1.1;
const REFERENCE_GRID_STEP = 0.2;
const REFERENCE_AXIS_LENGTH = 1.25;
const REFERENCE_ARROW_SIZE = 0.08;
const EARTH_ARROW_LENGTH = 1.35;
const EARTH_ARROW_SIZE = 0.07;
const GRID_COLOR: [number, number, number, number] = [0.7, 0.86, 1, 0.6];
const AXIS_X_COLOR: [number, number, number, number] = [1, 0.4, 0.36, 0.92];
const AXIS_Y_COLOR: [number, number, number, number] = [0.45, 1, 0.62, 0.92];
const AXIS_Z_COLOR: [number, number, number, number] = [0.46, 0.66, 1, 0.92];
const EARTH_ARROW_COLOR: [number, number, number, number] = [1, 0.93, 0.45, 0.95];

type ViewMode = "telescope" | "orbit";

export default function JupiterLab({ onExit }: JupiterLabProps) {
  const [mode, setMode] = useState<"inner" | "regular" | "all">("inner");
  const [quality, setQuality] = useState<"high" | "eco">("high");
  const [frame3d, setFrame3d] = useState<"J2000" | "IAU_JUPITER">("J2000");
  const [fovArcsec, setFovArcsec] = useState(DEFAULT_FOV_ARCSEC);
  const [useLocation, setUseLocation] = useState(false);
  const [latInput, setLatInput] = useState("0");
  const [lonInput, setLonInput] = useState("0");
  const [altInput, setAltInput] = useState("0");
  const [scene, setScene] = useState<SceneResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [viewSize, setViewSize] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("telescope");
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportShellRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<JupiterRenderer | null>(null);
  const etagRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const activeRequestRef = useRef(0);

  const fetchScene = useCallback(
    async (force = false) => {
      if (inFlightRef.current && !force) return;
      if (force && abortRef.current) {
        abortRef.current.abort();
      }

      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      inFlightRef.current = true;

      const params = new URLSearchParams();
      params.set("t", "now");
      params.set("mode", mode);
      params.set("quality", quality);
      params.set("frame3d", frame3d);

      const lat = toNumber(latInput);
      const lon = toNumber(lonInput);
      const alt = toNumber(altInput);
      if (useLocation && lat !== null && lon !== null) {
        params.set("lat", lat.toFixed(4));
        params.set("lon", lon.toFixed(4));
        if (alt !== null) {
          params.set("alt", alt.toFixed(0));
        }
      }

      const url = `/api/jupiter/scene?${params.toString()}`;
      const controller = new AbortController();
      abortRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined
        });
        if (response.status === 304) {
          setLoading(false);
          return;
        }
        if (!response.ok) {
          throw new Error(`API error ${response.status}`);
        }
        const data = (await response.json()) as SceneResponse;
        setScene(data);
        etagRef.current = response.headers.get("ETag");
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          if (timedOut) {
            setError(`Timed out waiting for the SPICE backend (${Math.round(REQUEST_TIMEOUT_MS / 1000)}s).`);
          }
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load scene.");
      } finally {
        window.clearTimeout(timeoutId);
        if (activeRequestRef.current === requestId) {
          inFlightRef.current = false;
        }
        setLoading(false);
      }
    },
    [mode, quality, frame3d, useLocation, latInput, lonInput, altInput]
  );

  useEffect(() => {
    fetchScene();
    const timer = window.setInterval(fetchScene, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [fetchScene]);

  useEffect(() => {
    if (viewMode !== "telescope") return;
    if (typeof ResizeObserver === "undefined") return;
    if (!viewRef.current) return;
    setViewSize(viewRef.current.clientWidth);
    const observer = new ResizeObserver(() => {
      if (!viewRef.current) return;
      setViewSize(viewRef.current.clientWidth);
    });
    observer.observe(viewRef.current);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "orbit") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new JupiterRenderer(canvas);
    rendererRef.current = renderer;
    try {
      renderer.init();
      renderer.setDistanceLimits(ORBIT_MIN_DISTANCE, ORBIT_MAX_DISTANCE);
      renderer.resetCamera(ORBIT_DEFAULT_DISTANCE);
      renderer.resize();
      renderer.render();
      setRendererReady(true);
    } catch (err) {
      console.error(err);
      setRendererReady(false);
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
      setRendererReady(false);
    };
  }, [viewMode]);

  useEffect(() => {
    if (!rendererReady || viewMode !== "orbit") return;
    const renderer = rendererRef.current;
    const shell = viewportShellRef.current;
    if (!renderer || !shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      renderer.resize();
      renderer.render();
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [rendererReady, viewMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && fullscreenMode) {
        setFullscreenMode(false);
      }
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.resize();
        renderer.render();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fullscreenMode]);

  useEffect(() => {
    if (viewMode === "telescope" && fullscreenMode) {
      if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {
          /* ignore fullscreen errors */
        });
      }
      setFullscreenMode(false);
    }
  }, [viewMode, fullscreenMode]);

  const sortedMoons = useMemo(() => {
    if (!scene) return [];
    return [...scene.moons].sort((a, b) => a.sky.offsetArcsec.separation - b.sky.offsetArcsec.separation);
  }, [scene]);

  const visibleFeatures = useMemo(() => {
    if (!scene) return [];
    return scene.features.filter((feature) => feature.appearance.visible);
  }, [scene]);

  const pixelsPerArcsec = viewSize ? viewSize / fovArcsec : 0;
  const center = viewSize / 2;
  const jupiterRadiusPx = scene ? scene.jupiter.angularRadiusArcsec * pixelsPerArcsec : 0;
  const orbitBodies = useMemo(() => (scene ? buildOrbitBodies(scene) : null), [scene]);
  const referenceLines = useMemo(() => (scene ? buildReferenceLines(scene.earthDirection) : null), [scene]);

  useEffect(() => {
    if (!rendererReady || viewMode !== "orbit" || !orbitBodies) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setBodies({ data: orbitBodies.buffer, count: orbitBodies.count });
  }, [rendererReady, viewMode, orbitBodies]);

  useEffect(() => {
    if (!rendererReady || viewMode !== "orbit" || !referenceLines) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setReferenceLines({ data: referenceLines.buffer, count: referenceLines.count });
  }, [rendererReady, viewMode, referenceLines]);

  useEffect(() => {
    if (!rendererReady || viewMode !== "orbit") return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const raf = requestAnimationFrame(() => {
      renderer.resize();
      renderer.render();
    });
    return () => cancelAnimationFrame(raf);
  }, [rendererReady, viewMode, fullscreenMode]);

  useEffect(() => {
    if (!rendererReady || viewMode !== "orbit") return;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const activePointers = new Map<number, { x: number; y: number }>();
    let draggingId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let lastPinchDistance: number | null = null;
    const dragScale = 0.006;
    const pinchScale = 0.0025;

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
        renderer.orbit(dx * dragScale, -dy * dragScale);
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
      renderer.zoom(-e.deltaY * 0.002);
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
  }, [rendererReady, viewMode]);

  const enterFullscreenMode = () => {
    setFullscreenMode(true);
    const shell = viewportShellRef.current;
    if (shell?.requestFullscreen) {
      shell.requestFullscreen().catch(() => {
        /* ignore fullscreen errors */
      });
    }
  };

  const exitFullscreenMode = () => {
    setFullscreenMode(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {
        /* ignore fullscreen errors */
      });
    }
  };

  const toggleFullscreenMode = () => {
    if (fullscreenMode) {
      exitFullscreenMode();
    } else {
      enterFullscreenMode();
    }
  };

  const enterOrbitView = () => {
    setViewMode("orbit");
  };

  const exitOrbitView = () => {
    if (fullscreenMode) {
      exitFullscreenMode();
    }
    setViewMode("telescope");
  };

  return (
    <div className={`page ${fullscreenMode ? "is-immersive" : ""}`}>
      {!fullscreenMode && (
        <header className="title-banner">
          <div className="title-text">
            <h1>Jupiter Lab</h1>
            <p className="title-subtitle">Moon position planning for amateur astronomers.</p>
          </div>
          <div className="title-actions">
            <button className="btn secondary" type="button" onClick={() => fetchScene(true)}>
              Refresh
            </button>
            <button className="btn ghost" type="button" onClick={onExit}>
              All Labs
            </button>
            <button
              className={`btn ${viewMode === "telescope" ? "primary" : "secondary"}`}
              type="button"
              onClick={exitOrbitView}
            >
              Telescope view
            </button>
            <button
              className={`btn ${viewMode === "orbit" ? "primary" : "secondary"}`}
              type="button"
              onClick={enterOrbitView}
            >
              Orbit 3D
            </button>
          </div>
        </header>
      )}

      <div className="layout jupiter-layout">
        <section className="panel viewport-panel">
          <div className="panel-heading-row">
            <div className="panel-heading">{viewMode === "orbit" ? "3D orbit view" : "2D telescope view"}</div>
            <div className={`title-status ${loading ? "is-loading" : ""}`}>
              {loading ? "Updating..." : lastUpdated ? `Updated ${lastUpdated}` : "Awaiting data"}
            </div>
          </div>
          {viewMode === "orbit" ? (
            <>
              {!fullscreenMode && (
                <div className="viewport-toolbar">
                  <button className="btn ghost" type="button" onClick={exitOrbitView}>
                    Back to telescope
                  </button>
                  <button className="fullscreen-btn" onClick={toggleFullscreenMode} type="button">
                    Full Screen
                  </button>
                </div>
              )}
              <div className="canvas-shell" ref={viewportShellRef}>
                <canvas ref={canvasRef} className="viewport" />
                <div className="view-overlay-stack">
                  {!fullscreenMode && (
                    <div className={`scene-badge ${loading ? "is-loading" : ""}`}>
                      <div className="scene-title">Jupiter system</div>
                      <div className="scene-meta">Drag to orbit around the moons</div>
                    </div>
                  )}
                  <div className="axis-legend" aria-label="Axis orientation">
                    <div className="axis-row">
                      <span className="axis-dot axis-x" />
                      <span>X</span>
                    </div>
                    <div className="axis-row">
                      <span className="axis-dot axis-y" />
                      <span>Y</span>
                    </div>
                  <div className="axis-row">
                    <span className="axis-dot axis-z" />
                    <span>Z</span>
                  </div>
                  <div className="axis-row">
                    <span className="axis-dot axis-earth" />
                    <span>Earth</span>
                  </div>
                  <div className="axis-note">Reference plane: Y = 0 ({frame3d})</div>
                </div>
                </div>
                {fullscreenMode && (
                  <div className="view-actions">
                    <button className="fullscreen-btn is-active" onClick={toggleFullscreenMode} type="button">
                      Exit full view
                    </button>
                    <button className="fullscreen-btn" onClick={exitOrbitView} type="button">
                      Back to telescope
                    </button>
                  </div>
                )}
                {!fullscreenMode && <div className="hint">Drag to orbit | Pinch or scroll to zoom</div>}
              </div>
            </>
          ) : (
            <>
          <div className="telescope-shell">
            <div className="telescope-view" ref={viewRef}>
              <div className="telescope-grid" />
              <div className="telescope-axis telescope-axis-north" />
              <div className="telescope-axis telescope-axis-east" />
              {scene && (
                <div
                  className="jupiter-disk"
                  style={{
                    width: `${jupiterRadiusPx * 2}px`,
                    height: `${jupiterRadiusPx * 2}px`,
                    left: `${center - jupiterRadiusPx}px`,
                    top: `${center - jupiterRadiusPx}px`
                  }}
                />
              )}
              {visibleFeatures.map((feature) => {
                const x = center + feature.sky.offsetArcsec.east * pixelsPerArcsec;
                const y = center - feature.sky.offsetArcsec.north * pixelsPerArcsec;
                const width = feature.appearance.sizeArcsec.eastWest * pixelsPerArcsec;
                const height = feature.appearance.sizeArcsec.northSouth * pixelsPerArcsec;
                const safeWidth = Number.isFinite(width) ? Math.max(width, 3) : 3;
                const safeHeight = Number.isFinite(height) ? Math.max(height, 3) : 3;
                return (
                  <div
                    key={feature.key}
                    className="jupiter-feature"
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${safeWidth}px`,
                      height: `${safeHeight}px`,
                      backgroundColor: feature.style?.color
                    }}
                    title={`${feature.displayName} | Lat ${feature.system.latDeg.toFixed(1)}° Lon ${feature.system.lonDeg.toFixed(
                      1
                    )}°`}
                  />
                );
              })}
              {scene?.moons.map((moon) => {
                const x = center + moon.sky.offsetArcsec.east * pixelsPerArcsec;
                const y = center - moon.sky.offsetArcsec.north * pixelsPerArcsec;
                const classes = [
                  "moon-dot",
                  moon.events?.transit ? "is-transit" : "",
                  moon.events?.occulted ? "is-occulted" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={moon.key}
                    className={classes}
                    style={{ left: `${x}px`, top: `${y}px` }}
                    title={`${moon.displayName} | E ${formatArcsec(moon.sky.offsetArcsec.east)}" N ${formatArcsec(
                      moon.sky.offsetArcsec.north
                    )}"`}
                  />
                );
              })}
            </div>
          </div>
          <div className="telescope-footer">
            <label className="field">
              <div className="field-label">
                <span className="field-label-text">Field of view (arcsec)</span>
              </div>
              <input
                type="range"
                min={MIN_FOV_ARCSEC}
                max={MAX_FOV_ARCSEC}
                step={20}
                value={fovArcsec}
                onChange={(event) => setFovArcsec(Number(event.target.value))}
              />
              <div className="title-status">FOV: {formatArcsec(fovArcsec)}"</div>
            </label>
            <div className="legend-row">
              <span className="legend-dot" />
              <span className="legend-text">Moon</span>
              <span className="legend-dot is-transit" />
              <span className="legend-text">Transit</span>
              <span className="legend-dot is-occulted" />
              <span className="legend-text">Occulted</span>
              <span className="legend-dot is-feature" />
              <span className="legend-text">Feature</span>
            </div>
          </div>
            </>
          )}
        </section>

        <section className="panel controls-panel">
          <div className="controls-header">
            <div className="controls-heading">
              <div className="panel-heading">Scene controls</div>
              <div className="title-status">{scene?.meta.cache ? `${scene.meta.cache.bucketSec}s cache` : "No cache"}</div>
            </div>
            {error && <div className="status-error">{error}</div>}
          </div>

          <div className="controls-scroll">
            <div className="section">
              <div className="section-title">Data mode</div>
              <div className="field-grid">
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Moons</span>
                  </div>
                  <select className="select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                    <option value="inner">Inner (Galileans + Amalthea)</option>
                    <option value="regular">Regular (jup365)</option>
                    <option value="all">All (jup365 + jup347)</option>
                  </select>
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Quality</span>
                  </div>
                  <select
                    className="select"
                    value={quality}
                    onChange={(event) => setQuality(event.target.value as typeof quality)}
                  >
                    <option value="high">High (LT+S)</option>
                    <option value="eco">Eco (LT)</option>
                  </select>
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">System frame</span>
                  </div>
                  <select
                    className="select"
                    value={frame3d}
                    onChange={(event) => setFrame3d(event.target.value as typeof frame3d)}
                  >
                    <option value="J2000">J2000</option>
                    <option value="IAU_JUPITER">IAU Jupiter</option>
                  </select>
                </label>
              </div>
              <div className="chip-row" style={{ marginTop: 10 }}>
                <div className="title-status">ABCorr: {scene?.meta.abcorr ?? "LT+S"}</div>
                <div className="title-status">Mode: {scene?.meta.mode ?? mode}</div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">Observer location</div>
              <div className="chip-row">
                <button
                  className={`btn ${useLocation ? "secondary" : "ghost"}`}
                  type="button"
                  onClick={() => setUseLocation((value) => !value)}
                >
                  {useLocation ? "Topocentric" : "Geocentric"}
                </button>
                <div className="title-status">{useLocation ? "Using site coordinates" : "Earth center"}</div>
              </div>
              <div className="field-grid" style={{ marginTop: 10 }}>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Latitude (deg)</span>
                  </div>
                  <input
                    className="input"
                    type="number"
                    step={0.0001}
                    value={latInput}
                    onChange={(event) => setLatInput(event.target.value)}
                    disabled={!useLocation}
                  />
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Longitude (deg)</span>
                  </div>
                  <input
                    className="input"
                    type="number"
                    step={0.0001}
                    value={lonInput}
                    onChange={(event) => setLonInput(event.target.value)}
                    disabled={!useLocation}
                  />
                </label>
                <label className="field">
                  <div className="field-label">
                    <span className="field-label-text">Altitude (m)</span>
                  </div>
                  <input
                    className="input"
                    type="number"
                    step={1}
                    value={altInput}
                    onChange={(event) => setAltInput(event.target.value)}
                    disabled={!useLocation}
                  />
                </label>
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <div className="title-status">
                  Jupiter range: {scene ? formatKm(scene.jupiter.distanceKm) : "--"} km
                </div>
                <div className="title-status">
                  Angular radius: {scene ? `${formatArcsec(scene.jupiter.angularRadiusArcsec)}"` : "--"}
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">Moon offsets</div>
              <div className="moon-table">
                {sortedMoons.length === 0 && <div className="title-status">No moons yet.</div>}
                {sortedMoons.map((moon) => (
                  <div key={moon.key} className="moon-row">
                    <div className="moon-name">{moon.displayName}</div>
                    <div className="moon-meta">
                      <span className="moon-class">{moon.class}</span>
                      <span className="moon-sep">{formatArcsec(moon.sky.offsetArcsec.separation)}"</span>
                    </div>
                    <div className="moon-offsets">
                      E {formatArcsec(moon.sky.offsetArcsec.east)}" · N {formatArcsec(moon.sky.offsetArcsec.north)}"
                    </div>
                    <div className="moon-events">
                      {moon.events?.transit && <span className="status-chip is-transit">Transit</span>}
                      {moon.events?.occulted && <span className="status-chip is-occulted">Occulted</span>}
                      {!moon.events?.transit && !moon.events?.occulted && <span className="status-chip">Clear</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Surface features</div>
              <div className="feature-table">
                {(scene?.features ?? []).length === 0 && <div className="title-status">No features yet.</div>}
                {(scene?.features ?? []).map((feature) => (
                  <div key={feature.key} className="feature-row">
                    <div className="feature-name">{feature.displayName}</div>
                    <div className="feature-meta">
                      Lat {feature.system.latDeg.toFixed(1)}° / Lon {feature.system.lonDeg.toFixed(1)}°
                    </div>
                    <div className="feature-offsets">
                      E {formatArcsec(feature.sky.offsetArcsec.east)}" N {formatArcsec(feature.sky.offsetArcsec.north)}"
                    </div>
                    <div className="feature-status">
                      {feature.appearance.visible ? (
                        <span className="status-chip is-feature">Visible</span>
                      ) : feature.appearance.onDisk ? (
                        <span className="status-chip is-feature-hidden">Behind limb</span>
                      ) : (
                        <span className="status-chip">Off disk</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Jupiter-centered vectors</div>
              <div className="vector-table">
                {sortedMoons.length === 0 && <div className="title-status">No vectors yet.</div>}
                {sortedMoons.map((moon) => (
                  <div key={`${moon.key}-vec`} className="vector-row">
                    <div className="vector-name">{moon.displayName}</div>
                    <div className="vector-values">
                      <span>X {formatKm(moon.system.jupiterCentricKm.x)}</span>
                      <span>Y {formatKm(moon.system.jupiterCentricKm.y)}</span>
                      <span>Z {formatKm(moon.system.jupiterCentricKm.z)}</span>
                    </div>
                    <div className="vector-range">{formatKm(moon.system.rangeFromJupiterKm)} km</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatArcsec(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatKm(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value).toLocaleString()}`;
  return value.toFixed(2);
}

function buildOrbitBodies(scene: SceneResponse) {
  const maxRangeKm = Math.max(
    JUPITER_RADIUS_KM,
    ...scene.moons.map((moon) => moon.system.rangeFromJupiterKm)
  );
  const scale = maxRangeKm > 0 ? 1 / maxRangeKm : 1;
  const bodyCount = scene.moons.length + 1;
  const buffer = new Float32Array(bodyCount * ORBIT_BODY_STRIDE);

  writeBody(buffer, 0, 0, 0, 0, JUPITER_SIZE, COLOR_JUPITER);

  let cursor = ORBIT_BODY_STRIDE;
  for (const moon of scene.moons) {
    const pos = moon.system.jupiterCentricKm;
    const size = moon.events?.occulted ? MOON_SIZE * 0.8 : MOON_SIZE;
    writeBody(buffer, cursor, pos.x * scale, pos.y * scale, pos.z * scale, size, pickMoonColor(moon));
    cursor += ORBIT_BODY_STRIDE;
  }

  return { buffer, count: bodyCount, scale };
}

function pickMoonColor(moon: SceneResponse["moons"][number]) {
  if (moon.events?.occulted) return COLOR_OCCULTED;
  if (moon.events?.transit) return COLOR_TRANSIT;
  return COLOR_MOON;
}

function writeBody(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  size: number,
  color: [number, number, number]
) {
  buffer[offset + 0] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = z;
  buffer[offset + 3] = size;
  buffer[offset + 4] = color[0];
  buffer[offset + 5] = color[1];
  buffer[offset + 6] = color[2];
}

function buildReferenceLines(earthDirection?: SceneResponse["earthDirection"]) {
  const data: number[] = [];
  const radius = REFERENCE_GRID_RADIUS;
  const step = REFERENCE_GRID_STEP;
  const steps = Math.round(radius / step);

  for (let i = -steps; i <= steps; i += 1) {
    const offset = i * step;
    pushLine(data, -radius, 0, offset, radius, 0, offset, GRID_COLOR);
    pushLine(data, offset, 0, -radius, offset, 0, radius, GRID_COLOR);
  }

  pushLine(data, 0, 0, 0, REFERENCE_AXIS_LENGTH, 0, 0, AXIS_X_COLOR);
  pushLine(
    data,
    REFERENCE_AXIS_LENGTH,
    0,
    0,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    0,
    REFERENCE_ARROW_SIZE * 0.5,
    AXIS_X_COLOR
  );
  pushLine(
    data,
    REFERENCE_AXIS_LENGTH,
    0,
    0,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    0,
    -REFERENCE_ARROW_SIZE * 0.5,
    AXIS_X_COLOR
  );

  pushLine(data, 0, 0, 0, 0, REFERENCE_AXIS_LENGTH, 0, AXIS_Y_COLOR);
  pushLine(
    data,
    0,
    REFERENCE_AXIS_LENGTH,
    0,
    REFERENCE_ARROW_SIZE * 0.5,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    0,
    AXIS_Y_COLOR
  );
  pushLine(
    data,
    0,
    REFERENCE_AXIS_LENGTH,
    0,
    -REFERENCE_ARROW_SIZE * 0.5,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    0,
    AXIS_Y_COLOR
  );

  pushLine(data, 0, 0, 0, 0, 0, REFERENCE_AXIS_LENGTH, AXIS_Z_COLOR);
  pushLine(
    data,
    0,
    0,
    REFERENCE_AXIS_LENGTH,
    REFERENCE_ARROW_SIZE * 0.5,
    0,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    AXIS_Z_COLOR
  );
  pushLine(
    data,
    0,
    0,
    REFERENCE_AXIS_LENGTH,
    -REFERENCE_ARROW_SIZE * 0.5,
    0,
    REFERENCE_AXIS_LENGTH - REFERENCE_ARROW_SIZE,
    AXIS_Z_COLOR
  );

  const earthDir = normalizeVec(earthDirection ?? { x: 1, y: 0, z: 0 });
  const earthTip = scaleVec(earthDir, EARTH_ARROW_LENGTH);
  pushLine(data, 0, 0, 0, earthTip.x, earthTip.y, earthTip.z, EARTH_ARROW_COLOR);

  const arrowBase = subVec(earthTip, scaleVec(earthDir, EARTH_ARROW_SIZE));
  const upRef = Math.abs(earthDir.y) > 0.85 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const side = normalizeVec(crossVec(earthDir, upRef));
  const wing = scaleVec(side, EARTH_ARROW_SIZE * 0.7);
  const wingA = addVec(arrowBase, wing);
  const wingB = subVec(arrowBase, wing);
  pushLine(data, earthTip.x, earthTip.y, earthTip.z, wingA.x, wingA.y, wingA.z, EARTH_ARROW_COLOR);
  pushLine(data, earthTip.x, earthTip.y, earthTip.z, wingB.x, wingB.y, wingB.z, EARTH_ARROW_COLOR);

  return { buffer: new Float32Array(data), count: data.length / 7 };
}

function pushLine(
  data: number[],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  color: [number, number, number, number]
) {
  pushVertex(data, x1, y1, z1, color);
  pushVertex(data, x2, y2, z2, color);
}

function pushVertex(data: number[], x: number, y: number, z: number, color: [number, number, number, number]) {
  data.push(x, y, z, color[0], color[1], color[2], color[3]);
}

function normalizeVec(vec: SceneResponse["earthDirection"]) {
  const length = Math.hypot(vec.x, vec.y, vec.z) || 1;
  return { x: vec.x / length, y: vec.y / length, z: vec.z / length };
}

function scaleVec(vec: SceneResponse["earthDirection"], scalar: number) {
  return { x: vec.x * scalar, y: vec.y * scalar, z: vec.z * scalar };
}

function addVec(a: SceneResponse["earthDirection"], b: SceneResponse["earthDirection"]) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a: SceneResponse["earthDirection"], b: SceneResponse["earthDirection"]) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function crossVec(a: SceneResponse["earthDirection"], b: SceneResponse["earthDirection"]) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
