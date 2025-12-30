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
  starCount: 120000,
  armCount: 4,
  armTwist: 6.4,
  armSpread: 0.26,
  diskRadius: 68,
  verticalThickness: 0.22,
  noise: 0.22,
  coreFalloff: 1.8,
  brightness: 1.3,
  bulgeRadius: 9.0,
  bulgeStarCount: 50000,
  bulgeFalloff: 2.3,
  bulgeVerticalScale: 0.7,
  bulgeBrightness: 3.4
};

export interface StarBuffer {
  /** interleaved xyz,intensity,colorIndex01 */
  data: Float32Array;
  count: number;
}
