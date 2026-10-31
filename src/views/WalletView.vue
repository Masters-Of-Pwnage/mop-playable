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
          <div class="mt-1 text-xs muted">Vêm de eventos, códigos e trocas. Podem virar créditos.</div>
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <form class="panel-glass flex flex-col gap-2 p-5 text-sm" @submit.prevent="doConvert">
          <h2 class="subtitle text-lg font-bold">Converter PwnCoins</h2>
          <div class="muted">1 PWC = {{ economy.pwcToCr }} CR · só nesse sentido · hoje você ainda pode converter {{ economy.convertLeftToday }} PWC.</div>
          <div class="flex items-center gap-2">
            <input v-model.number="pwc" type="number" min="1" :max="maxConvert" class="input w-28" />
            <span class="font-mono">→ {{ (pwc || 0) * economy.pwcToCr }} CR</span>
          </div>
          <button class="btn btn-sm self-start" :disabled="busy || !(pwc >= 1 && pwc <= maxConvert)">Converter</button>
        </form>
        <form class="panel-glass flex flex-col gap-2 p-5 text-sm" @submit.prevent="doRedeem">
          <h2 class="subtitle text-lg font-bold">Resgatar código</h2>
          <div class="muted">Códigos distribuídos em eventos (H2HC, BSides...).</div>
          <input v-model="code" class="input font-mono uppercase tracking-[0.15em]" maxlength="20" placeholder="XXXX-XXXX-XXXX" autocomplete="off" />
          <button class="btn btn-sm self-start" :disabled="busy || code.replace(/[^A-Za-z0-9]/g, '').length !== 12">Resgatar</button>
        </form>
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
import { computed, ref, watch } from 'vue';
import { account, api, login } from '../stores/account.js';
import { getCard } from '../stores/cards.js';
import { convert, economy, redeem } from '../stores/economy.js';
import { toast } from '../composables/toast.js';

const KINDS = {
  signup_grant: 'Kit inicial de boas-vindas',
  daily: 'Bônus diário',
  shop_buy: 'Compra na loja',
  shop_sell: 'Venda de cartas',
  admin_adjust: 'Ajuste da administração',
  reversal: 'Estorno',
  convert: 'Conversão de PwnCoins',
  trade: 'Troca com outro jogador',
  redeem: 'Código resgatado',
  pack_open: 'Pacote aberto',
  match_reward: 'Recompensa de partida',
};
const pwc = ref(1);
const code = ref('');
const busy = ref(false);
const maxConvert = computed(() => Math.min(economy.balances.PWC, economy.convertLeftToday));

async function doConvert() {
  busy.value = true;
  try {
    const r = await convert(pwc.value);
    toast(`Convertido. Saldo: ${r.balances.CR} CR.`, 'ok');
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    busy.value = false;
  }
}

async function doRedeem() {
  busy.value = true;
  try {
    const r = await redeem(code.value);
    const parts = [r.reward.pwc && `${r.reward.pwc} PWC`, r.reward.cr && `${r.reward.cr} CR`, r.reward.cards?.length && `${r.reward.cards.reduce((n, c) => n + c.qty, 0)} carta(s)`].filter(Boolean);
    toast(`Código "${r.name}" resgatado: ${parts.join(' + ')}.`, 'ok', 5000);
    code.value = '';
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    busy.value = false;
  }
}

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
