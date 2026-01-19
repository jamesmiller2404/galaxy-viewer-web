export type Mode = "inner" | "regular" | "all";
export type Quality = "high" | "eco";
export type Frame3d = "J2000" | "IAU_JUPITER";

export type Vec3 = { x: number; y: number; z: number };
export type RaDec = { raDeg: number; decDeg: number };

export type Observer =
  | { kind: "geocentric" }
  | { kind: "topocentric"; latDeg: number; lonDeg: number; altM: number };

export type MoonClass = "inner" | "regular" | "irregular";
export type PrecisionClass = "high" | "hourly" | "coarse";

export type SceneRequest = {
  timeUTC: string;
  mode: Mode;
  quality: Quality;
  frame3d: Frame3d;
  observer: Observer;
};

export type SceneResponse = {
  meta: {
    requestTimeUTC: string;
    et: number;
    mode: Mode;
    quality: Quality;
    abcorr: "LT+S" | "LT" | "NONE";
    observer: {
      kind: "topocentric" | "geocentric";
      latDeg?: number;
      lonDeg?: number;
      altM?: number;
    };
    frames: {
      sky: "J2000";
      system: Frame3d;
    };
    cache: { bucketSec: number; etag: string };
  };
  jupiter: {
    apparent: RaDec;
    distanceKm: number;
    angularRadiusArcsec: number;
  };
  moons: Array<{
    key: string;
    displayName: string;
    class: MoonClass;
    precisionClass: PrecisionClass;
    sky: {
      apparent: RaDec;
      offsetArcsec: {
        east: number;
        north: number;
        separation: number;
        positionAngleDeg: number;
      };
    };
    system: {
      jupiterCentricKm: Vec3;
      rangeFromJupiterKm: number;
    };
    events?: {
      onDisk: boolean;
      transit?: boolean;
      occulted?: boolean;
    };
  }>;
  features: SurfaceFeature[];
};

export type OrbitsRequest = {
  timeUTC: string;
  spanHours: number;
  stepSeconds: number;
  mode: Mode;
  frame3d: Frame3d;
};

export type OrbitsResponse = {
  meta: {
    baseTimeUTC: string;
    et0: number;
    spanHours: number;
    stepSeconds: number;
    frame: Frame3d;
    mode: Mode;
  };
  dtSeconds: number[];
  bodies: Record<
    string,
    {
      class: MoonClass;
      precisionClass: PrecisionClass;
      posKm: number[];
    }
  >;
};

export type MoonCatalogEntry = {
  key: string;
  displayName: string;
  class: MoonClass;
  radiusKm?: number;
};

export type SurfaceFeature = {
  key: string;
  displayName: string;
  system: {
    latDeg: number;
    lonDeg: number;
  };
  sky: {
    offsetArcsec: {
      east: number;
      north: number;
      separation: number;
      positionAngleDeg: number;
    };
  };
  appearance: {
    onDisk: boolean;
    visible: boolean;
    sizeArcsec: {
      eastWest: number;
      northSouth: number;
    };
  };
  style?: {
    color?: string;
  };
};
