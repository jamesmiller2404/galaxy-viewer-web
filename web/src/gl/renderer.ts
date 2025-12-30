import { mat4 } from "gl-matrix";
import { Camera } from "@domain/camera";
import { fragmentSource, vertexSource } from "./shaders";
import { StarBuffer } from "@domain/parameters";

export class GalaxyRenderer {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private paletteTex!: WebGLTexture;
  private uModel!: WebGLUniformLocation;
  private uView!: WebGLUniformLocation;
  private uProjection!: WebGLUniformLocation;
  private uPalette!: WebGLUniformLocation;
  private starCount = 0;
  private camera = new Camera();
  private model = mat4.create();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
  }

  init() {
    const gl = this.gl;
    this.program = this.createProgram(vertexSource, fragmentSource);
    this.uModel = gl.getUniformLocation(this.program, "uModel")!;
    this.uView = gl.getUniformLocation(this.program, "uView")!;
    this.uProjection = gl.getUniformLocation(this.program, "uProjection")!;
    this.uPalette = gl.getUniformLocation(this.program, "uPalette")!;

    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    const stride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4 * 4);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.enable(gl.PROGRAM_POINT_SIZE);

    this.paletteTex = this.createPaletteTexture(buildPalette());
    this.resize();
  }

  setStars(buffer: StarBuffer) {
    this.starCount = buffer.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.data, gl.DYNAMIC_DRAW);
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
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const view = this.camera.getViewMatrix();
    const projection = this.camera.getProjectionMatrix(aspect);

    gl.uniformMatrix4fv(this.uModel, false, this.model);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uProjection, false, projection);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(this.uPalette, 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.starCount);
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

  setAngles(yaw: number, pitch: number) {
    this.camera.setAngles(yaw, pitch);
    this.render();
  }

  getAngles() {
    return this.camera.getAngles();
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.paletteTex);
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

  private createPaletteTexture(palette: Float32Array) {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Store palette as a 1xN strip
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16F,
      palette.length / 3,
      1,
      0,
      gl.RGB,
      gl.FLOAT,
      palette
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
}

function buildPalette() {
  const palette = new Float32Array(256 * 3);
  const core = [1.0, 0.95, 0.9];
  const mid = [0.85, 0.9, 1.0];
  const outer = [0.45, 0.6, 1.0];

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const midT = clamp((t - 0.2) / 0.3, 0, 1);
    const outerT = clamp((t - 0.5) / 0.5, 0, 1);
    const warmToMid = lerp3(core, mid, midT);
    const col = lerp3(warmToMid, outer, outerT);
    palette[i * 3 + 0] = col[0];
    palette[i * 3 + 1] = col[1];
    palette[i * 3 + 2] = col[2];
  }

  return palette;
}

function lerp3(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}
