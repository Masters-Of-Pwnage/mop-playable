<template>
  <section class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-4 sm:px-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Loja</h1>
      <input v-model="query" class="input min-w-[180px] flex-1" placeholder="Buscar carta pelo nome..." />
      <div v-if="account.user" class="font-mono text-neon">{{ economy.balances.CR }} CR</div>
    </div>

    <div v-if="!account.enabled" class="panel-glass p-5">A loja só existe na versão do jogo com contas.</div>
    <div v-else-if="!account.user" class="panel-glass flex flex-wrap items-center gap-3 p-5">
      <span>Entre com sua conta para comprar cartas com créditos.</span>
      <button class="btn btn-primary btn-sm" @click="login">Entrar com o Google</button>
    </div>
    <div v-else-if="economy.catalogLoaded && !economy.shopOpen" class="panel-glass p-5">A loja está fechada no momento.</div>

    <div class="flex flex-wrap items-center gap-1.5 text-sm">
      <button v-for="r in RARITIES" :key="r" class="chip" :class="{ 'chip-on': rarities.includes(r) }" @click="toggle(rarities, r)">
        {{ RARITY_LABELS[r] }} · {{ priceOf(r) }} CR
      </button>
      <span class="mx-1 h-5 w-px bg-white/15"></span>
      <button v-for="t in FILTER_TYPES" :key="t" class="chip" :class="{ 'chip-on': types.includes(t) }" @click="toggle(types, t)">{{ t }}</button>
      <span class="mx-1 h-5 w-px bg-white/15"></span>
      <button class="chip" :class="{ 'chip-on': notOwned }" @click="notOwned = !notOwned">Não tenho</button>
      <button class="chip" :class="{ 'chip-on': affordable }" @click="affordable = !affordable">Cabe no saldo</button>
    </div>

    <div class="text-sm muted">{{ list.length }} cartas à venda</div>
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
      <div v-for="card in visible" :key="card.uid" class="flex flex-col gap-1.5">
        <CardTile :card="card" class="cursor-pointer" @click="open(card)" />
        <div class="flex items-center justify-between gap-1 text-xs">
          <RarityBadge :rarity="catalogFor(card.uid)?.rarity" />
          <span class="font-mono" :class="canAfford(card) ? 'text-neon' : 'text-danger'">{{ catalogFor(card.uid)?.price }} CR</span>
        </div>
        <div class="flex items-center justify-between text-xs muted">
          <span class="truncate">{{ card.name }}</span>
          <span v-if="account.user" class="shrink-0 font-mono">tenho {{ owned(card.uid) }}</span>
        </div>
      </div>
    </div>
    <div v-if="visible.length < list.length" class="py-4 text-center">
      <button class="btn btn-sm" @click="limit += 60">Mostrar mais ({{ list.length - visible.length }})</button>
    </div>

    <UiModal :open="!!selected" :title="selected?.name" width="560px" @close="selected = null">
      <div v-if="selected" class="flex flex-col gap-4 sm:flex-row">
        <CardTile :card="selected" size="full" :tilt="false" class="w-full max-w-[220px] self-center" />
        <div class="flex flex-1 flex-col gap-2 text-sm">
          <div class="flex items-center gap-2"><RarityBadge :rarity="entry.rarity" /> <span class="font-mono text-neon">{{ entry.price }} CR</span></div>
          <div class="muted">Você tem {{ owned(selected.uid) }}<span v-if="entry.maxOwned !== null"> de no máximo {{ entry.maxOwned }}</span>.</div>
          <div v-if="entry.stockLeft !== null" class="text-amber">Restam {{ entry.stockLeft }} em estoque.</div>
          <div v-if="entry.availableUntil" class="text-amber">À venda até {{ new Date(entry.availableUntil).toLocaleString('pt-BR') }}.</div>
          <label class="mt-2 flex items-center gap-2">
            <span>Quantidade</span>
            <input v-model.number="qty" type="number" min="1" :max="maxQty" class="input w-20" />
          </label>
          <div class="font-mono">Total: {{ total }} CR · saldo depois: <span :class="after < 0 ? 'text-danger' : 'text-neon'">{{ after }} CR</span></div>
          <p v-if="reason && !convertNeeded" class="text-amber">{{ reason }}</p>
          <p v-if="convertNeeded" class="text-cyan">Faltam {{ -after }} CR: dá para converter {{ convertNeeded }} PWC ({{ convertNeeded * economy.pwcToCr }} CR) e comprar.</p>
          <div class="mt-auto flex justify-end gap-2">
            <button class="btn" @click="selected = null">Fechar</button>
            <button v-if="convertNeeded" class="btn btn-primary" :disabled="busy" @click="convertAndBuy">Converter {{ convertNeeded }} PWC e comprar</button>
            <button v-else class="btn btn-primary" :disabled="!!reason || busy" @click="confirmBuy">Comprar</button>
          </div>
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
import { FILTER_TYPES, filterCards } from '../engine/cards.js';
import { account, login } from '../stores/account.js';
import { cardsStore } from '../stores/cards.js';
import { buy, catalogFor, convert, economy, owned, pwcFor, RARITIES, RARITY_LABELS } from '../stores/economy.js';
import { toast } from '../composables/toast.js';
import { sfx } from '../stores/audio.js';

