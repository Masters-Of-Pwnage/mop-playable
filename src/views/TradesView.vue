<template>
  <section class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-3 py-4 sm:px-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="title mr-2 text-2xl">> Trocas</h1>
      <button v-for="t in TABS" :key="t.id" class="chip" :class="{ 'chip-on': tab === t.id }" @click="setTab(t.id)">{{ t.label }}<span v-if="t.id === 'in' && inbox.length"> ({{ inbox.length }})</span></button>
    </div>

    <div v-if="!account.user" class="panel-glass flex flex-wrap items-center gap-3 p-5">
      <span>Entre com sua conta para trocar cartas e PwnCoins com outros jogadores.</span>
      <button v-if="account.enabled" class="btn btn-primary btn-sm" @click="login">Entrar com o Google</button>
    </div>

    <template v-else>
      <div v-if="!enabled" class="panel-glass p-4 text-sm text-amber">As trocas estão desligadas no momento.</div>
      <div v-else-if="!canTrade" class="panel-glass p-4 text-sm text-amber">Sua conta ainda não pode propor nem aceitar trocas: é preciso ter a conta há alguns dias e algumas partidas concluídas no modo Coleção.</div>

      <!-- lists -->
      <div v-if="['in', 'out', 'history'].includes(tab)" class="flex flex-col gap-3">
        <div v-for="t in lists[tab]" :key="t.id" class="panel-glass p-4 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div><strong>{{ mine(t) ? `Para ${t.to.displayName}` : `De ${t.from.displayName}` }}</strong> <span class="muted">· {{ fmt(t.createdAt) }}</span></div>
            <span class="chip cursor-default text-xs">{{ STATUS[t.status] }}</span>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <TradeSide :title="'Você dá'" :side="mine(t) ? t.offer : t.request" :value="mine(t) ? t.valueOffer : t.valueRequest" tone="danger" />
            <TradeSide :title="'Você recebe'" :side="mine(t) ? t.request : t.offer" :value="mine(t) ? t.valueRequest : t.valueOffer" tone="neon" />
          </div>
          <div v-if="t.status === 'aberta' || t.status === 'em_revisao'" class="mt-3 flex flex-wrap items-center justify-end gap-2">
            <span class="mr-auto text-xs muted">{{ t.status === 'em_revisao' ? 'Aguardando revisão da moderação (valores muito diferentes).' : `Expira em ${fmt(t.expiresAt)}` }}</span>
            <template v-if="!mine(t) && t.status === 'aberta'">
              <button class="btn btn-sm" :disabled="busy" @click="act(t, 'decline')">Recusar</button>
              <button class="btn btn-sm btn-primary" :disabled="busy || !canTrade" @click="accepting = t">Aceitar</button>
            </template>
            <button v-if="mine(t)" class="btn btn-sm" :disabled="busy" @click="act(t, 'cancel')">Cancelar oferta</button>
          </div>
        </div>
        <p v-if="!lists[tab].length" class="py-6 text-center text-sm muted">Nada por aqui.</p>
      </div>

      <!-- new trade -->
      <div v-if="tab === 'new'" class="flex flex-col gap-3">
        <div class="panel-glass p-4 text-sm">
          <h2 class="subtitle font-bold">Com quem?</h2>
          <div class="mt-2 flex gap-2">
            <input v-model="query" class="input" placeholder="Apelido ou ID público (mín. 2 letras)" @keyup.enter="searchPlayers" />
            <button class="btn btn-sm" @click="searchPlayers">Buscar</button>
          </div>
          <div v-if="players.length" class="mt-2 flex flex-wrap gap-2">
            <button v-for="p in players" :key="p.publicId" class="chip" :class="{ 'chip-on': partner?.publicId === p.publicId }" @click="choose(p)">{{ p.displayName }}</button>
          </div>
          <div v-if="matches.length" class="mt-3">
            <div class="text-xs muted">Sugestões pela sua lista de desejos:</div>
            <div class="mt-1 flex flex-wrap gap-2">
              <button v-for="m in matches" :key="m.publicId" class="chip" :class="{ 'chip-on': partner?.publicId === m.publicId }" @click="choose(m)">
                {{ m.displayName }} · tem {{ m.theyHave.length }} · quer {{ m.theyWant.length }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="partner" class="grid gap-3 lg:grid-cols-2">
          <div class="panel-glass p-4 text-sm">
            <h2 class="subtitle font-bold">Você dá</h2>
            <label class="mt-2 flex items-center gap-2">PwnCoins <input v-model.number="offer.pwc" type="number" min="0" :max="economy.balances.PWC" class="input w-28" /> <span class="text-xs muted">de {{ economy.balances.PWC }}</span></label>
            <input v-model="myFilter" class="input mt-2" placeholder="Filtrar suas cartas..." />
            <CardPicker class="mt-2" :cards="myCards" :picked="offer.cards" @change="(c) => (offer.cards = c)" />
          </div>
          <div class="panel-glass p-4 text-sm">
            <h2 class="subtitle font-bold">Você recebe de {{ partner.displayName }}</h2>
            <label class="mt-2 flex items-center gap-2">PwnCoins <input v-model.number="request.pwc" type="number" min="0" class="input w-28" /></label>
            <p class="mt-2 text-xs muted">Cópias que {{ partner.displayName }} tem além do que um deck usa:</p>
            <CardPicker class="mt-2" :cards="theirCards" :picked="request.cards" @change="(c) => (request.cards = c)" />
          </div>
          <div class="panel-glass flex flex-wrap items-center gap-3 p-4 text-sm lg:col-span-2">
            <span>Valor estimado: você dá <strong class="font-mono text-danger">{{ sideValue(offer) }} CR</strong> · recebe <strong class="font-mono text-neon">{{ sideValue(request) }} CR</strong></span>
            <span class="text-xs muted">Taxa de 5% sobre PwnCoins. Ofertas muito desequilibradas passam por revisão.</span>
            <button class="btn btn-primary ml-auto" :disabled="busy || !canTrade || !enabled || empty" @click="propose">Enviar oferta</button>
          </div>
        </div>
      </div>

      <!-- wishlist -->
      <div v-if="tab === 'wish'" class="panel-glass p-4 text-sm">
        <p class="muted">Cartas que você procura. Aparecem nas sugestões de troca. Adicione pela sua <RouterLink to="/colecao" class="underline hover:text-neon">coleção</RouterLink>.</p>
        <ul class="mt-3 flex flex-col gap-1">
          <li v-for="(qty, uid) in economy.wishlist" :key="uid" class="flex items-center justify-between gap-2 border-b border-white/5 py-1">
            <span class="truncate">{{ getCard(uid)?.name || uid }}</span>
            <span class="flex items-center gap-2">
              <input :value="qty" type="number" min="1" max="60" class="input w-20" @change="setWishlist(uid, Number($event.target.value))" />
              <button class="btn btn-ghost btn-sm" @click="setWishlist(uid, 0)">Remover</button>
            </span>
          </li>
        </ul>
        <p v-if="!Object.keys(economy.wishlist).length" class="py-4 text-center muted">Sua lista de desejos está vazia.</p>
      </div>
    </template>

    <UiModal :open="!!accepting" title="Aceitar troca" @close="accepting = null">
      <template v-if="accepting">
        <div class="grid gap-3 text-sm sm:grid-cols-2">
          <TradeSide title="Você dá" :side="accepting.request" :value="accepting.valueRequest" tone="danger" />
          <TradeSide title="Você recebe" :side="accepting.offer" :value="accepting.valueOffer" tone="neon" />
        </div>
        <p class="mt-3 text-xs muted">A troca acontece de uma vez. Se algum dos dois não tiver mais os itens, ela é cancelada.</p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn" @click="accepting = null">Voltar</button>
          <button class="btn btn-primary" :disabled="busy" @click="accept">Confirmar troca</button>
        </div>
      </template>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue';
import UiModal from '../components/UiModal.vue';
import { account, api, login } from '../stores/account.js';
import { getCard } from '../stores/cards.js';
import { catalogFor, economy, loadMine, setWishlist, sideValue } from '../stores/economy.js';
import { toast } from '../composables/toast.js';

const TABS = [
  { id: 'in', label: 'Recebidas' },
  { id: 'out', label: 'Enviadas' },
  { id: 'history', label: 'Histórico' },
  { id: 'new', label: 'Nova troca' },
  { id: 'wish', label: 'Lista de desejos' },
];
const STATUS = { aberta: 'Aberta', em_revisao: 'Em revisão', aceita: 'Concluída', recusada: 'Recusada', cancelada: 'Cancelada', expirada: 'Expirada', revertida: 'Estornada' };
const fmt = (ms) => new Date(ms).toLocaleString('pt-BR');

/** One side of a trade: coins and cards, with its estimated value. */
const TradeSide = defineComponent({
  props: { title: String, side: Object, value: Number, tone: String },
  setup(props) {
    return () => h('div', { class: 'rounded-lg border border-white/10 p-3' }, [
      h('div', { class: 'flex justify-between' }, [h('span', { class: 'muted' }, props.title), h('span', { class: `font-mono text-${props.tone}` }, `≈ ${props.value} CR`)]),
      props.side.pwc ? h('div', { class: 'mt-1 font-mono text-cyan' }, `${props.side.pwc} PWC`) : null,
      ...props.side.cards.map((c) => h('div', { class: 'truncate' }, `${c.qty}× ${getCard(c.uid)?.name || c.uid}`)),
      !props.side.pwc && !props.side.cards.length ? h('div', { class: 'muted' }, 'nada') : null,
    ]);
  },
});

/** List of cards with quantity steppers (max = available copies). */
const CardPicker = defineComponent({
  props: { cards: Array, picked: Array },
  emits: ['change'],
  setup(props, { emit }) {
    const qtyOf = (uid) => props.picked.find((p) => p.uid === uid)?.qty || 0;
    const set = (uid, qty, max) => {
      const q = Math.max(0, Math.min(max, qty));
      const rest = props.picked.filter((p) => p.uid !== uid);
      emit('change', q ? [...rest, { uid, qty: q }] : rest);
    };
    return () => h('ul', { class: 'flex max-h-72 flex-col gap-1 overflow-y-auto' }, props.cards.length
      ? props.cards.map((c) => h('li', { class: 'flex items-center justify-between gap-2' }, [
        h('span', { class: 'truncate' }, `${getCard(c.uid)?.name || c.uid} `),
        h('span', { class: 'flex shrink-0 items-center gap-1 font-mono' }, [
          h('span', { class: 'text-xs muted' }, `${catalogFor(c.uid)?.price ?? '?'} CR · tem ${c.qty}`),
          h('button', { class: 'btn btn-sm h-8 w-8 px-0', type: 'button', onClick: () => set(c.uid, qtyOf(c.uid) - 1, c.qty) }, '−'),
          h('span', { class: 'w-6 text-center' }, String(qtyOf(c.uid))),
          h('button', { class: 'btn btn-sm h-8 w-8 px-0', type: 'button', onClick: () => set(c.uid, qtyOf(c.uid) + 1, c.qty) }, '+'),
        ]),
      ]))
      : [h('li', { class: 'muted' }, 'Nenhuma carta disponível.')]);
  },
});

const tab = ref('in');
const lists = reactive({ in: [], out: [], history: [] });
const inbox = computed(() => lists.in);
const enabled = ref(true);
const canTrade = ref(true);
const busy = ref(false);
const accepting = ref(null);
const mine = (t) => t.from?.publicId === account.user?.publicId;

async function load(box) {
  try {
    const r = await api('GET', `/trades?box=${box}`);
    lists[box] = r.trades;
    enabled.value = r.enabled;
    canTrade.value = r.canTrade;
  } catch (err) {
    toast(err.message, 'error');
  }
}
function setTab(id) {
  tab.value = id;
  if (lists[id]) load(id);
  if (id === 'new') loadMatches();
}
watch(() => account.user?.publicId, (id) => { if (id) load('in'); }, { immediate: true });

async function act(t, action) {
  busy.value = true;
  try {
    await api('POST', `/trades/${t.id}/${action}`);
    toast(action === 'decline' ? 'Troca recusada.' : 'Oferta cancelada.', 'info');
    load(tab.value);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy.value = false;
  }
}

async function accept() {
  busy.value = true;
  try {
    await api('POST', `/trades/${accepting.value.id}/accept`, { contentHash: accepting.value.contentHash });
    toast('Troca concluída!', 'ok');
    accepting.value = null;
    await Promise.all([load('in'), loadMine()]);
  } catch (err) {
    toast(err.message, 'error', 5000);
    load('in');
  } finally {
    busy.value = false;
  }
}

// ------------------------------------------------------------ new trade

const query = ref('');
const players = ref([]);
const matches = ref([]);
const partner = ref(null);
const theirSpare = ref([]);
const myFilter = ref('');
const offer = reactive({ pwc: 0, cards: [] });
const request = reactive({ pwc: 0, cards: [] });

async function loadMatches() {
  try {
    matches.value = (await api('GET', '/trades/matches')).matches;
  } catch { /* optional */ }
}
async function searchPlayers() {
  if (query.value.trim().length < 2) return;
  try {
    players.value = (await api('GET', `/players?q=${encodeURIComponent(query.value.trim())}`)).players;
  } catch (err) {
    toast(err.message, 'error');
  }
}
async function choose(p) {
  partner.value = p;
  Object.assign(offer, { pwc: 0, cards: [] });
  Object.assign(request, { pwc: 0, cards: [] });
  try {
    theirSpare.value = (await api('GET', `/players/${p.publicId}/spare`)).cards;
  } catch (err) {
    toast(err.message, 'error');
  }
}
const myCards = computed(() => {
  const f = myFilter.value.trim().toLowerCase();
  return Object.entries(economy.collection)
    .filter(([uid, qty]) => qty > 0 && catalogFor(uid)?.tradeable && (!f || (getCard(uid)?.name || '').toLowerCase().includes(f)))
    .map(([uid, qty]) => ({ uid, qty }))
    .sort((a, b) => (getCard(a.uid)?.name || '').localeCompare(getCard(b.uid)?.name || ''));
});
const theirCards = computed(() => theirSpare.value);
const empty = computed(() => !offer.pwc && !offer.cards.length && !request.pwc && !request.cards.length);

async function propose() {
  busy.value = true;
  try {
    const r = await api('POST', '/trades', { to: partner.value.publicId, offer: { pwc: offer.pwc || 0, cards: offer.cards }, request: { pwc: request.pwc || 0, cards: request.cards } });
    toast(r.trade.status === 'em_revisao' ? 'Oferta enviada para revisão da moderação.' : `Oferta enviada para ${partner.value.displayName}.`, 'ok', 4000);
    partner.value = null;
    setTab('out');
  } catch (err) {
    toast(err.message, 'error', 5000);
  } finally {
    busy.value = false;
  }
}

onMounted(() => { if (account.user) loadMatches(); });
</script>
