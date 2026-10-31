<template>
  <span v-if="rarity" class="rarity-badge" :class="`rarity-badge--${rarity}`" :title="`Raridade: ${RARITY_LABELS[rarity]}`">{{ short ? RARITY_LABELS[rarity].slice(0, 1) : RARITY_LABELS[rarity] }}</span>
</template>

<script setup>
import { RARITY_LABELS } from '../stores/economy.js';

defineProps({
  rarity: { type: String, default: '' },
  short: { type: Boolean, default: false },
});
</script>

<style scoped>
.rarity-badge { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0 0.5em; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; line-height: 1.5; white-space: nowrap; }
.rarity-badge--comum { color: #9aa5ad; }
.rarity-badge--incomum { color: #d6e2ea; }
.rarity-badge--rara { color: #ffc94d; }
.rarity-badge--mitica { color: #ff7a45; }
.rarity-badge--lendaria { color: #ff5ef0; text-shadow: 0 0 8px rgba(255, 94, 240, 0.6); }
</style>
