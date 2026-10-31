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

    <div v-if="isOwner" class="panel-glass p-4">
      <h2 class="subtitle font-bold">Tokens de API (pipeline de animações)</h2>
      <p class="mt-1 text-xs muted">Usados por <code>scripts/anim/push.mjs</code> para enviar clipes para revisão. Escopo único: animations:write. O token aparece uma vez só.</p>
      <form class="mt-3 flex flex-wrap items-center gap-2 text-sm" @submit.prevent="createToken">
        <input v-model="tokenLabel" class="input w-48" placeholder="Nome (ex.: Mac do CleBeer)" minlength="2" required />
        <select v-model.number="tokenDays" class="input w-32"><option :value="7">7 dias</option><option :value="30">30 dias</option><option :value="90">90 dias</option></select>
        <button class="btn btn-sm" :disabled="busy">Criar token</button>
      </form>
      <div v-if="newToken" class="mt-3 rounded border border-amber/60 p-2 text-xs">
        <div class="text-amber">Copie agora — não será mostrado de novo:</div>
        <code class="mt-1 block select-all break-all font-mono">{{ newToken }}</code>
      </div>
      <ul class="mt-3 flex flex-col gap-1 text-xs">
        <li v-for="t in tokens" :key="t.id" class="flex items-center justify-between gap-2 border-b border-white/5 pb-1">
          <span>{{ t.label }} · {{ t.owner }} · expira {{ fmtDate(t.expiresAt) }}<span v-if="t.revokedAt" class="text-danger"> · revogado</span></span>
          <button v-if="!t.revokedAt" class="btn btn-sm btn-danger" @click="revokeToken(t)">Revogar</button>
        </li>
      </ul>
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
import { computed, onMounted, ref } from 'vue';
import { account } from '../../stores/account.js';
import { loadCatalog } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, showError } from './adminApi.js';

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

const isOwner = computed(() => account.user?.role === 'owner');
const tokens = ref([]);
const tokenLabel = ref('');
const tokenDays = ref(30);
const newToken = ref('');

async function loadTokens() {
  if (!isOwner.value) return;
  try {
    tokens.value = (await api('GET', '/admin/tokens')).tokens;
  } catch (err) {
    showError(err);
  }
}
onMounted(loadTokens);

async function createToken() {
  busy.value = true;
  try {
    newToken.value = (await api('POST', '/admin/tokens', { label: tokenLabel.value.trim(), days: tokenDays.value })).token;
    tokenLabel.value = '';
    loadTokens();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function revokeToken(t) {
  try {
    await api('DELETE', `/admin/tokens/${t.id}`);
    toast('Token revogado.', 'ok');
    loadTokens();
  } catch (err) {
    showError(err);
  }
}

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
