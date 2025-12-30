export interface GalaxyParameters {
  starCount: number;
  armCount: number;
  armTwist: number;
  armSpread: number;
  diskRadius: number;
  verticalThickness: number;
  noise: number;
  coreFalloff: number;
  brightness: number;
  bulgeRadius: number;
  bulgeStarCount: number;
  bulgeFalloff: number;
  bulgeVerticalScale: number;
  bulgeBrightness: number;
}

export const defaultParameters: GalaxyParameters = {
  starCount: 80000,
  armCount: 3,
  armTwist: 7.5,
  armSpread: 0.28,
  diskRadius: 52,
  verticalThickness: 0.42,
  noise: 0.22,
  coreFalloff: 1.9,
  brightness: 1.1,
  bulgeRadius: 7.5,
  bulgeStarCount: 30000,
  bulgeFalloff: 2.2,
  bulgeVerticalScale: 0.9,
  bulgeBrightness: 2.6
};

export interface StarBuffer {
  /** interleaved xyz,intensity,colorIndex01 */
  data: Float32Array;
  count: number;
}
