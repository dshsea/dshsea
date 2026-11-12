// Smooth procedural sea creatures: geometry builders and the shared organic shader.
// Every creature faces +x, is roughly 2 units long, and is built from parametric grids
// (tubes, ellipsoids, fins) so that no model files are needed.
import * as THREE from 'three';
import type { SpeciesId } from '../lib/species';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PI = Math.PI;

// Vertex "part" ids, read by the fragment shader.
export const PART = { body: 0, fin: 1, eye: 2, glow: 3, pale: 4, bell: 6, frill: 7, shell: 8, scute: 9 } as const;

type Sway = (u: number, v: number) => [number, number, number];
type GridOpts = { part: number; wrapU?: boolean; phase?: number; sway?: Sway; t?: (u: number, v: number) => number };

class Builder {
  pos: number[] = [];
  partT: number[] = [];
  anim: number[] = [];
  idx: number[] = [];

  /** A (nu × nv) parametric surface patch. */
  grid(nu: number, nv: number, fn: (u: number, v: number) => THREE.Vector3, o: GridOpts) {
    const start = this.pos.length / 3;
    const cols = o.wrapU ? nu : nu + 1;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i < cols; i++) {
        const u = i / nu, v = j / nv;
        const p = fn(u, v);
        this.pos.push(p.x, p.y, p.z);
        this.partT.push(o.part, o.t ? o.t(u, v) : v);
        const s = o.sway ? o.sway(u, v) : [0, 0, 0];
        this.anim.push(s[0], s[1], s[2], o.phase ?? 0);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const i2 = o.wrapU ? (i + 1) % nu : i + 1;
        const a = start + j * cols + i, b = start + j * cols + i2, c = start + (j + 1) * cols + i, d = start + (j + 1) * cols + i2;
        this.idx.push(a, b, d, a, d, c);
      }
    }
  }

  /** A tube swept along a curve with an elliptical cross-section. */
  tube(curve: (t: number) => THREE.Vector3, rad: (t: number) => [number, number], segs: number, radial: number, o: GridOpts & { up?: THREE.Vector3 }) {
    const up = o.up ?? V(0, 1, 0);
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
    this.grid(radial, segs, (u, v) => {
      const p = curve(v);
      T.copy(curve(Math.min(1, v + 0.01))).sub(curve(Math.max(0, v - 0.01))).normalize();
      N.copy(up).addScaledVector(T, -up.dot(T));
      if (N.lengthSq() < 1e-6) N.set(0, 0, 1);
      N.normalize();
      B.crossVectors(T, N);
      const [ry, rz] = rad(v);
      const a = u * PI * 2;
      return p.clone().addScaledVector(N, Math.cos(a) * Math.max(ry, 0.002)).addScaledVector(B, Math.sin(a) * Math.max(rz, 0.002));
    }, { ...o, wrapU: true });
  }

  ball(c: THREE.Vector3, r: [number, number, number], o: GridOpts, nu = 16, nv = 10) {
    this.grid(nu, nv, (u, v) => {
      const lat = lerp(0.02, PI - 0.02, v), lon = u * PI * 2;
      return V(c.x + Math.sin(lat) * Math.cos(lon) * r[0], c.y + Math.cos(lat) * r[1], c.z + Math.sin(lat) * Math.sin(lon) * r[2]);
    }, { ...o, wrapU: true });
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aPartT', new THREE.Float32BufferAttribute(this.partT, 2));
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.anim, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- shared pieces ----------
type Body = { x0: number; x1: number; h: number; w: number; pow: number; ped?: number };
/** Half-height and half-width of a fish-like body at parameter t (0 = tail, 1 = nose). */
function bodyRad(b: Body, t: number): [number, number] {
  const s = Math.pow(Math.max(Math.sin(PI * Math.pow(t, b.pow)), 0), 0.72);
  const k = (b.ped ?? 0.14) * (1 - t) + s;
  return [b.h * k, b.w * k];
}
const bodyAt = (b: Body, x: number) => bodyRad(b, (x - b.x0) / (b.x1 - b.x0));
function addBody(B: Builder, b: Body, segs = 28, radial = 18) {
  B.tube((t) => V(lerp(b.x0, b.x1, t), 0, 0), (t) => bodyRad(b, t), segs, radial, { part: PART.body });
}
function addEyes(B: Builder, x: number, y: number, z: number, r: number) {
  for (const s of [1, -1]) {
    B.ball(V(x, y, s * z), [r, r, r * 0.7], { part: PART.pale }, 10, 6);
    B.ball(V(x + r * 0.25, y, s * (z + r * 0.42)), [r * 0.62, r * 0.62, r * 0.4], { part: PART.eye }, 10, 6);
  }
}
/** Vertical tail fin (fish). */
function addTail(B: Builder, x: number, len: number, spread: number, fork: number, amp: number) {
  B.grid(10, 5, (u, v) => {
    const yy = 2 * u - 1;
    return V(x - v * len * (1 - fork + fork * Math.abs(yy)), yy * (0.04 + spread * v), 0);
  }, { part: PART.fin, sway: (_u, v) => [0, 0, amp * v * v], t: (_u, v) => v * 0.6 });
}
function addPectorals(B: Builder, b: Body, x: number, len: number, wide: number, drop: number, out: number, flap = 0.05) {
  const [, hw] = bodyAt(b, x);
  for (const s of [1, -1]) {
    B.grid(6, 5, (u, v) => V(x - v * len * 0.85 + (u - 0.5) * wide * 0.3, -drop * 0.4 + (u - 0.5) * wide * (1 - 0.45 * v) - v * drop, s * (hw * 0.85 + v * out)),
      { part: PART.fin, phase: s > 0 ? 0 : 0.6, sway: (_u, v) => [0, flap * v, s * flap * 0.6 * v] });
  }
}
function addDorsal(B: Builder, b: Body, xa: number, xb: number, hgt: number, sign = 1, lean = 0.12) {
  B.grid(10, 4, (u, v) => {
    const x = lerp(xa, xb, u);
    const [hh] = bodyAt(b, x);
    return V(x - v * lean, sign * (hh * 0.92 + v * hgt * Math.pow(Math.sin(PI * Math.min(1, u * 0.95 + 0.05)), 0.6)), 0);
  }, { part: PART.fin, sway: (_u, v) => [0, 0, 0.03 * v] });
}

// ---------- species ----------
function fish(detail = 1) {
  const B = new Builder();
  const b: Body = { x0: -0.7, x1: 0.95, h: 0.36, w: 0.17, pow: 1.45 };
  addBody(B, b, Math.round(28 * detail), Math.round(18 * detail));
  addTail(B, -0.66, 0.6, 0.42, 0.55, 0.1);
  addDorsal(B, b, 0.5, -0.4, 0.26);
  addDorsal(B, b, -0.05, -0.5, 0.16, -1, 0.08);
  addPectorals(B, b, 0.4, 0.34, 0.2, 0.1, 0.2);
  if (detail >= 1) addEyes(B, 0.68, 0.06, bodyAt(b, 0.68)[1] * 0.82, 0.062);
  return B.build();
}

function anglerfish() {
  const B = new Builder();
  const b: Body = { x0: -0.6, x1: 0.82, h: 0.5, w: 0.36, pow: 1.95, ped: 0.1 };
  addBody(B, b, 30, 20);
  addTail(B, -0.56, 0.42, 0.32, 0.25, 0.09);
  addDorsal(B, b, 0.0, -0.45, 0.16);
  addPectorals(B, b, 0.2, 0.26, 0.2, 0.1, 0.16);
  addEyes(B, 0.5, 0.2, bodyAt(b, 0.5)[1] * 0.86, 0.05);
  // The mouth: a dark gape with needle teeth.
  B.ball(V(0.6, -0.1, 0), [0.24, 0.1, 0.27], { part: PART.eye }, 16, 8);
  for (let i = 0; i < 11; i++) {
    const a = lerp(-1.25, 1.25, i / 10);
    const x = 0.56 + Math.cos(a) * 0.27, z = Math.sin(a) * 0.27;
    const len = 0.1 + (i % 2) * 0.07;
    for (const dir of [1, -1]) {
      const y0 = dir > 0 ? -0.2 : -0.01;
      B.tube((t) => V(x, y0 + dir * t * len, z), (t) => [0.02 * (1 - t), 0.02 * (1 - t)], 3, 5, { part: PART.pale });
    }
  }
  // The lure: a stalk arcing over the head, ending in a glowing bulb.
  const stalk = (t: number) => V(0.3 + t * 0.62, 0.42 + Math.sin(t * PI * 0.62) * 0.42, 0);
  B.tube(stalk, () => [0.016, 0.016], 12, 6, { part: PART.body, sway: (_u, v) => [0, 0, 0.07 * v * v], t: (_u, v) => v });
  const tip = stalk(1);
  B.ball(tip, [0.085, 0.085, 0.085], { part: PART.glow, sway: () => [0, 0, 0.07], t: () => 1 }, 12, 8);
  return B.build();
}

function pufferfish() {
  const B = new Builder();
  const b: Body = { x0: -0.55, x1: 0.62, h: 0.5, w: 0.5, pow: 1.3, ped: 0.08 };
  addBody(B, b, 26, 22);
  addTail(B, -0.52, 0.3, 0.22, 0.1, 0.1);
  addDorsal(B, b, -0.18, -0.42, 0.14);
  addPectorals(B, b, 0.12, 0.2, 0.2, 0.02, 0.2, 0.09);
  addEyes(B, 0.42, 0.16, bodyAt(b, 0.42)[1] * 0.84, 0.085);
  B.ball(V(0.61, -0.04, 0), [0.05, 0.045, 0.09], { part: PART.pale }, 10, 6);
  // Spikes, spread over the body by a golden-angle spiral.
  const n = 70;
  for (let i = 0; i < n; i++) {
    const t = 0.12 + 0.76 * ((i + 0.5) / n);
    const a = i * 2.39996;
    const x = lerp(b.x0, b.x1, t);
    const [ry, rz] = bodyRad(b, t);
    const dir = V(0, Math.cos(a), Math.sin(a));
    const base = V(x, dir.y * ry * 0.96, dir.z * rz * 0.96);
    const out = V((t - 0.5) * 0.5, dir.y, dir.z).normalize();
    B.tube((s) => base.clone().addScaledVector(out, s * 0.13), (s) => [0.022 * (1 - s), 0.022 * (1 - s)], 2, 5, { part: PART.pale });
  }
  return B.build();
}

function whale() {
  const B = new Builder();
  const b: Body = { x0: -1.0, x1: 1.02, h: 0.3, w: 0.29, pow: 1.75, ped: 0.1 };
  addBody(B, b, 40, 22);
  // Horizontal fluke.
  B.grid(14, 5, (u, v) => {
    const zz = 2 * u - 1;
    return V(-0.97 - v * (0.1 + 0.26 * Math.abs(zz)), 0, zz * (0.04 + 0.52 * v));
  }, { part: PART.fin, sway: (_u, v) => [0, 0.05 * v, 0] });
  for (const s of [1, -1]) {
    const [, hw] = bodyAt(b, 0.42);
    B.grid(6, 6, (u, v) => V(0.44 - v * 0.5 + (u - 0.5) * 0.2 * (1 - v * 0.6), -0.14 - v * 0.2, s * (hw * 0.8 + v * 0.42)),
      { part: PART.fin, sway: (_u, v) => [0, 0.07 * v * v, 0], phase: s > 0 ? 0 : 0.5 });
  }
  addDorsal(B, b, -0.3, -0.52, 0.1, 1, 0.1);
  addEyes(B, 0.62, -0.03, bodyAt(b, 0.62)[1] * 0.9, 0.03);
  return B.build();
}

function squid() {
  const B = new Builder();
  const rad = (t: number): [number, number] => {
    const r = 0.2 * Math.pow(Math.max(1 - Math.pow(t, 2.4), 0), 0.55) * (0.72 + 0.28 * Math.sin(Math.min(1, t * 3) * PI * 0.5));
    return [r, r];
  };
  B.tube((t) => V(lerp(0.0, 1.0, t), 0, 0), rad, 26, 18, { part: PART.body });
  for (const s of [1, -1]) {
    B.grid(8, 5, (u, v) => {
      const x = lerp(0.5, 0.98, u);
      return V(x, 0, s * (rad(x)[0] * 0.9 + v * 0.3 * Math.pow(Math.sin(PI * u), 0.7)));
    }, { part: PART.fin, sway: (u, v) => [0, 0.08 * v, 0], t: (u) => u, phase: s });
  }
  B.ball(V(-0.08, 0, 0), [0.16, 0.14, 0.15], { part: PART.body });
  addEyes(B, -0.07, 0.02, 0.125, 0.07);
  for (let i = 0; i < 10; i++) {
    const long = i >= 8;
    const a = (i / 8) * PI * 2 + (long ? 0.4 : 0);
    const len = long ? 1.25 : 0.8, spread = long ? 0.1 : 0.16;
    const dy = Math.cos(a), dz = Math.sin(a);
    B.tube(
      (t) => V(-0.2 - t * len, dy * (0.07 + spread * Math.sin(t * PI * 0.6)), dz * (0.07 + spread * Math.sin(t * PI * 0.6))),
      (t) => { const r = (long ? 0.016 : 0.034) * (1 - t * 0.85) + (long && t > 0.82 ? 0.03 * Math.sin(((t - 0.82) / 0.18) * PI) : 0); return [r, r]; },
      14, 7, { part: PART.body, phase: i * 1.3, sway: (_u, v) => [0, dz * 0.09 * v * v, -dy * 0.09 * v * v] },
    );
  }
  return B.build();
}

function octopus() {
  const B = new Builder();
  B.ball(V(-0.08, 0.5, 0), [0.4, 0.46, 0.37], { part: PART.body }, 22, 14);
  B.ball(V(0.06, 0.12, 0), [0.3, 0.22, 0.3], { part: PART.body }, 18, 10);
  addEyes(B, 0.2, 0.22, 0.22, 0.075);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + 0.39;
    const dx = Math.cos(a), dz = Math.sin(a);
    B.tube(
      (t) => {
        const reach = 0.16 + t * 0.78 - 0.18 * t * t * t;
        return V(dx * reach, 0.04 - 0.72 * t + 0.34 * Math.sin(t * 3.3) * t, dz * reach);
      },
      (t) => { const r = 0.1 * Math.pow(1 - t, 0.8) + 0.012; return [r, r]; },
      20, 9, { part: PART.body, phase: i * 0.9, sway: (_u, v) => [-dz * 0.13 * v * v, 0.05 * v, dx * 0.13 * v * v] },
    );
  }
  return B.build();
}

