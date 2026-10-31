<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Cartas</h1>
      <input v-model="q" class="input min-w-[180px] flex-1" placeholder="Buscar por nome ou uid..." />
      <button class="btn btn-sm" @click="exportCsv">Exportar CSV</button>
      <label v-if="canEdit" class="btn btn-sm cursor-pointer">Importar CSV<input type="file" accept=".csv,text/csv" class="hidden" @change="importCsv" /></label>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 text-sm">
      <button v-for="r in RARITIES" :key="r" class="chip" :class="{ 'chip-on': fRarity.includes(r) }" @click="toggle(fRarity, r)">{{ RARITY_LABELS[r] }} ({{ countBy('rarity', r) }})</button>
      <span class="mx-1 h-5 w-px bg-white/15"></span>
      <button v-for="(label, a) in AVAILABILITY_LABELS" :key="a" class="chip" :class="{ 'chip-on': fAvail.includes(a) }" @click="toggle(fAvail, a)">{{ label }}</button>
      <span class="mx-1 h-5 w-px bg-white/15"></span>
      <button class="chip" :class="{ 'chip-on': fOwnPrice }" @click="fOwnPrice = !fOwnPrice">Preço próprio</button>
      <button class="chip" :class="{ 'chip-on': fCharacters }" @click="fCharacters = !fCharacters">Personagens</button>
      <button class="chip" :class="{ 'chip-on': fOrphan }" @click="fOrphan = !fOrphan">Órfãs</button>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="muted">{{ filtered.length }} cartas · {{ selected.size }} selecionadas</span>
      <button class="btn btn-sm" @click="selectFiltered">Selecionar filtradas</button>
      <button class="btn btn-sm" :disabled="!selected.size" @click="selected = new Set()">Limpar seleção</button>
      <button v-if="canEdit" class="btn btn-sm btn-primary" :disabled="!selected.size" @click="openBulk">Editar em massa</button>
    </div>

    <div class="panel-glass overflow-x-auto">
      <table class="w-full min-w-[900px] text-sm">
        <thead class="text-left text-xs muted">
          <tr class="border-b border-white/10">
            <th class="p-2"><input type="checkbox" :checked="allVisibleSelected" @change="toggleVisible" /></th>
            <th class="p-2">Carta</th><th class="p-2">Raridade</th><th class="p-2 text-right">Preço</th><th class="p-2 text-right">Revenda</th>
            <th class="p-2">Disponibilidade</th><th class="p-2 text-right">Estoque</th><th class="p-2 text-right">Donos</th><th class="p-2 text-right">7d</th><th class="p-2">Animação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in visible" :key="c.uid" class="cursor-pointer border-b border-white/5 hover:bg-white/5" @click="openEditor(c)">
            <td class="p-2" @click.stop><input type="checkbox" :checked="selected.has(c.uid)" @change="toggleOne(c.uid)" /></td>
            <td class="p-2">
              <div class="flex items-center gap-2">
                <img v-if="thumb(c)" :src="thumb(c)" alt="" class="h-10 w-7 rounded-sm object-cover" loading="lazy" />
                <div class="min-w-0"><div class="truncate font-semibold" :class="{ 'line-through muted': c.orphan }">{{ c.name }}</div><div class="truncate text-xs muted">{{ KIND_NAMES[c.kind] }}</div></div>
              </div>
            </td>
            <td class="p-2" :style="{ color: RARITY_COLORS[c.rarity] }">{{ RARITY_LABELS[c.rarity] }}</td>
            <td class="p-2 text-right font-mono" :class="c.price !== null ? 'text-amber' : ''">{{ c.effectivePrice }}</td>
            <td class="p-2 text-right font-mono" :class="c.sellPrice !== null ? 'text-amber' : 'muted'">{{ c.effectiveSellPrice }}</td>
            <td class="p-2">{{ AVAILABILITY_LABELS[c.availability] }}<span v-if="c.availableFrom || c.availableUntil" class="ml-1 text-xs text-amber" title="Com janela de venda">⏱</span></td>
            <td class="p-2 text-right font-mono">{{ c.stockTotal === null ? '∞' : `${c.stockSold}/${c.stockTotal}` }}</td>
            <td class="p-2 text-right font-mono">{{ c.owners }}</td>
            <td class="p-2 text-right font-mono">{{ c.sold7d }}</td>
            <td class="p-2 text-xs">{{ CONSENT_LABELS[c.animationConsent] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="visible.length < filtered.length" class="p-3 text-center"><button class="btn btn-sm" @click="limit += 100">Mostrar mais ({{ filtered.length - visible.length }})</button></div>
    </div>

    <!-- editor -->
    <UiModal :open="!!editing" :title="editing?.name" width="760px" @close="editing = null">
      <div v-if="editing" class="flex flex-col gap-4 md:flex-row">
        <div class="flex shrink-0 flex-col items-center gap-2 md:w-48">
          <CardTile v-if="getCard(editing.uid)" :card="getCard(editing.uid)" size="full" :tilt="false" class="w-full" />
          <div class="break-all text-center font-mono text-[10px] muted">{{ editing.uid }}</div>
        </div>
        <form class="grid flex-1 grid-cols-2 gap-3 text-sm" @submit.prevent="saveEditor">
          <label class="flex flex-col gap-1">Raridade
            <select v-model="form.rarity" class="input" :disabled="!canEdit"><option v-for="r in RARITIES" :key="r" :value="r">{{ RARITY_LABELS[r] }}</option></select>
          </label>
          <label class="flex flex-col gap-1">Disponibilidade
            <select v-model="form.availability" class="input" :disabled="!canEdit"><option v-for="(l, a) in AVAILABILITY_LABELS" :key="a" :value="a">{{ l }}</option></select>
          </label>
          <label class="flex flex-col gap-1">Preço (CR) <span class="text-xs muted">vazio = padrão da raridade ({{ defaultPrice(form.rarity) }})</span>
            <input v-model="form.price" type="number" min="0" class="input" :placeholder="String(defaultPrice(form.rarity))" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">Revenda (CR) <span class="text-xs muted">vazio = padrão ({{ defaultSell(form.rarity) }})</span>
            <input v-model="form.sellPrice" type="number" min="0" class="input" :placeholder="String(defaultSell(form.rarity))" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">À venda a partir de
            <input v-model="form.availableFrom" type="datetime-local" class="input" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">À venda até
            <input v-model="form.availableUntil" type="datetime-local" class="input" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">Estoque total <span class="text-xs muted">vazio = ilimitado · vendidas {{ editing.stockSold }}</span>
            <input v-model="form.stockTotal" type="number" :min="editing.stockSold" class="input" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">Limite por jogador <span class="text-xs muted">vazio = sem limite</span>
            <input v-model="form.perUserLimit" type="number" min="0" class="input" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">Posse máxima <span class="text-xs muted">vazio = regra do deck ({{ editing.kind === 0 ? 'livre' : 4 }})</span>
            <input v-model="form.maxOwned" type="number" min="0" class="input" :disabled="!canEdit" />
          </label>
          <label class="flex flex-col gap-1">Consentimento de animação
            <select v-model="form.animationConsent" class="input" :disabled="!canEdit"><option v-for="(l, k) in CONSENT_LABELS" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label class="col-span-2 flex items-center gap-2"><input v-model="form.tradeable" type="checkbox" :disabled="!canEdit" /> Pode ser trocada entre jogadores</label>
          <div class="col-span-2 flex flex-wrap justify-end gap-2">
            <span class="mr-auto self-center text-xs muted">{{ editing.owners }} donos · {{ editing.sold7d }} vendidas em 7 dias</span>
            <button type="button" class="btn" @click="editing = null">Fechar</button>
            <button v-if="canEdit" class="btn btn-primary" :disabled="saving">Salvar</button>
          </div>
        </form>
      </div>
      <div v-if="history.length" class="mt-4 border-t border-white/10 pt-3">
        <h3 class="subtitle text-sm font-bold">Histórico</h3>
        <ul class="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
          <li v-for="h in history" :key="h.id"><span class="muted">{{ fmtDate(h.createdAt) }} · {{ h.actor || 'sistema' }} ·</span> {{ describeChange(h) }}</li>
        </ul>
      </div>
    </UiModal>

    <UiModal :open="!!bigChange" title="Confirmar mudança de preço" @close="bigChange = null">
      <p>O preço passa de <strong>{{ bigChange?.from }} CR</strong> para <strong class="text-amber">{{ bigChange?.to }} CR</strong>, uma mudança de mais de 50%.</p>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn" @click="bigChange = null">Voltar</button>
        <button class="btn btn-primary" @click="confirmBigChange">Confirmar</button>
      </div>
    </UiModal>

    <!-- bulk -->
    <UiModal :open="bulkOpen" title="Editar em massa" width="640px" @close="bulkOpen = false">
      <p class="text-sm muted">{{ selected.size }} cartas selecionadas. Só os campos marcados mudam.</p>
      <div class="mt-3 grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
        <input v-model="bulk.useRarity" type="checkbox" /><label class="flex items-center gap-2">Raridade <select v-model="bulk.rarity" class="input"><option v-for="r in RARITIES" :key="r" :value="r">{{ RARITY_LABELS[r] }}</option></select></label>
        <input v-model="bulk.useAvailability" type="checkbox" /><label class="flex items-center gap-2">Disponibilidade <select v-model="bulk.availability" class="input"><option v-for="(l, a) in AVAILABILITY_LABELS" :key="a" :value="a">{{ l }}</option></select></label>
        <input v-model="bulk.usePrice" type="checkbox" /><label class="flex items-center gap-2">Preço fixo <input v-model="bulk.price" type="number" min="0" class="input w-28" placeholder="vazio = padrão" /></label>
        <input v-model="bulk.usePct" type="checkbox" /><label class="flex items-center gap-2">Reajuste <input v-model.number="bulk.pct" type="number" min="-90" max="1000" class="input w-24" /> % sobre o preço atual</label>
        <input v-model="bulk.useLimit" type="checkbox" /><label class="flex items-center gap-2">Limite por jogador <input v-model="bulk.limit" type="number" min="0" class="input w-24" placeholder="vazio = sem" /></label>
        <input v-model="bulk.useTradeable" type="checkbox" /><label class="flex items-center gap-2">Trocável <input v-model="bulk.tradeable" type="checkbox" /></label>
      </div>
      <div v-if="preview" class="mt-4 border-t border-white/10 pt-3">
        <div class="text-sm">{{ preview.changed }} carta(s) mudam:</div>
        <ul class="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
          <li v-for="p in preview.preview" :key="p.uid"><strong>{{ p.name }}</strong>: {{ Object.entries(p.changes).map(([f, v]) => `${f} ${v.before ?? 'padrão'} → ${v.after ?? 'padrão'}`).join(' · ') }}</li>
        </ul>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn" @click="bulkOpen = false">Cancelar</button>
        <button class="btn" :disabled="saving || !bulkPayload" @click="runBulk(true)">Pré-visualizar</button>
        <button class="btn btn-primary" :disabled="saving || !preview || !preview.changed" @click="runBulk(false)">Aplicar</button>
      </div>
    </UiModal>

    <!-- CSV import preview -->
    <UiModal :open="!!csvPreview" title="Importar CSV" width="640px" @close="csvPreview = null">
      <template v-if="csvPreview">
        <p class="text-sm">{{ csvPreview.rows }} linha(s) lidas · {{ csvPreview.changed }} carta(s) mudam.</p>
        <ul class="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-xs">
          <li v-for="p in csvPreview.preview" :key="p.uid"><strong>{{ p.name }}</strong>: {{ Object.entries(p.changes).map(([f, v]) => `${f} ${v.before ?? 'padrão'} → ${v.after ?? 'padrão'}`).join(' · ') }}</li>
        </ul>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn" @click="csvPreview = null">Cancelar</button>
          <button class="btn btn-primary" :disabled="saving || !csvPreview.changed" @click="applyCsv">Aplicar importação</button>
        </div>
      </template>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import CardTile from '../../components/CardTile.vue';
import UiModal from '../../components/UiModal.vue';
import { KIND_NAMES } from '../../engine/cards.js';
import { account } from '../../stores/account.js';
import { getCard, imageUrl } from '../../stores/cards.js';
import { loadCatalog, RARITIES, RARITY_LABELS } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, AVAILABILITY_LABELS, CONSENT_LABELS, download, fmtDate, fromLocalInput, RARITY_COLORS, showError, toLocalInput } from './adminApi.js';

const canEdit = computed(() => ['admin', 'owner'].includes(account.user?.role));
const cards = ref([]);
const rarityDefaults = ref([]);
const q = ref('');
const fRarity = ref([]);
const fAvail = ref([]);
const fOwnPrice = ref(false);
const fCharacters = ref(false);
const fOrphan = ref(false);
const limit = ref(100);
const selected = ref(new Set());
const saving = ref(false);

async function load() {
  try {
    const [c, r] = await Promise.all([api('GET', '/admin/catalog'), api('GET', '/admin/rarity-defaults')]);
    cards.value = c.cards;
    rarityDefaults.value = r.rarities;
  } catch (err) {
    showError(err);
  }
}
onMounted(load);

const defaultPrice = (r) => rarityDefaults.value.find((x) => x.rarity === r)?.price ?? '';
const defaultSell = (r) => rarityDefaults.value.find((x) => x.rarity === r)?.sellPrice ?? '';
const thumb = (c) => imageUrl(getCard(c.uid), 'thumb');
const toggle = (list, v) => { const i = list.indexOf(v); if (i === -1) list.push(v); else list.splice(i, 1); };
const countBy = (field, value) => cards.value.filter((c) => c[field] === value && !c.orphan).length;
const isCharacter = (c) => c.kind === 1 || c.kind === 6 || c.animationConsent !== 'nao_se_aplica';

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return cards.value.filter((c) => {
    if (needle && !c.name.toLowerCase().includes(needle) && !c.uid.toLowerCase().includes(needle)) return false;
    if (fRarity.value.length && !fRarity.value.includes(c.rarity)) return false;
    if (fAvail.value.length && !fAvail.value.includes(c.availability)) return false;
    if (fOwnPrice.value && c.price === null) return false;
    if (fCharacters.value && !isCharacter(c)) return false;
    if (fOrphan.value !== c.orphan) return false;
    return true;
  });
});
const visible = computed(() => filtered.value.slice(0, limit.value));
watch([q, fRarity, fAvail, fOwnPrice, fCharacters, fOrphan], () => { limit.value = 100; }, { deep: true });

