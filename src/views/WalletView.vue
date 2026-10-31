<template>
  <section class="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
    <h1 class="title text-3xl font-bold">Carteira</h1>

    <div v-if="!account.user" class="panel-glass mt-6 flex flex-wrap items-center gap-3 p-5">
      <span>Entre com sua conta para ver sua carteira.</span>
      <button v-if="account.enabled" class="btn btn-primary btn-sm" @click="login">Entrar com o Google</button>
    </div>

    <template v-else>
      <div class="mt-6 grid grid-cols-2 gap-3">
        <div class="panel-glass p-5">
          <div class="text-sm muted">Créditos</div>
          <div class="font-mono text-3xl text-neon">{{ economy.balances.CR }} <span class="text-base">CR</span></div>
          <div class="mt-1 text-xs muted">Para comprar cartas. Não são transferíveis.</div>
        </div>
        <div class="panel-glass p-5">
          <div class="text-sm muted">PwnCoins</div>
          <div class="font-mono text-3xl text-cyan">{{ economy.balances.PWC }} <span class="text-base">PWC</span></div>
          <div class="mt-1 text-xs muted">Vêm de eventos e trocas. Em breve: conversão em créditos.</div>
        </div>
      </div>

      <div class="panel-glass mt-4 p-5">
        <h2 class="subtitle text-lg font-bold">Extrato</h2>
        <ul class="mt-3 flex flex-col">
          <li v-for="e in entries" :key="`${e.tx}-${e.currency}`" class="flex items-start justify-between gap-3 border-b border-neon/10 py-2 text-sm">
            <div class="min-w-0">
              <div>{{ describe(e) }}</div>
              <div class="text-xs muted">{{ new Date(e.createdAt).toLocaleString('pt-BR') }}</div>
            </div>
            <div class="shrink-0 font-mono" :class="e.amount >= 0 ? 'text-neon' : 'text-danger'">{{ e.amount > 0 ? '+' : '' }}{{ e.amount }} {{ e.currency }}</div>
          </li>
        </ul>
        <p v-if="!entries.length && !loading" class="py-4 text-center text-sm muted">Nenhuma movimentação ainda.</p>
        <div v-if="next" class="mt-3 text-center">
          <button class="btn btn-sm" :disabled="loading" @click="more">Mais antigas</button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
import { account, api, login } from '../stores/account.js';
import { getCard } from '../stores/cards.js';
import { economy } from '../stores/economy.js';

const KINDS = {
  signup_grant: 'Kit inicial de boas-vindas',
  daily: 'Bônus diário',
  shop_buy: 'Compra na loja',
  shop_sell: 'Venda de cartas',
  admin_adjust: 'Ajuste da administração',
  reversal: 'Estorno',
};
const entries = ref([]);
const next = ref(null);
const loading = ref(false);

function describe(e) {
  const base = KINDS[e.kind] || e.kind;
  if (!e.cards.length) return base;
  const names = e.cards.slice(0, 3).map((c) => `${Math.abs(c.delta)}× ${getCard(c.uid)?.name || c.uid}`).join(', ');
  return `${base}: ${names}${e.cards.length > 3 ? ` e mais ${e.cards.length - 3}` : ''}`;
}

async function load(before) {
  loading.value = true;
  try {
    const r = await api('GET', `/me/ledger${before ? `?before=${before}` : ''}`);
    entries.value = before ? [...entries.value, ...r.entries] : r.entries;
    next.value = r.next;
  } finally {
    loading.value = false;
  }
}
const more = () => load(next.value);

watch(() => [account.user?.publicId, economy.balances.CR, economy.balances.PWC], ([id]) => { if (id) load(); }, { immediate: true });
</script>