function jellyfish() {
  const B = new Builder();
  const bell = (scale: number, yOff: number) => (u: number, v: number) => {
    const a = u * PI * 2;
    const r = 0.5 * scale * Math.sin(v * PI * 0.55) * (1 + 0.035 * Math.sin(a * 8) * Math.pow(v, 4));
    return V(Math.cos(a) * r, yOff + 0.4 * scale * Math.cos(v * PI * 0.5) - 0.06 * Math.pow(v, 6), Math.sin(a) * r);
  };
  B.grid(40, 16, bell(1, 0), { part: PART.bell, wrapU: true });
  B.grid(28, 10, bell(0.7, -0.04), { part: PART.bell, wrapU: true });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    B.tube(
      (t) => V(Math.cos(a + t * 1.6) * (0.07 + 0.05 * t), 0.12 - t * 1.05, Math.sin(a + t * 1.6) * (0.07 + 0.05 * t)),
      (t) => [0.06 * (1 - t * 0.7) * (1 + 0.5 * Math.sin(t * 26)), 0.014],
      26, 6, { part: PART.frill, phase: i * 1.7, sway: (_u, v) => [0.07 * v, 0, 0.07 * v] },
    );
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * PI * 2;
    const len = 1.2 + ((i * 7) % 5) * 0.12;
    B.tube(
      (t) => V(Math.cos(a) * 0.47 * (1 - 0.25 * t), -0.02 - t * len, Math.sin(a) * 0.47 * (1 - 0.25 * t)),
      () => [0.007, 0.007], 16, 4,
      { part: PART.frill, phase: i * 2.1, sway: (_u, v) => [Math.cos(a + 1.5) * 0.12 * v, 0, Math.sin(a + 1.5) * 0.12 * v] },
    );
  }
  return B.build();
}

