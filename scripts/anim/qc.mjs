#!/usr/bin/env node
/**
 * Quality check of raw animation clips (docs/sdd/03-animacoes.md §3.3): extracts the first, middle and
 * last frames with ffmpeg, writes .anim-work/frames/<name>-qc.jpg (source crop + the 3 frames) and
 * prints the mean absolute difference between first and last frame (loop seam, 0-255; < 10 is clean).
 * Usage: node scripts/anim/qc.mjs .anim-work/raw/<slug>__seedance.mp4 [...]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const framesDir = path.join(root, '.anim-work/frames');
const W = 360;
const H = 270;

function frameAt(src, seconds) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', src, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
}

function duration(src) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim();
  return Number(out);
}

async function seam(a, b) {
  const [ra, rb] = await Promise.all([a, b].map((buf) => sharp(buf).resize(160, 120, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < ra.length; i += 1) sum += Math.abs(ra[i] - rb[i]);
  return sum / ra.length;
}

async function check(file) {
  const src = path.resolve(file);
  const name = path.parse(src).name;
  const slug = name.split('__')[0];
  const d = duration(src);
  const first = frameAt(src, 0);
  const mid = frameAt(src, d / 2);
  const last = frameAt(src, Math.max(0, d - 0.06));
  const crop = path.join(root, '.anim-work/crops', `${slug}.png`);
  const parts = [fs.existsSync(crop) ? fs.readFileSync(crop) : first, first, mid, last];
  const tiles = await Promise.all(parts.map(async (buf, i) => ({ input: await sharp(buf).resize(W, H, { fit: 'cover' }).toBuffer(), left: i * W, top: 0 })));
  fs.mkdirSync(framesDir, { recursive: true });
  const out = path.join(framesDir, `${name}-qc.jpg`);
  await sharp({ create: { width: W * 4, height: H, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 82 }).toFile(out);
  const s = await seam(first, last);
  const meta = await sharp(first).metadata();
  console.log(`${name}: ${d.toFixed(2)} s · ${meta.width}x${meta.height} · emenda ${s.toFixed(1)} · ${path.relative(root, out)}`);
}

for (const f of process.argv.slice(2)) await check(f);
