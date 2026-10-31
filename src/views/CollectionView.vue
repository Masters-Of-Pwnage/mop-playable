<template>
  <section class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-4 sm:px-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Coleção</h1>
      <input v-model="query" class="input min-w-[180px] flex-1" placeholder="Buscar carta pelo nome..." />
    </div>

    <div v-if="!account.user" class="panel-glass flex flex-wrap items-center gap-3 p-5">
      <span>Entre com sua conta para ver sua coleção.</span>
      <button v-if="account.enabled" class="btn btn-primary btn-sm" @click="login">Entrar com o Google</button>
    </div>

    <template v-else>
      <div class="panel-glass flex flex-wrap items-center gap-4 p-4 text-sm">
        <div><span class="font-mono text-2xl text-neon">{{ distinct }}</span> <span class="muted">de {{ cardsStore.cards.length }} cartas</span></div>
        <div><span class="font-mono text-2xl text-cyan">{{ copiesTotal }}</span> <span class="muted">cópias</span></div>
        <div class="h-2 min-w-[160px] flex-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-gradient-to-r from-neon to-cyan" :style="{ width: `${(distinct / (cardsStore.cards.length || 1)) * 100}%` }"></div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 text-sm">
        <button v-for="o in SHOW" :key="o.id" class="chip" :class="{ 'chip-on': show === o.id }" @click="show = o.id">{{ o.label }}</button>
        <span class="mx-1 h-5 w-px bg-white/15"></span>
        <button v-for="r in RARITIES" :key="r" class="chip" :class="{ 'chip-on': rarities.includes(r) }" @click="toggle(r)">{{ RARITY_LABELS[r] }}</button>
      </div>

      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
        <div v-for="card in visible" :key="card.uid" class="flex flex-col gap-1">
          <CardTile :card="card" :dim="!owned(card.uid)" class="cursor-pointer" @click="selected = card" />
          <div class="flex items-center justify-between text-xs">
            <RarityBadge :rarity="catalogFor(card.uid)?.rarity" short />
            <span class="font-mono" :class="owned(card.uid) ? 'text-neon' : 'muted'">×{{ owned(card.uid) }}</span>
          </div>
        </div>
      </div>
      <div v-if="visible.length < list.length" class="py-4 text-center">
        <button class="btn btn-sm" @click="limit += 60">Mostrar mais ({{ list.length - visible.length }})</button>
      </div>
    </template>

    <UiModal :open="!!selected" :title="selected?.name" width="560px" @close="selected = null">
      <div v-if="selected" class="flex flex-col gap-4 sm:flex-row">
        <CardTile :card="selected" size="full" :tilt="false" class="w-full max-w-[220px] self-center" />
        <div class="flex flex-1 flex-col gap-2 text-sm">
          <div class="flex items-center gap-2"><RarityBadge :rarity="entry?.rarity" /></div>
          <div>Você tem <strong class="text-neon">{{ owned(selected.uid) }}</strong> cópia(s).</div>
          <template v-if="excess(selected.uid) > 0 && entry && entry.availability !== 'evento' && entry.availability !== 'recompensa'">
            <div class="muted">{{ excess(selected.uid) }} cópia(s) além do que um deck usa. Venda por {{ entry.sellPrice }} CR cada.</div>
            <label class="flex items-center gap-2">
              <span>Vender</span>
              <input v-model.number="sellQty" type="number" min="1" :max="excess(selected.uid)" class="input w-20" />
            </label>
            <button class="btn btn-sm self-start" :disabled="busy || sellQty < 1 || sellQty > excess(selected.uid)" @click="confirmSell">Vender por {{ entry.sellPrice * (sellQty || 0) }} CR</button>
          </template>
          <div v-if="entry?.tradeable" class="flex items-center gap-2">
            <button class="btn btn-sm" @click="toggleWish">{{ wanted(selected.uid) ? '★ Na lista de desejos' : '☆ Quero (lista de desejos)' }}</button>
          </div>
          <RouterLink v-if="entry?.buyable" to="/loja" class="btn btn-sm mt-auto self-start">Comprar mais na loja</RouterLink>
        </div>
      </div>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import CardTile from '../components/CardTile.vue';
import RarityBadge from '../components/RarityBadge.vue';
import UiModal from '../components/UiModal.vue';
import { filterCards } from '../engine/cards.js';
import { account, login } from '../stores/account.js';
import { cardsStore } from '../stores/cards.js';
import { catalogFor, economy, excess, owned, RARITIES, RARITY_LABELS, sell, setWishlist, wanted } from '../stores/economy.js';
import { toast } from '../composables/toast.js';

const SHOW = [
  { id: 'all', label: 'Todas' },
  { id: 'mine', label: 'Tenho' },
  { id: 'missing', label: 'Faltam' },
  { id: 'extra', label: 'Excedentes' },
];
const query = ref('');
const show = ref('all');
const rarities = ref([]);
const limit = ref(60);
const selected = ref(null);
const sellQty = ref(1);
const busy = ref(false);

const toggle = (r) => {
  const i = rarities.value.indexOf(r);
  if (i === -1) rarities.value.push(r);
  else rarities.value.splice(i, 1);
};
const distinct = computed(() => Object.values(economy.collection).filter((n) => n > 0).length);
const copiesTotal = computed(() => Object.values(economy.collection).reduce((a, b) => a + b, 0));
const entry = computed(() => (selected.value ? catalogFor(selected.value.uid) : null));

const list = computed(() => filterCards(cardsStore.cards, { name: query.value }).filter((card) => {
  const n = owned(card.uid);
  if (show.value === 'mine' && !n) return false;
  if (show.value === 'missing' && n) return false;
  if (show.value === 'extra' && !excess(card.uid)) return false;
  if (rarities.value.length && !rarities.value.includes(catalogFor(card.uid)?.rarity)) return false;
  return true;
}));
const visible = computed(() => list.value.slice(0, limit.value));
watch([query, show, rarities], () => { limit.value = 60; }, { deep: true });
watch(selected, () => { sellQty.value = 1; });

async function toggleWish() {
  try {
    const uid = selected.value.uid;
    await setWishlist(uid, wanted(uid) ? 0 : Math.max(1, 4 - owned(uid)));
    toast(wanted(uid) ? 'Adicionada à lista de desejos.' : 'Removida da lista de desejos.', 'info');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function confirmSell() {
  busy.value = true;
  try {
    const r = await sell([{ uid: selected.value.uid, qty: sellQty.value }]);
    toast(`Vendido. Saldo: ${r.balances.CR} CR.`, 'ok');
    selected.value = null;
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    busy.value = false;
  }
}
</script>
