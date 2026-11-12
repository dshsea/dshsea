// Share cards (1200×630), rendered at build time. /og/home.png plus one per project.
import fs from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import satori from 'satori';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { getProjects, fmt, type Project } from '../../lib/projects';
import { tintDeg, zoneFor, fmtDepth, type SpeciesId } from '../../lib/species';
import { dict } from '../../lib/i18n';

const root = process.cwd();
const fontFile = (pkg: string, name: string) => fs.readFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', name));
const fonts = [
  { name: 'Inter', data: fontFile('inter', 'inter-latin-400-normal.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: fontFile('inter', 'inter-latin-600-normal.woff'), weight: 600 as const, style: 'normal' as const },
  { name: 'Serif', data: fontFile('instrument-serif', 'instrument-serif-latin-400-normal.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Serif', data: fontFile('instrument-serif', 'instrument-serif-latin-400-italic.woff'), weight: 400 as const, style: 'italic' as const },
];
const t = dict('en');

export function getStaticPaths() {
  return [
    { params: { slug: 'home' }, props: { project: null } },
    ...getProjects().map((project) => ({ params: { slug: project.slug }, props: { project } })),
  ];
}

// The still renders in public/creatures are tinted to the project's hue, like the site does with CSS.
const tinted = new Map<string, Promise<string>>();
function creature(id: SpeciesId, hue: number, width: number, height = Math.round(width * 0.75)): Promise<string> {
  const key = `${id}:${hue}:${width}:${height}`;
  if (!tinted.has(key)) {
    tinted.set(
      key,
      sharp(path.join(root, 'public/creatures', `${id}.webp`))
        .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .modulate({ hue: tintDeg(hue) })
        .png()
        .toBuffer()
        .then((buf) => `data:image/png;base64,${buf.toString('base64')}`),
    );
  }
  return tinted.get(key)!;
}

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children, ...extra },
});

const RARITY_COLOR: Record<string, string> = { common: '#93a8c6', rare: '#9ad6ff', epic: '#dcb4ff', legendary: '#f5d27a' };
// The bundled fonts only cover Latin; anything else would render as empty boxes.
const latin = (s: string) => s.replace(/[^\x20-\x7e]/g, '').trim();

async function projectCard(p: Project): Promise<Node> {
  const name = latin(p.name) || p.slug;
  const size = name.length > 24 ? 54 : name.length > 16 ? 68 : name.length > 10 ? 88 : 108;
  return el('div', { width: 1200, height: 630, background: 'linear-gradient(160deg,#0d3f7c 0%,#04102a 58%,#020714 100%)', color: '#eaf2ff', fontFamily: 'Inter' }, [
    el('div', { width: 540, height: 630, alignItems: 'center', justifyContent: 'center', background: `radial-gradient(circle at 52% 50%, hsla(${p.hue},85%,62%,0.42), rgba(2,7,20,0) 66%)` }, [
      el('img', {}, undefined, { src: await creature(p.species, p.hue, 520), width: 520, height: 390 }),
    ]),
    el('div', { flex: 1, flexDirection: 'column', justifyContent: 'center', paddingRight: 64 }, [
      el('div', { fontSize: 20, fontWeight: 600, letterSpacing: 5, color: RARITY_COLOR[p.rarity], marginBottom: 14 }, `${t.rarityNames[p.rarity]} ${t.speciesNames[p.species]}`.toUpperCase()),
      el('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.02, letterSpacing: -1.5, color: '#ffffff', marginBottom: 30 }, name),
      el('div', { fontSize: 38, fontWeight: 600, color: '#6ef3d6', marginBottom: 6 }, `${fmtDepth(p.depth)} deep`),
      el('div', { fontSize: 20, letterSpacing: 4, color: '#93a8c6', marginBottom: 26 }, t.zones[zoneFor(p.depth)].toUpperCase()),
      el('div', { fontSize: 28, color: '#f5d27a' }, `${fmt(p.stars)} stars`),
      el('div', { fontFamily: 'Serif', fontStyle: 'italic', fontSize: 30, color: '#cfe2ff', marginTop: 48 }, 'dshsea.com'),
    ]),
  ]);
}

async function homeCard(): Promise<Node> {
  const cast: [SpeciesId, number, number, number, number][] = [
    ['whale', 255, 10, 330, 400],
    ['jellyfish', 150, 380, 300, 240],
    ['manta', 20, 560, 380, 300],
    ['anglerfish', 330, 820, 320, 230],
    ['shark', 95, 900, 450, 290],
  ];
  const imgs = await Promise.all(cast.map(([id, hue, , , w]) => creature(id, hue, w)));
  return el('div', { width: 1200, height: 630, position: 'relative', flexDirection: 'column', alignItems: 'center', background: 'linear-gradient(180deg,#1a1446 0%,#6b2d73 22%,#f0707a 38%,#ffc37a 45%,#1f9fc4 45.2%,#0b3a74 68%,#020714 100%)', color: '#fff', fontFamily: 'Inter' }, [
    el('div', { fontSize: 18, fontWeight: 600, letterSpacing: 7, color: '#ffe9c9', marginTop: 46 }, 'THE DEEPSEEK HARNESS OCEAN'),
    el('div', { fontFamily: 'Serif', fontSize: 196, lineHeight: 1, letterSpacing: -6, marginTop: 2 }, [
      el('span', { marginRight: 40 }, 'Deep'),
      el('span', { fontStyle: 'italic', color: '#8ff8e1' }, 'Seek'),
    ]),
    ...cast.map(([, , left, top, w], i) => el('img', { position: 'absolute', left, top }, undefined, { src: imgs[i], width: w, height: Math.round(w * 0.75) })),
    el('div', { position: 'absolute', bottom: 30, fontSize: 24, color: '#cfe2ff' }, 'dshsea.com  ·  every project is a creature'),
  ]);
}

export const GET: APIRoute = async ({ props }) => {
  const project = props.project as Project | null;
  const tree = project ? await projectCard(project) : await homeCard();
  const svg = await satori(tree as any, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