function nautilus() {
  const B = new Builder();
  const a0 = 0.07, k = 0.18, th0 = 0.5 * PI, th1 = 3.5 * PI;
  const cx = -0.1, cy = -0.22;
  // Clockwise spiral: the last whorl ends on top, opening towards +x.
  const curve = (t: number) => {
    const th = lerp(th0, th1, t), r = a0 * Math.exp(k * th);
    return V(cx + Math.cos(th) * r, cy - Math.sin(th) * r, 0);
  };
  B.tube(curve, (t) => {
    const r = a0 * Math.exp(k * lerp(th0, th1, t)) * 0.52;
    return [r * 0.82, r];
  }, 70, 20, { part: PART.shell, up: V(0, 0, 1), t: (_u, v) => v });
  const end = curve(1), dir = curve(1).sub(curve(0.985)).normalize();
  const R = a0 * Math.exp(k * th1) * 0.52;
  const head = end.clone().addScaledVector(dir, R * 0.2);
  B.ball(head, [R * 0.8, R * 0.8, R * 0.66], { part: PART.body }, 16, 10);
  const side = V(-dir.y, dir.x, 0);
  for (const s of [1, -1]) {
    const e = head.clone().addScaledVector(dir, R * 0.15).addScaledVector(side, -R * 0.1);
    B.ball(V(e.x, e.y, s * R * 0.6), [0.05, 0.05, 0.03], { part: PART.eye }, 8, 6);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2;
    const off = side.clone().multiplyScalar(Math.cos(a) * R * 0.34).add(V(0, 0, Math.sin(a) * R * 0.3));
    const base = head.clone().addScaledVector(dir, R * 0.5).add(off);
    const len = 0.3 + ((i * 5) % 4) * 0.05;
    B.tube(
      (t) => base.clone().addScaledVector(dir, t * len).addScaledVector(off, t * 0.9).add(V(0, -0.1 * t * t, 0)),
      (t) => [0.026 * (1 - t * 0.8), 0.026 * (1 - t * 0.8)], 8, 6,
      { part: PART.pale, phase: i * 1.1, sway: (_u, v) => [0, 0.04 * v, 0.04 * v * Math.sin(a)] },
    );
  }
  return B.build();
}

function seahorse() {
  const B = new Builder();
  const spine = new THREE.CatmullRomCurve3([
    V(0.0, -0.6, 0), V(-0.1, -0.7, 0), V(-0.2, -0.62, 0), V(-0.17, -0.5, 0), V(-0.06, -0.46, 0), V(0.04, -0.36, 0),
    V(0.1, -0.16, 0), V(0.1, 0.08, 0), V(0.02, 0.3, 0), V(-0.03, 0.5, 0), V(0.02, 0.66, 0), V(0.14, 0.72, 0),
  ]);
  B.tube((t) => spine.getPoint(t), (t) => {
    const belly = Math.exp(-Math.pow((t - 0.6) / 0.16, 2)) * 0.13;
    const neck = Math.exp(-Math.pow((t - 0.95) / 0.07, 2)) * 0.05;
    const r = 0.022 + 0.06 * Math.min(1, t * 2.4) + belly + neck;
    // Bony rings.
    const ring = 1 + 0.07 * Math.sin(t * 95);
    return [r * 0.86 * ring, r * ring];
  }, 80, 14, { part: PART.body, up: V(0, 0, 1) });
  B.ball(V(0.15, 0.71, 0), [0.14, 0.12, 0.105], { part: PART.body }, 14, 10);
  B.tube((t) => V(0.24 + t * 0.3, 0.69 - t * 0.14, 0), (t) => [0.045 - 0.012 * t + (t > 0.85 ? 0.012 : 0), 0.04 - 0.01 * t], 8, 10, { part: PART.body });
  addEyes(B, 0.2, 0.75, 0.085, 0.045);
  for (let i = 0; i < 4; i++) B.ball(V(0.06 + i * 0.045, 0.83 + Math.sin(i * 1.3) * 0.02, 0), [0.03, 0.05, 0.03], { part: PART.fin }, 6, 4);
  B.grid(10, 4, (u, v) => V(0.0 - v * 0.2 - 0.04 * Math.sin(u * PI), lerp(-0.08, 0.3, u), 0),
    { part: PART.fin, sway: (u, v) => [0, 0, 0.05 * v], t: (u) => u * 2.5 });
  return B.build();
}

