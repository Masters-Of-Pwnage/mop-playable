<template>
  <section class="flex flex-col gap-3">
    <h1 class="title text-2xl">> Sistema</h1>

    <div class="panel-glass p-4">
      <h2 class="subtitle font-bold">Saúde da economia</h2>
      <div v-if="health" class="mt-2 text-sm">
        <div v-if="!health.invariants.length" class="text-neon">✓ Invariantes I1–I5 em ordem (saldos, ledger, coleções e estoque batem).</div>
        <ul v-else class="text-danger"><li v-for="p in health.invariants" :key="p">✗ {{ p }}</li></ul>
        <div class="mt-3 grid gap-1 text-xs muted sm:grid-cols-2">
          <span>Banco: {{ health.dbBytes ? `${(health.dbBytes / 1024 / 1024).toFixed(2)} MB` : 'em memória' }}</span>
          <span>Node {{ health.node }} · no ar há {{ Math.round(health.uptimeSeconds / 60) }} min</span>
          <span>Versão: {{ health.version || 'não informada' }}</span>
          <span>Migrações: {{ health.migrations.map((m) => m.name).join(', ') }}</span>
        </div>
      </div>
    </div>

    <div class="panel-glass p-4">
      <h2 class="subtitle font-bold">Funcionalidades (flags)</h2>
      <p class="mt-1 text-xs muted">Valem na hora, sem reiniciar. "Pacotes" e "Pagamentos" dependem da validação jurídica e só o dono liga.</p>
      <ul class="mt-3 flex flex-col gap-2 text-sm">
        <li v-for="f in flags" :key="f.name" class="flex items-center justify-between gap-3 border-b border-white/5 pb-2">
          <div><div class="font-semibold">{{ FLAG_LABELS[f.name] || f.name }}</div><div class="text-xs muted">{{ f.runtime ? (f.ownerOnly ? 'só o dono altera' : 'alterável aqui') : 'definida na configuração do servidor' }}</div></div>
          <button class="btn btn-sm" :class="f.on ? 'btn-primary' : ''" :disabled="!f.runtime || !canToggle(f) || busy" @click="toggle(f)">{{ f.on ? 'Ligada' : 'Desligada' }}</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { account } from '../../stores/account.js';
import { loadCatalog } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, showError } from './adminApi.js';

const FLAG_LABELS = { accounts: 'Contas (login Google)', shop: 'Loja', trades: 'Trocas', animations: 'Animações', packs: 'Pacotes aleatórios', payments: 'Pagamentos', leagues: 'Ligas', spectate: 'Modo espectador' };
const health = ref(null);
const flags = ref([]);
const busy = ref(false);
const canToggle = (f) => (f.ownerOnly ? account.user?.role === 'owner' : ['admin', 'owner'].includes(account.user?.role));

async function load() {
  try {
    const [h, f] = await Promise.all([api('GET', '/admin/health'), api('GET', '/admin/flags')]);
    health.value = h;
    flags.value = f.flags;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

async function toggle(f) {
  busy.value = true;
  try {
    await api('PUT', `/admin/flags/${f.name}`, { on: !f.on });
    f.on = !f.on;
    toast(`${FLAG_LABELS[f.name] || f.name}: ${f.on ? 'ligada' : 'desligada'}.`, 'ok');
    loadCatalog().catch(() => {});
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
