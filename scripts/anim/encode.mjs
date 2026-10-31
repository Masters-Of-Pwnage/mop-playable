#!/usr/bin/env node
/**
 * Encodes raw animation clips for the web (docs/sdd/03-animacoes.md §3.4). Needs ffmpeg on PATH.
 *   .anim-work/raw/<name>.mp4 -> .anim-work/out/<name>/{loop.webm, loop.mp4, poster.webp}
 * webm: VP9 CRF 34; mp4: H.264 baseline CRF 26 +faststart; no audio, 480 px tall, 24 fps.
 * The poster goes through sharp (Homebrew's ffmpeg has no WebP encoder).
 * Clips over 1 MB in either format are reported (the server rejects them).
 * Usage: node scripts/anim/encode.mjs [raw files...]   (no arguments = every file in .anim-work/raw)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawDir = path.join(root, '.anim-work/raw');
const outDir = path.join(root, '.anim-work/out');
const MAX_BYTES = 1024 * 1024;
const SCALE = 'scale=-2:480:flags=lanczos,fps=24';

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

async function encode(src) {
  const name = path.parse(src).name;
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const webm = path.join(dir, 'loop.webm');
  const mp4 = path.join(dir, 'loop.mp4');
  const poster = path.join(dir, 'poster.webp');
  ffmpeg(['-i', src, '-an', '-vf', SCALE, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', webm]);
  ffmpeg(['-i', src, '-an', '-vf', SCALE, '-c:v', 'libx264', '-profile:v', 'baseline', '-crf', '26', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const frame = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', 'scale=-2:480:flags=lanczos', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
  await sharp(frame).webp({ quality: 82 }).toFile(poster);
  const sizes = { webm: fs.statSync(webm).size, mp4: fs.statSync(mp4).size, poster: fs.statSync(poster).size };
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const over = sizes.webm > MAX_BYTES || sizes.mp4 > MAX_BYTES ? '  ACIMA DE 1 MB' : '';
  console.log(`${name}: webm ${kb(sizes.webm)} · mp4 ${kb(sizes.mp4)} · poster ${kb(sizes.poster)}${over}`);
  return sizes;
}

const args = process.argv.slice(2);
const files = args.length ? args : fs.readdirSync(rawDir).filter((f) => f.endsWith('.mp4')).map((f) => path.join(rawDir, f));
for (const file of files) await encode(path.resolve(file));