function turtle() {
  const B = new Builder();
  B.ball(V(-0.05, 0.03, 0), [0.62, 0.25, 0.5], { part: PART.scute }, 26, 14);
  B.ball(V(-0.05, -0.05, 0), [0.57, 0.15, 0.45], { part: PART.pale }, 20, 8);
  B.tube((t) => V(0.5 + t * 0.26, -0.01 + t * 0.03, 0), () => [0.085, 0.095], 4, 10, { part: PART.body });
  B.ball(V(0.82, 0.03, 0), [0.17, 0.125, 0.13], { part: PART.body }, 14, 10);
  addEyes(B, 0.87, 0.06, 0.1, 0.035);
  B.tube((t) => V(-0.64 - t * 0.16, -0.04, 0), (t) => [0.03 * (1 - t), 0.04 * (1 - t)], 4, 6, { part: PART.body });
  for (const s of [1, -1]) {
    // Front flippers: long blades that beat like wings.
    B.grid(8, 8, (u, v) => {
      const w = 0.3 * Math.pow(Math.sin(PI * Math.min(1, 0.12 + v * 0.88)), 0.6) * (1 - v * 0.35);
      return V(0.36 - v * 0.52 + (u - 0.5) * w, -0.03 - v * 0.06 + 0.03 * Math.sin(u * PI), s * (0.36 + v * 0.8));
    }, { part: PART.body, phase: 0, sway: (_u, v) => [0, 0.24 * v * v, 0], t: (_u, v) => v * 0.5 });
    B.grid(6, 5, (u, v) => {
      const w = 0.2 * Math.pow(Math.sin(PI * Math.min(1, 0.15 + v * 0.85)), 0.6);
      return V(-0.5 - v * 0.34 + (u - 0.5) * w, -0.04, s * (0.3 + v * 0.26));
    }, { part: PART.body, phase: 1.2, sway: (_u, v) => [0, 0.08 * v, 0] });
  }
  return B.build();
}

/** Horizontal fluke (whales, dolphins). */
function addFluke(B: Builder, x: number, len: number, span: number) {
  B.grid(14, 5, (u, v) => {
    const zz = 2 * u - 1;
    return V(x - v * len * (0.3 + 0.7 * Math.abs(zz)), 0, zz * (0.04 + span * v));
  }, { part: PART.fin, sway: (_u, v) => [0, 0.05 * v, 0] });
}

function shark(hammer = false) {
  const B = new Builder();
  const b: Body = { x0: -0.9, x1: 1.0, h: 0.22, w: 0.18, pow: 1.6, ped: 0.1 };
  addBody(B, b, 36, 18);
  // Heterocercal tail: the upper lobe is the long one.
  B.grid(10, 5, (u, v) => {
    const yy = 2 * u - 1;
    const lobe = yy > 0 ? 0.55 : 0.28;
    return V(-0.86 - v * (0.1 + lobe * Math.abs(yy)), yy * (0.03 + (yy > 0 ? 0.5 : 0.3) * v), 0);
  }, { part: PART.body, sway: (_u, v) => [0, 0, 0.1 * v * v], t: (_u, v) => v * 0.6 });
  B.grid(8, 5, (u, v) => {
    const x = lerp(0.3, -0.12, u);
    return V(x - v * 0.24, bodyAt(b, x)[0] * 0.9 + v * 0.38 * Math.pow(1 - u * 0.75, 1.2), 0);
  }, { part: PART.body });
  addPectorals(B, b, 0.38, 0.46, 0.24, 0.2, 0.36, 0.03);
  addDorsal(B, b, -0.42, -0.62, 0.1, 1, 0.08);
  addDorsal(B, b, -0.35, -0.6, 0.1, -1, 0.08);
  if (hammer) {
    B.ball(V(0.93, 0, 0), [0.1, 0.045, 0.44], { part: PART.body }, 16, 8);
    addEyes(B, 0.95, 0, 0.42, 0.035);
  } else addEyes(B, 0.74, 0.03, bodyAt(b, 0.74)[1] * 0.9, 0.032);
  return B.build();
}

function dolphin(tusk = false) {
  const B = new Builder();
  const b: Body = { x0: -0.95, x1: 0.82, h: 0.24, w: 0.21, pow: 1.7, ped: 0.1 };
  addBody(B, b, 34, 18);
  B.tube((t) => V(0.72 + t * 0.26, -0.03, 0), (t) => [0.07 * (1 - t * 0.55), 0.075 * (1 - t * 0.5)], 6, 10, { part: PART.body });
  if (tusk) B.tube((t) => V(0.95 + t * 0.95, 0.0 + t * 0.03, 0.02), (t) => [0.024 * (1 - t * 0.85), 0.024 * (1 - t * 0.85)], 10, 6, { part: PART.pale });
  addFluke(B, -0.92, 0.3, 0.42);
  B.grid(8, 5, (u, v) => {
    const x = lerp(0.12, -0.2, u);
    return V(x - v * 0.26 * (0.4 + v), bodyAt(b, x)[0] * 0.9 + v * 0.3 * Math.pow(1 - u * 0.8, 1.1), 0);
  }, { part: PART.body });
  addPectorals(B, b, 0.36, 0.34, 0.16, 0.16, 0.24, 0.04);
  addEyes(B, 0.6, 0.02, bodyAt(b, 0.6)[1] * 0.9, 0.03);
  return B.build();
}

function swordfish() {
  const B = new Builder();
  const b: Body = { x0: -0.75, x1: 0.8, h: 0.2, w: 0.14, pow: 1.5, ped: 0.08 };
  addBody(B, b, 30, 16);
  B.tube((t) => V(0.74 + t * 0.85, 0.01, 0), (t) => [0.028 * (1 - t * 0.9), 0.04 * (1 - t * 0.9)], 10, 6, { part: PART.body });
  addTail(B, -0.72, 0.5, 0.52, 0.85, 0.1);
  // Sail.
  B.grid(14, 5, (u, v) => {
    const x = lerp(0.5, -0.45, u);
    return V(x - v * 0.1, bodyAt(b, x)[0] * 0.9 + v * (0.42 * Math.pow(1 - u, 0.6) * Math.min(1, u * 9 + 0.25) + 0.05), 0);
  }, { part: PART.fin, sway: (_u, v) => [0, 0, 0.03 * v] });
  addPectorals(B, b, 0.36, 0.34, 0.1, 0.14, 0.12);
  addEyes(B, 0.58, 0.03, bodyAt(b, 0.58)[1] * 0.85, 0.05);
  return B.build();
}

function eel() {
  const B = new Builder();
  const rad = (t: number): [number, number] => {
    const r = 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.35) * (0.45 + 0.55 * t);
    return [r * 1.25, r];
  };
  const xAt = (t: number) => lerp(-1.2, 1.0, t);
  B.tube((t) => V(xAt(t), 0, 0), rad, 60, 12, { part: PART.body });
  for (const sign of [1, -1]) {
    B.grid(40, 2, (u, v) => {
      const t = lerp(0.02, 0.8, u);
      return V(xAt(t), sign * (rad(t)[0] * 0.9 + v * 0.05 * Math.sin(PI * u)), 0);
    }, { part: PART.fin });
  }
  addEyes(B, 0.88, 0.035, 0.05, 0.03);
  return B.build();
}

