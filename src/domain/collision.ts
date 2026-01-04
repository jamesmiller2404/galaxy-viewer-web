import { GalaxyParameters, defaultParameters } from "./parameters";
import { findPreset } from "./presets";

export type GalaxyInstance = {
  name: string;
  params: GalaxyParameters;
  massScale: number;
  color: string;
};

export type CollisionSetup = {
  galaxyA: GalaxyInstance;
  galaxyB: GalaxyInstance;
  impactOffset: number;
  relativeSpeed: number;
};

const DEFAULT_COLOR_A = "#ff4d4d";
const DEFAULT_COLOR_B = "#4da3ff";

export function makeGalaxyInstance(
  name: string,
  params: GalaxyParameters,
  options?: Partial<Pick<GalaxyInstance, "massScale" | "color">>
): GalaxyInstance {
  return {
    name,
    params,
    massScale: options?.massScale ?? 1,
    color: options?.color ?? "#ff8c5a"
  };
}

export function resolvePreset(name: string): GalaxyParameters {
  return findPreset(name) ?? { ...defaultParameters };
}

export function scaleGalaxy(params: GalaxyParameters, scale: number): GalaxyParameters {
  const clampScale = Math.max(0.05, Math.min(2, scale));
  return {
    ...params,
    starCount: Math.max(1000, Math.floor(params.starCount * clampScale)),
    bulgeStarCount: Math.max(0, Math.floor(params.bulgeStarCount * clampScale))
  };
}

export function capGalaxyStars(params: GalaxyParameters, capPerGalaxy: number): GalaxyParameters {
  const total = params.starCount + params.bulgeStarCount;
  if (total <= capPerGalaxy) return params;
  const ratio = capPerGalaxy / Math.max(1, total);
  return {
    ...params,
    starCount: Math.max(500, Math.floor(params.starCount * ratio)),
    bulgeStarCount: Math.max(0, Math.floor(params.bulgeStarCount * ratio))
  };
}

export function clampCollisionStars(
  a: GalaxyParameters,
  b: GalaxyParameters,
  capPerGalaxy: number
): { a: GalaxyParameters; b: GalaxyParameters } {
  return { a: capGalaxyStars(a, capPerGalaxy), b: capGalaxyStars(b, capPerGalaxy) };
}

export function defaultCollisionSetup(): CollisionSetup {
  const cap = 50_000;
  const andromeda = capGalaxyStars(resolvePreset("Andromeda (M31)"), cap);
  const spiral = capGalaxyStars(resolvePreset("Spiral (Sa)"), cap);
  return {
    galaxyA: makeGalaxyInstance("Andromeda (M31)", andromeda, { color: DEFAULT_COLOR_A, massScale: 1 }),
    galaxyB: makeGalaxyInstance("Spiral (Sa)", spiral, { color: DEFAULT_COLOR_B, massScale: 1 }),
    impactOffset: 18,
    relativeSpeed: 1.5
  };
}
