<template>
  <div
    ref="root"
    class="card-frame card-tile"
    :class="[{ 'card-tile--tilt': tilt && !settings.reducedMotion, 'card-tile--glow': glow, 'card-tile--dim': dim, 'card-tile--still': settings.reducedMotion }, rarityClass]"
    :style="{ '--glow-color': glowColor }"
    @pointermove="onMove"
    @pointerleave="reset"
  >
    <template v-if="faceDown"></template>
    <img v-else-if="src && !failed" :src="src" :alt="card?.name || 'Carta'" :loading="eager ? 'eager' : 'lazy'" decoding="async" draggable="false" @error="failed = true" @load="loaded = true" :class="{ 'opacity-0': !loaded && !eager }" class="transition-opacity duration-300" />
    <div v-else class="flex h-full w-full flex-col justify-between border-2 border-neonDim/70 p-[6%] text-left">
      <div class="font-mono text-[0.7em] font-bold leading-tight text-neon">{{ card?.name || 'Carta' }}</div>
      <div class="text-[0.55em] leading-tight text-muted">{{ card?.typeLine }}</div>
      <div class="line-clamp-[6] text-[0.5em] leading-tight">{{ card?.text }}</div>
    </div>
    <div v-if="faceDown" class="absolute inset-0">
      <img :src="back" alt="Verso da carta" draggable="false" />
    </div>
    <div class="card-tile__shine" aria-hidden="true"></div>
    <slot />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { backUrl, imageUrl } from '../stores/cards.js';
import { settings } from '../stores/settings.js';
import { catalogFor } from '../stores/economy.js';

const props = defineProps({
  card: { type: Object, default: null },
  size: { type: String, default: 'thumb' }, // thumb | full
  faceDown: { type: Boolean, default: false },
  tilt: { type: Boolean, default: true },
  glow: { type: Boolean, default: false },
  glowColor: { type: String, default: '#3dff7a' },
  dim: { type: Boolean, default: false },
  eager: { type: Boolean, default: false },
});

const root = ref(null);
const failed = ref(false);
const loaded = ref(false);
const src = computed(() => imageUrl(props.card, props.size));
const back = computed(() => backUrl(props.size));
// Rare and above get a frame and a holo sheen (docs/sdd/02-economia.md §3); nothing without a catalog.
const rarityClass = computed(() => {
  const r = !props.faceDown && props.card ? catalogFor(props.card.uid)?.rarity : '';
  return r && r !== 'comum' ? `card-tile--r-${r}` : '';
});

function onMove(e) {
  if (!props.tilt || settings.reducedMotion) return;
  const el = root.value;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', `${(-y * 14).toFixed(2)}deg`);
  el.style.setProperty('--ry', `${(x * 14).toFixed(2)}deg`);
  el.style.setProperty('--sx', `${((x + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty('--sy', `${((y + 0.5) * 100).toFixed(1)}%`);
}

function reset() {
  const el = root.value;
  if (!el) return;
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
}
</script>

<style scoped>
.card-tile {
  --rx: 0deg;
  --ry: 0deg;
  --sx: 50%;
  --sy: 50%;
  transform-style: preserve-3d;
  transition: transform 0.18s ease, box-shadow 0.2s ease, filter 0.2s ease;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
}
.card-tile--tilt { transform: perspective(700px) rotateX(var(--rx)) rotateY(var(--ry)); }
.card-tile--tilt:hover { z-index: 2; }
.card-tile--glow { box-shadow: 0 0 0 2px var(--glow-color), 0 0 18px var(--glow-color), 0 6px 18px rgba(0, 0, 0, 0.6); }
.card-tile--dim { filter: brightness(0.55) saturate(0.6); }
.card-tile__shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(circle at var(--sx) var(--sy), rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 55%);
  transition: opacity 0.2s ease;
}
.card-tile--tilt:hover .card-tile__shine { opacity: 1; }
.card-tile--r-incomum { box-shadow: 0 0 0 1px rgba(214, 226, 234, 0.55), 0 6px 18px rgba(0, 0, 0, 0.55); }
.card-tile--r-rara { box-shadow: 0 0 0 1.5px rgba(255, 201, 77, 0.8), 0 0 12px rgba(255, 201, 77, 0.25), 0 6px 18px rgba(0, 0, 0, 0.55); }
.card-tile--r-mitica { box-shadow: 0 0 0 1.5px rgba(255, 122, 69, 0.9), 0 0 16px rgba(255, 122, 69, 0.35), 0 6px 18px rgba(0, 0, 0, 0.55); }
.card-tile--r-lendaria { box-shadow: 0 0 0 2px rgba(255, 94, 240, 0.9), 0 0 20px rgba(255, 94, 240, 0.4), 0 6px 18px rgba(0, 0, 0, 0.55); }
.card-tile--glow.card-tile--r-incomum, .card-tile--glow.card-tile--r-rara, .card-tile--glow.card-tile--r-mitica, .card-tile--glow.card-tile--r-lendaria {
  box-shadow: 0 0 0 2px var(--glow-color), 0 0 18px var(--glow-color), 0 6px 18px rgba(0, 0, 0, 0.6);
}
/* Holo sheen sweeping over mythic and legendary cards. */
.card-tile--r-mitica::after, .card-tile--r-lendaria::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.16) 45%, rgba(120, 220, 255, 0.14) 50%, rgba(255, 120, 240, 0.12) 55%, transparent 70%);
  background-size: 250% 100%;
  mix-blend-mode: screen;
  animation: holo 5s linear infinite;
}
.card-tile--still::after { animation: none !important; }
@keyframes holo { from { background-position: 150% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .card-tile--r-mitica::after, .card-tile--r-lendaria::after { animation: none; } }
</style>
