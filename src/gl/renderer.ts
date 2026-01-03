import { mat4 } from "gl-matrix";
import { Camera } from "@domain/camera";
import { fragmentSource, vertexSource } from "./shaders";
import { StarBuffer } from "@domain/parameters";

export class GalaxyRenderer {
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private useOrtho = false;
  private mode: "single" | "multi" = "single";
  private galaxyDraws: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number; model: mat4 }[] = [];
  private paletteTex!: WebGLTexture;
  private uModel!: WebGLUniformLocation;
  private uView!: WebGLUniformLocation;
  private uProjection!: WebGLUniformLocation;
  private uPalette!: WebGLUniformLocation;
  private uStarSizeScale!: WebGLUniformLocation;
  private starCount = 0;
  private starSizeScale = 1;
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
    this.uStarSizeScale = gl.getUniformLocation(this.program, "uStarSizeScale")!;

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

    this.paletteTex = this.createPaletteTexture(buildPalette());
    this.resize();
  }

  setStars(buffer: StarBuffer) {
    this.mode = "single";
    this.disposeGalaxyDraws();
    this.starCount = buffer.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.data, gl.DYNAMIC_DRAW);
    this.render();
  }

  updateStarBuffer(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    this.render();
  }

  setGalaxies(
    galaxies: Array<{ buffer: StarBuffer; model?: mat4 }>
  ) {
    const gl = this.gl;
    this.mode = "multi";
    this.disposeGalaxyDraws();

    this.galaxyDraws = galaxies.map((entry) => {
      const vbo = gl.createBuffer();
      const vao = gl.createVertexArray();
      if (!vbo || !vao) {
        throw new Error("Failed to create buffers for galaxy");
      }
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, entry.buffer.data, gl.DYNAMIC_DRAW);
      const stride = 5 * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4 * 4);
      gl.bindVertexArray(null);
      return { vao, vbo, count: entry.buffer.count, model: entry.model ? mat4.clone(entry.model) : mat4.create() };
    });
    this.render();
  }

  updateGalaxyModel(index: number, model: mat4) {
    const target = this.galaxyDraws[index];
    if (!target) return;
    target.model = mat4.clone(model);
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
    const projection = this.useOrtho ? this.camera.getOrthoMatrix(aspect) : this.camera.getProjectionMatrix(aspect);

    gl.uniformMatrix4fv(this.uProjection, false, projection);
    gl.uniform1f(this.uStarSizeScale, clamp(this.starSizeScale, 0, 1));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(this.uPalette, 0);

    if (this.mode === "multi") {
      this.renderMulti(view);
      return;
    }

    gl.uniformMatrix4fv(this.uModel, false, this.model);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.starCount);
    gl.bindVertexArray(null);
  }

  private renderMulti(view: mat4) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uView, false, view);
    for (const galaxy of this.galaxyDraws) {
      gl.uniformMatrix4fv(this.uModel, false, galaxy.model);
      gl.bindVertexArray(galaxy.vao);
      gl.drawArrays(gl.POINTS, 0, galaxy.count);
    }
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

  getZoomDistance() {
    return this.camera.getDistance();
  }

  getCameraState() {
    return {
      target: this.camera.getTarget(),
      distance: this.camera.getDistance(),
      angles: this.camera.getAngles(),
      useOrtho: this.useOrtho
    };
  }

  setAngles(yaw: number, pitch: number) {
    this.camera.setAngles(yaw, pitch);
    this.render();
  }

  setPlanarView(distance?: number) {
    this.useOrtho = true;
    this.camera.setPlanarView(distance);
    this.render();
  }

  pan2D(deltaX: number, deltaY: number) {
    if (!this.useOrtho) return;
    this.camera.panOrtho(deltaX, deltaY, this.canvas.width, this.canvas.height);
    this.render();
  }

  setStarSizeScale(scale: number) {
    this.starSizeScale = clamp(scale, 0, 1);
    this.render();
  }


  setOrthoMode(enabled: boolean) {
    this.useOrtho = enabled;
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
    this.disposeGalaxyDraws();
  }

  private disposeGalaxyDraws() {
    const gl = this.gl;
    this.galaxyDraws.forEach((g) => {
      gl.deleteBuffer(g.vbo);
      gl.deleteVertexArray(g.vao);
    });
    this.galaxyDraws = [];
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
  const core = [1.0, 0.94, 0.82];
  const mid = [0.86, 0.68, 0.55];
  const outer = [0.52, 0.68, 1.0];

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
