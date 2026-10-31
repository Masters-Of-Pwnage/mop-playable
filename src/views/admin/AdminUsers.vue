<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Jogadores</h1>
      <input v-model="q" class="input min-w-[200px] flex-1" placeholder="Apelido, e-mail ou ID público..." @keyup.enter="search" />
      <button class="btn btn-sm" @click="search">Buscar</button>
    </div>

    <div class="flex flex-col gap-3 lg:flex-row">
      <div class="panel-glass min-w-0 p-2 lg:w-[380px] lg:shrink-0">
        <button v-for="u in users" :key="u.publicId" class="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white/5" :class="{ 'bg-white/10': detail?.user.publicId === u.publicId }" @click="open(u.publicId)">
          <div class="min-w-0"><div class="truncate font-semibold">{{ u.displayName }}</div><div class="truncate text-xs muted">{{ u.email || u.publicId }}</div></div>
          <div class="shrink-0 text-right text-xs"><div>{{ ROLE_LABELS[u.role] }}</div><div :class="u.status === 'active' ? 'muted' : 'text-danger'">{{ STATUS[u.status] }}</div></div>
        </button>
        <p v-if="!users.length" class="p-3 text-sm muted">Nenhum jogador encontrado.</p>
      </div>

      <div v-if="detail" class="panel-glass min-w-0 flex-1 p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="text-xl font-bold">{{ detail.user.displayName }}</h2>
            <div class="text-xs muted">{{ detail.user.publicId }} · {{ detail.user.email || 'sem e-mail' }} · desde {{ fmtDate(detail.user.createdAt) }} · último login {{ fmtDate(detail.user.lastLoginAt) }}</div>
            <div class="mt-1 text-sm">{{ ROLE_LABELS[detail.user.role] }} · <span :class="detail.user.status === 'active' ? 'text-neon' : 'text-danger'">{{ STATUS[detail.user.status] }}</span>
              <span v-if="detail.user.suspendedUntil" class="text-xs muted"> até {{ fmtDate(detail.user.suspendedUntil) }}</span>
              <span v-if="detail.user.tradeLockedUntil" class="text-xs text-amber"> · trocas travadas até {{ fmtDate(detail.user.tradeLockedUntil) }}</span>
            </div>
          </div>
          <div class="text-right font-mono"><div class="text-neon">{{ detail.balances.CR }} CR</div><div class="text-cyan">{{ detail.balances.PWC }} PWC</div></div>
        </div>
        <div class="mt-3 flex flex-wrap gap-3 text-xs muted">
          <span>{{ detail.collection.distinctCards }} cartas ({{ detail.collection.copies }} cópias)</span>
          <span>{{ detail.decks }} decks</span><span>{{ detail.sessions }} sessões ativas</span>
        </div>

        <div v-if="detail.canAct || isOwner" class="mt-4 flex flex-wrap gap-2">
          <template v-if="detail.canAct">
            <button v-if="detail.user.status === 'active'" class="btn btn-sm" @click="openAction('suspend')">Suspender</button>
            <button v-if="detail.user.status !== 'banned'" class="btn btn-sm btn-danger" @click="openAction('ban')">Banir</button>
            <button v-if="detail.user.status !== 'active'" class="btn btn-sm" @click="openAction('unban')">Reativar</button>
            <button class="btn btn-sm" @click="openAction('trade-lock')">Travar trocas</button>
            <button class="btn btn-sm" @click="openAction('revoke')">Encerrar sessões</button>
          </template>
          <button v-if="canAdjust" class="btn btn-sm" @click="openAction('adjust')">Ajustar saldo/cartas</button>
          <button v-if="isOwner && detail.canAct" class="btn btn-sm" @click="openAction('role')">Mudar papel</button>
        </div>

        <h3 class="subtitle mt-5 text-sm font-bold">Extrato recente</h3>
        <ul class="mt-1 flex flex-col text-xs">
          <li v-for="l in detail.ledger" :key="`${l.id}-${l.currency}`" class="flex justify-between gap-2 border-b border-white/5 py-1">
            <span>#{{ l.id }} {{ l.kind }}<span v-if="l.reason" class="muted"> · {{ l.reason }}</span> <span class="muted">· {{ fmtDate(l.createdAt) }}</span></span>
            <span class="font-mono" :class="l.amount >= 0 ? 'text-neon' : 'text-danger'">{{ l.amount > 0 ? '+' : '' }}{{ l.amount }} {{ l.currency }}</span>
          </li>
        </ul>
        <h3 class="subtitle mt-4 text-sm font-bold">Ações administrativas</h3>
        <ul class="mt-1 flex flex-col text-xs">
          <li v-for="a in detail.audit" :key="a.id" class="border-b border-white/5 py-1">{{ fmtDate(a.createdAt) }} · {{ a.actor || 'sistema' }} · {{ a.action }}<span v-if="a.after?.reason" class="muted"> · {{ a.after.reason }}</span></li>
        </ul>
      </div>
    </div>

    <UiModal :open="!!action" :title="ACTION_TITLES[action]" @close="action = null">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="runAction">
        <label v-if="action === 'suspend'" class="flex flex-col gap-1">Suspender até <input v-model="form.until" type="datetime-local" class="input" required /></label>
        <label v-if="action === 'trade-lock'" class="flex flex-col gap-1">Travar trocas até <span class="text-xs muted">vazio = destravar</span><input v-model="form.until" type="datetime-local" class="input" /></label>
        <template v-if="action === 'adjust'">
          <div class="flex gap-2">
            <select v-model="form.currency" class="input w-28"><option>CR</option><option>PWC</option></select>
            <input v-model.number="form.amount" type="number" class="input" placeholder="+100 ou -50" />
          </div>
          <label class="flex flex-col gap-1">Cartas (opcional) <span class="text-xs muted">uma por linha: uid,quantidade (negativo remove)</span>
            <textarea v-model="form.cards" class="input h-20 font-mono text-xs" placeholder="c3b1...,1"></textarea>
          </label>
        </template>
        <label v-if="action === 'role'" class="flex flex-col gap-1">Novo papel
          <select v-model="form.role" class="input"><option v-for="(l, r) in ROLE_LABELS" :key="r" :value="r">{{ l }}</option></select>
        </label>
        <label v-if="action === 'ban'" class="flex flex-col gap-1">Digite o apelido para confirmar: <strong>{{ detail?.user.displayName }}</strong>
          <input v-model="form.confirm" class="input" autocomplete="off" />
        </label>
        <label class="flex flex-col gap-1">Motivo (fica registrado na auditoria)
          <input v-model="form.reason" class="input" minlength="3" maxlength="300" required />
        </label>
        <p v-if="action === 'adjust' || action === 'role'" class="text-xs text-amber">Ação sensível: se seu último login tiver mais de 15 minutos, o Google vai pedir que você entre de novo.</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" @click="action = null">Cancelar</button>
          <button class="btn btn-primary" :disabled="busy || (action === 'ban' && form.confirm !== detail?.user.displayName)">Confirmar</button>
        </div>
      </form>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import UiModal from '../../components/UiModal.vue';