const allVisibleSelected = computed(() => visible.value.length > 0 && visible.value.every((c) => selected.value.has(c.uid)));
function toggleOne(uid) {
  const s = new Set(selected.value);
  if (s.has(uid)) s.delete(uid); else s.add(uid);
  selected.value = s;
}
function toggleVisible() {
  const s = new Set(selected.value);
  const on = !allVisibleSelected.value;
  for (const c of visible.value) if (on) s.add(c.uid); else s.delete(c.uid);
  selected.value = s;
}
const selectFiltered = () => { selected.value = new Set(filtered.value.map((c) => c.uid)); };

// ---------------------------------------------------------------- editor

const editing = ref(null);
const history = ref([]);
const form = reactive({});
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

async function openEditor(c) {
  editing.value = c;
  Object.assign(form, {
    rarity: c.rarity, availability: c.availability, price: c.price ?? '', sellPrice: c.sellPrice ?? '',
    availableFrom: toLocalInput(c.availableFrom), availableUntil: toLocalInput(c.availableUntil),
    stockTotal: c.stockTotal ?? '', perUserLimit: c.perUserLimit ?? '', maxOwned: c.maxOwned ?? '',
    animationConsent: c.animationConsent, tradeable: c.tradeable,
  });
  history.value = [];
  try {
    const r = await api('GET', `/admin/catalog/${encodeURIComponent(c.uid)}`);
    history.value = r.history;
  } catch (err) {
    showError(err);
  }
}

