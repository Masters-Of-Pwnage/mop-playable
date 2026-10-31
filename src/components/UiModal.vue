<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" @click.self="dismissable && $emit('close')">
        <Transition name="pop" appear>
          <div class="panel-glass max-h-[92vh] w-full overflow-y-auto p-4 sm:p-6" :style="{ maxWidth: width }" role="dialog" aria-modal="true">
            <div v-if="title" class="mb-3 flex items-start justify-between gap-3">
              <h2 class="subtitle text-xl font-bold">{{ title }}</h2>
              <button v-if="dismissable" class="btn btn-ghost btn-sm -mr-2 -mt-1" aria-label="Fechar" @click="$emit('close')">✕</button>
            </div>
            <slot />
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: String, default: '520px' },
  dismissable: { type: Boolean, default: true },
});
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape' && props.open && props.dismissable) emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>