const query = ref('');
const rarities = ref([]);
const types = ref([]);
const notOwned = ref(false);
const affordable = ref(false);
const limit = ref(60);
const selected = ref(null);
const qty = ref(1);
const busy = ref(false);

const priceOf = (r) => economy.rarities.find((x) => x.rarity === r)?.price ?? '–';
const toggle = (list, v) => {
  sfx('tap');
  const i = list.indexOf(v);
  if (i === -1) list.push(v);
  else list.splice(i, 1);
};
const canAfford = (card) => !account.user || (catalogFor(card.uid)?.price ?? Infinity) <= economy.balances.CR;

const list = computed(() => filterCards(cardsStore.cards, { name: query.value, types: types.value }).filter((card) => {
  const e = catalogFor(card.uid);
  if (!e || !e.buyable) return false;
  if (rarities.value.length && !rarities.value.includes(e.rarity)) return false;
  if (notOwned.value && owned(card.uid) > 0) return false;
  if (affordable.value && e.price > economy.balances.CR) return false;
  return true;
}));
const visible = computed(() => list.value.slice(0, limit.value));
watch([query, rarities, types, notOwned, affordable], () => { limit.value = 60; }, { deep: true });

const entry = computed(() => (selected.value ? catalogFor(selected.value.uid) : null));
const maxQty = computed(() => {
  const e = entry.value;
  if (!e) return 1;
  let max = 60;
  if (e.maxOwned !== null) max = Math.min(max, e.maxOwned - owned(selected.value.uid));
  if (e.stockLeft !== null) max = Math.min(max, e.stockLeft);
  return Math.max(0, max);
});
const total = computed(() => (entry.value ? entry.value.price * (qty.value || 0) : 0));
const after = computed(() => economy.balances.CR - total.value);
const reason = computed(() => {
  if (!account.user) return 'Entre com sua conta para comprar.';
  if (!economy.shopOpen) return 'A loja está fechada.';
  if (maxQty.value === 0) return 'Você já tem o máximo de cópias desta carta.';
  if (!Number.isInteger(qty.value) || qty.value < 1 || qty.value > maxQty.value) return `Escolha de 1 a ${maxQty.value}.`;
  if (after.value < 0) return 'Saldo insuficiente.';
  return '';
});

// R5: when credits are short and coins cover it, convert exactly what is missing.
const convertNeeded = computed(() => (reason.value === 'Saldo insuficiente.' ? pwcFor(-after.value) : 0));

async function convertAndBuy() {
  busy.value = true;
  try {
    await convert(convertNeeded.value);
  } catch (err) {
    toast(err.message, 'error', 4000);
    busy.value = false;
    return;
  }
  busy.value = false;
  await confirmBuy();
}

function open(card) {
  sfx('click');
  selected.value = card;
  qty.value = 1;
}

async function confirmBuy() {
  busy.value = true;
  try {
    await buy([{ uid: selected.value.uid, qty: qty.value }]);
    sfx('select');
    toast(`${qty.value}× ${selected.value.name} na sua coleção.`, 'ok');
    selected.value = null;
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    busy.value = false;
  }
}
</script>
