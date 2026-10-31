<template>
  <section class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-3 py-4 sm:px-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Pacotes</h1>
      <div v-if="account.user" class="ml-auto font-mono text-neon">{{ economy.balances.CR }} CR</div>
    </div>

    <div v-if="!enabled" class="panel-glass p-5">Pacotes não estão disponíveis no momento.</div>
    <template v-else>
      <div v-if="account.user && !account.user.adultConfirmed" class="panel-glass flex flex-wrap items-center gap-3 p-4 text-sm">
        <span>Pacotes têm conteúdo aleatório e são só para maiores de 18 anos.</span>
        <button class="btn btn-sm" @click="adultOpen = true">Confirmar maioridade</button>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="p in products" :key="p.id" class="panel-glass flex flex-col gap-2 p-4">
          <div class="text-lg font-bold">{{ p.name }}</div>
          <div class="text-sm muted">{{ p.description }}</div>
          <div class="text-sm">{{ p.cardsPerPack }} cartas · <span class="font-mono text-neon">{{ p.price }} CR</span><span v-if="p.dailyLimit" class="muted"> · até {{ p.dailyLimit }} por dia</span></div>
          <div class="mt-auto flex gap-2">
            <button class="btn btn-sm" @click="showOdds(p)">Probabilidades</button>
            <button class="btn btn-sm btn-primary" :disabled="busy || !account.user || !account.user.adultConfirmed || economy.balances.CR < p.price" @click="open(p)">Abrir</button>
          </div>
        </div>
      </div>
      <p v-if="!products.length" class="py-6 text-center text-sm muted">Nenhum pacote à venda agora.</p>
    </template>

    <!-- reveal -->
    <div v-if="reveal" class="fixed inset-0 z-[75] flex flex-col items-center justify-center gap-6 bg-black/85 p-4 backdrop-blur-sm">
      <div class="title text-2xl">{{ reveal.name }}</div>
      <div class="flex max-w-5xl flex-wrap justify-center gap-3">
        <div v-for="(c, i) in reveal.cards" :key="i" ref="slotEls" class="pack-card relative w-[min(28vw,150px)]" style="perspective: 900px">
          <div class="pack-card__inner">
            <CardTile :card="getCard(c.uid)" :face-down="!c.shown" :tilt="false" class="w-full" />
          </div>
          <div v-if="c.shown && c.refund" class="absolute inset-x-0 bottom-1 mx-1 rounded bg-black/80 text-center text-[11px] text-amber">+{{ c.refund }} CR (já tem o máximo)</div>
          <div v-if="c.shown" class="mt-1 text-center"><RarityBadge :rarity="c.rarity" short /></div>
        </div>
      </div>
      <div v-if="reveal.pity" class="text-sm text-cyan">Garantia ativada: rara ou melhor neste pacote.</div>
      <button class="btn btn-primary" :disabled="!revealDone" @click="reveal = null">Fechar</button>
    </div>

    <UiModal :open="!!odds" :title="odds ? `Probabilidades · ${odds.name}` : ''" width="640px" @close="odds = null">
      <div v-if="odds" class="flex flex-col gap-4 text-sm">
        <div v-for="(s, i) in odds.slots" :key="i">
          <div class="font-semibold">{{ s.count }} carta(s) com:</div>
          <div class="mt-1 flex flex-wrap gap-2">
            <span v-for="r in s.rarities" :key="r.rarity" class="chip cursor-default">{{ RARITY_LABELS[r.rarity] }} {{ pct(r.p) }}</span>
          </div>
          <details class="mt-1 text-xs"><summary class="cursor-pointer muted">Chance de cada carta por posição</summary>
            <ul class="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2"><li v-for="c in s.cards" :key="c.uid" class="flex justify-between gap-2"><span class="truncate">{{ c.name }}</span><span class="font-mono">{{ pct(c.p) }}</span></li></ul>
          </details>
        </div>
        <p class="text-xs muted">Versão {{ odds.version }} da configuração. Depois de uma sequência de pacotes sem rara, o próximo garante rara ou melhor.</p>
      </div>
    </UiModal>

    <UiModal :open="adultOpen" title="Confirmar maioridade" @close="adultOpen = false">
      <p class="text-sm">Declaro que tenho 18 anos ou mais. Pacotes têm conteúdo aleatório e são comprados só com créditos do jogo, que não têm valor em dinheiro.</p>
      <div class="mt-4 flex justify-end gap-2"><button class="btn" @click="adultOpen = false">Cancelar</button><button class="btn btn-primary" @click="confirmAdult">Confirmo</button></div>
    </UiModal>
  </section>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { gsap } from 'gsap';
import CardTile from '../components/CardTile.vue';
import RarityBadge from '../components/RarityBadge.vue';
import UiModal from '../components/UiModal.vue';
import { account, api, updateProfile } from '../stores/account.js';
import { getCard } from '../stores/cards.js';
import { applyBalances, economy, loadMine, RARITY_LABELS } from '../stores/economy.js';
import { settings } from '../stores/settings.js';
import { sfx } from '../stores/audio.js';
import { toast } from '../composables/toast.js';

const enabled = ref(false);
const products = ref([]);
const busy = ref(false);
const odds = ref(null);
const reveal = ref(null);
const revealDone = ref(false);
const slotEls = ref([]);
const adultOpen = ref(false);
const pct = (p) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;

onMounted(async () => {
  try {
    const r = await api('GET', '/packs');
    enabled.value = r.enabled;
    products.value = r.products;
  } catch {
    enabled.value = false;
  }
});

async function showOdds(p) {
  try {
    odds.value = await api('GET', `/packs/${p.id}/odds`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function confirmAdult() {
  try {
    await updateProfile({ adultConfirmed: true });
    adultOpen.value = false;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Flips the cards one by one (instant with reduced motion). */
async function animate() {
  revealDone.value = false;
  await nextTick();
  const cards = reveal.value.cards;
  for (let i = 0; i < cards.length; i += 1) {
    const el = slotEls.value[i]?.querySelector('.pack-card__inner');
    if (!el || settings.reducedMotion) {
      cards[i].shown = true;
      continue;
    }
    await gsap.to(el, { rotationY: 90, duration: 0.18, ease: 'power2.in' });
    cards[i].shown = true;
    sfx(['rara', 'mitica', 'lendaria'].includes(cards[i].rarity) ? 'select' : 'tap');
    await gsap.fromTo(el, { rotationY: -90 }, { rotationY: 0, duration: 0.22, ease: 'power2.out' });
    if (['mitica', 'lendaria'].includes(cards[i].rarity)) gsap.fromTo(el, { filter: 'brightness(2.4)' }, { filter: 'brightness(1)', duration: 0.8 });
  }
  revealDone.value = true;
}

async function open(p) {
  busy.value = true;
  try {
    const r = await api('POST', `/packs/${p.id}/open`, { expectedPrice: p.price });
    applyBalances(r.balances);
    reveal.value = { name: p.name, pity: r.pity, cards: r.cards.map((c) => ({ ...c, shown: false })) };
    animate();
    loadMine().catch(() => {});
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pack-card__inner { transform-style: preserve-3d; }
</style>
