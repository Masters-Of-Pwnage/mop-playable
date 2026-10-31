<template>
  <div class="relative flex flex-1 flex-col">
    <NeonBackdrop :src="bg" :tiny="bgTiny" :darken="0.6" :rain="0.08" />
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 py-4 sm:px-6">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="title text-2xl sm:text-3xl">> Jogar online</h1>
        <span class="chip cursor-default text-xs" :class="statusClass">{{ statusText }}</span>
        <div class="ml-auto flex items-center gap-2">
          <input v-model="name" class="input w-44" maxlength="24" placeholder="Seu nome" @change="rename" />
        </div>
      </div>

      <p v-if="net.status === 'error'" class="panel-glass border-danger p-4 text-sm">
        {{ net.error }} Configure o endereço do servidor de salas abaixo ou rode <code class="font-mono text-neon">npm run server</code> localmente.
        <span class="mt-2 flex gap-2">
          <input v-model="serverUrl" class="input" placeholder="wss://seu-servidor/ws" />
          <button class="btn btn-sm" @click="saveServer">Conectar</button>
        </span>
      </p>

      <!-- inside a room -->
      <section v-if="net.room" class="panel-glass p-4 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="subtitle text-lg font-bold">{{ net.room.name }}</div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-sm muted">
              <span>{{ net.room.visibility === 'private' ? '🔒 Sala privada' : '🌐 Sala pública' }}</span>
              <span v-if="collection" class="chip cursor-default border-amber text-xs text-amber">Modo Coleção</span>
              <span>· código</span>
              <code class="rounded bg-black/50 px-2 py-0.5 font-mono text-base tracking-[0.25em] text-neon">{{ net.room.code }}</code>
              <button class="btn btn-ghost btn-sm" @click="copyLink">Copiar link</button>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" @click="leave">Sair da sala</button>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div v-for="seat in [0, 1]" :key="seat" class="panel flex flex-col gap-2 p-4" :class="{ 'border-neon': seat === net.seat }">
            <div class="flex items-center justify-between">
              <div class="font-mono text-sm muted">{{ seat === 0 ? 'HOST' : 'CONVIDADO' }}</div>
              <span v-if="net.room.players[seat]" class="text-xs" :class="net.room.players[seat].connected !== false && !(net.peerAway && seat !== net.seat) ? 'text-neon' : 'text-amber'">
                {{ net.peerAway && seat !== net.seat ? '⟳ reconectando' : '● online' }}
              </span>
            </div>
            <div class="text-xl font-bold">{{ net.room.players[seat]?.name || 'Aguardando jogador...' }}</div>
            <template v-if="seat === net.seat">
              <label class="text-sm muted">Seu deck{{ collection ? ' (da sua conta, só com cartas que você tem)' : '' }}</label>
              <select v-model="deckId" class="input">
                <option v-for="d in playable" :key="d.id" :value="d.id">{{ d.builtin ? '★ ' : '' }}{{ d.name }} ({{ count(d) }})</option>
              </select>
              <p v-if="collection && !playable.length" class="text-xs text-amber">Nenhum deck da sua conta está completo na sua coleção. Monte um no montador e compre o que falta.</p>
              <p v-if="collection && net.room.decks?.[seat]" class="text-xs text-neon">✓ Deck validado pelo servidor.</p>
              <div v-if="selectedDeck" class="flex items-center gap-2 text-xs muted">
                <ManaPips :symbols="deckColors(selectedDeck)" style="--pip: 16px" />
                <span>{{ deckSummary(selectedDeck) }}</span>
              </div>
            </template>
            <div v-else-if="net.room.players[seat]" class="text-sm muted">
              <template v-if="collection">{{ net.room.decks?.[seat] ? `✓ Deck: ${net.room.decks[seat].name} (${net.room.decks[seat].count} cartas)` : 'escolhendo o deck...' }}</template>
              <template v-else>{{ peerDeck ? `Deck: ${peerDeck.name} (${peerDeck.count} cartas)` : 'escolhendo o deck...' }}</template>
            </div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-3">
          <template v-if="net.seat === 0">
            <button class="btn btn-primary btn-lg" :disabled="!canStart" @click="start">▶ Iniciar partida</button>
            <span class="text-sm muted">{{ canStart ? 'Tudo pronto.' : (net.room.players[1] ? 'Aguardando o deck do convidado...' : 'Aguardando um oponente entrar...') }}</span>
          </template>
          <template v-else>
            <span class="pulse-neon rounded-lg border border-neon/40 px-4 py-2 text-sm">Aguardando o host iniciar a partida...</span>
          </template>
        </div>
      </section>

      <!-- lobby -->
      <template v-else>
        <div class="grid gap-4 lg:grid-cols-[1fr_360px]">
          <section class="panel-glass p-4 sm:p-6">
            <div class="flex items-center justify-between">
              <h2 class="subtitle text-lg font-bold">Salas públicas</h2>
              <button class="btn btn-ghost btn-sm" :disabled="!lobby.connected" @click="lobby.refresh()">Atualizar</button>
            </div>
            <TransitionGroup name="list" tag="div" class="relative mt-3 flex flex-col gap-2">
              <div v-for="r in net.rooms" :key="r.code" class="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3 transition-colors hover:border-neon">
                <div class="min-w-0 flex-1">
                  <div class="truncate font-semibold">{{ r.name }} <span v-if="r.mode === 'colecao'" class="text-xs text-amber">· Coleção</span></div>
                  <div class="text-xs muted">host: {{ r.host }} · {{ r.players }}/2 · {{ since(r.createdAt) }}</div>
                </div>
                <button class="btn btn-primary btn-sm" :disabled="!lobby.connected" @click="join(r.code)">Entrar</button>
              </div>
            </TransitionGroup>
            <p v-if="!net.rooms.length" class="mt-4 py-6 text-center text-sm muted">
              {{ lobby.connected ? 'Nenhuma sala pública aberta agora. Crie a sua!' : 'Conectando ao servidor...' }}
            </p>
          </section>

          <aside class="flex flex-col gap-4">
            <section class="panel-glass p-4">
              <h2 class="subtitle text-lg font-bold">Criar sala</h2>
              <input v-model="roomName" class="input mt-3" maxlength="32" placeholder="Nome da sala (opcional)" />
              <div class="mt-2 flex gap-2">
                <button class="chip flex-1" :class="{ 'chip-on': visibility === 'public' }" @click="visibility = 'public'">🌐 Pública</button>
                <button class="chip flex-1" :class="{ 'chip-on': visibility === 'private' }" @click="visibility = 'private'">🔒 Privada</button>
              </div>
              <p class="mt-2 text-xs muted">{{ visibility === 'public' ? 'Aparece na lista para qualquer jogador entrar.' : 'Só entra quem tiver o código ou o link.' }}</p>
              <div v-if="account.user" class="mt-3 flex gap-2">
                <button class="chip flex-1" :class="{ 'chip-on': mode === 'livre' }" @click="mode = 'livre'">Livre</button>
                <button class="chip flex-1" :class="{ 'chip-on': mode === 'colecao' }" @click="mode = 'colecao'">Coleção</button>
              </div>
              <p v-if="account.user" class="mt-2 text-xs muted">{{ mode === 'colecao' ? 'Os dois jogadores precisam de conta e jogam só com cartas que têm. Partidas rendem créditos.' : 'Qualquer deck, com todas as cartas liberadas.' }}</p>
              <button class="btn btn-primary mt-3 w-full" :disabled="!lobby.connected" @click="create">Criar sala</button>
            </section>
            <section class="panel-glass p-4">
              <h2 class="subtitle text-lg font-bold">Entrar com código</h2>
              <div class="mt-3 flex gap-2">
                <input v-model="joinCode" class="input font-mono uppercase tracking-[0.2em]" maxlength="6" placeholder="ABC123" @keyup.enter="join(joinCode)" />
                <button class="btn" :disabled="!lobby.connected || joinCode.length < 6" @click="join(joinCode)">Entrar</button>
              </div>
            </section>
            <section class="panel-glass p-4 text-sm">
              <h2 class="subtitle text-lg font-bold">Sem oponente?</h2>
              <p class="mt-1 muted">Treine contra a IA enquanto espera.</p>
              <button class="btn mt-3 w-full" @click="practice">Treinar contra a IA</button>
            </section>
          </aside>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NeonBackdrop from '../components/NeonBackdrop.vue';
