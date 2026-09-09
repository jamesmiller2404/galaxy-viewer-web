import { mat4, quat, vec3 } from "gl-matrix";

const BASE_FORWARD = vec3.fromValues(1, 0, 0);
const BASE_UP = vec3.fromValues(0, 1, 0);
const BASE_RIGHT = vec3.fromValues(0, 0, 1);

export class OrbitCamera {
  private orientation = quat.create();
  private distance = 2.2;
  private minDistance = 0.6;
  private maxDistance = 6;
  private target = vec3.fromValues(0, 0, 0);

  rotate(deltaYaw: number, deltaPitch: number) {
    if (deltaYaw === 0 && deltaPitch === 0) return;

    const yawQuat = quat.setAxisAngle(quat.create(), BASE_UP, deltaYaw);

    const rotation = mat4.fromQuat(mat4.create(), this.orientation);
    const right = vec3.transformMat4(vec3.create(), BASE_RIGHT, rotation);
    const pitchQuat = quat.setAxisAngle(quat.create(), right, deltaPitch);

    quat.multiply(this.orientation, yawQuat, this.orientation);
    quat.multiply(this.orientation, pitchQuat, this.orientation);
    quat.normalize(this.orientation, this.orientation);
  }

  zoom(delta: number) {
    this.setDistance(this.distance + delta);
  }

  setDistance(distance: number) {
    this.distance = clamp(distance, this.minDistance, this.maxDistance);
  }

  setDistanceLimits(minDistance: number, maxDistance: number) {
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.setDistance(this.distance);
  }

  getDistance() {
    return this.distance;
  }

  setTarget(target: vec3 | [number, number, number]) {
    const next = Array.isArray(target) ? vec3.fromValues(target[0], target[1], target[2]) : target;
    vec3.copy(this.target, next);
  }

  reset(distance?: number) {
    quat.identity(this.orientation);
    if (typeof distance === "number") {
      this.setDistance(distance);
    }
  }

  getViewMatrix(): mat4 {
    // Build a 4x4 rotation matrix from the quaternion to avoid gimbal lock.
    const rotation = mat4.fromQuat(mat4.create(), this.orientation);
    const forward = vec3.transformMat4(vec3.create(), BASE_FORWARD, rotation);
    const up = vec3.transformMat4(vec3.create(), BASE_UP, rotation);
    const position = vec3.scaleAndAdd(vec3.create(), this.target, forward, this.distance);
    return mat4.lookAt(mat4.create(), position, this.target, up);
  }

  getProjectionMatrix(aspect: number): mat4 {
    const proj = mat4.create();
    return mat4.perspective(proj, deg2rad(55), Math.max(0.1, aspect), 0.01, 50);
  }
}

function deg2rad(v: number) {
  return (v * Math.PI) / 180;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}
