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
  starSize: number;
  bulgeRadius: number;
  bulgeStarCount: number;
  bulgeFalloff: number;
  bulgeVerticalScale: number;
  bulgeBrightness: number;
  bhRadius: number;
  bhRingWidth: number;
  bhRingBrightness: number;
}

export const defaultParameters: GalaxyParameters = {
  starCount: 120000,
  armCount: 5,
  armTwist: 6.5,
  armSpread: 0.17,
  diskRadius: 68,
  verticalThickness: 0.22,
  noise: 0.22,
  coreFalloff: 1.8,
  brightness: 0.65,
  starSize: 0.2,
  bulgeRadius: 9.0,
  bulgeStarCount: 50000,
  bulgeFalloff: 2.3,
  bulgeVerticalScale: 3.0,
  bulgeBrightness: 3.4,
  bhRadius: 5.0,
  bhRingWidth: 0.18,
  bhRingBrightness: 1.4
};

export interface StarBuffer {
  /** interleaved xyz,intensity,colorIndex01 */
  data: Float32Array;
  count: number;
}

export interface BlackHoleBuffer {
  /** interleaved xyz,rgb */
  data: Float32Array;
  count: number;
}
