import { OrbitCamera } from "@domain/orbitCamera";
import { jupiterFragmentSource, jupiterVertexSource } from "./jupiterShaders";
import { jupiterReferenceFragmentSource, jupiterReferenceVertexSource } from "./jupiterReferenceShaders";

export type JupiterBodyBuffer = {
  data: Float32Array;
  count: number;
};

export type JupiterReferenceBuffer = {
  data: Float32Array;
  count: number;
};

export class JupiterRenderer {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private uView!: WebGLUniformLocation;
  private uProjection!: WebGLUniformLocation;
  private refProgram!: WebGLProgram;
  private refVao!: WebGLVertexArrayObject;
  private refVbo!: WebGLBuffer;
  private uRefView!: WebGLUniformLocation;
  private uRefProjection!: WebGLUniformLocation;
  private camera = new OrbitCamera();
  private bodyCount = 0;
  private referenceCount = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
  }

  init() {
    const gl = this.gl;
    this.program = this.createProgram(jupiterVertexSource, jupiterFragmentSource);
    this.uView = gl.getUniformLocation(this.program, "uView")!;
    this.uProjection = gl.getUniformLocation(this.program, "uProjection")!;

    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    const stride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 4 * 4);

    gl.bindVertexArray(null);

    this.refProgram = this.createProgram(jupiterReferenceVertexSource, jupiterReferenceFragmentSource);
    this.uRefView = gl.getUniformLocation(this.refProgram, "uView")!;
    this.uRefProjection = gl.getUniformLocation(this.refProgram, "uProjection")!;

    this.refVao = gl.createVertexArray()!;
    this.refVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.refVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.refVbo);

    const refStride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, refStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, refStride, 3 * 4);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);

    this.resize();
  }

  setBodies(buffer: JupiterBodyBuffer) {
    this.bodyCount = buffer.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.data, gl.DYNAMIC_DRAW);
    this.render();
  }

  setReferenceLines(buffer: JupiterReferenceBuffer) {
    this.referenceCount = buffer.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.refVbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.data, gl.STATIC_DRAW);
    this.render();
  }

  updateBodies(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    this.render();
  }

  resize() {
    const { canvas, gl } = this;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  render() {
    const { gl } = this;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const view = this.camera.getViewMatrix();
    const projection = this.camera.getProjectionMatrix(aspect);

    if (this.referenceCount > 0) {
      gl.useProgram(this.refProgram);
      gl.uniformMatrix4fv(this.uRefView, false, view);
      gl.uniformMatrix4fv(this.uRefProjection, false, projection);
      gl.bindVertexArray(this.refVao);
      gl.drawArrays(gl.LINES, 0, this.referenceCount);
      gl.bindVertexArray(null);
    }

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uProjection, false, projection);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.bodyCount);
    gl.bindVertexArray(null);
  }

  orbit(deltaX: number, deltaY: number) {
    this.camera.rotate(deltaX, deltaY);
    this.render();
  }

  zoom(delta: number) {
    this.camera.zoom(delta);
    this.render();
  }

  setZoomDistance(distance: number) {
    this.camera.setDistance(distance);
    this.render();
  }

  setDistanceLimits(minDistance: number, maxDistance: number) {
    this.camera.setDistanceLimits(minDistance, maxDistance);
    this.render();
  }

  resetCamera(distance?: number) {
    this.camera.reset(distance);
    this.render();
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.refProgram);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.refVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.refVao);
  }

  private createProgram(vsSource: string, fsSource: string) {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  private compileShader(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }
}
