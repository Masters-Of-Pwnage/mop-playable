<template>
  <div class="min-h-full flex flex-col" :class="{ scanlines: !settings.reducedMotion }">
    <header v-if="!isGame" class="no-print sticky top-0 z-40 border-b border-neon/20 bg-ink/80 backdrop-blur-md">
      <nav class="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-4">
        <RouterLink to="/" class="flex items-center gap-2 pr-2" @click="sfx('click')">
          <img :src="logo" alt="Masters of Pwnage" class="h-9 w-auto sm:h-10" />
        </RouterLink>
        <div class="hidden flex-1 items-center gap-1 sm:flex">
          <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="btn btn-ghost btn-sm" :class="{ 'text-neon': isActive(item.to) }" @click="sfx('click')">
            {{ item.label }}
          </RouterLink>
        </div>
        <div class="flex-1 sm:hidden"></div>
        <button class="btn btn-ghost btn-sm" :title="settings.music > 0 ? 'Silenciar música' : 'Ligar música'" @click="toggleMusic">
          <span aria-hidden="true">{{ settings.music > 0 ? '♫' : '♪' }}</span>
          <span class="hidden md:inline">{{ settings.music > 0 ? 'Música' : 'Sem música' }}</span>
        </button>
        <button class="btn btn-ghost btn-sm sm:hidden" aria-label="Menu" @click="menuOpen = !menuOpen">☰</button>
      </nav>
      <Transition name="fade">
        <div v-if="menuOpen" class="flex flex-col gap-1 border-t border-neon/20 px-3 py-2 sm:hidden">
          <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="btn btn-ghost justify-start" @click="menuOpen = false; sfx('click')">
            {{ item.label }}
          </RouterLink>
        </div>
      </Transition>
    </header>

    <main class="flex-1 min-h-0 flex flex-col">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <!-- toasts -->
    <div class="pointer-events-none fixed left-1/2 top-16 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      <TransitionGroup name="pop">
        <div v-for="t in toasts" :key="t.id" class="panel-glass px-4 py-2 text-center text-sm" :class="toastClass(t.kind)">
          {{ t.text }}
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import logo from './assets/art/logo.webp';
import { settings } from './stores/settings.js';
import { sfx, playMusic, stopMusic, applyVolumes } from './stores/audio.js';
import { toasts } from './composables/toast.js';

const route = useRoute();
const menuOpen = ref(false);
const isGame = computed(() => route.name === 'game');
const items = [
  { to: '/decks', label: 'Montar deck' },
  { to: '/play', label: 'Jogar online' },
  { to: '/rules', label: 'Como jogar' },
];
const isActive = (to) => route.path.startsWith(to);
const toastClass = (k) => ({ ok: 'border-neon', warn: 'border-amber', error: 'border-danger', info: 'border-cyan' }[k] || 'border-cyan');

let lastMusic = 0.5;
function toggleMusic() {
  sfx('click');
  if (settings.music > 0) {
    lastMusic = settings.music;
    settings.music = 0;
    stopMusic();
  } else {
    settings.music = lastMusic || 0.5;
    applyVolumes();
    playMusic(musicFor(route.name));
  }
}

const musicFor = (name) => ({ decks: 'deck', game: 'game' }[name] || 'menu');
watch(() => route.name, (name) => {
  if (settings.music > 0 && name !== 'game') playMusic(musicFor(name));
}, { immediate: true });
</script>