import ManaPips from '../components/ManaPips.vue';
import bg from '../assets/art/lobby.jpg';
import bgTiny from '../assets/art/lobby-tiny.jpg';
import { connect, lobby, net } from '../net/client.js';
import { settings } from '../stores/settings.js';
import { allDecks, count, decksStore, expand, findDeck, problemsForPlay, stats } from '../stores/decks.js';
import { account } from '../stores/account.js';
import { shortfall } from '../stores/economy.js';
import { COLORS } from '../engine/mana.js';
import { sfx } from '../stores/audio.js';
import { toast } from '../composables/toast.js';
import { session } from '../game/session.js';

const props = defineProps({ code: { type: String, default: '' } });
const route = useRoute();
const router = useRouter();

const name = ref(settings.playerName);
const serverUrl = ref(settings.serverUrl);
const roomName = ref('');
const visibility = ref('public');
const joinCode = ref('');
const deckId = ref(settings.lastDeck);
const peerDeck = ref(null);
const mode = ref('livre');
const canonical = ref(null); // collection room, host: lists validated by the server
const collection = computed(() => net.room?.mode === 'colecao');
let unsubRoom = null;
let unsubRelay = null;

// Collection rooms only accept account decks that the collection covers (the server checks again).
const playable = computed(() => (collection.value
  ? (decksStore.mode === 'account' ? decksStore.mine : []).filter((d) => problemsForPlay(d) === '' && shortfall(d).missing === 0)
  : allDecks().filter((d) => problemsForPlay(d) === '')));
