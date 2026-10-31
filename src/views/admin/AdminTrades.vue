<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Trocas</h1>
      <button v-for="(l, s) in FILTERS" :key="s" class="chip" :class="{ 'chip-on': status === s }" @click="status = s; load()">{{ l }}</button>
    </div>
    <div v-for="t in trades" :key="t.id" class="panel-glass p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><strong>{{ t.from?.displayName }}</strong> → <strong>{{ t.to?.displayName }}</strong> <span class="muted">· {{ fmtDate(t.createdAt) }}</span></div>
        <span class="chip cursor-default text-xs">{{ STATUS[t.status] }}</span>
      </div>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        <div class="rounded border border-white/10 p-2"><div class="muted">{{ t.from?.displayName }} dá · ≈ {{ t.valueOffer }} CR</div><div v-if="t.offer.pwc" class="font-mono text-cyan">{{ t.offer.pwc }} PWC</div><div v-for="c in t.offer.cards" :key="c.uid">{{ c.qty }}× {{ getCard(c.uid)?.name || c.uid }}</div></div>
        <div class="rounded border border-white/10 p-2"><div class="muted">{{ t.to?.displayName }} dá · ≈ {{ t.valueRequest }} CR</div><div v-if="t.request.pwc" class="font-mono text-cyan">{{ t.request.pwc }} PWC</div><div v-for="c in t.request.cards" :key="c.uid">{{ c.qty }}× {{ getCard(c.uid)?.name || c.uid }}</div></div>
      </div>
      <div v-if="t.status === 'em_revisao'" class="mt-3 flex flex-wrap items-center gap-2">
        <input v-model="reasons[t.id]" class="input flex-1" placeholder="Motivo (obrigatório)" />
        <button class="btn btn-sm" :disabled="(reasons[t.id] || '').trim().length < 3" @click="review(t, 'reject')">Recusar</button>
        <button class="btn btn-sm btn-primary" :disabled="(reasons[t.id] || '').trim().length < 3" @click="review(t, 'approve')">Aprovar</button>
      </div>
      <div v-if="t.status === 'aceita' && t.txId" class="mt-2 text-xs muted">Transação #{{ t.txId }} — para desfazer, estorne no <RouterLink to="/admin/ledger" class="underline">ledger</RouterLink>.</div>
    </div>
    <p v-if="!trades.length" class="py-6 text-center text-sm muted">Nenhuma troca.</p>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { getCard } from '../../stores/cards.js';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, showError } from './adminApi.js';

const FILTERS = { em_revisao: 'Em revisão', aberta: 'Abertas', aceita: 'Concluídas', '': 'Todas' };
const STATUS = { aberta: 'Aberta', em_revisao: 'Em revisão', aceita: 'Concluída', recusada: 'Recusada', cancelada: 'Cancelada', expirada: 'Expirada', revertida: 'Estornada' };
const status = ref('em_revisao');
const trades = ref([]);
const reasons = reactive({});

async function load() {
  try {
    trades.value = (await api('GET', `/admin/trades${status.value ? `?status=${status.value}` : ''}`)).trades;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

async function review(t, action) {
  try {
    await api('POST', `/admin/trades/${t.id}/${action}`, { reason: reasons[t.id].trim() });
    toast(action === 'approve' ? 'Troca liberada para o destinatário.' : 'Troca recusada.', 'ok');
    load();
  } catch (err) {
    showError(err);
  }
}
</script>
