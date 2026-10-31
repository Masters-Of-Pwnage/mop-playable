<template>
  <UiModal :open="!!prompt" :title="prompt?.title || ''" width="440px" :dismissable="prompt?.cancellable !== false" @close="resolve(null)">
    <template v-if="prompt">
      <p v-if="prompt.text" class="mb-3 text-sm muted">{{ prompt.text }}</p>

      <div v-if="prompt.kind === 'options'" class="flex flex-col gap-2">
        <button v-for="o in prompt.options" :key="String(o.value)" class="btn justify-start" :class="o.style" @click="resolve(o.value)">{{ o.label }}</button>
      </div>

      <div v-else-if="prompt.kind === 'number'" class="flex items-center justify-center gap-4">
        <button class="btn h-14 w-14 text-2xl" @click="n = Math.max(prompt.min, n - 1)">−</button>
        <div class="w-20 text-center font-mono text-4xl text-neon">{{ n }}</div>
        <button class="btn h-14 w-14 text-2xl" @click="n = Math.min(prompt.max, n + 1)">+</button>
      </div>

      <div v-else-if="prompt.kind === 'color'" class="grid grid-cols-3 gap-2">
        <button v-for="c in prompt.colors" :key="c" class="btn flex-col py-3" @click="resolve(c)">
          <ManaPips :symbols="[c]" style="--pip: 30px" />
          <span class="text-sm">{{ COLOR_NAMES[c] }}</span>
        </button>
      </div>

      <div v-else-if="prompt.kind === 'token'" class="flex flex-col gap-2">
        <input v-model="tokenName" class="input" placeholder="Nome da ficha" />
        <div class="grid grid-cols-3 gap-2">
          <label class="text-sm">Poder<input v-model.number="tokenP" type="number" min="0" class="input mt-1" /></label>
          <label class="text-sm">Resist.<input v-model.number="tokenT" type="number" min="0" class="input mt-1" /></label>
          <label class="text-sm">Qtd.<input v-model.number="tokenN" type="number" min="1" max="10" class="input mt-1" /></label>
        </div>
      </div>

      <div v-else-if="prompt.kind === 'text'" class="flex flex-col gap-2">
        <input v-model="text" class="input" :placeholder="prompt.placeholder || ''" @keyup.enter="resolve(text)" />
      </div>

      <div v-if="['number', 'token', 'text'].includes(prompt.kind)" class="mt-4 flex justify-end gap-2">
        <button v-if="prompt.cancellable !== false" class="btn" @click="resolve(null)">Cancelar</button>
        <button class="btn btn-primary" @click="confirm">{{ prompt.confirmLabel || 'Confirmar' }}</button>
      </div>
      <div v-else-if="prompt.cancellable !== false" class="mt-3 flex justify-end">
        <button class="btn" @click="resolve(null)">Cancelar</button>
      </div>
    </template>
  </UiModal>
</template>

<script setup>
import { ref, watch } from 'vue';
import UiModal from '../UiModal.vue';
import ManaPips from '../ManaPips.vue';
import { COLOR_NAMES } from '../../engine/mana.js';
import { sfx } from '../../stores/audio.js';

const props = defineProps({ prompt: { type: Object, default: null } });
const emit = defineEmits(['resolve']);
const n = ref(1);
const tokenName = ref('Hacker');
const tokenP = ref(1);
const tokenT = ref(1);
const tokenN = ref(1);
const text = ref('');

watch(() => props.prompt, (p) => {
  if (!p) return;
  n.value = p.value ?? 1;
  text.value = p.value ?? '';
});

function resolve(v) {
  sfx('click');
  emit('resolve', v);
}

function confirm() {
  const p = props.prompt;
  if (p.kind === 'number') resolve(n.value);
  else if (p.kind === 'token') resolve({ name: tokenName.value.trim() || 'Ficha', power: tokenP.value | 0, toughness: tokenT.value | 0, n: Math.max(1, tokenN.value | 0) });
  else resolve(text.value);
}
</script>
