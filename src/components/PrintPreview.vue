<template>
  <UiModal :open="open" title="Imprimir deck (PDF frente e verso)" width="860px" @close="$emit('close')">
    <p class="mb-3 text-sm muted">
      A4 retrato, 9 cartas por folha (63×88 mm). Cada página de versos é seguida pela página de frentes com as colunas espelhadas,
      para que a impressão frente e verso fique alinhada. Imprima em 100% (sem ajustar à página).
    </p>
    <div v-if="allPages.length" class="flex items-center justify-between gap-2">
      <button class="btn btn-sm" :disabled="page === 0" @click="page--">◀</button>
      <div class="font-mono text-sm">Página {{ page + 1 }} de {{ allPages.length * 2 }} — {{ page % 2 === 0 ? 'versos' : 'frentes' }}</div>
      <button class="btn btn-sm" :disabled="page >= allPages.length * 2 - 1" @click="page++">▶</button>
    </div>
    <div class="mx-auto mt-3 w-full max-w-[420px] rounded-md bg-white p-3" style="aspect-ratio: 210 / 297">
      <div class="grid h-full grid-cols-3 content-start gap-[2%]">
        <div v-for="(card, i) in currentCards" :key="i" class="card-frame">
          <img :src="page % 2 === 0 ? backUrl('thumb') : imageUrl(card, 'thumb')" :alt="card.name" />
        </div>
      </div>
    </div>
    <div v-if="progress > 0 && progress < 1" class="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
      <div class="h-full bg-neon transition-all" :style="{ width: `${progress * 100}%` }"></div>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button class="btn" @click="$emit('close')">Cancelar</button>
      <button class="btn btn-primary" :disabled="busy || !allPages.length" @click="print">{{ busy ? 'Gerando PDF...' : 'Gerar PDF' }}</button>
    </div>
  </UiModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import UiModal from './UiModal.vue';
import { backUrl, imageUrl } from '../stores/cards.js';
import { generatePdf, pages } from '../game/print.js';
import { toast } from '../composables/toast.js';

const props = defineProps({ open: Boolean, deck: { type: Object, required: true } });
defineEmits(['close']);

const page = ref(0);
const busy = ref(false);
const progress = ref(0);
const allPages = computed(() => pages(props.deck));
const currentCards = computed(() => allPages.value[Math.floor(page.value / 2)] || []);
watch(() => props.open, () => { page.value = 0; });

async function print() {
  busy.value = true;
  progress.value = 0.01;
  try {
    const name = await generatePdf(props.deck, (p) => { progress.value = p; });
    toast(`PDF gerado: ${name}`, 'ok');
  } catch (err) {
    toast(err.message || 'Erro ao gerar o PDF.', 'error');
  } finally {
    busy.value = false;
    progress.value = 0;
  }
}
</script>
