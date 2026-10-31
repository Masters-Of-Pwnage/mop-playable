<template>
  <span class="inline-flex items-center gap-[2px] align-middle">
    <span v-for="(s, i) in symbols" :key="i" class="inline-flex items-center justify-center rounded-full font-mono font-bold leading-none shadow-sm" :style="pipStyle(s)" :title="title(s)">
      {{ label(s) }}
    </span>
  </span>
</template>

<script setup>
import { COLOR_HEX, COLOR_NAMES } from '../engine/mana.js';

defineProps({
  symbols: { type: Array, default: () => [] },
  size: { type: Number, default: 18 },
});

const dark = ['W', 'C', 'G', 'U', 'R', '*'];
function pipStyle(s) {
  const parts = String(s).split('/');
  const size = 'var(--pip, 18px)';
  const bg = parts.length === 2
    ? `linear-gradient(135deg, ${COLOR_HEX[parts[0]] || '#b9c0c8'} 50%, ${COLOR_HEX[parts[1]] || '#b9c0c8'} 50%)`
    : (COLOR_HEX[s] || (s === '?' ? '#c8b6ff' : '#b9c0c8'));
  const fg = dark.includes(s) || /^\d+$/.test(s) || s === 'X' || s === '?' ? '#0a0a0a' : '#fff';
  return { width: size, height: size, fontSize: `calc(${size} * 0.58)`, background: bg, color: fg, border: '1px solid rgba(0,0,0,.55)' };
}
const label = (s) => (String(s).includes('/') ? '' : ({ C: '◇', '*': '★' }[s] || s));
const title = (s) => COLOR_NAMES[s] || (s === '?' ? 'Símbolo especial' : `${s} genérico`);
</script>
