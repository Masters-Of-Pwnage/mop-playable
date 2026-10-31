<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Animações</h1>
      <button v-for="s in STATUSES" :key="s.id" class="chip" :class="{ 'chip-on': status === s.id }" @click="status = s.id">{{ s.label }} ({{ count(s.id) }})</button>
    </div>
    <p class="text-sm muted">Clipes enviados pelo pipeline (<code>scripts/anim/push.mjs</code>). Confira o loop sobre a carta real: rosto preservado, sem objetos novos, sem emenda. Só os aprovados aparecem no jogo, e só com a flag "Animações" ligada.</p>

    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(230px, 1fr))">
      <div v-for="a in shown" :key="a.id" class="panel-glass flex flex-col gap-2 p-3">
        <div class="relative">
          <CardTile v-if="getCard(a.uid)" :card="getCard(a.uid)" size="full" :tilt="false" class="w-full" />
          <div class="absolute overflow-hidden" :style="box(a.crop)">
            <video :poster="a.files.poster" muted loop playsinline autoplay class="h-full w-full object-cover">
              <source :src="a.files.webm" type="video/webm" /><source :src="a.files.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 text-sm"><span class="truncate font-semibold">{{ a.name }}</span><span class="shrink-0 text-xs" :style="{ color: RARITY_COLORS[a.rarity] }">{{ RARITY_LABELS[a.rarity] }}</span></div>
        <div class="text-xs muted">
          {{ STATUS_LABELS[a.status] }} · {{ Math.round(a.files.bytes / 1024) }} KB · {{ fmtDate(a.createdAt) }}
          <span v-if="a.provenance?.modelo"> · {{ a.provenance.modelo }}</span><span v-if="a.provenance?.custo"> · {{ a.provenance.custo }} créditos</span>
        </div>
        <div v-if="a.consent !== 'concedido'" class="text-xs text-danger">Sem consentimento: não pode ser aprovada.</div>
        <div v-if="a.reason" class="text-xs text-amber">Motivo: {{ a.reason }}</div>
        <div v-if="canEdit" class="mt-auto flex flex-wrap gap-2">
          <button v-if="a.status !== 'aprovada'" class="btn btn-sm btn-primary" :disabled="busy || a.consent !== 'concedido'" @click="act(a, 'approve')">Aprovar</button>
          <button v-if="a.status === 'revisao'" class="btn btn-sm btn-danger" :disabled="busy" @click="rejecting = a">Rejeitar</button>
          <button v-if="a.status === 'aprovada'" class="btn btn-sm" :disabled="busy" @click="rejecting = a; archiving = true">Tirar do jogo</button>
        </div>
      </div>
    </div>
    <p v-if="!shown.length" class="text-sm muted">Nada aqui.</p>

    <UiModal :open="!!rejecting" :title="archiving ? 'Tirar animação do jogo' : 'Rejeitar animação'" @close="rejecting = null; archiving = false">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="act(rejecting, archiving ? 'archive' : 'reject', reason)">
        <label class="flex flex-col gap-1">Motivo <input v-model="reason" class="input" maxlength="300" placeholder="ex.: rosto mudou no meio do loop" /></label>
        <div class="flex justify-end gap-2"><button type="button" class="btn" @click="rejecting = null; archiving = false">Cancelar</button><button class="btn btn-danger" :disabled="busy">Confirmar</button></div>
      </form>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import CardTile from '../../components/CardTile.vue';
import UiModal from '../../components/UiModal.vue';
import { account } from '../../stores/account.js';
import { getCard } from '../../stores/cards.js';
import { loadCatalog, RARITY_LABELS } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, RARITY_COLORS, showError } from './adminApi.js';

const STATUSES = [{ id: 'revisao', label: 'Em revisão' }, { id: 'aprovada', label: 'Aprovadas' }, { id: 'rejeitada', label: 'Rejeitadas' }];
const STATUS_LABELS = { revisao: 'Em revisão', aprovada: 'Aprovada', rejeitada: 'Rejeitada', arquivada: 'Arquivada' };
const canEdit = computed(() => ['admin', 'owner'].includes(account.user?.role));
const list = ref([]);
const status = ref('revisao');
const busy = ref(false);
const rejecting = ref(null);
const archiving = ref(false);
const reason = ref('');

const count = (s) => list.value.filter((a) => a.status === s).length;
const shown = computed(() => list.value.filter((a) => a.status === status.value));
const box = (c) => ({ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%` });

async function load() {
  try {
    list.value = (await api('GET', '/admin/animations')).animations;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

async function act(a, action, why = '') {
  busy.value = true;
  try {
    await api('POST', `/admin/animations/${a.id}/${action}`, action === 'approve' ? undefined : { reason: why || undefined });
    toast({ approve: 'Animação aprovada: já aparece no jogo.', reject: 'Animação rejeitada.', archive: 'Animação retirada do jogo.' }[action], 'ok');
    rejecting.value = null;
    archiving.value = false;
    reason.value = '';
    await load();
    loadCatalog().catch(() => {});
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
