#!/usr/bin/env node
/**
 * Crops the illustration window of card images for the animation pipeline (docs/sdd/03-animacoes.md §3.1).
 * Reads images/<file> (never modified) and writes:
 *   .anim-work/crops/<slug>.png      art window only (no name bar, text box or frame)
 *   .anim-work/contact-sheet.html    every crop next to its card, to check before spending credits
 *
 * The default window is given in % of the card; per-card overrides live in scripts/anim/crops.json
 * as { "<image file name>": { "x": 8.5, "y": 11.5, "w": 83, "h": 42 } }.
 * Usage: node scripts/anim/crop.mjs [image files...]   (no arguments = every image)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imagesDir = path.join(root, 'images');
const workDir = path.join(root, '.anim-work');
const cropDir = path.join(workDir, 'crops');
const overridesFile = path.join(root, 'scripts/anim/crops.json');

export const DEFAULT_CROP = { x: 8.5, y: 11.5, w: 83, h: 42 };
const MIN_UPLOAD_WIDTH = 1024;

/** Same folding as build-cards.mjs, so slugs match file names across NFD/NFC spellings. */
export function slug(file) {
  return path
    .parse(file)
    .name.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function cropFor(file, overrides) {
  return { ...DEFAULT_CROP, ...(overrides[path.basename(file)] || {}) };
}

async function main() {
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
  const args = process.argv.slice(2);
  const files = (args.length ? args.map((a) => path.basename(a)) : fs.readdirSync(imagesDir))
    .filter((f) => /\.(webp|png|jpe?g)$/i.test(f) && f !== 'back-card.webp');
  fs.mkdirSync(cropDir, { recursive: true });

  const rows = [];
  for (const file of files) {
    const src = path.join(imagesDir, file);
    if (!fs.existsSync(src)) {
      console.warn(`skip ${file}: not found in images/`);
      continue;
    }
    const { width, height } = await sharp(src).metadata();
    const c = cropFor(file, overrides);
    const region = {
      left: Math.round((c.x / 100) * width),
      top: Math.round((c.y / 100) * height),
      width: Math.round((c.w / 100) * width),
      height: Math.round((c.h / 100) * height),
    };
    const out = path.join(cropDir, `${slug(file)}.png`);
    // Most card images are ~457 px tall, so their art window is tiny: enlarge it before upload, the
    // video models keep faces far better from a 1000+ px source (pilot of 2026-10-31).
    const pipeline = sharp(src).extract(region);
    if (region.width < MIN_UPLOAD_WIDTH) pipeline.resize({ width: MIN_UPLOAD_WIDTH, kernel: 'lanczos3' });
    await pipeline.png().toFile(out);
    rows.push({ file, slug: slug(file), crop: c, size: `${region.width}×${region.height}` });
  }

  const cards = rows
    .map((r) => `<figure><img class="card" src="../images/${encodeURI(r.file)}"><img class="crop" src="crops/${r.slug}.png">
<figcaption>${r.file} · ${r.size} · x${r.crop.x} y${r.crop.y} w${r.crop.w} h${r.crop.h}</figcaption></figure>`)
    .join('\n');
  fs.writeFileSync(path.join(workDir, 'contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>Recortes</title>
<style>body{background:#111;color:#ccc;font:12px monospace;display:flex;flex-wrap:wrap;gap:16px;padding:16px}
figure{margin:0;display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;width:420px}.card{height:220px}.crop{width:240px}</style>
${cards}`);
  console.log(`crops: ${rows.length} -> ${path.relative(root, cropDir)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
