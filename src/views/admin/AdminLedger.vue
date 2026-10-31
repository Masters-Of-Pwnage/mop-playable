<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Ledger</h1>
      <input v-model="user" class="input w-40" placeholder="ID público" @keyup.enter="load()" />
      <select v-model="kind" class="input w-48" @change="load()">
        <option value="">Todos os tipos</option>
        <option v-for="(l, k) in KINDS" :key="k" :value="k">{{ l }}</option>
      </select>
      <button class="btn btn-sm" @click="load()">Filtrar</button>
    </div>

    <div class="panel-glass overflow-x-auto">
      <table class="w-full min-w-[720px] text-sm">
        <thead class="text-left text-xs muted"><tr class="border-b border-white/10"><th class="p-2">#</th><th class="p-2">Tipo</th><th class="p-2">Quem</th><th class="p-2">Resumo</th><th class="p-2">Quando</th></tr></thead>
        <tbody>
          <tr v-for="t in txs" :key="t.id" class="cursor-pointer border-b border-white/5 hover:bg-white/5" @click="open(t.id)">
            <td class="p-2 font-mono">{{ t.id }}</td>
            <td class="p-2">{{ KINDS[t.kind] || t.kind }}<span v-if="t.reverses" class="text-xs text-amber"> de #{{ t.reverses }}</span></td>
            <td class="p-2">{{ t.actor || '–' }}</td>
            <td class="p-2 text-xs muted">{{ summary(t) }}</td>
            <td class="p-2 text-xs">{{ fmtDate(t.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="next" class="p-3 text-center"><button class="btn btn-sm" @click="load(next)">Mais antigas</button></div>
    </div>

    <UiModal :open="!!detail" :title="detail ? `Transação #${detail.tx.id}` : ''" width="620px" @close="detail = null">
      <template v-if="detail">
        <div class="text-sm">{{ KINDS[detail.tx.kind] || detail.tx.kind }} · {{ fmtDate(detail.tx.createdAt) }}<span v-if="detail.tx.reason" class="muted"> · {{ detail.tx.reason }}</span></div>
        <div v-if="detail.tx.reversedBy" class="mt-1 text-sm text-amber">Estornada pela transação #{{ detail.tx.reversedBy }}.</div>
        <h3 class="subtitle mt-3 text-sm font-bold">Lançamentos</h3>
        <ul class="text-xs"><li v-for="(e, i) in detail.entries" :key="i" class="flex justify-between border-b border-white/5 py-1"><span>{{ e.owner }}</span><span class="font-mono" :class="e.amount >= 0 ? 'text-neon' : 'text-danger'">{{ e.amount > 0 ? '+' : '' }}{{ e.amount }} {{ e.currency }}</span></li></ul>
        <template v-if="detail.cards.length">
          <h3 class="subtitle mt-3 text-sm font-bold">Cartas</h3>
          <ul class="text-xs"><li v-for="(c, i) in detail.cards" :key="i" class="flex justify-between border-b border-white/5 py-1"><span>{{ c.publicId }} · {{ getCard(c.uid)?.name || c.uid }}</span><span class="font-mono">{{ c.delta > 0 ? '+' : '' }}{{ c.delta }}</span></li></ul>
        </template>
        <form v-if="canReverse" class="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3 text-sm" @submit.prevent="reverse">
          <label class="flex flex-col gap-1">Motivo do estorno <input v-model="reason" class="input" minlength="3" required /></label>
          <p class="text-xs text-amber">Ação sensível: pode pedir novo login no Google. O estorno falha se o jogador já gastou o valor ou as cartas.</p>
          <button class="btn btn-danger self-end" :disabled="busy">Estornar</button>
        </form>
      </template>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import UiModal from '../../components/UiModal.vue';
import { account } from '../../stores/account.js';
import { getCard } from '../../stores/cards.js';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, showError } from './adminApi.js';

const KINDS = { signup_grant: 'Kit inicial', daily: 'Bônus diário', shop_buy: 'Compra', shop_sell: 'Venda', admin_adjust: 'Ajuste manual', reversal: 'Estorno' };
const txs = ref([]);
const next = ref(null);
const user = ref('');
const kind = ref('');
const detail = ref(null);
const reason = ref('');
const busy = ref(false);
const canReverse = computed(() => ['admin', 'owner'].includes(account.user?.role) && detail.value && detail.value.tx.kind !== 'reversal' && !detail.value.tx.reversedBy);

function summary(t) {
  const m = t.meta || {};
  if (m.total !== undefined) return `${m.items?.length || 0} item(ns), ${m.total} CR`;
  if (m.amount !== undefined) return `${m.target}: ${m.amount} ${m.currency || ''}${m.cards?.length ? ` + ${m.cards.length} carta(s)` : ''}`;
  if (m.credits !== undefined) return `${m.credits} CR + ${m.cards} cartas`;
  if (m.day) return m.day;
  return t.reason || '';
}

async function load(before) {
  const params = new URLSearchParams();
  if (user.value.trim()) params.set('user', user.value.trim().toUpperCase());
  if (kind.value) params.set('kind', kind.value);
  if (before) params.set('before', before);
  try {
    const r = await api('GET', `/admin/ledger?${params}`);
    txs.value = before ? [...txs.value, ...r.transactions] : r.transactions;
    next.value = r.next;
  } catch (err) {
    showError(err);
  }
}
onMounted(() => load());

async function open(id) {
  reason.value = '';
  try {
    detail.value = await api('GET', `/admin/ledger/${id}`);
  } catch (err) {
    showError(err);
  }
}

async function reverse() {
  busy.value = true;
  try {
    const r = await api('POST', `/admin/ledger/${detail.value.tx.id}/reverse`, { reason: reason.value.trim() });
    toast(`Estornada pela transação #${r.tx}.`, 'ok');
    detail.value = null;
    load();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
