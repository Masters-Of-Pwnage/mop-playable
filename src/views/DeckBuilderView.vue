<template>
  <div class="relative flex flex-1 flex-col">
    <NeonBackdrop :src="bg" :tiny="bgTiny" :darken="0.72" :rain="0.05" />

    <div class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
      <!-- top bar -->
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="title mr-2 text-2xl">> Montar deck</h1>
        <input v-model="filters.name" class="input min-w-[180px] flex-1" placeholder="Buscar carta pelo nome..." />
        <button class="btn btn-sm" :class="{ 'chip-on': showFilters }" @click="showFilters = !showFilters">Filtros</button>
        <div class="flex gap-1 lg:hidden">
          <button class="btn btn-sm" :class="{ 'chip-on': tab === 'cards' }" @click="tab = 'cards'">Cartas</button>
          <button class="btn btn-sm" :class="{ 'chip-on': tab === 'deck' }" @click="tab = 'deck'">Deck {{ total }}/{{ MAX_CARDS }}</button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 gap-3">
        <!-- filters -->
        <Transition name="fade">
          <aside v-if="showFilters" class="panel-glass hidden w-64 shrink-0 self-start p-4 lg:block">
            <FilterPanel v-model="filters" :result-count="filtered.length" :total="cardsStore.cards.length" @clear="clearFilters" />
          </aside>
        </Transition>

        <!-- card grid -->
        <section v-show="tab === 'cards' || isWide" class="panel-glass flex min-h-0 flex-1 flex-col p-3">
          <div v-if="showFilters" class="mb-3 lg:hidden">
            <FilterPanel v-model="filters" :result-count="filtered.length" :total="cardsStore.cards.length" @clear="clearFilters" />
          </div>
          <div class="mb-2 flex items-center justify-between text-sm muted">
            <span>{{ filtered.length }} de {{ cardsStore.cards.length }} cartas</span>
            <span class="hidden sm:inline">Clique para ampliar · + adiciona · − remove</span>
          </div>
          <div ref="gridEl" class="min-h-0 flex-1 overflow-y-auto pr-1" style="max-height: calc(100vh - 190px)">
            <div v-if="cardsStore.loading" class="py-10 text-center muted">Carregando cartas...</div>
            <div v-else-if="cardsStore.error" class="py-10 text-center text-danger">{{ cardsStore.error }}</div>
            <div v-else-if="!filtered.length" class="py-10 text-center muted">Nenhuma carta encontrada. Ajuste os filtros.</div>
            <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
              <div v-for="card in visibleCards" :key="card.uid" class="group flex flex-col gap-1.5">
                <CardTile :card="card" :glow="copies(deck, card.uid) > 0" class="cursor-zoom-in" @click="zoom = card" @contextmenu.prevent="remove(card)" />
                <div class="flex items-center gap-1">
                  <button class="btn btn-sm w-10 flex-none px-0" :disabled="copies(deck, card.uid) === 0" aria-label="Remover" @click="remove(card)">−</button>
                  <div class="flex-1 text-center font-mono text-sm" :class="copies(deck, card.uid) ? 'text-neon' : 'muted'">
                    {{ copies(deck, card.uid) }}<span v-if="copyLimit(card) < MAX_CARDS">/{{ copyLimit(card) }}</span>
                  </div>
                  <button class="btn btn-sm btn-primary w-10 flex-none px-0" :disabled="copies(deck, card.uid) >= copyLimit(card) || total >= MAX_CARDS" aria-label="Adicionar" @click="add(card)">+</button>
                </div>
                <div class="truncate text-center text-xs muted">{{ card.name }}</div>
                <div v-if="economy.mineLoaded" class="text-center font-mono text-[11px]" :class="owned(card.uid) < copies(deck, card.uid) ? 'text-amber' : 'muted'">tenho {{ owned(card.uid) }}</div>
              </div>
            </div>
            <div v-if="visibleCards.length < filtered.length" class="py-4 text-center">
              <button class="btn btn-sm" @click="limit += 60">Mostrar mais ({{ filtered.length - visibleCards.length }})</button>
            </div>
          </div>
        </section>

        <!-- deck panel -->
        <aside v-show="tab === 'deck' || isWide" class="panel-glass flex w-full shrink-0 flex-col gap-3 p-4 lg:w-[360px]">
          <input v-model="deck.name" class="input" placeholder="Nome do deck" />
          <div class="flex gap-2">
            <input v-model="deck.author" class="input" placeholder="Autor" />
            <input v-model="deck.author_social" class="input" placeholder="@social" />
          </div>
          <div>
            <div class="flex items-center justify-between font-mono">
              <span class="text-cyan">{{ deck.name || 'Deck sem nome' }}</span>
              <span :class="total === MAX_CARDS ? 'text-neon' : ''">{{ total }}/{{ MAX_CARDS }}</span>
            </div>
            <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-neon to-cyan transition-all duration-300" :style="{ width: `${(total / MAX_CARDS) * 100}%` }"></div>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs muted">
              <span>{{ deckStats.lands }} terrenos · {{ deckStats.creatures }} criaturas · {{ deckStats.spells }} outras</span>
              <ManaPips :symbols="colorSymbols" style="--pip: 16px" />
            </div>
            <ManaCurve :curve="deckStats.curve" class="mt-2" />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto" style="max-height: 40vh">
            <TransitionGroup name="list" tag="div" class="relative flex flex-col gap-1">
              <template v-for="group in grouped" :key="group.kind">
                <div class="subtitle mt-1 text-sm font-bold">{{ group.label }} ({{ group.total }})</div>
                <div v-for="e in group.entries" :key="e.card.uid" class="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-white/5">
                  <button class="min-w-0 flex-1 truncate text-left text-sm hover:text-neon" @click="zoom = e.card">{{ e.amount }}× {{ e.card.name }}</button>
                  <ManaPips v-if="e.card.kind !== Kind.LAND && !e.card.cost.isEmpty" :symbols="e.card.cost.symbols()" style="--pip: 14px" />
                  <button class="btn btn-ghost btn-sm h-8 w-8 px-0" @click="remove(e.card)">−</button>
                  <button class="btn btn-ghost btn-sm h-8 w-8 px-0" @click="add(e.card)">+</button>
                </div>
              </template>
            </TransitionGroup>
            <p v-if="!deck.cards.length" class="py-6 text-center text-sm muted">Use + nas cartas para montar seu deck.</p>
          </div>
          <div v-if="economy.mineLoaded && deck.cards.length" class="rounded-lg border p-2 text-sm" :class="missing.missing ? 'border-amber/50' : 'border-neon/30'">
            <template v-if="missing.missing">
              <div class="text-amber">Faltam {{ missing.missing }} cópia(s) na sua coleção para jogar este deck no modo Coleção.</div>
              <button v-if="missing.items.length" class="btn btn-sm mt-2 w-full" :disabled="!economy.shopOpen" @click="buyOpen = true">Comprar o que falta ({{ missing.total }} CR)</button>
              <div v-if="missing.blocked.length" class="mt-1 text-xs muted">{{ missing.blocked.length }} carta(s) não estão à venda agora.</div>
            </template>
            <div v-else class="text-neon">Você tem todas as cartas deste deck.</div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button class="btn btn-sm" @click="newDeckConfirm">Novo</button>
            <button class="btn btn-sm" @click="openOpen = true">Abrir</button>
            <button class="btn btn-sm btn-primary" @click="save">Salvar</button>
            <button class="btn btn-sm" @click="importOpen = true">Importar</button>
            <button class="btn btn-sm" @click="exportDeck">Exportar</button>
            <button class="btn btn-sm" :disabled="!deck.cards.length" @click="printOpen = true">Imprimir</button>
          </div>
          <button class="btn btn-primary" :disabled="!!playProblem" :title="playProblem" @click="play">▶ Testar contra a IA</button>
        </aside>
      </div>
    </div>

    <!-- zoom -->
    <CardZoom :card="zoom" :extra="zoom ? `No deck: ${copies(deck, zoom.uid)}` : ''" @close="zoom = null">
      <template #actions>
        <button class="btn btn-primary" :disabled="copies(deck, zoom.uid) >= copyLimit(zoom) || total >= MAX_CARDS" @click="add(zoom)">+ Adicionar</button>
        <button class="btn btn-danger" :disabled="copies(deck, zoom.uid) === 0" @click="remove(zoom)">− Remover</button>
      </template>
    </CardZoom>

    <!-- open deck -->
    <UiModal :open="openOpen" title="Abrir deck" @close="openOpen = false">
      <div class="flex flex-col gap-2">
        <div v-for="d in allDecks()" :key="d.id" class="flex items-center gap-2 rounded-lg border border-white/10 p-2 hover:border-cyan">
          <button class="min-w-0 flex-1 text-left" @click="openDeck(d)">
            <div class="font-semibold">{{ d.builtin ? '★ ' : '' }}{{ d.name }} <span class="text-xs muted">· {{ count(d) }} cartas</span></div>
            <div class="text-xs muted">{{ d.subtitle || (d.author ? `por ${d.author}` : 'seu deck') }}</div>
          </button>
          <button v-if="!d.builtin" class="btn btn-danger btn-sm" @click="removeDeck(d)">Excluir</button>
        </div>
        <p class="text-xs muted">★ = deck pré-construído (salvar cria uma cópia sua).</p>
      </div>
    </UiModal>

    <!-- import -->
    <UiModal :open="importOpen" title="Importar deck" @close="importOpen = false">
      <p class="mb-3 text-sm muted">Aceita o JSON exportado por este site ou pelo construtor antigo.</p>
      <input ref="fileEl" type="file" accept=".json,application/json" class="mb-3 block w-full text-sm" @change="onFile" />
      <textarea v-model="importText" class="input h-40 font-mono text-xs" placeholder='{"name": "...", "cards": [{"id": "...", "amount": 2}]}'></textarea>
      <p v-if="importError" class="mt-2 text-sm text-danger">{{ importError }}</p>
      <div class="mt-3 flex justify-end gap-2">
        <button class="btn" @click="importOpen = false">Cancelar</button>
        <button class="btn btn-primary" @click="doImport">Importar</button>
      </div>
    </UiModal>

    <PrintPreview :open="printOpen" :deck="deck" @close="printOpen = false" />

    <UiModal :open="buyOpen" title="Comprar o que falta" @close="buyOpen = false">
      <ul class="flex max-h-[40vh] flex-col gap-1 overflow-y-auto text-sm">
        <li v-for="i in missing.items" :key="i.uid" class="flex justify-between gap-2">
          <span class="truncate">{{ i.qty }}× {{ getCard(i.uid)?.name }}</span>
          <span class="shrink-0 font-mono muted">{{ catalogFor(i.uid).price * i.qty }} CR</span>
        </li>
      </ul>
      <div class="mt-3 font-mono">Total: {{ missing.total }} CR · saldo depois: <span :class="economy.balances.CR - missing.total < 0 ? 'text-danger' : 'text-neon'">{{ economy.balances.CR - missing.total }} CR</span></div>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn" @click="buyOpen = false">Cancelar</button>
        <button class="btn btn-primary" :disabled="buying || economy.balances.CR < missing.total" @click="buyMissing">Comprar</button>
      </div>
    </UiModal>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import NeonBackdrop from '../components/NeonBackdrop.vue';
