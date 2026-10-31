#!/usr/bin/env node
/**
 * Builds the card library for the web app without touching the sources:
 *   cards/*.json  -> public/cards.json   (array of the original card objects + "_file")
 *   images/*.webp -> public/image/<file> (full card, max 1024px tall, webp)
 *                 -> public/thumb/<file> (grid thumbnail, 360px tall, webp)
 *   images/back-card.webp -> public/image/back-card.webp
 *
 * Replaces make_files.py for the Vite build (the python scripts are kept for reference).
 * Usage: node scripts/build-cards.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cardsDir = path.join(root, 'cards');
const imagesDir = path.join(root, 'images');
const publicDir = path.join(root, 'public');
const imageOut = path.join(publicDir, 'image');
const thumbOut = path.join(publicDir, 'thumb');
const force = process.argv.includes('--force');

const FULL_HEIGHT = 1024;
const THUMB_HEIGHT = 360;

/** Lower-case, strip diacritics (NFD + NFC spellings) and keep [a-z0-9]. */
function fold(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function newer(src, dest) {
  if (force || !fs.existsSync(dest)) return true;
  return fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
}

async function main() {
  fs.mkdirSync(imageOut, { recursive: true });
  fs.mkdirSync(thumbOut, { recursive: true });

  const imageFiles = fs.readdirSync(imagesDir).filter((f) => /\.(webp|png|jpe?g)$/i.test(f));
  const imageIndex = new Map(imageFiles.map((f) => [fold(path.parse(f).name), f]));

  const cards = [];
  const missing = [];
  const files = fs.readdirSync(cardsDir).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
    } catch (err) {
      console.warn(`skip ${file}: ${err.message}`);
      continue;
    }
    if (Array.isArray(data) || typeof data !== 'object' || data === null) continue; // legacy aggregate
    const card = { ...data, _file: file };
    const wanted = path.basename(String(data.image || ''));
    let imageFile = imageFiles.includes(wanted) ? wanted : imageIndex.get(fold(path.parse(wanted).name));
    if (!imageFile) imageFile = imageIndex.get(fold(path.parse(file).name));
    if (imageFile) {
      const outName = `${path.parse(imageFile).name.normalize('NFC')}.webp`;
      const src = path.join(imagesDir, imageFile);
      const full = path.join(imageOut, outName);
      const thumb = path.join(thumbOut, outName);
      if (newer(src, full)) {
        await sharp(src).resize({ height: FULL_HEIGHT, withoutEnlargement: true }).webp({ quality: 88 }).toFile(full);
      }
      if (newer(src, thumb)) {
        await sharp(src).resize({ height: THUMB_HEIGHT, withoutEnlargement: true }).webp({ quality: 84 }).toFile(thumb);
      }
      // Same relative layout the original site used ("image/<file>"), plus a thumbnail.
      card.image = `image/${outName}`;
      card._thumb = `thumb/${outName}`;
    } else {
      missing.push(file);
      card._thumb = '';
    }
    cards.push(card);
  }

  const back = path.join(imagesDir, 'back-card.webp');
  if (fs.existsSync(back)) {
    const dest = path.join(imageOut, 'back-card.webp');
    if (newer(back, dest)) await sharp(back).resize({ height: FULL_HEIGHT, withoutEnlargement: true }).webp({ quality: 90 }).toFile(dest);
    const destThumb = path.join(thumbOut, 'back-card.webp');
    if (newer(back, destThumb)) await sharp(back).resize({ height: THUMB_HEIGHT }).webp({ quality: 84 }).toFile(destThumb);
  }

  fs.writeFileSync(path.join(publicDir, 'cards.json'), JSON.stringify(cards));
  console.log(`cards: ${cards.length} | images: ${cards.length - missing.length} | missing images: ${missing.length ? missing.join(', ') : 'none'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
