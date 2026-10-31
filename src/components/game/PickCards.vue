<template>
  <UiModal :open="open" :title="title" width="900px" :dismissable="cancellable" @close="cancellable && $emit('resolve', null)">
    <p v-if="text" class="mb-2 text-sm muted">{{ text }}</p>
    <p class="mb-3 text-sm muted">Selecionadas: {{ picked.length }} (mín. {{ min }}, máx. {{ max }}) — clique para selecionar, botão direito para ampliar</p>
    <div class="grid max-h-[55vh] gap-2 overflow-y-auto pr-1" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr))">
      <CardTile v-for="e in entries" :key="e.iid" :card="e.card" :face-down="e.faceDown" :glow="picked.includes(e.iid)" class="cursor-pointer" @click="toggle(e.iid)" @contextmenu.prevent="zoom = e.card" />
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button v-if="cancellable" class="btn" @click="$emit('resolve', null)">{{ cancelLabel }}</button>
      <button class="btn btn-primary" :disabled="picked.length < min || picked.length > max" @click="$emit('resolve', picked)">{{ confirmLabel }}</button>
    </div>
    <CardZoom :card="zoom" @close="zoom = null" />
  </UiModal>
</template>

<script setup>
import { ref, watch } from 'vue';
import UiModal from '../UiModal.vue';
import CardTile from '../CardTile.vue';
import CardZoom from '../CardZoom.vue';
import { sfx } from '../../stores/audio.js';

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '' },
  text: { type: String, default: '' },
  entries: { type: Array, default: () => [] },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  confirmLabel: { type: String, default: 'Confirmar' },
  cancelLabel: { type: String, default: 'Cancelar' },
  cancellable: { type: Boolean, default: true },
});
defineEmits(['resolve']);

const picked = ref([]);
const zoom = ref(null);
watch(() => props.open, () => { picked.value = []; });

function toggle(iid) {
  sfx('tap');
  const i = picked.value.indexOf(iid);
  if (i !== -1) picked.value.splice(i, 1);
  else if (picked.value.length < props.max) picked.value.push(iid);
  else if (props.max === 1) picked.value = [iid];
}
</script>