import CardTile from '../components/CardTile.vue';
import CardZoom from '../components/CardZoom.vue';
import ManaPips from '../components/ManaPips.vue';
import ManaCurve from '../components/ManaCurve.vue';
import FilterPanel from '../components/FilterPanel.vue';
import UiModal from '../components/UiModal.vue';
import PrintPreview from '../components/PrintPreview.vue';
import bg from '../assets/art/deck.jpg';
import bgTiny from '../assets/art/deck-tiny.jpg';
import { cardsStore, getCard } from '../stores/cards.js';
import { Kind, KIND_NAMES, filterCards } from '../engine/cards.js';
import { COLORS } from '../engine/mana.js';
import {
  MAX_CARDS, addCard, allDecks, copies, copyLimit, count, deleteDeck, expand, findDeck, importJson, newDeck, normalize,
  problemsForPlay, removeCard, saveDeck, stats, toJson,
} from '../stores/decks.js';
import { settings } from '../stores/settings.js';
import { sfx } from '../stores/audio.js';
import { toast } from '../composables/toast.js';
import { session } from '../game/session.js';
import { buy, catalogFor, economy, owned, shortfall } from '../stores/economy.js';

const router = useRouter();
const deck = reactive(newDeck());
const filters = reactive({ name: '', description: '', costMin: '', costMax: '', types: [], manas: [] });
const showFilters = ref(window.innerWidth >= 1280);
const tab = ref('cards');
const isWide = ref(window.innerWidth >= 1024);
const limit = ref(60);
const zoom = ref(null);
const openOpen = ref(false);
const importOpen = ref(false);
const importText = ref('');
const importError = ref('');
const printOpen = ref(false);
const gridEl = ref(null);
const fileEl = ref(null);
let dirty = false;