const selectedDeck = computed(() => playable.value.find((d) => d.id === deckId.value) || playable.value[0] || null);
const canStart = computed(() => (collection.value
  ? !!(net.room?.players[1] && canonical.value)
  : !!(net.room?.players[1] && peerDeck.value && selectedDeck.value)));
const statusText = computed(() => ({ online: 'conectado', connecting: 'conectando...', offline: 'desconectado', error: 'erro de conexão' }[net.status]));
const statusClass = computed(() => ({ online: 'border-neon text-neon', connecting: 'border-amber text-amber', offline: 'border-muted', error: 'border-danger text-danger' }[net.status]));

const deckColors = (d) => COLORS.filter((c) => stats(d).colors[c]);
const deckSummary = (d) => {
  const s = stats(d);
  return `${s.count} cartas · ${s.lands} terrenos · ${s.creatures} criaturas`;
};
const since = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? 'agora' : `há ${m} min`;
};

function shareDeck() {
  if (!net.room || !selectedDeck.value) return;
  const d = selectedDeck.value;
  if (collection.value) {
    lobby.deck(d.id); // validated by the server; no list goes through the relay
    return;
  }
  // Only the guest sends its list: the host builds the match. The host's list would let the guest
  // map the host's hidden cards (F-5), so the host only announces the deck name and size.
  lobby.relay({ k: 'deck', name: d.name, count: count(d), ...(net.seat === 1 ? { deck: expand(d) } : {}) });
}

watch(selectedDeck, (d) => {
  if (d) {
    settings.lastDeck = d.id;
    if (deckId.value !== d.id) deckId.value = d.id; // keep the <select> in sync with the fallback
  }
  shareDeck();
}, { immediate: true });

