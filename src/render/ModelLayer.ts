// Instanced low-poly models (cars, taxis, people, depot offices, showrooms)
// drawn inside MapLibre's 3D pass so tall buildings hide what's behind them.
// Each instance is a box with position, heading, size, colour and an emissive
// flag (head/tail lights). Three passes: blended ground decals (shadows,
// highlight halos), opaque solids, then see-through glass over the solids.
// Geometry is in local metres; one matrix maps local metres to clip space.

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
out vec4 v_col;
void main() {
  vec3 p = a_pos * i_size;
  float c = cos(i_pos.w), s = sin(i_pos.w);
  vec3 w = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + i_pos.xyz;
  vec3 n = vec3(c * a_nrm.x - s * a_nrm.y, s * a_nrm.x + c * a_nrm.y, a_nrm.z);
  float lit = u_ambient + u_diffuse * max(dot(n, u_sun), 0.0) + 0.1 * n.z;
  v_col = vec4(mix(i_col.rgb * lit, i_col.rgb, i_emit), i_col.a);
  gl_Position = u_matrix * vec4(w, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_col;
out vec4 o_col;
void main() { o_col = v_col; }`;

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
}

export class ModelLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  /** local metres → clip space for the frame just drawn (used by the 2D overlay) */
  matrix: Float64Array | null = null;
  lighting: Lighting = { sun: [0.4, -0.5, 0.77], ambient: 0.62, diffuse: 0.45 };

  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private inst: WebGLBuffer | null = null;
  private instCap = 0;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private model: Float64Array;
  private solids: Float32Array = new Float32Array(0);
  private shadows: Float32Array = new Float32Array(0);
  private glass: Float32Array = new Float32Array(0);
  private nSolid = 0;
  private nShadow = 0;
  private nGlass = 0;
  private vertexCount = 0;

  constructor(id: string, proj: LocalProjection, private onRender: (layer: ModelLayer) => void) {
    this.id = id;
    const o = proj.origin;
    const m0 = MercatorCoordinate.fromLngLat([o.lng, o.lat]);
    const phi = (o.lat * Math.PI) / 180;
    const kx = 1 / (360 * proj.mPerDegLng);
    const ky = -(1 / (2 * Math.PI * Math.cos(phi))) * ((Math.PI / 180) / proj.mPerDegLat);
    const kz = m0.meterInMercatorCoordinateUnits();
    // translate(m0) · scale(kx, ky, kz), column-major
    this.model = new Float64Array([kx, 0, 0, 0, 0, ky, 0, 0, 0, 0, kz, 0, m0.x, m0.y, 0, 1]);
  }

  /** Swap in this frame's instances; arrays may be longer than the counts. */
  setInstances(solids: Float32Array, nSolid: number, shadows: Float32Array, nShadow: number, glass: Float32Array, nGlass: number) {
    this.solids = solids;
    this.nSolid = nSolid;
    this.shadows = shadows;
    this.nShadow = nShadow;
    this.glass = glass;
    this.nGlass = nGlass;
  }

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    for (const u of ['u_matrix', 'u_sun', 'u_ambient', 'u_diffuse']) this.loc[u] = gl.getUniformLocation(prog, u);

    const mesh = boxMesh();
    this.vertexCount = mesh.length / 6;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.inst) gl.deleteBuffer(this.inst);
  }

  private upload(gl: WebGL2RenderingContext, data: Float32Array, count: number) {
    const bytes = count * INSTANCE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (bytes > this.instCap) {
      this.instCap = Math.max(bytes, this.instCap * 2, 4096);
      gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    // mainMatrix takes 0..1 web-mercator coordinates with conformal z, matching this.model
    this.matrix = mul(options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>, this.model);
    this.onRender(this);
    if (!this.prog || !this.vao || (!this.nSolid && !this.nShadow && !this.nGlass)) return;

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.u_matrix, false, new Float32Array(this.matrix));
    gl.uniform3fv(this.loc.u_sun, this.lighting.sun);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    if (this.nShadow) {
      // soft contact shadows: blended, no depth writes, unlit
      gl.uniform1f(this.loc.u_ambient, 1);
      gl.uniform1f(this.loc.u_diffuse, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.upload(gl, this.shadows, this.nShadow);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.nShadow);
    }
    if (this.nSolid) {
      gl.uniform1f(this.loc.u_ambient, this.lighting.ambient);
      gl.uniform1f(this.loc.u_diffuse, this.lighting.diffuse);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      this.upload(gl, this.solids, this.nSolid);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.nSolid);
    }
    if (this.nGlass) {
      // lit, blended, tested against the solids but not hiding them
      gl.uniform1f(this.loc.u_ambient, this.lighting.ambient);
      gl.uniform1f(this.loc.u_diffuse, this.lighting.diffuse);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.upload(gl, this.glass, this.nGlass);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.nGlass);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
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
