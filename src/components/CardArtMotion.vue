<template>
  <div v-if="playing" class="card-motion" :style="box" aria-hidden="true">
    <video :poster="anim.poster" muted loop playsinline autoplay disablepictureinpicture disableremoteplayback @loadeddata="ready = true">
      <source :src="anim.webm" type="video/webm" />
      <source :src="anim.mp4" type="video/mp4" />
    </video>
  </div>
</template>

<script>
import { reactive } from 'vue';

// Videos playing at once across the page (03-animacoes §4: at most 3; a busy board stays smooth).
const MAX_PLAYING = 3;
const slots = reactive(new Set());
let seq = 0;
</script>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { motionEnabled } from '../stores/settings.js';

const props = defineProps({
  /** Catalog animation: { webm, mp4, poster, crop: {x, y, w, h} in % of the card }. */
  anim: { type: Object, default: null },
  /** Wants to play (hovered, zoomed...). The global limit may still say no. */
  active: { type: Boolean, default: false },
  /** Zoom view: plays with the "ao ampliar" preference too. */
  zoom: { type: Boolean, default: false },
});

const id = (seq += 1);
const ready = ref(false);
const wants = computed(() => Boolean(props.anim) && props.active && motionEnabled(props.zoom));
const playing = computed(() => wants.value && slots.has(id));

watch(wants, (on) => {
  if (on && (slots.size < MAX_PLAYING || props.zoom)) slots.add(id);
  else slots.delete(id);
  if (!on) ready.value = false;
}, { immediate: true });
onBeforeUnmount(() => slots.delete(id));

const box = computed(() => {
  const c = props.anim?.crop || { x: 8.5, y: 11.5, w: 83, h: 42 };
  return { left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`, opacity: ready.value ? 1 : 0 };
});
</script>

<style scoped>
.card-motion { position: absolute; overflow: hidden; pointer-events: none; transition: opacity 0.25s ease; border-radius: 2px; }
.card-motion video { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
