<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Auditoria</h1>
      <select v-model="action" class="input w-56" @change="load()">
        <option value="">Todas as ações</option>
        <option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option>
      </select>
      <button class="btn btn-sm" @click="exportJson">Exportar JSON</button>
    </div>
    <div class="panel-glass overflow-x-auto">
      <table class="w-full min-w-[760px] text-sm">
        <thead class="text-left text-xs muted"><tr class="border-b border-white/10"><th class="p-2">Quando</th><th class="p-2">Quem</th><th class="p-2">Ação</th><th class="p-2">Alvo</th><th class="p-2">Detalhe</th></tr></thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id" class="border-b border-white/5 align-top">
            <td class="whitespace-nowrap p-2 text-xs">{{ fmtDate(e.createdAt) }}</td>
            <td class="p-2">{{ e.actor || 'sistema' }}</td>
            <td class="p-2 font-mono text-xs">{{ e.action }}</td>
            <td class="p-2 font-mono text-xs">{{ e.target }}</td>
            <td class="p-2 text-xs muted">{{ detail(e) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="next" class="p-3 text-center"><button class="btn btn-sm" @click="load(next)">Mais antigas</button></div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api, download, fmtDate, showError } from './adminApi.js';

const ACTIONS = ['catalog', 'rarity', 'settings', 'flags', 'user.signup', 'user.suspend', 'user.ban', 'user.unban', 'user.adjust', 'user.role', 'user.trade_lock', 'user.revoke_sessions', 'user.delete', 'ledger.reverse', 'room.close', 'trade.approve', 'trade.reject', 'codes', 'packs'];
const entries = ref([]);
const next = ref(null);
const action = ref('');

function detail(e) {
  const parts = [];
  for (const [k, v] of Object.entries(e.after || {})) {
    const before = e.before?.[k];
    parts.push(before !== undefined ? `${k}: ${JSON.stringify(before)} → ${JSON.stringify(v)}` : `${k}: ${JSON.stringify(v)}`);
  }
  return parts.join(' · ');
}

async function load(before) {
  const params = new URLSearchParams();
  if (action.value) params.set('action', action.value);
  if (before) params.set('before', before);
  try {
    const r = await api('GET', `/admin/audit?${params}`);
    entries.value = before ? [...entries.value, ...r.entries] : r.entries;
    next.value = r.next;
  } catch (err) {
    showError(err);
  }
}
onMounted(() => load());
const exportJson = () => download('mop-auditoria.json', JSON.stringify(entries.value, null, 2), 'application/json');
</script>
