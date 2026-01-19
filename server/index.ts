import http from "node:http";
import { createHash } from "node:crypto";
import os from "node:os";
import { LruCache } from "./ephem/cache";
import { MOON_CATALOG } from "./ephem/catalog";
import { WorkerPool } from "./ephem/pool";
import type { Frame3d, Mode, OrbitsRequest, OrbitsResponse, Quality, SceneRequest, SceneResponse } from "./ephem/types";

const pool = new WorkerPool(Math.min(2, os.cpus().length), new URL("./ephem/worker-bootstrap.mjs", import.meta.url));
const sceneCache = new LruCache<SceneResponse>(200);
const orbitsCache = new LruCache<OrbitsResponse>(40);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match"
};

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." }, corsHeaders);
    return;
  }

  if (url.pathname === "/api/jupiter/scene") {
    await handleScene(url, req, res);
    return;
  }

  if (url.pathname === "/api/jupiter/orbits") {
    await handleOrbits(url, req, res);
    return;
  }

  if (url.pathname === "/api/jupiter/moons") {
    sendJson(
      res,
      200,
      { moons: Object.values(MOON_CATALOG) },
      { ...corsHeaders, "Cache-Control": "public, max-age=86400" }
    );
    return;
  }

  sendJson(res, 404, { error: "Not found." }, corsHeaders);
}

async function handleScene(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const time = parseTime(url.searchParams.get("t"));
  if (!time) {
    sendJson(res, 400, { error: "Invalid time format." }, corsHeaders);
    return;
  }

  const mode = parseMode(url.searchParams.get("mode"));
  const quality = parseQuality(url.searchParams.get("quality"));
  const frame3d = parseFrame3d(url.searchParams.get("frame3d"));
  const lat = parseNumber(url.searchParams.get("lat"));
  const lon = parseNumber(url.searchParams.get("lon"));
  const alt = parseNumber(url.searchParams.get("alt"));
  const observer =
    lat !== null && lon !== null
      ? { kind: "topocentric" as const, latDeg: lat, lonDeg: lon, altM: alt ?? 0 }
      : { kind: "geocentric" as const };

  const bucketSec = quality === "high" ? 1 : 2;
  const bucket = Math.floor(time.timeMs / (bucketSec * 1000)) * bucketSec;
  const cacheKey = [
    "scene",
    mode,
    quality,
    frame3d,
    observer.kind,
    observer.kind === "topocentric" ? roundTo(lat ?? 0, 0.01) : "geo",
    observer.kind === "topocentric" ? roundTo(lon ?? 0, 0.01) : "geo",
    observer.kind === "topocentric" ? roundTo(alt ?? 0, 50) : "geo",
    bucket
  ].join("|");
  const etag = makeEtag(cacheKey);
  if (matchesEtag(req, etag)) {
    res.writeHead(304, { ...corsHeaders, ETag: etag });
    res.end();
    return;
  }

  const cached = sceneCache.get(cacheKey);
  if (cached) {
    sendJson(
      res,
      200,
      { ...cached, meta: { ...cached.meta, cache: { bucketSec, etag } } },
      { ...corsHeaders, ETag: etag, "Cache-Control": `public, max-age=${bucketSec}` }
    );
    return;
  }

  const args: SceneRequest = {
    timeUTC: time.iso,
    mode,
    quality,
    frame3d,
    observer
  };

  try {
    const result = (await pool.runTask<SceneResponse>("scene", args)) as SceneResponse;
    const response = { ...result, meta: { ...result.meta, cache: { bucketSec, etag } } };
    sceneCache.set(cacheKey, response, bucketSec * 1000);
    sendJson(res, 200, response, { ...corsHeaders, ETag: etag, "Cache-Control": `public, max-age=${bucketSec}` });
  } catch (error) {
    sendJson(res, 500, { error: messageFromError(error) }, corsHeaders);
  }
}

async function handleOrbits(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const time = parseTime(url.searchParams.get("t"));
  if (!time) {
    sendJson(res, 400, { error: "Invalid time format." }, corsHeaders);
    return;
  }

  const mode = parseMode(url.searchParams.get("mode"));
  const frame3d = parseFrame3d(url.searchParams.get("frame3d"));
  const spanHours = clampNumber(parseNumber(url.searchParams.get("spanH")) ?? 48, 1, 240);
  let stepSeconds = clampNumber(parseNumber(url.searchParams.get("stepS")) ?? 600, 60, 7200);
  if (mode === "all") {
    stepSeconds = Math.max(stepSeconds, 1800);
  }

  const totalSeconds = spanHours * 3600;
  const maxSamples = 500;
  const sampleCount = Math.floor(totalSeconds / stepSeconds) + 1;
  if (sampleCount > maxSamples) {
    stepSeconds = Math.ceil(totalSeconds / Math.max(1, maxSamples - 1));
  }

  const bucketSec = Math.max(60, stepSeconds);
  const bucket = Math.floor(time.timeMs / (bucketSec * 1000)) * bucketSec;
  const cacheKey = ["orbits", mode, frame3d, spanHours, stepSeconds, bucket].join("|");
  const etag = makeEtag(cacheKey);
  if (matchesEtag(req, etag)) {
    res.writeHead(304, { ...corsHeaders, ETag: etag });
    res.end();
    return;
  }

  const cached = orbitsCache.get(cacheKey);
  if (cached) {
    sendJson(
      res,
      200,
      cached,
      { ...corsHeaders, ETag: etag, "Cache-Control": `public, max-age=${bucketSec}` }
    );
    return;
  }

  const args: OrbitsRequest = {
    timeUTC: time.iso,
    spanHours,
    stepSeconds,
    mode,
    frame3d
  };

  try {
    const result = (await pool.runTask<OrbitsResponse>("orbits", args)) as OrbitsResponse;
    orbitsCache.set(cacheKey, result, bucketSec * 1000);
    sendJson(res, 200, result, { ...corsHeaders, ETag: etag, "Cache-Control": `public, max-age=${bucketSec}` });
  } catch (error) {
    sendJson(res, 500, { error: messageFromError(error) }, corsHeaders);
  }
}

function parseTime(value: string | null) {
  if (!value || value === "now") {
    const now = new Date();
    return { iso: now.toISOString(), timeMs: now.getTime() };
  }
  const timeMs = Date.parse(value);
  if (!Number.isFinite(timeMs)) return null;
  return { iso: new Date(timeMs).toISOString(), timeMs };
}

function parseMode(value: string | null): Mode {
  if (value === "regular" || value === "all") return value;
  return "inner";
}

function parseQuality(value: string | null): Quality {
  if (value === "eco") return "eco";
  return "high";
}

function parseFrame3d(value: string | null): Frame3d {
  if (value === "IAU_JUPITER") return "IAU_JUPITER";
  return "J2000";
}

function parseNumber(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, step: number) {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function makeEtag(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function matchesEtag(req: http.IncomingMessage, etag: string) {
  const header = req.headers["if-none-match"];
  if (!header) return false;
  const value = Array.isArray(header) ? header[0] : header;
  return value.replace(/"/g, "") === etag;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string>
) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Jupiter API listening on http://localhost:${port}`);
});

const shutdown = async () => {
  await pool.close();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
