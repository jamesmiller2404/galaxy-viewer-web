import { ARCSEC_PER_RAD, DEG2RAD, RAD2DEG, WGS84_A_KM, WGS84_F } from "./constants";
import type { Vec3 } from "./types";

export function toRadians(deg: number) {
  return deg * DEG2RAD;
}

export function toDegrees(rad: number) {
  return rad * RAD2DEG;
}

export function norm(vec: Vec3) {
  return Math.hypot(vec.x, vec.y, vec.z);
}

export function unit(vec: Vec3): Vec3 {
  const length = norm(vec) || 1;
  return { x: vec.x / length, y: vec.y / length, z: vec.z / length };
}

export function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(vec: Vec3, scalar: number): Vec3 {
  return { x: vec.x * scalar, y: vec.y * scalar, z: vec.z * scalar };
}

export function wrapRadians(angleRad: number) {
  const twoPi = Math.PI * 2;
  return ((angleRad % twoPi) + twoPi) % twoPi;
}

export function wrapSignedRadians(angleRad: number) {
  const twoPi = Math.PI * 2;
  const wrapped = ((angleRad % twoPi) + twoPi) % twoPi;
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
}

export function raDecFromVec(vec: Vec3) {
  const rangeKm = norm(vec);
  const raRad = wrapRadians(Math.atan2(vec.y, vec.x));
  const decRad = Math.asin(vec.z / Math.max(rangeKm, 1e-9));
  return {
    raRad,
    decRad,
    raDeg: raRad * RAD2DEG,
    decDeg: decRad * RAD2DEG,
    rangeKm
  };
}

export function computeOffsets(
  raRad: number,
  decRad: number,
  raJupRad: number,
  decJupRad: number
) {
  const dRa = wrapSignedRadians(raRad - raJupRad);
  const eastArcsec = dRa * Math.cos(decJupRad) * ARCSEC_PER_RAD;
  const northArcsec = (decRad - decJupRad) * ARCSEC_PER_RAD;
  const separation = Math.hypot(eastArcsec, northArcsec);
  const positionAngleDeg = wrapDegrees(Math.atan2(eastArcsec, northArcsec) * RAD2DEG);
  return { eastArcsec, northArcsec, separation, positionAngleDeg };
}

export function geodeticToEcef(latDeg: number, lonDeg: number, altM: number): Vec3 {
  const latRad = latDeg * DEG2RAD;
  const lonRad = lonDeg * DEG2RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  const e2 = WGS84_F * (2 - WGS84_F);
  const n = WGS84_A_KM / Math.sqrt(1 - e2 * sinLat * sinLat);
  const altKm = altM / 1000;
  return {
    x: (n + altKm) * cosLat * cosLon,
    y: (n + altKm) * cosLat * sinLon,
    z: (n * (1 - e2) + altKm) * sinLat
  };
}

export function mat3MultiplyVec(matrix: number[] | number[][], vec: Vec3): Vec3 {
  if (Array.isArray(matrix[0])) {
    const m = matrix as number[][];
    return {
      x: m[0][0] * vec.x + m[0][1] * vec.y + m[0][2] * vec.z,
      y: m[1][0] * vec.x + m[1][1] * vec.y + m[1][2] * vec.z,
      z: m[2][0] * vec.x + m[2][1] * vec.y + m[2][2] * vec.z
    };
  }
  const m = matrix as number[];
  return {
    x: m[0] * vec.x + m[1] * vec.y + m[2] * vec.z,
    y: m[3] * vec.x + m[4] * vec.y + m[5] * vec.z,
    z: m[6] * vec.x + m[7] * vec.y + m[8] * vec.z
  };
}

export function wrapDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}
