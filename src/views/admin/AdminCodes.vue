<template>
  <section class="flex flex-col gap-3">
    <h1 class="title text-2xl">> Códigos de resgate</h1>

    <form v-if="canEdit" class="panel-glass grid gap-3 p-4 text-sm sm:grid-cols-2" @submit.prevent="create">
      <label class="flex flex-col gap-1 sm:col-span-2">Nome do lote <input v-model="form.name" class="input" placeholder="ex.: BSides SP 2026 — estande" minlength="3" required /></label>
      <label class="flex flex-col gap-1">Quantidade de códigos <input v-model.number="form.count" type="number" min="1" max="1000" class="input" /></label>
      <label class="flex flex-col gap-1">Usos por código <span class="text-xs muted">cada conta usa só uma vez</span><input v-model.number="form.maxUses" type="number" min="1" class="input" /></label>
      <label class="flex flex-col gap-1">Expira em <input v-model="form.expires" type="datetime-local" class="input" /></label>
      <div class="flex gap-2">
        <label class="flex flex-1 flex-col gap-1">PwnCoins <input v-model.number="form.pwc" type="number" min="0" class="input" /></label>
        <label class="flex flex-1 flex-col gap-1">Créditos <input v-model.number="form.cr" type="number" min="0" class="input" /></label>
      </div>
      <label class="flex flex-col gap-1 sm:col-span-2">Cartas (opcional) <span class="text-xs muted">uma por linha: uid,quantidade</span><textarea v-model="form.cards" class="input h-16 font-mono text-xs"></textarea></label>
      <p class="text-xs text-amber sm:col-span-2">Os códigos aparecem uma única vez, logo depois de criar: o arquivo CSV é baixado na hora. Pode pedir novo login no Google.</p>
      <div class="sm:col-span-2"><button class="btn btn-primary" :disabled="busy">Gerar lote</button></div>
    </form>

    <div class="panel-glass overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="text-left text-xs muted"><tr class="border-b border-white/10"><th class="p-2">Lote</th><th class="p-2">Recompensa</th><th class="p-2">Uso</th><th class="p-2">Expira</th><th class="p-2">Estado</th><th></th></tr></thead>
        <tbody>
          <tr v-for="b in batches" :key="b.id" class="border-b border-white/5">
            <td class="p-2">{{ b.name }}<div class="text-xs muted">{{ b.creator }} · {{ fmtDate(b.createdAt) }}</div></td>
            <td class="p-2 text-xs">{{ rewardText(b.reward) }}</td>
            <td class="p-2 font-mono">{{ b.used }}/{{ b.codes * b.maxUses }}</td>
            <td class="p-2 text-xs">{{ fmtDate(b.expiresAt) }}</td>
            <td class="p-2">{{ b.disabledAt ? 'Desativado' : 'Ativo' }}</td>
            <td class="p-2 text-right"><button v-if="canEdit && !b.disabledAt" class="btn btn-sm btn-danger" @click="disabling = b">Desativar</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!batches.length" class="p-4 text-sm muted">Nenhum lote criado.</p>
    </div>

    <UiModal :open="!!disabling" :title="`Desativar ${disabling?.name}`" @close="disabling = null">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="disable">
        <p>Nenhum código deste lote poderá mais ser resgatado.</p>
        <label class="flex flex-col gap-1">Motivo <input v-model="reason" class="input" minlength="3" required /></label>
        <div class="flex justify-end gap-2"><button type="button" class="btn" @click="disabling = null">Cancelar</button><button class="btn btn-danger">Desativar</button></div>
      </form>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import UiModal from '../../components/UiModal.vue';
import { account } from '../../stores/account.js';
import { getCard } from '../../stores/cards.js';
import { toast } from '../../composables/toast.js';
import { api, download, fmtDate, fromLocalInput, showError } from './adminApi.js';

const canEdit = computed(() => ['admin', 'owner'].includes(account.user?.role));
const batches = ref([]);
const busy = ref(false);
const disabling = ref(null);
const reason = ref('');
const form = reactive({ name: '', count: 50, maxUses: 1, expires: '', pwc: 0, cr: 0, cards: '' });

const rewardText = (r) => [r.pwc && `${r.pwc} PWC`, r.cr && `${r.cr} CR`, ...(r.cards || []).map((c) => `${c.qty}× ${getCard(c.uid)?.name || c.uid}`)].filter(Boolean).join(' + ');

async function load() {
  try {
    batches.value = (await api('GET', '/admin/codes')).batches;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

async function create() {
  const cards = form.cards.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [uid, qty] = l.split(',').map((x) => x.trim());
    return { uid, qty: Number(qty) || 1 };
  });
  busy.value = true;
  try {
    const r = await api('POST', '/admin/codes', {
      name: form.name.trim(), count: form.count, maxUses: form.maxUses, expiresAt: fromLocalInput(form.expires),
      reward: { ...(form.pwc ? { pwc: form.pwc } : {}), ...(form.cr ? { cr: form.cr } : {}), ...(cards.length ? { cards } : {}) },
    });
    download(`mop-codigos-${r.id}.csv`, `codigo\r\n${r.codes.join('\r\n')}\r\n`, 'text/csv');
    toast(`${r.codes.length} códigos gerados. Guarde o arquivo: eles não aparecem de novo.`, 'ok', 6000);
    form.name = '';
    load();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function disable() {
  try {
    await api('POST', `/admin/codes/${disabling.value.id}/disable`, { reason: reason.value.trim() });
    toast('Lote desativado.', 'ok');
    disabling.value = null;
    reason.value = '';
    load();
  } catch (err) {
    showError(err);
  }
}
</script>
