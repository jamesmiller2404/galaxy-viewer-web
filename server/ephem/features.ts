export type SurfaceFeatureDefinition = {
  key: string;
  displayName: string;
  latDeg: number;
  lonDeg: number;
  sizeKm: {
    eastWest: number;
    northSouth: number;
  };
  color?: string;
  referenceUTC?: string;
  driftDegPerDay?: number;
};

export const SURFACE_FEATURES: SurfaceFeatureDefinition[] = [
  {
    key: "GRS",
    displayName: "Great Red Spot",
    latDeg: -22.0,
    lonDeg: 290.0,
    sizeKm: { eastWest: 16000, northSouth: 12000 },
    color: "#ff6b4a"
  }
];
