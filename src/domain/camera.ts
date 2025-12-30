import { mat4, vec3 } from "gl-matrix";

export class Camera {
  yaw = 0;
  pitch = -0.35;
  distance = 140;
  target: vec3 = vec3.fromValues(0, 0, 0);

  rotate(deltaYaw: number, deltaPitch: number) {
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, -1.45, 1.45);
  }

  zoom(delta: number) {
    this.distance = clamp(this.distance + delta, 10, 400);
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
