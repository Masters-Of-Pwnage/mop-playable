<template>
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink">
    <img :src="tiny" aria-hidden="true" class="absolute inset-0 h-full w-full object-cover blur-xl" :style="{ objectPosition: position }" />
    <img :src="src" :alt="alt" class="absolute inset-0 h-full w-full object-cover transition-opacity duration-700" :class="loaded ? 'opacity-100' : 'opacity-0'" :style="{ objectPosition: position }" @load="loaded = true" />
    <div class="absolute inset-0" :style="{ background: `linear-gradient(180deg, rgba(6,8,11,${darken * 0.6}) 0%, rgba(6,8,11,${darken}) 100%)` }"></div>
    <canvas v-if="rain > 0 && !settings.reducedMotion" ref="canvas" class="absolute inset-0 h-full w-full" :style="{ opacity: rain }"></canvas>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { settings } from '../stores/settings.js';

const props = defineProps({
  src: { type: String, required: true },
  tiny: { type: String, default: '' },
  alt: { type: String, default: '' },
  darken: { type: Number, default: 0.45 },
  rain: { type: Number, default: 0.12 },
  position: { type: String, default: 'center' },
});

const loaded = ref(false);
const canvas = ref(null);
let raf = 0;
let columns = [];

function resize() {
  const c = canvas.value;
  if (!c) return;
  c.width = Math.floor(c.clientWidth / 2);
  c.height = Math.floor(c.clientHeight / 2);
  const cols = Math.floor(c.width / 14);
  columns = Array.from({ length: cols }, () => ({ y: Math.random() * -c.height, speed: 1.2 + Math.random() * 2.5 }));
}

function frame() {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(6, 8, 11, 0.18)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = '12px "JetBrains Mono", monospace';
  columns.forEach((col, i) => {
    const ch = String.fromCharCode(0x30a0 + Math.random() * 60);
    ctx.fillStyle = Math.random() > 0.96 ? '#c8ffdc' : '#3dff7a';
    ctx.fillText(ch, i * 14, col.y);
    col.y += col.speed * 4;
    if (col.y > c.height + 20) {
      col.y = Math.random() * -200;
      col.speed = 1.2 + Math.random() * 2.5;
    }
  });
  raf = requestAnimationFrame(() => setTimeout(frame, 45));
}

onMounted(() => {
  if (canvas.value) {
    resize();
    window.addEventListener('resize', resize);
    frame();
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', resize);
});
</script>
