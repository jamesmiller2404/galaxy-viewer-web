import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneResponse } from "./types/jupiter";

type JupiterLabProps = {
  onExit: () => void;
};

const DEFAULT_FOV_ARCSEC = 240;
const MIN_FOV_ARCSEC = 80;
const MAX_FOV_ARCSEC = 1600;
const REFRESH_MS = 4000;

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
  const viewRef = useRef<HTMLDivElement | null>(null);
  const etagRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchScene = useCallback(async () => {
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
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load scene.");
    } finally {
      setLoading(false);
    }
  }, [mode, quality, frame3d, useLocation, latInput, lonInput, altInput]);

  useEffect(() => {
    fetchScene();
    const timer = window.setInterval(fetchScene, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [fetchScene]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    if (!viewRef.current) return;
    const observer = new ResizeObserver(() => {
      if (!viewRef.current) return;
      setViewSize(viewRef.current.clientWidth);
    });
    observer.observe(viewRef.current);
    return () => observer.disconnect();
  }, []);

  const sortedMoons = useMemo(() => {
    if (!scene) return [];
    return [...scene.moons].sort((a, b) => a.sky.offsetArcsec.separation - b.sky.offsetArcsec.separation);
  }, [scene]);

  const pixelsPerArcsec = viewSize ? viewSize / fovArcsec : 0;
  const center = viewSize / 2;
  const jupiterRadiusPx = scene ? scene.jupiter.angularRadiusArcsec * pixelsPerArcsec : 0;

  return (
    <div className="page">
      <header className="title-banner">
        <div className="title-text">
          <h1>Jupiter Lab</h1>
          <p className="title-subtitle">Moon position planning for amateur astronomers.</p>
        </div>
        <div className="title-actions">
          <button className="btn secondary" type="button" onClick={fetchScene}>
            Refresh
          </button>
          <button className="btn ghost" type="button" onClick={onExit}>
            All Labs
          </button>
        </div>
      </header>

      <div className="layout jupiter-layout">
        <section className="panel viewport-panel">
          <div className="panel-heading-row">
            <div className="panel-heading">2D telescope view</div>
            <div className={`title-status ${loading ? "is-loading" : ""}`}>
              {loading ? "Updating..." : lastUpdated ? `Updated ${lastUpdated}` : "Awaiting data"}
            </div>
          </div>
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
            </div>
          </div>
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
