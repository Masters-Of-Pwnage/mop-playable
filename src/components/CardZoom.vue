<template>
  <UiModal :open="!!card" width="900px" @close="$emit('close')">
    <div v-if="card" class="flex flex-col gap-5 md:flex-row">
      <div class="mx-auto w-full max-w-[340px] shrink-0 md:w-[46%]">
        <CardTile :card="card" size="full" eager zoom :face-down="false" />
        <label v-if="catalogFor(card.uid)?.animation" class="mt-2 flex items-center justify-center gap-2 text-xs muted">
          Animações das cartas
          <select v-model="settings.cardMotion" class="input py-0.5 text-xs">
            <option value="sempre">sempre</option>
            <option value="ampliar">só ao ampliar</option>
            <option value="desligado">desligadas</option>
          </select>
        </label>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h2 class="subtitle text-2xl font-bold leading-tight">{{ card.name }}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-sm muted">
            <ManaPips v-if="card.kind !== Kind.LAND && !card.cost.isEmpty" :symbols="card.cost.symbols()" style="--pip: 22px" />
            <span>{{ card.typeLine || card.kindName }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="chip chip-on cursor-default">{{ card.kindName }}</span>
          <span v-if="card.hasPT" class="chip cursor-default border-neon">P/R {{ card.ptText }}</span>
          <span v-if="card.loyaltyText" class="chip cursor-default border-amber">Lealdade {{ card.loyaltyText }}</span>
          <span v-if="card.kind !== Kind.LAND" class="chip cursor-default">Custo {{ card.manaValue }}</span>
          <span v-for="kw in Object.keys(card.keywords)" :key="kw" class="chip cursor-default border-magenta">{{ KEYWORD_NAMES[kw] || kw }}</span>
          <span v-if="card.kind === Kind.LAND" class="chip cursor-default border-neon">{{ produces }}</span>
        </div>
        <p class="whitespace-pre-line text-[15px] leading-relaxed">{{ card.text || '(sem texto de regras)' }}</p>
        <p v-if="card.flavor" class="whitespace-pre-line text-sm italic muted">{{ card.flavor }}</p>
        <p v-if="meta" class="text-xs muted">{{ meta }}</p>
        <div v-if="$slots.actions" class="mt-auto flex flex-wrap gap-2 pt-2">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import { computed } from 'vue';
import UiModal from './UiModal.vue';
import CardTile from './CardTile.vue';
import ManaPips from './ManaPips.vue';
import { Kind, KEYWORD_NAMES } from '../engine/cards.js';
import { COLOR_NAMES, ANY } from '../engine/mana.js';
import { catalogFor } from '../stores/economy.js';
import { settings } from '../stores/settings.js';

const props = defineProps({ card: { type: Object, default: null }, extra: { type: String, default: '' } });
defineEmits(['close']);

const produces = computed(() => {
  const p = props.card?.produces || [];
  if (!p.length || p.includes(ANY)) return 'Gera: qualquer cor';
  return `Gera: ${p.map((c) => COLOR_NAMES[c] || c).join(', ')}`;
});
const meta = computed(() => [props.card?.edition, props.card?.year, props.extra].filter(Boolean).join(' · '));
</script>
