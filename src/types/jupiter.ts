export type Vec3 = { x: number; y: number; z: number };
export type RaDec = { raDeg: number; decDeg: number };

export type SceneResponse = {
  meta: {
    requestTimeUTC: string;
    et: number;
    mode: "inner" | "regular" | "all";
    quality: "high" | "eco";
    abcorr: "LT+S" | "LT" | "NONE";
    observer: {
      kind: "topocentric" | "geocentric";
      latDeg?: number;
      lonDeg?: number;
      altM?: number;
    };
    frames: {
      sky: "J2000";
      system: "J2000" | "IAU_JUPITER";
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
    class: "inner" | "regular" | "irregular";
    precisionClass: "high" | "hourly" | "coarse";
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
};