function sunfish() {
  const B = new Builder();
  const b: Body = { x0: -0.5, x1: 0.62, h: 0.58, w: 0.15, pow: 1.15, ped: 0.75 };
  addBody(B, b, 26, 20);
  for (const sign of [1, -1]) {
    B.grid(8, 6, (u, v) => {
      const x = lerp(-0.18, -0.46, u);
      return V(x - v * 0.16, sign * (0.5 + v * 0.62 * Math.pow(Math.sin(Math.PI * (0.15 + u * 0.7)), 0.5)), 0);
    }, { part: PART.body, sway: (_u, v) => [0, 0, sign * 0.1 * v], t: (_u, v) => v * 0.4 });
  }
  B.grid(12, 3, (u, v) => V(-0.5 - v * 0.14 * (1 + 0.25 * Math.sin(u * 28)), (2 * u - 1) * 0.42, 0), { part: PART.fin, sway: (_u, v) => [0, 0, 0.04 * v] });
  addPectorals(B, b, 0.2, 0.16, 0.14, 0.02, 0.1, 0.06);
  addEyes(B, 0.42, 0.14, bodyAt(b, 0.42)[1] * 0.8, 0.06);
  B.ball(V(0.62, -0.02, 0), [0.03, 0.05, 0.06], { part: PART.pale }, 8, 6);
  return B.build();
}

function lionfish() {
  const B = new Builder();
  const b: Body = { x0: -0.6, x1: 0.8, h: 0.3, w: 0.17, pow: 1.5 };
  addBody(B, b, 28, 16);
  addTail(B, -0.56, 0.42, 0.34, 0.2, 0.09);
  // Venomous spines down the back, each with a strip of membrane.
  for (let i = 0; i < 12; i++) {
    const x = lerp(0.48, -0.36, i / 11);
    const top = bodyAt(b, x)[0] * 0.9;
    const len = 0.5 * Math.sin(Math.PI * (0.18 + (i / 11) * 0.72));
    B.grid(2, 5, (u, v) => V(x - v * 0.14 + (u - 0.5) * 0.05 * (1 - v), top + v * len, 0),
      { part: i % 2 ? PART.fin : PART.pale, phase: i * 0.6, sway: (_u, v) => [0, 0, 0.05 * v * v] });
  }
  // Fan pectorals: long separate rays.
  for (const s of [1, -1]) {
    for (let i = 0; i < 9; i++) {
      const a = lerp(-1.0, 0.9, i / 8);
      B.grid(2, 5, (u, v) => V(0.34 - v * 0.5 * Math.cos(a * 0.5) + (u - 0.5) * 0.04, -0.04 + v * 0.48 * Math.sin(a), s * (bodyAt(b, 0.34)[1] * 0.8 + v * 0.42)),
        { part: i % 2 ? PART.fin : PART.pale, phase: i * 0.5 + (s > 0 ? 0 : 1), sway: (_u, v) => [0, 0.05 * v, s * 0.06 * v] });
    }
  }
  addEyes(B, 0.6, 0.07, bodyAt(b, 0.6)[1] * 0.85, 0.055);
  return B.build();
}

function manta() {
  const B = new Builder();
  B.ball(V(0.05, 0, 0), [0.56, 0.1, 0.4], { part: PART.body }, 22, 12);
  for (const s of [1, -1]) {
    for (const face of [1, -1]) {
      // Each wing is two skins a hair apart, so it has a dark back and a pale belly.
      B.grid(10, 10, (u, v) => {
        const chord = 0.9 * Math.pow(1 - v, 0.75) + 0.06;
        return V(0.42 - u * chord - v * 0.34, face * 0.035 * (1 - v) * Math.sin(Math.PI * u), s * (0.22 + v * 1.05));
      }, { part: face > 0 ? PART.body : PART.pale, phase: 0, sway: (_u, v) => [0, 0.3 * v * v, 0], t: (_u, v) => v * 0.45 });
    }
    B.tube((t) => V(0.5 + t * 0.26, -0.03 - t * 0.05, s * (0.16 - t * 0.04)), (t) => [0.05 * (1 - t * 0.6), 0.025], 6, 8, { part: PART.body });
    B.ball(V(0.46, 0.03, s * 0.3), [0.03, 0.03, 0.02], { part: PART.eye }, 8, 6);
  }
  B.tube((t) => V(-0.45 - t * 1.0, 0, 0), (t) => [0.02 * (1 - t), 0.02 * (1 - t)], 14, 5, { part: PART.body, sway: (_u, v) => [0, 0.08 * v * v, 0] });
  return B.build();
}

function crab() {
  const B = new Builder();
  B.ball(V(0, 0.05, 0), [0.34, 0.2, 0.5], { part: PART.scute }, 22, 12);
  B.ball(V(0, -0.02, 0), [0.3, 0.14, 0.44], { part: PART.pale }, 16, 8);
  for (const s of [1, -1]) {
    B.tube((t) => V(0.26 + t * 0.06, 0.12 + t * 0.14, s * 0.14), () => [0.018, 0.018], 3, 5, { part: PART.body });
    B.ball(V(0.33, 0.28, s * 0.14), [0.04, 0.04, 0.04], { part: PART.eye }, 8, 6);
    // Claw arm, claw and pincer.
    B.tube((t) => V(0.2 + t * 0.34, 0.0 + 0.1 * Math.sin(t * PI), s * (0.44 - t * 0.14)), (t) => [0.055 + 0.02 * t, 0.055], 8, 8, { part: PART.body, phase: s, sway: (_u, v) => [0, 0.04 * v, 0] });
    B.ball(V(0.64, 0.04, s * 0.28), [0.17, 0.11, 0.1], { part: PART.body, sway: () => [0, 0.04, 0], phase: s }, 12, 8);
    B.tube((t) => V(0.72 + t * 0.2, 0.1 - t * 0.05, s * 0.28), (t) => [0.035 * (1 - t), 0.04 * (1 - t)], 4, 6, { part: PART.pale, sway: () => [0, 0.04, 0], phase: s });
    for (let i = 0; i < 4; i++) {
      const z0 = 0.44, a = lerp(0.5, -0.9, i / 3);
      const knee = V(Math.sin(a) * 0.3, 0.16, s * (z0 + 0.34));
      const foot = V(Math.sin(a) * 0.46, -0.34, s * (z0 + 0.56));
      const root = V(Math.sin(a) * 0.14, 0, s * z0 * 0.9);
      B.tube((t) => (t < 0.5 ? root.clone().lerp(knee, t * 2) : knee.clone().lerp(foot, (t - 0.5) * 2)), (t) => [0.04 * (1 - t * 0.7), 0.04 * (1 - t * 0.7)], 8, 6,
        { part: PART.body, phase: i * 1.6 + (s > 0 ? 0 : 0.8), sway: (_u, v) => [0.07 * v, 0.03 * v, 0] });
    }
  }
  return B.build();
}

function starfish() {
  const B = new Builder();
  B.ball(V(0, 0, 0), [0.26, 0.26, 0.12], { part: PART.body }, 16, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + PI / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    B.tube((t) => V(dx * (0.12 + t * 0.85), dy * (0.12 + t * 0.85), 0.03 * Math.sin(t * PI)), (t) => { const r = 0.17 * Math.pow(1 - t, 0.7) + 0.02; return [r, r * 0.5]; },
      14, 12, { part: PART.body, up: V(-dy, dx, 0), phase: i * 1.2, sway: (_u, v) => [0, 0, 0.08 * v * v] });
    for (let k = 1; k < 6; k++) B.ball(V(dx * (0.1 + k * 0.14), dy * (0.1 + k * 0.14), 0.085 - k * 0.008), [0.028, 0.028, 0.028], { part: PART.pale }, 6, 4);
  }
  return B.build();
}

