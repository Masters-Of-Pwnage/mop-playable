<template>
  <div class="flex items-end gap-1" :style="{ height: `${height + 16}px` }">
    <div v-for="(n, i) in curve" :key="i" class="flex flex-1 flex-col items-center justify-end gap-0.5" :title="`${n} carta(s) de custo ${i === 7 ? '7+' : i}`">
      <div class="w-full rounded-sm transition-all duration-300" :class="n ? 'bg-neon' : 'bg-white/10'" :style="{ height: `${Math.max(2, (n / max) * height)}px` }"></div>
      <div class="text-[10px] leading-none muted">{{ i === 7 ? '7+' : i }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ curve: { type: Array, default: () => [0, 0, 0, 0, 0, 0, 0, 0] }, height: { type: Number, default: 40 } });
const max = computed(() => Math.max(1, ...props.curve));
</script>
