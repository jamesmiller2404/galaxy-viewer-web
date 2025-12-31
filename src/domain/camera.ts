import { mat4, vec3 } from "gl-matrix";

export class Camera {
  yaw = 0.9;
  pitch = -0.55;
  distance = 90;
  target: vec3 = vec3.fromValues(0, 0, 0);

  rotate(deltaYaw: number, deltaPitch: number) {
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, -1.45, 1.45);
  }

  zoom(delta: number) {
    this.setDistance(this.distance + delta);
  }

  setDistance(distance: number) {
    this.distance = clamp(distance, 10, 400);
  }

  getDistance() {
    return this.distance;
  }

  setTarget(target: vec3 | [number, number, number]) {
    const next = Array.isArray(target) ? vec3.fromValues(target[0], target[1], target[2]) : target;
    vec3.copy(this.target, next);
  }

  panOrtho(deltaX: number, deltaY: number, viewportWidth: number, viewportHeight: number) {
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const aspect = viewportWidth / Math.max(1, viewportHeight);
    const worldWidth = 2 * this.distance * aspect;
    const worldHeight = 2 * this.distance;
    const moveX = (deltaX / viewportWidth) * worldWidth;
    const moveY = (deltaY / viewportHeight) * worldHeight;
    vec3.add(this.target, this.target, vec3.fromValues(-moveX, moveY, 0));
  }

  setPlanarView(distance?: number) {
    this.yaw = -Math.PI / 2;
    this.pitch = 0;
    if (typeof distance === "number") {
      this.setDistance(distance);
    }
  }

  getViewMatrix(): mat4 {
    const forward = vec3.fromValues(
      Math.cos(this.pitch) * Math.cos(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.sin(this.yaw)
    );

    const position = vec3.scaleAndAdd(vec3.create(), this.target, forward, this.distance);
    const view = mat4.create();
    return mat4.lookAt(view, position, this.target, vec3.fromValues(0, 1, 0));
  }

  getProjectionMatrix(aspect: number): mat4 {
    const proj = mat4.create();
    return mat4.perspective(proj, deg2rad(60), Math.max(0.1, aspect), 0.1, 1000);
  }

  getOrthoMatrix(aspect: number): mat4 {
    const size = this.distance;
    const left = -size * aspect;
    const right = size * aspect;
    const top = size;
    const bottom = -size;
    const proj = mat4.create();
    return mat4.ortho(proj, left, right, bottom, top, -500, 500);
  }

  getAngles() {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  setAngles(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -1.45, 1.45);
  }
}

function deg2rad(v: number) {
  return (v * Math.PI) / 180;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}
