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
        <template v-if="account.enabled">
          <RouterLink v-if="account.user && economy.mineLoaded" to="/carteira" class="btn btn-ghost btn-sm font-mono text-neon" title="Carteira" @click="sfx('click')">
            {{ economy.balances.CR }}<span class="text-xs">CR</span>
          </RouterLink>
          <RouterLink v-if="account.user" to="/perfil" class="btn btn-ghost btn-sm max-w-[42vw]" :title="`Perfil de ${account.user.displayName}`" @click="sfx('click')">
            <img v-if="account.user.avatarUrl" :src="account.user.avatarUrl" alt="" class="h-6 w-6 rounded-full" referrerpolicy="no-referrer" />
            <span v-else class="grid h-6 w-6 place-items-center rounded-full border border-neon/60 font-mono text-xs text-neon">{{ initial }}</span>
            <span class="truncate">{{ account.user.displayName }}</span>
          </RouterLink>
          <button v-else class="btn btn-sm google-btn" @click="login">
            <GoogleIcon class="h-4 w-4" />
            <span>Entrar com o Google</span>
          </button>
        </template>
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

    <UiModal :open="importOffer > 0" title="Importar decks deste navegador?" @close="declineImport">
      <p class="muted">Encontramos {{ importOffer }} deck(s) salvos neste navegador. Quer copiá-los para a sua conta? Eles ficam disponíveis em qualquer dispositivo.</p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn" @click="declineImport">Agora não</button>
        <button class="btn btn-primary" :disabled="importing" @click="acceptImport">Importar</button>
      </div>
    </UiModal>

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
import { useRoute, useRouter } from 'vue-router';
import logo from './assets/art/logo.webp';
import { settings } from './stores/settings.js';
import { sfx, playMusic, stopMusic, applyVolumes } from './stores/audio.js';
import { toast, toasts } from './composables/toast.js';
import UiModal from './components/UiModal.vue';
import GoogleIcon from './components/GoogleIcon.vue';
import { account, login } from './stores/account.js';
import { importLocalDecks, localDeckCount } from './stores/decks.js';
import { claimDaily, economy, loadMine } from './stores/economy.js';

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const isGame = computed(() => route.name === 'game');
const items = computed(() => [
  { to: '/decks', label: 'Montar deck' },
  { to: '/play', label: 'Jogar online' },
  ...(account.enabled ? [{ to: '/loja', label: 'Loja' }, { to: '/colecao', label: 'Coleção' }] : []),
  { to: '/rules', label: 'Como jogar' },
]);
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

const initial = computed(() => (account.user?.displayName || '?').slice(0, 1).toUpperCase());

// The login callback lands on "#/...?login=<result>" when something went wrong.
const LOGIN_RESULTS = {
  erro: ['Não foi possível entrar com o Google. Tente de novo.', 'error'],
  cancelado: ['Login cancelado.', 'info'],
  suspensa: ['Esta conta está suspensa. Fale com a organização do jogo.', 'error'],
};
watch(() => route.query.login, (value) => {
  if (!value) return;
  const [text, kind] = LOGIN_RESULTS[value] || LOGIN_RESULTS.erro;
  toast(text, kind, 5000);
  const { login: _login, ...query } = route.query;
  router.replace({ query });
}, { immediate: true });

// After the first login on this browser: offer to copy the local decks into the account (RF-1.11).
const importOffer = ref(0);
const importing = ref(false);
const offerKey = () => `mop.decks.import-offered.${account.user?.publicId}`;
// Wallet and collection follow the logged-in account; the daily bonus is claimed on arrival.
watch(() => account.user?.publicId, async (id) => {
  await loadMine().catch(() => {});
  if (!id) return;
  try {
    const daily = await claimDaily();
    if (daily.claimed) toast(`Bônus diário: +${daily.amount} créditos.`, 'ok', 3500);
  } catch { /* shown on the next action */ }
}, { immediate: true });

watch(() => account.user?.publicId, (id) => {
  if (!id) return;
  try {
    if (localStorage.getItem(offerKey())) return;
  } catch {
    return;
  }
  importOffer.value = localDeckCount();
}, { immediate: true });

function markOffered() {
  try {
    localStorage.setItem(offerKey(), String(Date.now()));
  } catch { /* ignore */ }
  importOffer.value = 0;
}

function declineImport() {
  markOffered();
}

async function acceptImport() {
  importing.value = true;
  try {
    const { imported } = await importLocalDecks();
    toast(`${imported} deck(s) importados para a sua conta.`, 'ok');
    markOffered();
  } catch (err) {
    toast(`Não foi possível importar: ${err.message}`, 'error');
  } finally {
    importing.value = false;
  }
}
</script>

<style scoped>
.google-btn { background: #fff; color: #1f1f1f; border-color: #dadce0; font-family: Roboto, Arial, sans-serif; font-weight: 500; }
.google-btn:hover:not(:disabled) { background: #f8f9fa; border-color: #c6c9cc; box-shadow: none; }
</style>