function shrimp() {
  const B = new Builder();
  // The body curls: straight thorax, then a tail tucked under.
  const spine = (t: number) => {
    const a = Math.max(0, 0.55 - t) * 2.9;
    return V(-0.5 + t * 1.0 + Math.sin(a) * -0.05, 0.12 * Math.cos(a) - 0.12 - Math.pow(Math.max(0, 0.55 - t), 1.6) * 1.1, 0);
  };
  B.tube(spine, (t) => { const r = (0.05 + 0.13 * Math.pow(t, 0.8)) * (1 + 0.09 * Math.sin(t * 44)); return [r, r * 0.72]; }, 40, 12, { part: PART.body });
  const tail = spine(0);
  B.grid(8, 3, (u, v) => V(tail.x + 0.02 + v * 0.2, tail.y - v * 0.08, (2 * u - 1) * (0.03 + 0.17 * v)), { part: PART.fin, sway: (_u, v) => [0, 0.04 * v, 0] });
  B.tube((t) => V(0.5 + t * 0.34, 0.04 + t * 0.08, 0), (t) => [0.03 * (1 - t), 0.02 * (1 - t)], 5, 6, { part: PART.pale });
  for (const s of [1, -1]) {
    B.ball(V(0.52, 0.09, s * 0.085), [0.04, 0.04, 0.04], { part: PART.eye }, 8, 6);
    B.tube((t) => V(0.5 + t * 0.5, 0.06 + t * 0.75 - t * t * 0.3, s * (0.05 + t * 0.2)), () => [0.007, 0.007], 14, 4, { part: PART.pale, phase: s, sway: (_u, v) => [0, 0.06 * v * v, s * 0.1 * v * v] });
    for (let i = 0; i < 5; i++) {
      const p0 = spine(0.5 + i * 0.09);
      B.tube((t) => V(p0.x + t * 0.05, p0.y - 0.08 - t * 0.22, s * (0.06 + t * 0.07)), (t) => [0.014 * (1 - t * 0.6), 0.014 * (1 - t * 0.6)], 4, 5, { part: PART.pale, phase: i * 1.1, sway: (_u, v) => [0.05 * v, 0, 0] });
    }
  }
  return B.build();
}

function nudibranch() {
  const B = new Builder();
  const rad = (t: number): [number, number] => {
    const r = 0.17 * Math.pow(Math.sin(PI * Math.min(1, 0.04 + t * 0.96)), 0.5);
    return [r * 0.8, r * (1.1 + 0.12 * Math.sin(t * 30))];
  };
  const xAt = (t: number) => lerp(-0.85, 0.75, t);
  B.tube((t) => V(xAt(t), 0.05 * Math.sin(t * 7), 0), rad, 40, 14, { part: PART.body });
  for (const s of [1, -1]) {
    B.tube((t) => V(0.6 + t * 0.06, 0.1 + t * 0.26, s * 0.07), (t) => [0.03 * (1 - t * 0.4), 0.03 * (1 - t * 0.4)], 5, 6, { part: PART.fin, phase: s, sway: (_u, v) => [0.03 * v, 0, 0] });
    B.ball(V(0.63, 0.38, s * 0.07), [0.035, 0.045, 0.035], { part: PART.glow }, 8, 6);
  }
  // Cerata: finger-like gills with glowing tips.
  for (let i = 0; i < 26; i++) {
    const t = 0.12 + ((i * 0.618) % 1) * 0.7;
    const side = ((i * 0.37) % 1) * 2 - 1;
    const [ry, rz] = rad(t);
    const base = V(xAt(t), ry * 0.7, side * rz * 0.75);
    const len = 0.16 + ((i * 7) % 5) * 0.03;
    B.tube((u) => base.clone().add(V(-0.05 * u, len * u, side * 0.1 * u)), (u) => [0.028 * (1 - u * 0.5), 0.028 * (1 - u * 0.5)], 4, 6, { part: PART.fin, phase: i * 0.8, sway: (_u, v) => [0.04 * v, 0, 0.03 * v] });
    B.ball(base.clone().add(V(-0.05, len, side * 0.1)), [0.026, 0.026, 0.026], { part: PART.glow, phase: i * 0.8, sway: () => [0.04, 0, 0.03], t: () => 1 }, 6, 4);
  }
  return B.build();
}

function cuttlefish() {
  const B = new Builder();
  const rad = (t: number): [number, number] => {
    const r = 0.25 * Math.pow(Math.sin(PI * Math.min(1, 0.05 + t * 0.9)), 0.55);
    return [r * 0.72, r];
  };
  const xAt = (t: number) => lerp(-0.8, 0.35, t);
  B.tube((t) => V(xAt(t), 0, 0), rad, 30, 18, { part: PART.body });
  // The skirt: a ribbon fin along each side that ripples.
  for (const s of [1, -1]) {
    B.grid(26, 3, (u, v) => {
      const t = lerp(0.06, 0.92, u);
      return V(xAt(t), 0, s * (rad(t)[1] * 0.95 + v * 0.12));
    }, { part: PART.fin, phase: s, sway: (_u, v) => [0, 0.07 * v, 0], t: (u) => u * 4 });
  }
  B.ball(V(0.4, 0, 0), [0.19, 0.16, 0.2], { part: PART.body }, 14, 10);
  addEyes(B, 0.42, 0.04, 0.17, 0.065);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    const dy = Math.cos(a), dz = Math.sin(a);
    B.tube((t) => V(0.52 + t * 0.4, dy * (0.07 - 0.02 * t) - 0.06 * t * t, dz * (0.09 - 0.03 * t)), (t) => [0.04 * (1 - t * 0.85), 0.04 * (1 - t * 0.85)], 10, 7,
      { part: PART.body, phase: i * 1.3, sway: (_u, v) => [0, dz * 0.05 * v * v, -dy * 0.05 * v * v] });
  }
  return B.build();
}

