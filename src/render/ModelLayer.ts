// Instanced low-poly models (cars, taxis, people, depot offices, showrooms,
// street trees and lamps, lit windows) drawn inside MapLibre's 3D pass so tall
// buildings hide what's behind them. Each instance is a box with position,
// heading, size, colour and an emissive flag. Passes, in order: soft ground
// decals (shadows, halos), opaque solids, night lights (windows, lamp heads),
// additive light pools, see-through glass, then one full-screen triangle for
// distance haze and a vignette. Geometry is in local metres; one matrix maps
// local metres to clip space.
//
// Things that never move (trees, lamps) are uploaded once; windows only when
// the camera has travelled. Only vehicles and people are re-sent every frame.

import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { LocalProjection } from '../core/geo';

export const INSTANCE_FLOATS = 12; // x y z heading | sx sy sz | r g b a | emissive

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec4 i_pos;
layout(location = 3) in vec3 i_size;
layout(location = 4) in vec4 i_col;
layout(location = 5) in float i_emit;
uniform mat4 u_matrix;
uniform vec3 u_sun;
uniform float u_ambient;
uniform float u_diffuse;
uniform vec3 u_tint;
uniform float u_fade;
out vec4 v_col;
out vec2 v_uv;
void main() {
  vec3 p = a_pos * i_size;
  float c = cos(i_pos.w), s = sin(i_pos.w);
  vec3 w = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + i_pos.xyz;
  vec3 n = vec3(c * a_nrm.x - s * a_nrm.y, s * a_nrm.x + c * a_nrm.y, a_nrm.z);
  float lit = u_ambient + u_diffuse * max(dot(n, u_sun), 0.0) + 0.1 * n.z;
  v_col = vec4(mix(i_col.rgb * lit * u_tint, i_col.rgb, i_emit), i_col.a * u_fade);
  v_uv = a_pos.xy * 2.0;
  gl_Position = u_matrix * vec4(w, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_col;
in vec2 v_uv;
uniform float u_soft;
out vec4 o_col;
void main() {
  float a = v_col.a;
  if (u_soft > 0.5) a *= 1.0 - smoothstep(0.3, 1.0, length(v_uv));
  o_col = vec4(v_col.rgb, a);
}`;

// one triangle that covers the screen
const SCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FX_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec4 u_haze;
uniform float u_vignette;
out vec4 o_col;
void main() {
  float h = u_haze.a * smoothstep(0.62, 1.0, v_uv.y);
  float v = u_vignette * smoothstep(0.42, 0.9, length(v_uv - 0.5));
  o_col = vec4(u_haze.rgb * h * (1.0 - v), h + v - h * v);
}`;

const MUL_FS = `#version 300 es
precision mediump float;
uniform vec3 u_mul;
out vec4 o_col;
void main() { o_col = vec4(u_mul, 1.0); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  return prog;
}

/**
 * Multiplies everything already drawn (the ground and roads) by a colour.
 * Sits under the buildings, which take their night colour from the map light,
 * so lamps, windows and headlights drawn later stay bright.
 */
export class TintLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  mul: [number, number, number] = [1, 1, 1];
  private prog: WebGLProgram | null = null;
  private loc: WebGLUniformLocation | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  constructor(readonly id: string) {}

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    this.prog = compile(gl, SCREEN_VS, MUL_FS);
    this.loc = gl.getUniformLocation(this.prog, 'u_mul');
    this.vao = gl.createVertexArray();
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }

  render(gl: WebGL2RenderingContext) {
    const m = this.mul;
    if (!this.prog || (m[0] > 0.995 && m[1] > 0.995 && m[2] > 0.995)) return;
    gl.useProgram(this.prog);
    gl.uniform3fv(this.loc, m);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

/** Unit box: x,y in [-0.5, 0.5], z in [0, 1]; no bottom face. */
function boxMesh(): Float32Array {
  const v: number[] = [];
  const face = (n: [number, number, number], corners: [number, number, number][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) v.push(...corners[i], ...n);
  };
  const x0 = -0.5, x1 = 0.5, y0 = -0.5, y1 = 0.5, z0 = 0, z1 = 1;
  face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  face([-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]);
  face([0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]);
  face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
  return new Float32Array(v);
}

function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export interface Lighting {
  sun: [number, number, number];
  ambient: number;
  diffuse: number;
  /** colour of the light falling on models (white by day, blue at night) */
  tint: [number, number, number];
}

/** One instanced draw: its own buffer and vertex array, re-uploaded only when its data changes. */
class Batch {
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private cap = 0;
  private data: Float32Array = new Float32Array(0);
  private dirty = false;
  n = 0;

  set(data: Float32Array, n: number) {
    this.data = data;
    this.n = n;
    this.dirty = true;
  }

  init(gl: WebGL2RenderingContext, mesh: WebGLBuffer) {
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = INSTANCE_FLOATS * 4;
    const attr = (loc: number, size: number, offset: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(2, 4, 0);
    attr(3, 3, 4);
    attr(4, 4, 7);
    attr(5, 1, 11);
    gl.bindVertexArray(null);
  }

  draw(gl: WebGL2RenderingContext, vertexCount: number) {
    if (!this.n || !this.vao) return;
    gl.bindVertexArray(this.vao);
    if (this.dirty) {
      this.dirty = false;
      const bytes = this.n * INSTANCE_FLOATS * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      if (bytes > this.cap) {
        this.cap = Math.max(bytes, this.cap * 2, 4096);
        gl.bufferData(gl.ARRAY_BUFFER, this.cap, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * INSTANCE_FLOATS);
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertexCount, this.n);
  }

  dispose(gl: WebGL2RenderingContext) {
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.buf) gl.deleteBuffer(this.buf);
  }
}

export class ModelLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  /** local metres → clip space for the frame just drawn (used by the 2D overlay) */
  matrix: Float64Array | null = null;
  lighting: Lighting = { sun: [0.4, -0.5, 0.77], ambient: 0.62, diffuse: 0.45, tint: [1, 1, 1] };
  /** 0 by day, 1 in the dead of night: fades in windows, lamps and light pools */
  night = 0;
  /** draw street trees and lamps (off when zoomed far out, or on low graphics) */
  props = true;
  /** distance haze colour and strength at the top of the screen */
  haze: [number, number, number, number] = [1, 1, 1, 0];
  vignette = 0;

  // every frame
  readonly decals = new Batch();
  readonly solids = new Batch();
  readonly glass = new Batch();
  readonly glows = new Batch();
  // uploaded once, or rarely
  readonly propSolids = new Batch();
  readonly propLights = new Batch();
  readonly propPools = new Batch();
  readonly windows = new Batch();

  private prog: WebGLProgram | null = null;
  private fx: WebGLProgram | null = null;
  private fxVao: WebGLVertexArrayObject | null = null;
  private mesh: WebGLBuffer | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private model: Float64Array;
  private m32 = new Float32Array(16);
  private vertexCount = 0;

  constructor(id: string, proj: LocalProjection, private onRender: (layer: ModelLayer) => void) {
    this.id = id;
    const o = proj.origin;
    const m0 = MercatorCoordinate.fromLngLat([o.lng, o.lat]);
    const phi = (o.lat * Math.PI) / 180;
    const kx = 1 / (360 * proj.mPerDegLng);
    const ky = -(1 / (2 * Math.PI * Math.cos(phi))) * ((Math.PI / 180) / proj.mPerDegLat);
    const kz = m0.meterInMercatorCoordinateUnits();
    // translate(m0) then scale(kx, ky, kz), column-major
    this.model = new Float64Array([kx, 0, 0, 0, 0, ky, 0, 0, 0, 0, kz, 0, m0.x, m0.y, 0, 1]);
  }

  private get batches() {
    return [this.decals, this.solids, this.glass, this.glows, this.propSolids, this.propLights, this.propPools, this.windows];
  }

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    this.prog = compile(gl, VS, FS);
    for (const u of ['u_matrix', 'u_sun', 'u_ambient', 'u_diffuse', 'u_tint', 'u_fade', 'u_soft']) this.loc[u] = gl.getUniformLocation(this.prog, u);
    this.fx = compile(gl, SCREEN_VS, FX_FS);
    this.loc.u_haze = gl.getUniformLocation(this.fx, 'u_haze');
    this.loc.u_vignette = gl.getUniformLocation(this.fx, 'u_vignette');
    this.fxVao = gl.createVertexArray();

    const mesh = boxMesh();
    this.vertexCount = mesh.length / 6;
    this.mesh = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    for (const b of this.batches) b.init(gl, this.mesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.fx) gl.deleteProgram(this.fx);
    if (this.fxVao) gl.deleteVertexArray(this.fxVao);
    if (this.mesh) gl.deleteBuffer(this.mesh);
    for (const b of this.batches) b.dispose(gl);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    // mainMatrix takes 0..1 web-mercator coordinates with conformal z, matching this.model
    this.matrix = mul(options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>, this.model);
    this.onRender(this);
    if (!this.prog) return;
    const L = this.loc, n = this.vertexCount, lit = this.lighting, night = this.night;

    gl.useProgram(this.prog);
    this.m32.set(this.matrix);
    gl.uniformMatrix4fv(L.u_matrix, false, this.m32);
    gl.uniform3fv(L.u_sun, lit.sun);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const unlit = () => { gl.uniform1f(L.u_ambient, 1); gl.uniform1f(L.u_diffuse, 0); gl.uniform3f(L.u_tint, 1, 1, 1); };
    const lighted = () => { gl.uniform1f(L.u_ambient, lit.ambient); gl.uniform1f(L.u_diffuse, lit.diffuse); gl.uniform3fv(L.u_tint, lit.tint); };
    const blend = (additive: boolean) => {
      gl.enable(gl.BLEND);
      // the alpha channel is left opaque so the page never shows through the canvas
      if (additive) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.depthMask(false);
    };

    // soft contact shadows and selection halos
    unlit();
    gl.uniform1f(L.u_fade, 1);
    gl.uniform1f(L.u_soft, 1);
    blend(false);
    this.decals.draw(gl, n);

    // solids
    lighted();
    gl.uniform1f(L.u_soft, 0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    if (this.props) this.propSolids.draw(gl, n);
    this.solids.draw(gl, n);

    if (night > 0.02) {
      // lit windows and lamp heads fade in with the dusk
      unlit();
      gl.uniform1f(L.u_fade, night);
      blend(false);
      this.windows.draw(gl, n);
      if (this.props) this.propLights.draw(gl, n);
      // pools of light on the road
      gl.uniform1f(L.u_soft, 1);
      blend(true);
      if (this.props) this.propPools.draw(gl, n);
      this.glows.draw(gl, n);
      gl.uniform1f(L.u_soft, 0);
    }

    if (this.glass.n) {
      // lit, blended, tested against the solids but not hiding them
      lighted();
      gl.uniform1f(L.u_fade, 1);
      blend(false);
      this.glass.draw(gl, n);
    }

    if (this.fx && (this.haze[3] > 0.01 || this.vignette > 0.01)) {
      gl.useProgram(this.fx);
      gl.uniform4fv(L.u_haze, this.haze);
      gl.uniform1f(L.u_vignette, this.vignette);
      gl.bindVertexArray(this.fxVao);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}

/** Project local metres (x east, y north, z up) to CSS pixels with a ModelLayer matrix. */
export function projectLocal(m: Float64Array, x: number, y: number, z: number, w: number, h: number): [number, number] | null {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 1e-6) return null;
  return [((cx / cw + 1) / 2) * w, ((1 - cy / cw) / 2) * h];
}
