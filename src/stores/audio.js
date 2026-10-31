/**
 * Audio: Artlist-generated music (Lyria 3 Pro) and UI/game sound effects.
 * SFX are synthesized with Web Audio; drop files named after the effect in
 * src/assets/audio/sfx/ (e.g. click.mp3) to replace any of them with recordings.
 */
import { settings } from './settings.js';

const MUSIC = import.meta.glob('../assets/audio/music/*.mp3', { eager: true, import: 'default', query: '?url' });
const SFX_FILES = import.meta.glob('../assets/audio/sfx/*.{mp3,m4a,ogg,wav}', { eager: true, import: 'default', query: '?url' });

const musicUrl = (name) => Object.entries(MUSIC).find(([k]) => k.endsWith(`/${name}.mp3`))?.[1] || '';
const sfxUrl = (name) => Object.entries(SFX_FILES).find(([k]) => /\/([^/]+)\.\w+$/.exec(k)?.[1] === name)?.[1] || '';

let ctx = null;
let master = null;
let sfxGain = null;
const buffers = new Map();
const music = { el: null, name: '', fadeTimer: null, stopTimer: null };

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.connect(master);
  sfxGain.gain.value = settings.sfx;
  return ctx;
}

/** Browsers require a user gesture before audio plays; call this from a click handler. */
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  if (music.el && music.el.paused && music.name) music.el.play().catch(() => {});
}

export function applyVolumes() {
  if (sfxGain) sfxGain.gain.value = settings.sfx;
  if (music.el) music.el.volume = settings.music * 0.7;
}

// ---------------------------------------------------------------- music

export function playMusic(name, { fade = 1200 } = {}) {
  const url = musicUrl(name);
  if (!url) return;
  if (music.name === name && music.el && !music.el.paused) return;
  stopMusic(fade / 2);
  const el = new Audio(url);
  el.loop = !['victory', 'defeat'].includes(name);
  el.volume = 0;
  el.preload = 'auto';
  music.el = el;
  music.name = name;
  el.play().catch(() => { /* waits for unlockAudio() */ });
  const target = settings.music * 0.7;
  const start = performance.now();
  clearInterval(music.fadeTimer);
  music.fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / fade);
    if (music.el === el) el.volume = target * t;
    if (t >= 1) clearInterval(music.fadeTimer);
  }, 50);
  if (!el.loop) {
    // Stingers are long tracks: play the opening and fade out.
    clearTimeout(music.stopTimer);
    music.stopTimer = setTimeout(() => {
      if (music.el === el) stopMusic(2500);
    }, 9000);
  }
}

export function stopMusic(fade = 600) {
  const el = music.el;
  if (!el) return;
  music.el = null;
  music.name = '';
  const start = performance.now();
  const from = el.volume;
  const timer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / fade);
    el.volume = from * (1 - t);
    if (t >= 1) {
      clearInterval(timer);
      el.pause();
      el.src = '';
    }
  }, 50);
}

// ---------------------------------------------------------------- sfx synthesis

const RATE = 22050;

function tone(freq, dur, wave, vol, attack = 0.002, decay = -1, slideTo = 0, start = 0) {
  const n = Math.floor(dur * RATE);
  const data = new Float32Array(n);
  if (decay < 0) decay = dur;
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const f = slideTo <= 0 ? freq : freq + (slideTo - freq) * (t / dur);
    phase += f / RATE;
    const x = phase % 1;
    let s = 0;
    if (wave === 'sine') s = Math.sin(2 * Math.PI * x);
    else if (wave === 'square') s = x < 0.5 ? 1 : -1;
    else if (wave === 'saw') s = 2 * x - 1;
    else s = 4 * Math.abs(x - 0.5) - 1;
    const env = Math.min(t / Math.max(attack, 1e-4), 1) * Math.max(0, Math.min(1, 1 - (t - attack) / Math.max(decay, 1e-4)));
    data[i] = s * env * vol;
  }
  return { start, data };
}

function noise(dur, vol, attack, decay, smooth, start = 0) {
  const n = Math.floor(dur * RATE);
  const data = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    last = (Math.random() * 2 - 1) * (1 - smooth) + last * smooth;
    const env = Math.min(t / Math.max(attack, 1e-4), 1) * Math.max(0, Math.min(1, 1 - t / Math.max(decay, 1e-4)));
    data[i] = last * env * vol;
  }
  return { start, data };
}

function glitch(dur, vol) {
  const n = Math.floor(dur * RATE);
  const data = new Float32Array(n);
  let hold = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (count <= 0) {
      hold = Math.random() * 2 - 1;
      count = 20 + Math.floor(Math.random() * 380);
    }
    count -= 1;
    const t = i / RATE;
    data[i] = hold * vol * Math.max(0, 1 - t / dur) * (Math.floor(i / 600) % 3 !== 0 ? 1 : 0.3);
  }
  return { start: 0, data };
}

