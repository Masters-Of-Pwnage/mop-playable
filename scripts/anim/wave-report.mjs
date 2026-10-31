#!/usr/bin/env node
/**
 * Writes the review artifacts of an animation wave (docs/sdd/03-animacoes.md §3.5):
 *   .anim-work/<wave>.json  [{uid, name, slug, status, crop, files, provenance}]
 *   .anim-work/<wave>.html  every card (public/thumb) with its loop over the art window
 * Inputs: .anim-work/<wave>-queue.json, <wave>-prompts.json, <wave>-log.jsonl, <wave>-review.json
 * (review: {slug: {status, notes, reuse?: {prompt, cost, date}}}).
 * Usage: node scripts/anim/wave-report.mjs [wave1]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropFor } from './crop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = path.join(root, '.anim-work');
const wave = process.argv[2] || 'wave1';
const MODEL = 'Seedance 2.0 Fast 480p (4 s, loop quadro final = inicial, sem áudio)';
const read = (f) => JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'));

const queue = read(`${wave}-queue.json`);
const prompts = read(`${wave}-prompts.json`);
const review = read(`${wave}-review.json`);
const overridesFile = path.join(root, 'scripts/anim/crops.json');
const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
const log = fs.readFileSync(path.join(work, `${wave}-log.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const size = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
const entries = [];
for (const card of queue) {
  const r = review[card.slug];
  if (!r) continue;
  const attempts = log.filter((l) => l.slug === card.slug);
  const dir = path.join(work, 'out', `${card.slug}__seedance`);
  const approved = r.status === 'aprovada';
  const files = approved
    ? {
      webm: path.relative(work, path.join(dir, 'loop.webm')),
      mp4: path.relative(work, path.join(dir, 'loop.mp4')),
      poster: path.relative(work, path.join(dir, 'poster.webp')),
      bytes: { webm: size(path.join(dir, 'loop.webm')), mp4: size(path.join(dir, 'loop.mp4')), poster: size(path.join(dir, 'poster.webp')) },
    }
    : null;
  const lastPrompt = prompts[`${card.slug}#try${attempts.length}`] || prompts[card.slug] || r.reuse?.prompt || '';
  entries.push({
    uid: card.uid,
    name: card.name,
    slug: card.slug,
    image: card.file,
    status: r.status,
    notes: r.notes || '',
    crop: cropFor(card.file, overrides),
    files,
    provenance: {
      modelo: MODEL,
      prompt: lastPrompt,
      custo: r.reuse ? r.reuse.cost : attempts.reduce((s, a) => s + a.cost, 0),
      tentativas: r.reuse ? 1 : attempts.length,
      gerado_em: r.reuse ? r.reuse.date : (attempts.at(-1)?.at || ''),
      origem: r.reuse ? 'piloto' : wave,
    },
  });
}
fs.writeFileSync(path.join(work, `${wave}.json`), JSON.stringify(entries, null, 1));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const thumb = (file) => `../public/thumb/${encodeURIComponent(`${path.parse(file).name.normalize('NFC')}.webp`)}`;
const kb = (n) => `${Math.round(n / 1024)} KB`;
const cards = entries.map((e) => {
  const video = e.files ? e.files.mp4 : `raw/${e.slug}__seedance.mp4`;
  const c = e.crop;
  return `<figure class="${e.status}">
  <div class="card"><img src="${thumb(e.image)}" alt="${esc(e.name)}" loading="lazy"><video src="${esc(video)}" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%" autoplay muted loop playsinline></video></div>
  <figcaption><b>${esc(e.name)}</b> · <span class="st">${e.status}</span>${e.files ? ` · webm ${kb(e.files.bytes.webm)} · mp4 ${kb(e.files.bytes.mp4)}` : ''} · ${e.provenance.tentativas} tentativa(s), ${e.provenance.custo} créditos${e.notes ? `<br><i>${esc(e.notes)}</i>` : ''}</figcaption>
</figure>`;
}).join('\n');
const approved = entries.filter((e) => e.status === 'aprovada').length;
const spent = entries.reduce((s, e) => s + (e.provenance.origem === wave ? e.provenance.custo : 0), 0);
fs.writeFileSync(path.join(work, `${wave}.html`), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Onda 1 de animações</title>
<style>
  :root { --bg:#07110c; --fg:#d7f5e3; --muted:#7fa592; --neon:#3dff7a; --bad:#ff5e5e; --line:#1d3a2b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 ui-monospace, Menlo, monospace; padding:16px; }
  h1 { color:var(--neon); font-size:20px; margin:0 0 4px; }
  p.lead { color:var(--muted); margin:0 0 16px; max-width:960px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:18px; }
  figure { margin:0; }
  .card { position:relative; width:100%; aspect-ratio:1500/2100; border-radius:4.5% / 3.2%; overflow:hidden; background:#000; }
  .card img { position:absolute; inset:0; width:100%; height:100%; display:block; }
  .card video { position:absolute; object-fit:cover; }
  figcaption { color:var(--muted); font-size:12px; margin-top:6px; }
  figcaption b { color:var(--fg); }
  .aprovada .st { color:var(--neon); }
  .rejeitada .st { color:var(--bad); }
  .rejeitada .card { outline:2px solid var(--bad); }
  button { background:#0d2318; color:var(--fg); border:1px solid var(--line); padding:6px 12px; font:inherit; cursor:pointer; margin-bottom:14px; }
</style></head><body>
<h1>Onda 1: lendárias animadas (${approved} aprovadas de ${entries.length})</h1>
<p class="lead">Cada carta inteira (miniatura) com o loop sobreposto à janela da arte, na posição que o jogo vai usar. Observe a emenda no fim de cada ciclo e a fidelidade do rosto. Modelo: ${MODEL}. Gasto desta onda: ${spent} créditos. Em vermelho: rejeitada (vídeo bruto da última tentativa, só para referência).</p>
<button id="sync">Reiniciar todos juntos</button>
<div class="grid">
${cards}
</div>
<script>document.getElementById('sync').onclick=()=>document.querySelectorAll('video').forEach(v=>{v.currentTime=0;v.play();});</script>
</body></html>
`);
console.log(`${wave}: ${entries.length} cartas, ${approved} aprovadas, ${spent} créditos -> ${wave}.json, ${wave}.html`);