function describeChange(h) {
  const fields = Object.keys(h.after || {});
  return `${h.action.replace('catalog.', '')}: ${fields.map((f) => `${f} ${h.before?.[f] ?? 'padrão'} → ${h.after[f] ?? 'padrão'}`).join(' · ')}`;
}

async function saveEditor() {
  const c = editing.value;
  const next = {
    rarity: form.rarity, availability: form.availability, price: num(form.price), sellPrice: num(form.sellPrice),
    availableFrom: fromLocalInput(form.availableFrom), availableUntil: fromLocalInput(form.availableUntil),
    stockTotal: num(form.stockTotal), perUserLimit: num(form.perUserLimit), maxOwned: num(form.maxOwned),
    animationConsent: form.animationConsent, tradeable: form.tradeable,
  };
  const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== c[k]));
  if (!Object.keys(changes).length) { editing.value = null; return; }
  const newPrice = 'price' in changes || changes.rarity ? (next.price ?? defaultPrice(next.rarity)) : null;
  if (newPrice !== null && c.effectivePrice > 0 && Math.abs(newPrice - c.effectivePrice) / c.effectivePrice > 0.5) {
    bigChange.value = { from: c.effectivePrice, to: newPrice, changes };
    return;
  }
  await commitEditor(changes);
}