const RECIPES = {
  click: () => [tone(1400, 0.035, 'square', 0.25, 0.001, 0.03, 900)],
  hover: () => [tone(2200, 0.02, 'sine', 0.12, 0.001, 0.015)],
  select: () => [tone(880, 0.05, 'square', 0.18), tone(1320, 0.06, 'square', 0.15, 0.001, 0.05, 0, 0.04)],
  draw: () => [noise(0.12, 0.35, 0.003, 0.1, 0.55)],
  shuffle: () => [noise(0.05, 0.3, 0.002, 0.04, 0.6), noise(0.05, 0.3, 0.002, 0.04, 0.6, 0.07), noise(0.05, 0.3, 0.002, 0.04, 0.6, 0.14), noise(0.06, 0.3, 0.002, 0.05, 0.6, 0.21)],
  play: () => [tone(140, 0.18, 'sine', 0.5, 0.002, 0.17, 70), tone(660, 0.12, 'triangle', 0.2, 0.005, 0.1, 990, 0.03)],
  land: () => [tone(110, 0.2, 'sine', 0.45, 0.002, 0.18, 80), noise(0.06, 0.15, 0.001, 0.05, 0.2)],
  tap: () => [tone(520, 0.05, 'square', 0.18, 0.001, 0.045, 380)],
  mana: () => [tone(988, 0.08, 'sine', 0.22, 0.002, 0.07), tone(1480, 0.1, 'sine', 0.16, 0.002, 0.09, 0, 0.05)],
  attack: () => [noise(0.25, 0.4, 0.02, 0.22, 0.3), tone(220, 0.25, 'saw', 0.22, 0.01, 0.22, 110)],
  block: () => [tone(180, 0.12, 'square', 0.3, 0.001, 0.11, 140), noise(0.08, 0.25, 0.001, 0.07, 0.4)],
  damage: () => [noise(0.18, 0.5, 0.001, 0.17, 0.15), tone(90, 0.2, 'sine', 0.5, 0.001, 0.19, 50)],
  heal: () => [tone(660, 0.1, 'sine', 0.2), tone(880, 0.1, 'sine', 0.2, 0.002, 0.09, 0, 0.08), tone(1320, 0.16, 'sine', 0.18, 0.002, 0.15, 0, 0.16)],
  destroy: () => [glitch(0.35, 0.4)],
  error: () => [tone(200, 0.09, 'square', 0.25), tone(150, 0.14, 'square', 0.25, 0.001, 0.13, 0, 0.1)],
  notify: () => [tone(1046, 0.07, 'triangle', 0.2), tone(1568, 0.12, 'triangle', 0.18, 0.002, 0.11, 0, 0.07)],
  turn: () => [tone(523, 0.08, 'square', 0.15), tone(784, 0.08, 'square', 0.15, 0.001, 0.07, 0, 0.09), tone(1046, 0.14, 'square', 0.15, 0.001, 0.13, 0, 0.18)],
  glitch: () => [glitch(0.18, 0.25)],
  join: () => [tone(440, 0.08, 'triangle', 0.2), tone(660, 0.08, 'triangle', 0.2, 0.002, 0.07, 0, 0.09), tone(880, 0.16, 'triangle', 0.2, 0.002, 0.15, 0, 0.18)],
};

function synth(name) {
  const parts = RECIPES[name]?.() || [];
  let total = 0;
  for (const p of parts) total = Math.max(total, Math.floor(p.start * RATE) + p.data.length);
  const buf = ctx.createBuffer(1, Math.max(total, 1), RATE);
  const out = buf.getChannelData(0);
  for (const p of parts) {
    const off = Math.floor(p.start * RATE);
    for (let i = 0; i < p.data.length; i += 1) out[off + i] += p.data[i];
  }
  for (let i = 0; i < out.length; i += 1) out[i] = Math.max(-1, Math.min(1, out[i]));
  return buf;
}

async function getBuffer(name) {
  if (buffers.has(name)) return buffers.get(name);
  const url = sfxUrl(name);
  let buf;
  if (url) {
    try {
      const res = await fetch(url);
      buf = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      buf = synth(name);
    }
  } else buf = synth(name);
  buffers.set(name, buf);
  return buf;
}

export function sfx(name, { pitch = 1, gain = 1 } = {}) {
  if (settings.sfx <= 0) return;
  const c = ensureContext();
  if (!c || c.state !== 'running') return;
  getBuffer(name).then((buf) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch * (0.97 + Math.random() * 0.06);
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(sfxGain);
    src.start();
  });
}