type SpeciesSpec = {
  build: () => THREE.BufferGeometry;
  /** Heading follows the swimming direction (otherwise the creature drifts and bobs). */
  swims: boolean;
  swim: number; axis: 0 | 1; pulse: number;
  /** Body pattern: 0 mottled, 1 stripes, 2 spots, 3 belly grooves. `null` lets each individual pick its own. */
  pattern: number | null;
  translucent?: boolean;
  /** Label offset below the creature, in body units. */
  drop: number;
};
export const SPECIES: Record<SpeciesId, SpeciesSpec> = {
  fish: { build: () => fish(), swims: true, swim: 1, axis: 0, pulse: 0, pattern: null, drop: 0.55 },
  anglerfish: { build: anglerfish, swims: true, swim: 0.55, axis: 0, pulse: 0, pattern: 0, drop: 0.7 },
  pufferfish: { build: pufferfish, swims: true, swim: 0.35, axis: 0, pulse: 0, pattern: 2, drop: 0.75 },
  whale: { build: whale, swims: true, swim: 0.7, axis: 1, pulse: 0, pattern: 3, drop: 0.6 },
  squid: { build: squid, swims: true, swim: 0, axis: 0, pulse: 0, pattern: 2, drop: 0.5 },
  turtle: { build: turtle, swims: true, swim: 0, axis: 0, pulse: 0, pattern: 0, drop: 0.5 },
  octopus: { build: octopus, swims: false, swim: 0, axis: 0, pulse: 0, pattern: null, drop: 0.95 },
  jellyfish: { build: jellyfish, swims: false, swim: 0, axis: 0, pulse: 1, pattern: 0, translucent: true, drop: 1.55 },
  nautilus: { build: nautilus, swims: false, swim: 0, axis: 0, pulse: 0, pattern: 0, drop: 0.95 },
  seahorse: { build: seahorse, swims: false, swim: 0, axis: 0, pulse: 0, pattern: null, drop: 1.0 },
  shark: { build: () => shark(), swims: true, swim: 0.8, axis: 0, pulse: 0, pattern: 0, drop: 0.5 },
  hammerhead: { build: () => shark(true), swims: true, swim: 0.8, axis: 0, pulse: 0, pattern: 0, drop: 0.5 },
  dolphin: { build: () => dolphin(), swims: true, swim: 0.8, axis: 1, pulse: 0, pattern: 0, drop: 0.5 },
  narwhal: { build: () => dolphin(true), swims: true, swim: 0.7, axis: 1, pulse: 0, pattern: 2, drop: 0.5 },
  swordfish: { build: swordfish, swims: true, swim: 0.9, axis: 0, pulse: 0, pattern: 1, drop: 0.6 },
  eel: { build: eel, swims: true, swim: 1.7, axis: 0, pulse: 0, pattern: null, drop: 0.45 },
  sunfish: { build: sunfish, swims: true, swim: 0.25, axis: 0, pulse: 0, pattern: 0, drop: 1.25 },
  lionfish: { build: lionfish, swims: true, swim: 0.6, axis: 0, pulse: 0, pattern: 1, drop: 0.75 },
  manta: { build: manta, swims: true, swim: 0, axis: 0, pulse: 0, pattern: 0, drop: 0.5 },
  crab: { build: crab, swims: false, swim: 0, axis: 0, pulse: 0, pattern: 2, drop: 0.6 },
  starfish: { build: starfish, swims: false, swim: 0, axis: 0, pulse: 0, pattern: 2, drop: 1.1 },
  shrimp: { build: shrimp, swims: true, swim: 0, axis: 0, pulse: 0, pattern: 1, drop: 0.75 },
  nudibranch: { build: nudibranch, swims: true, swim: 0.5, axis: 1, pulse: 0, pattern: 2, drop: 0.6 },
  cuttlefish: { build: cuttlefish, swims: true, swim: 0, axis: 0, pulse: 0, pattern: null, drop: 0.5 },
};

const cache = new Map<string, THREE.BufferGeometry>();
export function speciesGeometry(id: SpeciesId) {
  if (!cache.has(id)) cache.set(id, SPECIES[id].build());
  return cache.get(id)!;
}
export const schoolFishGeometry = () => fish(0.45);