/** Price moves above 50% need a second click (04-admin §4.1). */
const bigChange = ref(null);
async function confirmBigChange() {
  const { changes } = bigChange.value;
  bigChange.value = null;
  await commitEditor(changes);
}

async function commitEditor(changes) {
  const c = editing.value;
  saving.value = true;
  try {
    const r = await api('PATCH', `/admin/catalog/${encodeURIComponent(c.uid)}`, changes, { headers: { 'If-Match': String(c.updatedAt) } });
    const i = cards.value.findIndex((x) => x.uid === c.uid);
    if (i !== -1) cards.value[i] = r.card;
    toast('Carta salva.', 'ok');
    editing.value = null;
    loadCatalog().catch(() => {});
  } catch (err) {
    showError(err);
    if (err.code === 'edit_conflict') load();
  } finally {
    saving.value = false;
  }
}

// ------------------------------------------------------------------ bulk

const bulkOpen = ref(false);
const preview = ref(null);
const bulk = reactive({});
function openBulk() {
  Object.assign(bulk, { useRarity: false, rarity: 'rara', useAvailability: false, availability: 'loja', usePrice: false, price: '', usePct: false, pct: 10, useLimit: false, limit: '', useTradeable: false, tradeable: true });
  preview.value = null;
  bulkOpen.value = true;
}
const bulkPayload = computed(() => {
  const changes = {};
  if (bulk.useRarity) changes.rarity = bulk.rarity;
  if (bulk.useAvailability) changes.availability = bulk.availability;
  if (bulk.usePrice) changes.price = num(bulk.price);
  if (bulk.useLimit) changes.perUserLimit = num(bulk.limit);
  if (bulk.useTradeable) changes.tradeable = bulk.tradeable;
  const body = { uids: [...selected.value], changes };
  if (bulk.usePct && !bulk.usePrice) body.pricePct = bulk.pct;
  return Object.keys(changes).length || body.pricePct !== undefined ? body : null;
});
watch(bulk, () => { preview.value = null; }, { deep: true });

async function runBulk(dryRun) {
  saving.value = true;
  try {
    const r = await api('POST', '/admin/catalog/bulk', { ...bulkPayload.value, dryRun });
    if (dryRun) preview.value = r;
    else {
      toast(`${r.changed} carta(s) atualizadas.`, 'ok');
      bulkOpen.value = false;
      await load();
      loadCatalog().catch(() => {});
    }
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}

// ------------------------------------------------------------------- CSV

const csvPreview = ref(null);
let csvText = '';
async function exportCsv() {
  try {
    download('mop-catalogo.csv', await api('GET', '/admin/catalog/export.csv', undefined, { text: true }), 'text/csv');
  } catch (err) {
    showError(err);
  }
}
async function importCsv(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  csvText = await file.text();
  try {
    csvPreview.value = await api('POST', '/admin/catalog/import', { csv: csvText, dryRun: true });
  } catch (err) {
    showError(err);
  }
}
async function applyCsv() {
  saving.value = true;
  try {
    const r = await api('POST', '/admin/catalog/import', { csv: csvText });
    toast(`${r.changed} carta(s) atualizadas pelo CSV.`, 'ok');
    csvPreview.value = null;
    await load();
    loadCatalog().catch(() => {});
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}
</script>
