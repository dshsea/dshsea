// Shaders, textures and sound for the 3D ocean. No state lives here; ocean3d.ts wires it together.
import * as THREE from 'three';
import { FOG_GLSL } from './creatures3d';

export const TRAIL = 12;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---------- environment shaders ----------
export const BASIC_VERT = /* glsl */ `
  varying vec3 vWorld; varying vec3 vDir; varying vec2 vUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; vDir = position; vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const WATER_FRAG = /* glsl */ `
  ${FOG_GLSL}
  uniform float uTime;
  uniform vec3 uSunDir, uHorizon, uZenith;
  varying vec3 vWorld;
  vec3 waveNormal(vec2 p) {
    vec2 g = vec2(0.0);
    #define WAVE(dx, dz, f, s, a) g += a * f * cos(dot(vec2(dx, dz), p) * f + uTime * s) * vec2(dx, dz);
    WAVE(1.0, 0.2, 0.35, 1.1, 0.22) WAVE(-0.4, 1.0, 0.6, 1.4, 0.13) WAVE(0.7, -0.7, 1.3, 2.1, 0.06)
    WAVE(-0.2, -1.0, 2.6, 2.9, 0.03) WAVE(0.9, 0.5, 5.1, 3.7, 0.012)
    return normalize(vec3(-g.x, 1.0, -g.y));
  }
  void main() {
    vec3 n = waveNormal(vWorld.xz);
    vec3 toCam = cameraPosition - vWorld;
    float d = length(toCam);
    vec3 v = toCam / d;
    vec3 col;
    if (cameraPosition.y > 0.0) {
      vec3 r = reflect(-v, n);
      r.y = abs(r.y);
      vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, r.y));
      float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      col = mix(vec3(0.004, 0.03, 0.075), sky * 0.8, fres);
      float s = max(dot(r, uSunDir), 0.0);
      col += vec3(1.0, 0.72, 0.42) * (pow(s, 900.0) * 4.0 + pow(s, 60.0) * 0.16);
      col = mix(col, uHorizon, smoothstep(120.0, 380.0, d) * 0.85);
    } else {
      // Seen from below: a bright window straight up, shimmering ripples, fading into the water colour.
      float up = max(-v.y, 0.0);
      float window = smoothstep(0.45, 0.95, up);
      float ripple = pow(clamp(length(n.xz) * 3.2, 0.0, 1.0), 2.5);
      col = mix(uFogColor * 1.25, vec3(0.45, 0.85, 1.0), window * 0.75) + vec3(0.55, 0.95, 1.0) * ripple * (0.25 + window);
      col = mix(col, uFogColor, fogAmount(d, 0.6));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uC0, uC1, uC2, uC3;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.09, h));
    col = mix(col, uC2, smoothstep(0.06, 0.32, h));
    col = mix(col, uC3, smoothstep(0.28, 0.8, h));
    float s = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.82, 0.5) * (smoothstep(0.9982, 0.9990, s) * 3.2 + pow(s, 250.0) * 0.45 + pow(s, 18.0) * 0.08);
    vec3 cell = floor(d * 320.0);
    float star = step(0.9988, hash(cell)) * smoothstep(0.2, 0.5, h);
    col += vec3(star) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(cell + 1.0) * 40.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const RAY_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float side = smoothstep(0.0, 0.5, vUv.x) * (1.0 - smoothstep(0.5, 1.0, vUv.x));
    float a = side * pow(max(vUv.y, 0.0001), 1.6) * uOpacity;
    gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * a, a);
  }
