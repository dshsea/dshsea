// Renders one transparent WebP per species into public/creatures/, using the real 3D models.
// Run it after changing creatures3d.ts:   pnpm dev   (in one terminal)
//                                          pnpm render-species [http://localhost:4321]
// Needs Google Chrome installed. The site tints these images per project with a hue rotation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const base = process.argv[2] ?? 'http://localhost:4321';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'creatures');
fs.mkdirSync(out, { recursive: true });
const species = [
  'fish', 'jellyfish', 'seahorse', 'pufferfish', 'eel', 'crab', 'starfish', 'shrimp', 'nudibranch',
  'anglerfish', 'turtle', 'octopus', 'squid', 'cuttlefish', 'lionfish', 'sunfish', 'nautilus',
  'shark', 'hammerhead', 'manta', 'narwhal', 'dolphin', 'swordfish', 'whale',
].filter((id) => process.argv.length < 4 || process.argv.slice(3).includes(id));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 675 }, deviceScaleFactor: 1 });
for (const id of species) {
  await page.goto(`${base}/?studio=${id}`, { waitUntil: 'load' });
  await page.waitForSelector('body.studio-ready', { timeout: 20000 });
  await page.waitForTimeout(300);
  const shot = await page.locator('#ocean').screenshot({ omitBackground: true });
  // Crop to the creature so long, thin species are not lost in an empty frame.
  await sharp(await sharp(shot).trim().toBuffer()).resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 84, alphaQuality: 90 }).toFile(path.join(out, `${id}.webp`));
  console.log(`rendered ${id}`);
}
await browser.close();
