<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Pacotes</h1>
      <button v-if="canEdit" class="btn btn-sm btn-primary" @click="edit(null)">Novo pacote</button>
    </div>
    <p class="text-sm muted">A flag "Pacotes" está {{ flagOn ? 'ligada' : 'desligada' }} (Sistema). Cartas entram nos pacotes pelo campo "peso em pacote" do catálogo (via CSV, coluna packWeight); cartas com estoque limitado ficam de fora.
      Cartas por raridade nos pacotes: <span v-for="(n, r) in poolSizes" :key="r" class="mr-2 font-mono">{{ RARITY_LABELS[r] }} {{ n }}</span></p>
    <div class="grid gap-3 md:grid-cols-2">
      <div v-for="p in products" :key="p.id" class="panel-glass p-4 text-sm">
        <div class="flex items-center justify-between"><strong>{{ p.name }}</strong><span class="chip cursor-default text-xs">{{ p.active ? 'Ativo' : 'Inativo' }}</span></div>
        <div class="mt-1 muted">{{ p.cardsPerPack }} cartas · {{ p.price }} CR · versão {{ p.version }} · {{ p.opened }} abertos</div>
        <div v-for="(s, i) in p.odds" :key="i" class="mt-1 text-xs">{{ s.count }}×: {{ s.rarities.map((r) => `${RARITY_LABELS[r.rarity]} ${(r.p * 100).toFixed(1)}%`).join(' · ') || 'sem cartas elegíveis' }}</div>
        <button v-if="canEdit" class="btn btn-sm mt-2" @click="edit(p)">Editar</button>
      </div>
    </div>

    <UiModal :open="!!form" :title="form?.id ? 'Editar pacote' : 'Novo pacote'" width="680px" @close="form = null">
      <form v-if="form" class="flex flex-col gap-3 text-sm" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1">Nome <input v-model="form.name" class="input" required /></label>
          <label class="flex flex-col gap-1">Preço (CR) <input v-model.number="form.price" type="number" min="0" class="input" /></label>
          <label class="flex flex-col gap-1 sm:col-span-2">Descrição <input v-model="form.description" class="input" /></label>
          <label class="flex flex-col gap-1">Limite por dia <input v-model="form.dailyLimit" type="number" min="1" class="input" placeholder="vazio = sem limite" /></label>
          <label class="flex items-center gap-2"><input v-model="form.active" type="checkbox" /> Ativo</label>
        </div>
        <div>
          <div class="font-semibold">Posições (pesos por raridade)</div>
          <div v-for="(s, i) in form.slots" :key="i" class="mt-2 flex flex-wrap items-center gap-2 rounded border border-white/10 p-2">
            <input v-model.number="s.count" type="number" min="1" max="15" class="input w-16" title="Quantidade" />×
            <label v-for="r in RARITIES" :key="r" class="flex items-center gap-1 text-xs">{{ RARITY_LABELS[r] }}<input v-model.number="s.odds[r]" type="number" min="0" class="input w-20" /></label>
            <button type="button" class="btn btn-ghost btn-sm" @click="form.slots.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="btn btn-sm mt-2" @click="form.slots.push({ count: 1, odds: { comum: 1 } })">+ Posição</button>
        </div>
        <p class="text-xs muted">Mudar posições ou preço cria uma nova versão; as probabilidades ficam públicas para os jogadores.</p>
        <div class="flex justify-end gap-2"><button type="button" class="btn" @click="form = null">Cancelar</button><button class="btn btn-primary" :disabled="busy">Salvar</button></div>
      </form>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import UiModal from '../../components/UiModal.vue';
import { account } from '../../stores/account.js';
import { RARITIES, RARITY_LABELS } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, showError } from './adminApi.js';

const canEdit = computed(() => ['admin', 'owner'].includes(account.user?.role));
const products = ref([]);
const poolSizes = ref({});
const flagOn = ref(false);
const form = ref(null);
const busy = ref(false);

async function load() {
  try {
    const [p, f] = await Promise.all([api('GET', '/admin/packs'), api('GET', '/admin/flags')]);
    products.value = p.products;
    poolSizes.value = p.poolSizes;
    flagOn.value = f.flags.find((x) => x.name === 'packs')?.on || false;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

function edit(p) {
  form.value = p
    ? { id: p.id, name: p.name, description: p.description, price: p.price, dailyLimit: p.dailyLimit ?? '', active: p.active, slots: p.slots.map((s) => ({ count: s.count, odds: { ...s.odds } })) }
    : { id: null, name: '', description: '', price: 300, dailyLimit: '', active: false, slots: [{ count: 4, odds: { comum: 1 } }, { count: 1, odds: { incomum: 70, rara: 25, mitica: 4, lendaria: 1 } }] };
}

async function save() {
  const f = form.value;
  const body = {
    name: f.name.trim(), description: f.description.trim(), price: f.price, active: f.active,
    dailyLimit: f.dailyLimit === '' || f.dailyLimit === null ? null : Number(f.dailyLimit),
    slots: f.slots.map((s) => ({ count: s.count, odds: Object.fromEntries(Object.entries(s.odds).filter(([, w]) => Number(w) > 0).map(([r, w]) => [r, Number(w)])) })),
  };
  busy.value = true;
  try {
    await api(f.id ? 'PUT' : 'POST', f.id ? `/admin/packs/${f.id}` : '/admin/packs', body);
    toast('Pacote salvo.', 'ok');
    form.value = null;
    load();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