`;

// Plankton: drifting motes that light up along the lamp's trail and when a sonar shell passes.
export const PLANKTON_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uCamY, uRise, uSize, uScale, uBox, uLampOn, uPingA, uReact;
  uniform vec3 uLampPos;
  uniform vec4 uPing;
  uniform vec4 uTrail[${TRAIL}];
  varying float vAlpha, vGlow;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * uRise * (0.5 + aSeed) - uCamY, uBox) - uBox * 0.5 + uCamY;
    p.x += sin(uTime * 0.4 + aSeed * 50.0) * 0.35;
    p.z += cos(uTime * 0.3 + aSeed * 31.0) * 0.35;
    float g = 0.0;
    if (uReact > 0.5) {
      for (int i = 0; i < ${TRAIL}; i++) {
        vec3 dl = p - uTrail[i].xyz;
        g += exp(-dot(dl, dl) * 0.2) * exp(-max(uTime - uTrail[i].w, 0.0) * 0.55);
      }
      vec3 away = p - uLampPos;
      float ad = dot(away, away);
      p += normalize(away + 0.0001) * uLampOn * 0.9 * exp(-ad * 0.3);
      g = min(g, 1.4) * uLampOn + exp(-pow((distance(p, uPing.xyz) - uPing.w) / 1.0, 2.0)) * uPingA * 1.3;
    }
    vGlow = g;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = min(uSize * (0.5 + aSeed) * (1.0 + g * 1.6) * uScale / dist, 30.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = (1.0 - smoothstep(16.0, 48.0, dist)) * smoothstep(0.3, 2.0, dist) * step(p.y, -0.1) * (0.3 + aSeed * 0.7);
  }
`;
export const PLANKTON_FRAG = /* glsl */ `
  uniform vec3 uColor, uHot;
  uniform float uRing;
  varying float vAlpha, vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.0, 1.0, r);
    float ring = (1.0 - smoothstep(0.86, 1.0, r)) * smoothstep(0.55, 0.72, r) + 0.12 * soft;
    float shape = uRing > 0.5 ? ring : soft;
    vec3 col = mix(uColor, uHot * 2.4, clamp(vGlow, 0.0, 1.0));
    gl_FragColor = vec4(col, shape * clamp(vAlpha * (1.0 + vGlow * 3.0), 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------- textures ----------
export function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function lampTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#78ffd6';
  g.lineWidth = 5;
  g.setLineDash([22, 18]);
  g.beginPath();
  g.arc(128, 128, 114, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}
export function pingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  for (const [r, w, a] of [[250, 3, 1], [236, 10, 0.25], [214, 2, 0.35]] as const) {
    g.globalAlpha = a;
    g.lineWidth = w;
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
export function labelTexture(name: string, sub: string | null) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = sub ? 112 : 64;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.shadowColor = 'rgba(2,6,20,0.9)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 2;
  const stack = 'Inter, ui-sans-serif, system-ui, "PingFang SC", sans-serif';
  g.font = `600 32px ${stack}`;
  let text = name;
  while (text.length > 4 && g.measureText(text).width > 600) text = `${text.slice(0, -2)}…`;
  g.fillStyle = '#ffffff';
  g.fillText(text, 320, 10);
  if (sub) {
    g.font = `500 25px ${stack}`;
    g.fillStyle = '#f5d27a';
    g.fillText(sub, 320, 62);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}
export const labelMaterial = (tex: THREE.Texture) =>
  new THREE.SpriteMaterial({ map: tex, color: 0xc4c4c4, transparent: true, depthWrite: false, depthTest: false, fog: false });

// ---------- sound: synthesised, off until the visitor turns it on ----------
export function createSound() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let on = false;
  function ensure() {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // Underwater rumble: brown noise through a slowly moving low-pass.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lowpass.frequency);
    src.connect(lowpass).connect(master);
    src.start();
    lfo.start();
  }
  function tone(from: number, to: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    if (!on || !ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    // A short feedback delay makes it ring like a real ping.
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    osc.connect(g);
    g.connect(master);
    g.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    setTimeout(() => {
      fb.disconnect();
      delay.disconnect();
    }, 3500);
  }
  return {
    toggle() {
      ensure();
      on = !on;
      void ctx!.resume();
      master!.gain.linearRampToValueAtTime(on ? 0.5 : 0, ctx!.currentTime + 0.6);
      return on;
    },
    /** Deeper water sounds darker. */
    setDepth(depth: number, above: boolean) {
      if (!on || !lowpass || !ctx) return;
      lowpass.frequency.setTargetAtTime(above ? 1800 : 520 - 330 * clamp(depth / 6000, 0, 1), ctx.currentTime, 0.4);
    },
    ping: () => tone(1500, 900, 1.1, 0.22),
    blip: () => tone(520, 780, 0.22, 0.1, 'triangle'),
    splash: () => tone(180, 60, 0.7, 0.3, 'triangle'),
  };
}

