#!/usr/bin/env node
/**
 * Builds the generation queue of an animation wave (docs/sdd/03-animacoes.md §3.2).
 * Reads the catalog from a server database (read-only) and the built card list (public/cards.json),
 * maps every card to its source image in images/ (same matching as scripts/build-cards.mjs) and
 * writes .anim-work/<wave>-queue.json sorted by source resolution, largest first.
 * Usage: node scripts/anim/queue.mjs --db <mop.sqlite> [--rarity lendaria] [--wave wave1] [--skip uid,uid]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { slug } from './crop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imagesDir = path.join(root, 'images');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

/** Same folding as build-cards.mjs: lower case, no diacritics, [a-z0-9] only. */
function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
  const dbFile = arg('db');
  if (!dbFile) throw new Error('--db <mop.sqlite> é obrigatório');
  const rarity = arg('rarity', 'lendaria');
  const wave = arg('wave', 'wave1');
  const skip = new Set((arg('skip', '') || '').split(',').filter(Boolean));

  const db = new DatabaseSync(dbFile, { readOnly: true });
  const rows = db.prepare(`SELECT uid, name FROM card_catalog WHERE rarity = ? AND animation_consent = 'concedido' AND orphan = 0`).all(rarity);
  db.close();

  // uid -> raw card (uid = id, or "id#stem" for repeated ids, as in src/engine/cards.js buildLibrary)
  const cards = JSON.parse(fs.readFileSync(path.join(root, 'public/cards.json'), 'utf8'));
  const seen = new Set();
  const byUid = new Map();
  for (const raw of cards) {
    const id = String(raw.id || '').trim();
    const stem = String(raw._file || '').replace(/\.json$/, '');
    let uid = id || stem;
    if (seen.has(uid)) uid = `${uid}#${stem}`;
    seen.add(uid);
    byUid.set(uid, raw);
  }

  const imageFiles = fs.readdirSync(imagesDir).filter((f) => /\.(webp|png|jpe?g)$/i.test(f));
  const imageIndex = new Map(imageFiles.map((f) => [fold(path.parse(f).name), f]));
  const queue = [];
  const missing = [];
  for (const row of rows) {
    if (skip.has(row.uid)) continue;
    const raw = byUid.get(row.uid);
    const wanted = raw ? path.basename(String(raw.image || '')) : '';
    let file = imageFiles.includes(wanted) ? wanted : imageIndex.get(fold(path.parse(wanted).name));
    if (!file && raw) file = imageIndex.get(fold(path.parse(String(raw._file || '')).name));
    if (!file) {
      missing.push(row.name);
      continue;
    }
    const meta = await sharp(path.join(imagesDir, file)).metadata();
    queue.push({ uid: row.uid, name: row.name, type: raw?.type || '', description: raw?.description || '', file, slug: slug(file), width: meta.width, height: meta.height });
  }
  queue.sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  fs.mkdirSync(path.join(root, '.anim-work'), { recursive: true });
  fs.writeFileSync(path.join(root, `.anim-work/${wave}-queue.json`), JSON.stringify(queue, null, 1));
  console.log(`${queue.length} cartas na fila (${rarity}); sem imagem: ${missing.length ? missing.join(', ') : 'nenhuma'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
