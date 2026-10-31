#!/usr/bin/env node
/**
 * Uploads approved clips of a wave manifest to the game server for review (docs/sdd/03-animacoes.md §3.5).
 *   MOP_URL=https://mop.cle.beer MOP_TOKEN=mop_... node scripts/anim/push.mjs .anim-work/wave1.json [uid...]
 * The token comes from Admin > Sistema > Tokens (scope animations:write). Each clip lands "em revisão"
 * in Admin > Animações; nothing reaches players before an admin approves it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [manifestArg, ...only] = process.argv.slice(2);
const base = (process.env.MOP_URL || 'http://localhost:8787').replace(/\/+$/, '');
const token = process.env.MOP_TOKEN || '';
if (!manifestArg || !token) {
  console.error('uso: MOP_URL=... MOP_TOKEN=mop_... node scripts/anim/push.mjs <manifesto.json> [uid...]');
  process.exit(1);
}

const manifestPath = path.resolve(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
// File paths in a manifest are relative to the manifest itself (wave-report.mjs writes "out/<slug>/...").
const resolve = (p) => {
  if (path.isAbsolute(p)) return p;
  const near = path.resolve(path.dirname(manifestPath), p);
  return fs.existsSync(near) ? near : path.resolve(root, p);
};
let sent = 0;
for (const item of manifest) {
  if (item.status !== 'aprovada' || (only.length && !only.includes(item.uid))) continue;
  const read = (key) => fs.readFileSync(resolve(item.files[key])).toString('base64');
  const body = { webm: read('webm'), mp4: read('mp4'), poster: read('poster'), provenance: item.provenance || {} };
  if (item.crop) body.crop = item.crop;
  const res = await fetch(`${base}/api/admin/animations/${encodeURIComponent(item.uid)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) sent += 1;
  console.log(`${res.ok ? 'ok  ' : 'ERRO'} ${item.name || item.uid}${res.ok ? '' : `: ${data.message || res.status}`}`);
}
console.log(`${sent} clipe(s) enviados para revisão em ${base}`);
