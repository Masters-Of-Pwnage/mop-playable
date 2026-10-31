<template>
  <div class="panel-glass flex flex-wrap items-center gap-1.5 px-2 py-1.5 sm:gap-2" :class="{ 'border-neon/60': active }">
    <span class="h-2.5 w-2.5 rounded-full" :class="active ? 'bg-neon shadow-neon' : 'bg-muted'" :title="active ? 'turno deste jogador' : ''"></span>
    <span class="max-w-[120px] truncate font-mono text-sm sm:max-w-[160px]" :class="active ? 'text-neon' : ''">{{ ps.name }}</span>
    <span v-if="away" class="text-xs text-amber">⟳</span>

    <button class="btn btn-sm w-9 px-0" :disabled="!editable" aria-label="-1 vida" @click="$emit('life', -1)">−</button>
    <button ref="lifeEl" class="btn btn-sm min-w-[64px] font-mono text-xl" :class="ps.life <= 5 ? 'text-danger' : ''" :disabled="!editable" title="Vida" @click="$emit('life-click')">{{ ps.life }}</button>
    <button class="btn btn-sm w-9 px-0" :disabled="!editable" aria-label="+1 vida" @click="$emit('life', 1)">+</button>

    <div ref="poolEl" class="flex items-center gap-0.5">
      <button v-for="col in poolColors" :key="col" class="btn btn-ghost btn-sm h-9 w-9 px-0" :title="`${COLOR_NAMES[col]}: ${ps.pool[col]} (clique para gastar 1)`" :disabled="!editable" @click="$emit('pool-pip', col)">
        <span class="relative inline-flex"><ManaPips :symbols="[col]" style="--pip: 24px" /><span class="absolute -right-1 -top-1 rounded-full bg-black px-1 font-mono text-[10px] text-white">{{ ps.pool[col] }}</span></span>
      </button>
      <button v-if="editable" class="btn btn-sm px-2 text-xs" title="Adicionar mana à reserva" @click="$emit('pool-add')">+◇</button>
    </div>

    <div class="flex-1"></div>
    <div v-if="top" ref="handEl" class="h-8 w-20 sm:w-24"></div>
    <button v-if="editable" class="btn btn-sm px-2 text-xs" title="Criar ficha (token)" @click="$emit('token')">Ficha</button>
    <button v-if="!editable" class="btn btn-sm px-2 text-xs" @click="$emit('zone', Zone.HAND)">Mão {{ ps.hand.length }}</button>
    <button ref="libEl" class="btn btn-sm px-2 text-xs" @click="$emit('zone', Zone.LIBRARY)">Grim. {{ ps.library.length }}</button>
    <button ref="gyEl" class="btn btn-sm px-2 text-xs" @click="$emit('zone', Zone.GRAVEYARD)">Cemit. {{ ps.graveyard.length }}</button>
    <button v-if="ps.exile.length || editable" ref="exEl" class="btn btn-sm px-2 text-xs" @click="$emit('zone', Zone.EXILE)">Exílio {{ ps.exile.length }}</button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import ManaPips from '../ManaPips.vue';
import { Zone } from '../../engine/engine.js';
import { ALL, COLOR_NAMES } from '../../engine/mana.js';

const props = defineProps({
  ps: { type: Object, required: true },
  active: Boolean,
  editable: Boolean,
  top: Boolean,
  away: Boolean,
});
defineEmits(['life', 'life-click', 'zone', 'pool-add', 'pool-pip', 'token']);

const lifeEl = ref(null);
const poolEl = ref(null);
const handEl = ref(null);
const libEl = ref(null);
const gyEl = ref(null);
const exEl = ref(null);
const poolColors = computed(() => ALL.filter((c) => props.ps.pool[c] > 0));

function rect(el) {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

defineExpose({
  rects: () => ({
    life: rect(lifeEl.value), pool: rect(poolEl.value), hand: rect(handEl.value), library: rect(libEl.value),
    graveyard: rect(gyEl.value), exile: rect(exEl.value) || rect(gyEl.value),
  }),
});
</script>