const filtered = computed(() => filterCards(cardsStore.cards, filters));
const visibleCards = computed(() => filtered.value.slice(0, limit.value));
const total = computed(() => count(deck));
const deckStats = computed(() => stats(deck));
const colorSymbols = computed(() => COLORS.filter((c) => deckStats.value.colors[c]));
const playProblem = computed(() => problemsForPlay(deck));
const missing = computed(() => shortfall(deck));
const buyOpen = ref(false);
const buying = ref(false);

async function buyMissing() {
  buying.value = true;
  try {
    await buy(missing.value.items);
    toast('Cartas compradas. Este deck está completo na sua coleção.', 'ok');
    buyOpen.value = false;
  } catch (err) {
    toast(err.message, 'error', 4000);
  } finally {
    buying.value = false;
  }
}
const grouped = computed(() => {
  const order = [Kind.CREATURE, Kind.PLANESWALKER, Kind.INSTANT, Kind.SORCERY, Kind.ENCHANTMENT, Kind.ARTIFACT, Kind.OTHER, Kind.LAND];
  const groups = new Map();
  for (const e of deck.cards) {
    const card = getCard(e.uid);
    if (!card) continue;
    if (!groups.has(card.kind)) groups.set(card.kind, []);
    groups.get(card.kind).push({ card, amount: e.amount });
  }
  return order.filter((k) => groups.has(k)).map((k) => {
    const entries = groups.get(k).sort((a, b) => a.card.manaValue - b.card.manaValue || a.card.name.localeCompare(b.card.name));
    return { kind: k, label: KIND_NAMES[k], entries, total: entries.reduce((t, e) => t + e.amount, 0) };
  });
});

