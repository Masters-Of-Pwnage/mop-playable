<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Salas ao vivo</h1>
      <button class="btn btn-sm" @click="load">Atualizar</button>
    </div>
    <div class="panel-glass overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="text-left text-xs muted"><tr class="border-b border-white/10"><th class="p-2">Código</th><th class="p-2">Nome</th><th class="p-2">Jogadores</th><th class="p-2">Estado</th><th class="p-2">Criada</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rooms" :key="r.code" class="border-b border-white/5">
            <td class="p-2 font-mono">{{ r.code }}</td>
            <td class="p-2">{{ r.name }} <span class="text-xs muted">{{ r.visibility === 'private' ? '(particular)' : '' }}</span></td>
            <td class="p-2 text-xs"><span v-for="(s, i) in r.seats" :key="i" class="mr-2">{{ s ? `${s.name}${s.account ? ' ✓' : ''}${s.connected ? '' : ' (fora)'}` : '—' }}</span></td>
            <td class="p-2">{{ r.started ? 'Em partida' : 'Aguardando' }}</td>
            <td class="p-2 text-xs">{{ fmtDate(r.createdAt) }}</td>
            <td class="p-2 text-right"><button class="btn btn-sm btn-danger" @click="closing = r">Encerrar</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rooms.length" class="p-4 text-sm muted">Nenhuma sala aberta.</p>
    </div>
    <p class="text-xs muted">✓ = jogador com conta. As salas vivem na memória do servidor.</p>

    <UiModal :open="!!closing" :title="`Encerrar sala ${closing?.code}`" @close="closing = null">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="close">
        <p>Os jogadores voltam ao lobby e a partida termina.</p>
        <label class="flex flex-col gap-1">Motivo <input v-model="reason" class="input" minlength="3" required /></label>
        <div class="flex justify-end gap-2"><button type="button" class="btn" @click="closing = null">Cancelar</button><button class="btn btn-danger">Encerrar</button></div>
      </form>
    </UiModal>
  </section>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import UiModal from '../../components/UiModal.vue';
import { toast } from '../../composables/toast.js';
import { api, fmtDate, showError } from './adminApi.js';

const rooms = ref([]);
const closing = ref(null);
const reason = ref('');
async function load() {
  try {
    rooms.value = (await api('GET', '/admin/rooms')).rooms;
  } catch (err) {
    showError(err);
  }
}
let timer;
onMounted(() => { load(); timer = setInterval(load, 10_000); });
onUnmounted(() => clearInterval(timer));

async function close() {
  try {
    await api('POST', `/admin/rooms/${closing.value.code}/close`, { reason: reason.value.trim() });
    toast('Sala encerrada.', 'ok');
    closing.value = null;
    reason.value = '';
    load();
  } catch (err) {
    showError(err);
  }
}
</script>
