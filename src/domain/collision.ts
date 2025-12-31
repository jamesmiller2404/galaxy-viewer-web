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

export function clampCollisionStars(
  a: GalaxyParameters,
  b: GalaxyParameters,
  cap: number
): { a: GalaxyParameters; b: GalaxyParameters } {
  const total = a.starCount + a.bulgeStarCount + b.starCount + b.bulgeStarCount;
  if (total <= cap) return { a, b };
  const ratio = cap / Math.max(1, total);
  const scaleParams = (p: GalaxyParameters) => ({
    ...p,
    starCount: Math.max(500, Math.floor(p.starCount * ratio)),
    bulgeStarCount: Math.max(0, Math.floor(p.bulgeStarCount * ratio))
  });
  return { a: scaleParams(a), b: scaleParams(b) };
}

export function defaultCollisionSetup(): CollisionSetup {
  const andromeda = resolvePreset("Andromeda (M31)");
  const spiral = resolvePreset("Spiral (Sa)");
  return {
    galaxyA: makeGalaxyInstance("Andromeda (M31)", andromeda, { color: "#ff9f6d", massScale: 1 }),
    galaxyB: makeGalaxyInstance("Spiral (Sa)", spiral, { color: "#7bd8ff", massScale: 1 }),
    impactOffset: 18,
    relativeSpeed: 1.5
  };
}