watch(filters, () => {
  limit.value = 60;
  if (gridEl.value) gridEl.value.scrollTop = 0;
}, { deep: true });
watch(() => [deck.name, deck.author, deck.author_social], () => { dirty = true; });

onMounted(() => {
  window.addEventListener('resize', () => { isWide.value = window.innerWidth >= 1024; });
  const last = settings.lastDeck && findDeck(settings.lastDeck);
  if (last && !last.builtin) setDeck(last);
});

function setDeck(d) {
  Object.assign(deck, JSON.parse(JSON.stringify(d)));
  dirty = false;
  nextTick(() => { dirty = false; }); // the name/author watcher fires after the assignment
}

function add(card) {
  const err = addCard(deck, card);
  if (err) {
    toast(err, 'warn');
    return;
  }
  sfx('tap', { pitch: 1.1 });
  dirty = true;
}

function remove(card) {
  if (!copies(deck, card.uid)) return;
  removeCard(deck, card.uid);
  sfx('tap', { pitch: 0.85 });
  dirty = true;
}

function clearFilters() {
  Object.assign(filters, { name: '', description: '', costMin: '', costMax: '', types: [], manas: [] });
}

function confirmDiscard() {
  if (!dirty || !deck.cards.length) return true;
  return window.confirm('O deck atual tem alterações não salvas. Descartar?');
}

function newDeckConfirm() {
  if (!confirmDiscard()) return;
  setDeck(newDeck());
  sfx('click');
}

function save() {
  const err = saveDeck(deck);
  if (err) {
    toast(err, 'warn');
    return;
  }
  settings.lastDeck = deck.id;
  dirty = false;
  toast(`Deck "${deck.name}" salvo.`, 'ok');
}

function openDeck(d) {
  if (!confirmDiscard()) return;
  setDeck(d);
  openOpen.value = false;
  sfx('select');
}

function removeDeck(d) {
  if (!window.confirm(`Excluir "${d.name}" permanentemente?`)) return;
  deleteDeck(d.id);
  if (deck.id === d.id) setDeck(newDeck());
  toast('Deck excluído.', 'info');
}

function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  file.text().then((text) => { importText.value = text; });
}

function doImport() {
  const res = importJson(importText.value);
  if (res.error) {
    importError.value = res.error;
    sfx('error');
    return;
  }
  if (!confirmDiscard()) return;
  setDeck(res.deck);
  dirty = true;
  importError.value = '';
  importOpen.value = false;
  importText.value = '';
  toast(`Deck importado: ${deck.name} (${count(deck)} cartas).`, 'ok');
}

function exportDeck() {
  if (!deck.cards.length) {
    toast('O deck está vazio.', 'warn');
    return;
  }
  const blob = new Blob([toJson(deck)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(deck.name || 'deck').toLowerCase().replace(/\s+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Deck exportado.', 'ok');
}

function play() {
  if (playProblem.value) return;
  sfx('select');
  session.pending = { mode: 'ai', deck: normalize(toJson(deck) && JSON.parse(toJson(deck))) };
  session.pending.deck.name = deck.name || 'Deck em teste';
  router.push('/game');
}

defineExpose({ deck, expand });
</script>
