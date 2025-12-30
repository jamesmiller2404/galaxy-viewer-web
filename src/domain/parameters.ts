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
  starCount: 60000,
  armCount: 4,
  armTwist: 5,
  armSpread: 0.35,
  diskRadius: 40,
  verticalThickness: 0.5,
  noise: 0.25,
  coreFalloff: 2,
  brightness: 1,
  bulgeRadius: 5,
  bulgeStarCount: 20000,
  bulgeFalloff: 2,
  bulgeVerticalScale: 0.8,
  bulgeBrightness: 2
};

export interface StarBuffer {
  /** interleaved xyz,intensity,colorIndex01 */
  data: Float32Array;
  count: number;
}
