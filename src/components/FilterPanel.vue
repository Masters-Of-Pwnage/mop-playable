<template>
  <div class="flex flex-col gap-4 text-sm">
    <div class="muted">{{ resultCount }} de {{ total }} cartas</div>
    <label class="flex flex-col gap-1">
      <span class="muted">Texto da carta</span>
      <input :value="modelValue.description" class="input" placeholder="ex.: grimório, sacrifique..." @input="set('description', $event.target.value)" />
    </label>
    <div class="flex flex-col gap-1">
      <span class="muted">Custo de mana (mín / máx)</span>
      <div class="flex gap-2">
        <input :value="modelValue.costMin" type="number" min="0" class="input" placeholder="Mín" @input="set('costMin', $event.target.value)" />
        <input :value="modelValue.costMax" type="number" min="0" class="input" placeholder="Máx" @input="set('costMax', $event.target.value)" />
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="muted">Tipo de carta</span>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="t in FILTER_TYPES" :key="t" class="chip" :class="{ 'chip-on': modelValue.types.includes(t) }" @click="toggle('types', t)">{{ t }}</button>
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="muted">Cor de mana</span>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="m in MANAS" :key="m" class="chip flex items-center gap-1" :class="{ 'chip-on': modelValue.manas.includes(m) }" :title="COLOR_NAMES[m.replace(/[{}]/g, '')]" @click="toggle('manas', m)">
          <ManaPips :symbols="[m.replace(/[{}]/g, '')]" style="--pip: 18px" />
        </button>
      </div>
    </div>
    <button class="btn btn-sm" @click="$emit('clear')">Limpar filtros</button>
  </div>
</template>

<script setup>
import ManaPips from './ManaPips.vue';
import { FILTER_TYPES } from '../engine/cards.js';
import { COLOR_NAMES } from '../engine/mana.js';
import { sfx } from '../stores/audio.js';

const props = defineProps({
  modelValue: { type: Object, required: true },
  resultCount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
});
const emit = defineEmits(['update:modelValue', 'clear']);
const MANAS = ['{W}', '{U}', '{B}', '{R}', '{G}', '{C}'];

function set(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function toggle(key, value) {
  sfx('tap');
  const list = props.modelValue[key].includes(value) ? props.modelValue[key].filter((v) => v !== value) : [...props.modelValue[key], value];
  set(key, list);
}
</script>
