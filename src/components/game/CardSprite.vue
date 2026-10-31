<template>
  <div class="card-sprite absolute left-0 top-0 touch-none select-none" :style="{ zIndex: z }" :data-iid="ci.iid">
    <CardTile :card="card" :face-down="faceDown" :tilt="false" :glow="glow > 0" :glow-color="glowColor" :dim="dim" :eager="true" class="h-full w-full" :style="{ opacity: glow > 0 ? 1 : undefined }">
      <template v-if="!faceDown && onField">
        <div v-if="ptText" class="absolute bottom-[3%] right-[3%] rounded-md border bg-black/90 px-[5%] font-mono text-[clamp(10px,1.1em,20px)] font-bold" :class="ptClass">{{ ptText }}</div>
        <div v-if="counters" class="absolute left-[3%] top-[3%] rounded-md border border-amber bg-black/90 px-[4%] font-mono text-[clamp(9px,0.9em,16px)] text-amber">{{ counters }}</div>
        <div v-if="flags" class="absolute bottom-[3%] left-[3%] rounded-md border border-cyan bg-black/85 px-[4%] font-mono text-[clamp(9px,0.9em,16px)] text-cyan">{{ flags }}</div>
      </template>
      <div v-if="ci.isToken" class="absolute inset-0 flex flex-col items-center justify-center gap-1 border-2 border-cyan bg-[#03110c] p-2 text-center font-mono text-cyan">
        <div class="text-[0.6em] uppercase tracking-widest">ficha</div>
        <div class="text-[0.9em] font-bold leading-tight">{{ ci.tokenName }}</div>
      </div>
    </CardTile>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import CardTile from '../CardTile.vue';
import { Zone } from '../../engine/engine.js';

const props = defineProps({
  ci: { type: Object, required: true },
  card: { type: Object, default: null },
  engine: { type: Object, required: true },
  faceDown: Boolean,
  z: { type: Number, default: 1 },
  glow: { type: Number, default: 0 },
  glowColor: { type: String, default: '#3dff7a' },
  dim: Boolean,
});

const onField = computed(() => props.ci.zone === Zone.BATTLEFIELD);
const ptText = computed(() => {
  const e = props.engine;
  const c = props.ci;
  if (e.isCreature(c)) return e.hasStats(c) ? `${e.power(c)}/${e.toughness(c) - c.damage}` : '?/?';
  if (e.isPlaneswalker(c)) return `◆ ${e.loyalty(c)}`;
  return '';
});
const ptClass = computed(() => {
  const e = props.engine;
  const c = props.ci;
  if (c.damage > 0) return 'border-danger text-danger';
  if (e.isCreature(c) && (e.power(c) !== e.basePower(c) || e.toughness(c) !== e.baseToughness(c))) return 'border-amber text-amber';
  return 'border-neon text-white';
});
const counters = computed(() => Object.entries(props.ci.counters).filter(([k]) => k !== 'lealdade').map(([k, v]) => `${k}×${v}`).join(' '));
const flags = computed(() => {
  const c = props.ci;
  const f = [];
  if (c.attacking) f.push('⚔');
  if (c.blocking !== -1) f.push('⛨');
  if (c.sick && props.engine.isCreature(c)) f.push('zZ');
  if (c.attachedTo !== -1) f.push('⚙');
  return f.join(' ');
});
</script>

<style scoped>
.card-sprite { will-change: transform; transform-origin: center center; }
</style>
