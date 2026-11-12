// A single creature on a transparent canvas: the project page's interactive portrait,
// and (in dev, via /?studio=<species>) the source of the static renders in public/creatures.
import * as THREE from 'three';
import type { SpeciesId } from '../lib/species';
import { creatureMaterial, speciesGeometry } from './creatures3d';

export function mountViewer(canvas: HTMLCanvasElement, species: SpeciesId, hue: number, opts: { interactive?: boolean; still?: boolean } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const shared = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0.05, 0.14, 0.26) },
    uFogDensity: { value: 0 },
    uSun: { value: 0.6 },
    uAmbient: { value: 0.5 },
    uCaustic: { value: 0.3 },
    uLightDir: { value: new THREE.Vector3(0.3, 1, 0.5).normalize() },
    // The "lamp" doubles as a soft key light from the front.
    uLampPos: { value: new THREE.Vector3(1.5, 1.5, 5) },
    uLampOn: { value: 0.45 },
    uPing: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPingA: { value: 0 },
  };
  const geo = speciesGeometry(species);
  const mat = creatureMaterial(shared, species, hue, 0.6);
  mat.uniforms.uGlow.value = 0.3;
  const mesh = new THREE.Mesh(geo, mat);
  const sphere = geo.boundingSphere!;
  mesh.position.copy(sphere.center).multiplyScalar(-1);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  const scene = new THREE.Scene();
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  // Flat or front-facing species are shown from an angle that actually reveals their shape.
  const POSE: Partial<Record<SpeciesId, [number, number]>> = { manta: [-0.55, 0.75], crab: [-0.9, 0.5], starfish: [0, 0.1], jellyfish: [0.3, 0.1], octopus: [-1.0, 0.1] };
  const [REST_YAW, REST_PITCH] = POSE[species] ?? [-0.5, 0.12];
  let yaw = REST_YAW, pitch = REST_PITCH, vy = 0, vp = 0, dragging = false, lastX = 0, lastY = 0, lastDrag = -99;
  let visible = true, raf = 0, time = 0, last = performance.now();

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    // Fit the bounding sphere in the narrower dimension.
    const fit = sphere.radius / Math.sin(Math.atan(Math.tan(half) * Math.min(1, camera.aspect)));
    camera.position.set(0, 0, fit * 0.94);
    camera.updateProjectionMatrix();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    shared.uTime.value = opts.still ? 1.3 : time;
    if (!dragging) {
      yaw += vy;
      pitch += vp;
      vy *= 0.94;
      vp *= 0.94;
      if (!opts.still && time - lastDrag > 3) {
        // Ease back to the resting pose and sway gently.
        yaw += (REST_YAW + Math.sin(time * 0.5) * 0.35 - yaw) * Math.min(1, dt * 1.5);
        pitch += (REST_PITCH - pitch) * Math.min(1, dt * 1.5);
      }
    }
    pitch = Math.max(-0.9, Math.min(0.9, pitch));
    pivot.rotation.set(pitch, yaw, 0);
    if (!opts.still) pivot.position.y = Math.sin(time * 0.9) * sphere.radius * 0.03;
    renderer.render(scene, camera);
  }

  if (opts.interactive) {
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      vy = vp = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      vy = (e.clientX - lastX) * 0.01;
      vp = (e.clientY - lastY) * 0.006;
      yaw += vy;
      pitch += vp;
      lastX = e.clientX;
      lastY = e.clientY;
      lastDrag = time;
    });
    const end = () => {
      dragging = false;
      lastDrag = time;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  io.observe(canvas);
  resize();
  frame();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    renderer.dispose();
  };
}