onMounted(async () => {
  await connect();
  unsubRoom = lobby.onRoom((msg) => {
    if (msg.type === 'decks') {
      canonical.value = { lists: msg.lists, names: msg.names };
      return;
    }
    if (msg.type === 'error' && msg.code === 'deck_invalid') {
      const p = (msg.problems || [])[0];
      const why = !p ? '' : p.reason === 'not_owned' ? `: você tem ${p.owned} de ${p.needed} "${p.name}"` : p.reason === 'too_few_cards' ? `: ${p.count} cartas (mínimo ${p.min})` : '';
      toast(`Deck recusado no modo Coleção${why}.`, 'error', 5000);
      return;
    }
    if (msg.type === 'joined' || msg.type === 'resumed') {
      peerDeck.value = null;
      canonical.value = null;
      if (msg.room) {
        sfx('join');
        if (route.params.code !== msg.room.code) router.replace(`/play/${msg.room.code}`);
        setTimeout(shareDeck, 200);
      }
    } else if (msg.type === 'peer_joined') {
      sfx('join');
      toast(`${msg.player.name} entrou na sala.`, 'ok');
      setTimeout(shareDeck, 200);
    } else if (msg.type === 'peer_left') {
      peerDeck.value = null;
      canonical.value = null;
      toast('O outro jogador saiu da sala.', 'warn');
    } else if (msg.type === 'room_closed') {
      peerDeck.value = null;
      toast('O host fechou a sala.', 'warn');
      router.replace('/play');
    } else if (msg.type === 'peer_back') {
      setTimeout(shareDeck, 200);
    } else if (msg.type === 'error') {
      toast(msg.message || msg.code, 'error');
    } else if (msg.type === 'left') {
      router.replace('/play');
    }
  });
  unsubRelay = lobby.onRelay((raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.k === 'deck') {
      peerDeck.value = { name: String(msg.name || 'deck').slice(0, 40), count: Number(msg.count) | 0, deck: Array.isArray(msg.deck) ? msg.deck.slice(0, 60) : [] };
    } else if (msg.k === 'start' && net.seat === 1) {
      beginMatch(msg);
    }
  });
  if (props.code && !net.room) {
    const waitOnline = setInterval(() => {
      if (lobby.connected) {
        clearInterval(waitOnline);
        if (!net.room) lobby.join(props.code);
      }
    }, 200);
    setTimeout(() => clearInterval(waitOnline), 15000);
  }
});

onBeforeUnmount(() => {
  unsubRoom?.();
  unsubRelay?.();
});

function rename() {
  const n = name.value.trim().slice(0, 24) || settings.playerName;
  settings.playerName = n;
  name.value = n;
  lobby.rename(n);
}

function saveServer() {
  settings.serverUrl = serverUrl.value.trim();
  connect();
}

function create() {
  sfx('select');
  lobby.create(roomName.value.trim(), visibility.value, account.user ? mode.value : 'livre');
}

function join(code) {
  sfx('select');
  lobby.join(String(code).trim().toUpperCase());
}

function leave() {
  sfx('click');
  lobby.leave();
  router.replace('/play');
}

function copyLink() {
  const url = `${location.origin}${location.pathname}#/play/${net.room.code}`;
  navigator.clipboard?.writeText(url).then(() => toast('Link copiado! Envie para o seu oponente.', 'ok'), () => toast(url, 'info', 6000));
}

function start() {
  if (!canStart.value) return;
  const me = selectedDeck.value;
  const players = collection.value
    ? [
      // The server's canonical lists, never what the browsers hold (RF-2.20).
      { name: net.room.players[0].name, deckName: canonical.value.names[0], deck: canonical.value.lists[0] },
      { name: net.room.players[1].name, deckName: canonical.value.names[1], deck: canonical.value.lists[1] },
    ]
    : [
      { name: settings.playerName, deckName: me.name, deck: expand(me) },
      { name: net.room.players[1].name, deckName: peerDeck.value.name, deck: peerDeck.value.deck },
    ];
  lobby.relay({ k: 'start', players: players.map(({ name, deckName }) => ({ name, deckName })) }); // no deck lists
  beginMatch({ players });
}

function beginMatch(msg) {
  sfx('turn');
  session.pending = { mode: 'online', players: msg.players, seat: net.seat, roomCode: net.room?.code, collection: collection.value };
  router.push('/game');
}

function practice() {
  sfx('select');
  session.pending = { mode: 'ai', deck: selectedDeck.value ? findDeck(selectedDeck.value.id) : null };
  router.push('/game');
}
</script>