// ---------- shader ----------
export const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  float fogAmount(float d, float scale) { float k = d * uFogDensity * scale; return 1.0 - exp(-k * k); }
`;

const VERT = /* glsl */ `
  attribute vec2 aPartT;
  attribute vec4 aAnim;
  uniform float uTime, uPhase, uSpeed, uSwim, uSwimAxis, uPulse;
  varying vec3 vWorld, vNormal, vObjPos, vObjN;
  varying float vPart, vT;
  void main() {
    vec3 p = position;
    float part = aPartT.x, t = aPartT.y;
    float ph = uTime * uSpeed + uPhase;
    #ifdef USE_INSTANCING
      ph += dot(instanceMatrix[3].xyz, vec3(1.7, 2.3, 1.1));
    #endif
    if (uSwim > 0.0) {
      // A wave travels down the body, strongest at the tail (-x).
      float tail = clamp(0.5 - p.x * 0.5, 0.0, 1.0);
      float w = sin(p.x * 3.4 - ph * 5.0) * tail * tail * 0.2 * uSwim;
      if (uSwimAxis < 0.5) p.z += w; else p.y += w;
    }
    p += aAnim.xyz * sin(t * 5.0 - ph * 2.6 + aAnim.w);
    if (uPulse > 0.0) {
      float beat = sin(ph * 1.7) * 0.5 + 0.5;
      if (part > 5.5 && part < 6.5) {
        p.xz *= 1.0 - 0.24 * uPulse * beat * t * t;
        p.y += 0.07 * uPulse * beat * t;
      } else if (part > 6.5 && part < 7.5) {
        float lag = sin(ph * 1.7 - 0.7 - t * 1.6) * 0.5 + 0.5;
        p.xz *= 1.0 - 0.2 * uPulse * lag * (1.0 - t * 0.6);
        p.y += 0.09 * uPulse * lag;
      }
    }
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vec4 wp = m * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(m) * normal);
    vObjPos = position;
    vObjN = normal;
    vPart = part;
    vT = t;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  ${FOG_GLSL}
  uniform float uTime, uSun, uAmbient, uCaustic;
  uniform vec3 uLightDir, uLampPos;
  uniform float uLampOn;
  uniform vec4 uPing;
  uniform float uPingA;
  uniform vec3 uBase, uBelly, uAccent, uGlowColor;
  uniform float uPattern, uGlow, uDim, uFogScale, uOpacity, uHolo;
  varying vec3 vWorld, vNormal, vObjPos, vObjN;
  varying float vPart, vT;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float caustic(vec2 p) {
    p *= 0.55;
    float a = sin(p.x * 2.1 + uTime * 0.9) + sin(p.y * 2.3 - uTime * 1.1) + sin((p.x + p.y) * 1.7 + uTime * 0.7);
    float b = sin(p.x * 3.7 - uTime * 0.6) + sin(p.y * 3.1 + uTime * 0.8);
    return pow(0.5 + 0.5 * sin(a * 1.5 + b), 5.0);
  }

  void main() {
    vec3 n = normalize(vNormal), on = normalize(vObjN);
    if (!gl_FrontFacing) { n = -n; on = -on; }
    vec3 toCam = cameraPosition - vWorld;
    float d = length(toCam);
    vec3 v = toCam / d;
    float ndv = max(dot(n, v), 0.0);
    float fres = pow(1.0 - ndv, 3.0);
    float part = floor(vPart + 0.5);

    vec3 albedo = uBase;
    vec3 emissive = vec3(0.0);
    float spec = 0.35, alpha = uOpacity, irid = 0.3;
    bool jelly = part > 5.5 && part < 7.5;

    if (part < 0.5) {
      float cs = smoothstep(-0.6, 0.3, on.y);
      albedo = mix(uBelly, uBase, cs);
      float pat = 0.0;
      if (uPattern < 0.5) pat = noise(vObjPos.xy * 7.0 + vObjPos.z * 3.0) * 0.3;
      else if (uPattern < 1.5) pat = smoothstep(0.3, 0.62, sin(vObjPos.x * 13.0 + noise(vObjPos.xy * 3.5) * 2.6) * 0.5 + 0.5) * cs;
      else if (uPattern < 2.5) pat = smoothstep(0.6, 0.7, noise(vObjPos.xy * 8.0 + vObjPos.z * 6.0)) * (0.35 + 0.65 * cs);
      else albedo = mix(albedo, uBelly * 0.62, (1.0 - cs) * smoothstep(0.35, 0.65, sin(vObjPos.z * 70.0) * 0.5 + 0.5) * 0.6);
      albedo = mix(albedo, uAccent, pat * 0.7);
      // Photophores: a row of light organs along the flank.
      // Photophores: scattered light organs that only show once it gets dark.
      vec2 pg = vObjPos.xy * vec2(15.0, 11.0) + vObjPos.z * 4.0;
      float organ = step(0.74, hash(floor(pg))) * (1.0 - smoothstep(0.12, 0.3, length(fract(pg) - 0.5)));
      emissive += uGlowColor * (organ * uGlow * 2.6) + albedo * uGlow * 0.1;
    } else if (part < 1.5) {
      float rays = 0.78 + 0.22 * sin((vObjPos.y + vObjPos.z) * 80.0 + vObjPos.x * 30.0);
      albedo = mix(uAccent, uBase, 0.3) * rays;
      emissive += uGlowColor * uGlow * 0.3 * rays;
      irid = 0.9;
    } else if (part < 2.5) {
      albedo = vec3(0.012);
      spec = 2.2;
      irid = 0.0;
    } else if (part < 3.5) {
      albedo = uGlowColor;
      emissive += uGlowColor * (2.6 + uGlow * 1.5) * (0.85 + 0.15 * sin(uTime * 3.0));
    } else if (part < 4.5) {
      albedo = uBelly;
    } else if (part < 8.5 && !jelly) {
      float stripe = smoothstep(0.3, 0.6, sin(vT * 78.0 + noise(vObjPos.xy * 6.0) * 1.5) * 0.5 + 0.5) * (1.0 - smoothstep(0.8, 0.9, vT)) * smoothstep(-0.9, 0.2, on.y + 0.4);
      albedo = mix(vec3(0.93, 0.88, 0.8), uBase * 0.85, stripe);
      spec = 0.9;
      irid = 1.0;
    } else if (!jelly) {
      vec2 q = vObjPos.xz * vec2(5.2, 6.0);
      float cell = abs(sin(q.x * 1.5) * sin(q.y * 1.7 + q.x * 0.7));
      albedo = mix(uBase * 0.3, mix(uBase, uAccent, 0.3 + 0.3 * noise(q * 2.0)), smoothstep(0.02, 0.2, cell));
      spec = 0.7;
    }

    // Lighting: caustic sunlight from above, hemisphere ambient, the diver's lamp, a soft headlight.
    float wrap = max((dot(n, uLightDir) + 0.35) / 1.35, 0.0);
    float sun = uSun * wrap * (0.5 + uCaustic * caustic(vWorld.xz + vWorld.y * 0.35) * 0.9);
    vec3 amb = mix(uFogColor * 0.7 + 0.02, uFogColor * 1.9 + 0.1, n.y * 0.5 + 0.5) * uAmbient;
    vec3 L = uLampPos - vWorld;
    float ld = length(L);
    float att = uLampOn * 7.0 / (1.0 + ld * ld * 0.5);
    float lamp = max(dot(n, L / ld), 0.0) * att;
    vec3 lampCol = vec3(1.0, 0.93, 0.78);
    vec3 col = albedo * (amb + vec3(1.0, 0.97, 0.9) * sun + lampCol * lamp + ndv * 0.16);
    vec3 h = normalize(uLightDir + v);
    col += vec3(1.0) * pow(max(dot(n, h), 0.0), 70.0) * spec * (uSun + 0.15);
    vec3 h2 = normalize(L / ld + v);
    col += lampCol * pow(max(dot(n, h2), 0.0), 50.0) * spec * att * 0.6;
    col += albedo * (0.5 + 0.5 * cos(6.2831 * (fres * 1.3 + vec3(0.0, 0.33, 0.67)))) * fres * 0.55 * irid;
    col += mix(uGlowColor, vec3(1.0), 0.2) * fres * (0.08 + uGlow * 0.28);
    col += emissive;

    if (jelly) {
      float veins = part < 6.5 ? pow(abs(sin(atan(vObjPos.z, vObjPos.x) * 8.0)), 14.0) * smoothstep(0.1, 0.9, vT) : 0.0;
      float body = part < 6.5 ? 0.22 : 0.6;
      col = uGlowColor * (0.3 + fres * 1.5 + veins * 1.2) * (0.55 + uGlow * 0.9) + lampCol * lamp * 0.25 + vec3(1.0) * pow(max(dot(n, h), 0.0), 40.0) * 0.4 * uSun;
      alpha = clamp(body + fres * 0.85 + veins * 0.6, 0.0, 1.0) * uOpacity;
    }
    if (uHolo > 0.5) {
      float scan = 0.75 + 0.25 * sin(vWorld.y * 40.0 - uTime * 4.0);
      col = uGlowColor * (0.25 + fres * 1.6) * scan;
      alpha = clamp(0.18 + fres * 0.8, 0.0, 1.0) * uOpacity;
    }

    // Sonar: a shell of light sweeping outwards.
    float band = exp(-pow((distance(vWorld, uPing.xyz) - uPing.w) / 1.1, 2.0)) * uPingA;
    col += vec3(0.25, 1.0, 0.8) * band * 0.7;

    col = mix(col, uFogColor, fogAmount(d, uFogScale) * (1.0 - 0.3 * min(uGlow, 1.0)));
    col = mix(col, uFogColor, uDim);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export type SharedUniforms = Record<string, { value: unknown }>;

/** `seed` (0..1) varies the accent and glow so two creatures of one hue still differ. */
export function creaturePalette(hue: number, seed = 0.3) {
  const h = hue / 360;
  return {
    base: new THREE.Color().setHSL(h, 0.78, 0.42),
    belly: new THREE.Color().setHSL((h + 0.06) % 1, 0.4, 0.86),
    accent: new THREE.Color().setHSL((h + 0.06 + seed * 0.45) % 1, 0.85, 0.6),
    glow: new THREE.Color().setHSL((h + 0.04 + seed * 0.3) % 1, 1, 0.62),
  };
}

export function creatureMaterial(shared: SharedUniforms, id: SpeciesId, hue: number, phase: number, still = false, seed = 0.3) {
  const spec = SPECIES[id];
  const pal = creaturePalette(hue, seed);
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: !!spec.translucent,
    depthWrite: !spec.translucent,
    uniforms: {
      ...shared,
      uPhase: { value: phase }, uSpeed: { value: still ? 0.15 : 1 },
      uSwim: { value: spec.swim }, uSwimAxis: { value: spec.axis }, uPulse: { value: spec.pulse },
      uPattern: { value: spec.pattern ?? Math.floor(seed * 2.999) },
      uBase: { value: pal.base }, uBelly: { value: pal.belly }, uAccent: { value: pal.accent }, uGlowColor: { value: pal.glow },
      uGlow: { value: 0 }, uDim: { value: 0 }, uFogScale: { value: 1 }, uOpacity: { value: 1 }, uHolo: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