import { account } from '../../stores/account.js';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, fromLocalInput, ROLE_LABELS, showError } from './adminApi.js';

const STATUS = { active: 'Ativa', suspended: 'Suspensa', banned: 'Banida', deleted: 'Excluída' };
const ACTION_TITLES = { suspend: 'Suspender conta', ban: 'Banir conta', unban: 'Reativar conta', 'trade-lock': 'Travar trocas', revoke: 'Encerrar sessões', adjust: 'Ajustar saldo e cartas', role: 'Mudar papel' };
const q = ref('');
const users = ref([]);
const detail = ref(null);
const action = ref(null);
const busy = ref(false);
const form = reactive({});
const isOwner = computed(() => account.user?.role === 'owner');
const canAdjust = computed(() => ['admin', 'owner'].includes(account.user?.role) && (detail.value?.canAct || (isOwner.value && detail.value?.user.publicId === account.user.publicId)));

async function search() {
  try {
    users.value = (await api('GET', `/admin/users?q=${encodeURIComponent(q.value.trim())}`)).users;
  } catch (err) {
    showError(err);
  }
}
onMounted(search);

async function open(publicId) {
  try {
    detail.value = await api('GET', `/admin/users/${publicId}`);
  } catch (err) {
    showError(err);
  }
}

function openAction(a) {
  Object.assign(form, { until: '', reason: '', currency: 'CR', amount: null, cards: '', role: detail.value.user.role, confirm: '' });
  action.value = a;
}

function parseCards(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [uid, qty] = l.split(',').map((x) => x.trim());
    return { uid, delta: Number(qty) };
  });
}

async function runAction() {
  const id = detail.value.user.publicId;
  const reason = form.reason.trim();
  busy.value = true;
  try {
    if (['suspend', 'ban', 'unban'].includes(action.value)) {
      await api('POST', `/admin/users/${id}/status`, { action: action.value, reason, ...(action.value === 'suspend' ? { until: fromLocalInput(form.until) } : {}) });
    } else if (action.value === 'trade-lock') {
      await api('POST', `/admin/users/${id}/trade-lock`, { until: fromLocalInput(form.until), reason });
    } else if (action.value === 'revoke') {
      await api('POST', `/admin/users/${id}/revoke-sessions`, { reason });
    } else if (action.value === 'adjust') {
      const cards = parseCards(form.cards);
      await api('POST', `/admin/users/${id}/adjust`, { ...(form.amount ? { currency: form.currency, amount: form.amount } : {}), ...(cards.length ? { cards } : {}), reason });
    } else if (action.value === 'role') {
      await api('POST', `/admin/users/${id}/role`, { role: form.role, reason });
    }
    toast('Feito.', 'ok');
    action.value = null;
    await Promise.all([open(id), search()]);
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
