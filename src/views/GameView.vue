<template>
  <div class="relative flex h-screen flex-col overflow-hidden" ref="rootEl">
    <NeonBackdrop :src="playmat" :tiny="playmatTiny" :darken="0.15" :rain="0" />
    <div ref="shakeEl" class="flex min-h-0 flex-1 gap-1.5 p-1.5">
      <!-- board -->
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <PlayerBar ref="oppBarEl" :ps="oppPs" :active="st.active === opp && st.stage === Stage.PLAY" :editable="false" :top="true" :away="match.mode === 'online' && net.peerAway" @zone="onZone(opp, $event)" @life-click="lifeMenu(opp)" @life="(d) => submit({ t: 'life', p: opp, delta: d })" />
        <div ref="oppFieldEl" class="field relative flex-1" @click="deselect"><div ref="oppBackEl" class="absolute inset-x-1 top-1 h-[42%]"></div><div ref="oppFrontEl" class="absolute inset-x-1 bottom-1 h-[55%]"></div></div>

        <!-- center bar -->
        <div class="panel-glass flex flex-wrap items-center gap-1.5 px-2 py-1 sm:gap-2">
          <button class="btn btn-sm w-10 px-0" title="Menu" @click="openMenu">☰</button>
          <span class="font-mono text-sm" :class="st.active === seat ? 'text-neon' : 'text-amber'">{{ turnLabel }}</span>
          <div class="hidden items-center gap-1 lg:flex">
            <span v-for="ch in PHASE_CHIPS" :key="ch.label" class="rounded-full px-2 py-0.5 text-xs" :class="ch.phases.includes(st.phase) && st.stage === Stage.PLAY ? 'bg-neon/30 text-white' : 'bg-white/5 muted'">{{ ch.label }}</span>
          </div>
          <div v-if="st.stack.length" class="flex items-center gap-1">
            <span class="text-sm text-magenta">Pilha: {{ engine.displayName(engine.card(st.stack.at(-1))) }}</span>
            <button class="btn btn-sm btn-primary" @click="submit({ t: 'resolve', p: seat, iid: st.stack.at(-1) })">Resolver</button>
            <button class="btn btn-sm btn-danger" @click="submit({ t: 'counter', p: seat, iid: st.stack.at(-1) })">Anular</button>
          </div>
          <div class="flex-1"></div>
          <button v-if="buttons.tertiary" class="btn btn-sm" @click="centerAction('tertiary')">{{ buttons.tertiary }}</button>
          <button v-if="buttons.secondary" class="btn btn-sm" @click="centerAction('secondary')">{{ buttons.secondary }}</button>
          <button class="btn btn-sm btn-primary min-w-[150px]" :disabled="buttons.disabled" @click="centerAction('primary')">{{ buttons.primary }}</button>
        </div>

        <div ref="myFieldEl" class="field relative flex-[1.15]" @click="deselect"><div ref="myFrontEl" class="absolute inset-x-1 top-1 h-[55%]"></div><div ref="myBackEl" class="absolute inset-x-1 bottom-1 h-[42%]"></div></div>
        <PlayerBar ref="myBarEl" :ps="myPs" :active="st.active === seat && st.stage === Stage.PLAY" :editable="isLocal" @zone="onZone(seat, $event)" @life-click="lifeMenu(seat)" @life="(d) => submit({ t: 'life', p: seat, delta: d })" @pool-add="poolAdd" @pool-pip="(c) => submit({ t: 'pool', p: seat, color: c, delta: -1 })" @token="tokenPrompt" />
        <div ref="handEl" class="relative shrink-0" :style="{ height: handHeight + 'px' }"></div>
      </div>

      <!-- side panel -->
      <aside class="hidden w-[250px] shrink-0 flex-col gap-1.5 xl:flex">
        <div class="panel-glass p-2">
          <div class="mx-auto w-[220px]"><CardTile v-if="previewCard" :card="previewCard" size="full" :tilt="false" eager /><div v-else class="card-frame flex items-center justify-center p-4 text-center text-xs muted">Passe o mouse sobre uma carta. Botão direito amplia.</div></div>
          <div v-if="previewCard" class="mt-2 max-h-28 overflow-y-auto text-xs"><b class="text-neon">{{ previewCard.name }}</b><div class="muted">{{ previewCard.typeLine }}</div><div class="whitespace-pre-line">{{ previewCard.text }}</div></div>
        </div>
        <div class="panel-glass flex min-h-0 flex-1 flex-col p-2">
          <div ref="logEl" class="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-snug">
            <div v-for="(l, i) in logLines" :key="i" :class="l.chat ? 'text-cyan' : 'muted'">› {{ l.text }}</div>
          </div>
          <form v-if="match.mode === 'online'" class="mt-1 flex gap-1" @submit.prevent="sendChat">
            <input v-model="chatText" class="input h-8 text-xs" maxlength="200" placeholder="mensagem..." />
            <button class="btn btn-sm">➤</button>
          </form>
        </div>
      </aside>
    </div>

    <!-- card layer -->
    <div ref="layerEl" class="pointer-events-none absolute inset-0 z-20">
      <CardSprite
        v-for="sp in sprites" :key="sp.iid" :ref="(el) => registerSprite(sp.iid, el)"
        :ci="sp.ci" :card="sp.card" :engine="engine" :face-down="sp.faceDown" :z="sp.z" :glow="sp.glow" :glow-color="sp.glowColor" :dim="sp.dim"
        class="pointer-events-auto cursor-pointer"
        @pointerdown="onPointerDown($event, sp)" @pointerenter="hover = sp.iid; previewCard = sp.faceDown ? null : sp.card" @pointerleave="hover === sp.iid && (hover = -1)"
        @dblclick.prevent="onDouble(sp)" @contextmenu.prevent="onZoom(sp)"
      />
    </div>

    <!-- action bar -->
    <Transition name="pop">
      <div v-if="actionBar" class="panel-glass absolute z-40 flex flex-wrap gap-1 p-1.5" :style="{ left: actionBar.x + 'px', top: actionBar.y + 'px', maxWidth: '360px' }">
        <button v-for="a in actionBar.actions" :key="a.id" class="btn btn-sm" :class="a.style" @click="doAction(a.id, actionBar.iid)">{{ a.label }}</button>
        <button class="btn btn-sm" @click="onZoom(spriteOf(actionBar.iid))">🔍</button>
      </div>
    </Transition>

    <!-- fx -->
    <div class="pointer-events-none absolute inset-0 z-30">
      <TransitionGroup name="float">
        <div v-for="f in floats" :key="f.id" class="absolute font-mono text-3xl font-bold" :style="{ left: f.x + 'px', top: f.y + 'px', color: f.color, textShadow: '0 0 10px #000, 0 0 2px #000' }">{{ f.text }}</div>
      </TransitionGroup>
      <Transition name="banner">
        <div v-if="banner" class="absolute inset-x-0 top-1/2 -translate-y-1/2 border-y-2 bg-black/75 py-3 text-center" :style="{ borderColor: banner.color }">
          <div class="font-mono text-4xl font-bold tracking-widest" :style="{ color: banner.color, textShadow: `0 0 18px ${banner.color}` }">{{ banner.text }}</div>
          <div v-if="banner.sub" class="text-sm muted">{{ banner.sub }}</div>
        </div>
      </Transition>
      <div v-for="r in reminders" :key="r.id" class="panel-glass pointer-events-auto absolute bottom-[170px] left-3 flex w-[320px] cursor-pointer gap-2 p-2 text-xs" @click="reminderClick(r)">
        <CardTile :card="r.card" :tilt="false" class="w-12 shrink-0" />
        <div><b class="text-amber">Lembrete · {{ r.card.name }} {{ r.label }}</b><div class="line-clamp-4">{{ r.card.text }}</div></div>
      </div>
    </div>

    <!-- waiting / sync overlays -->
    <div v-if="match.status.waitingPeer" class="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div class="panel-glass p-6 text-center"><div class="subtitle text-xl">Aguardando o outro jogador...</div><button class="btn mt-4" @click="leave">Sair</button></div>
    </div>

    <!-- game over -->
    <Transition name="fade">
      <div v-if="gameOver" class="absolute inset-0 z-[60] flex items-center justify-center">
        <NeonBackdrop :src="gameOver.won ? victoryImg : defeatImg" :darken="0.3" :rain="0" />
        <div class="relative text-center">
          <div class="font-mono text-6xl font-bold tracking-widest" :style="{ color: gameOver.won ? '#3dff7a' : '#ff4d5e', textShadow: '0 0 30px currentColor' }">{{ gameOver.title }}</div>
          <div class="mt-2 muted">Turno {{ st.turn }} · {{ st.players[0].name }} {{ st.players[0].life }} × {{ st.players[1].life }} {{ st.players[1].name }}</div>
          <div class="mt-6 flex justify-center gap-3">
            <button v-if="match.mode !== 'online'" class="btn btn-primary btn-lg" @click="restart">Revanche</button>
            <button class="btn btn-lg" @click="leave">{{ match.mode === 'online' ? 'Voltar à sala' : 'Voltar' }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <PickCards v-bind="pick || {}" :open="!!pick" @resolve="resolvePick" />
    <GamePrompt :prompt="prompt" @resolve="resolvePrompt" />
    <CardZoom :card="zoomCard" :extra="zoomExtra" @close="zoomCard = null">
      <template #actions>
        <button v-for="a in zoomActions" :key="a.id" class="btn btn-sm" :class="a.style" @click="doAction(a.id, zoomIid); zoomCard = null">{{ a.label }}</button>
      </template>
    </CardZoom>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { gsap } from 'gsap';
import NeonBackdrop from '../components/NeonBackdrop.vue';
import CardTile from '../components/CardTile.vue';
import CardZoom from '../components/CardZoom.vue';
import PlayerBar from '../components/game/PlayerBar.vue';
import CardSprite from '../components/game/CardSprite.vue';
import PickCards from '../components/game/PickCards.vue';
import GamePrompt from '../components/game/GamePrompt.vue';
import playmat from '../assets/art/playmat.jpg';
import playmatTiny from '../assets/art/playmat-tiny.jpg';
import victoryImg from '../assets/art/victory.jpg';
import defeatImg from '../assets/art/defeat.jpg';
import { Match } from '../game/match.js';
import { session } from '../game/session.js';
import { computeLayout } from '../game/layout.js';
import { Zone, Phase, Stage, ZONE_NAMES, HAND_LIMIT, DISCARD } from '../engine/engine.js';
import { Kind } from '../engine/cards.js';
import { ANY, COLOR_HEX, ALL } from '../engine/mana.js';
import { getCard } from '../stores/cards.js';
import { allDecks, builtinDecks, count, expand, findDeck, problemsForPlay } from '../stores/decks.js';
import { settings } from '../stores/settings.js';
import { sfx, playMusic } from '../stores/audio.js';
import { toast } from '../composables/toast.js';
import { net, lobby } from '../net/client.js';

const router = useRouter();
const AI_NAMES = ['Z3r0C00l', 'AcidBurn', 'Phantom_Phreak', 'Crash0verride', 'ByteBandit', 'R00tKit', 'N3tRunn3r', 'Sh3llSh0ck'];
const PHASE_CHIPS = [
  { phases: [Phase.UPKEEP, Phase.UNTAP, Phase.DRAW], label: 'Início' }, { phases: [Phase.MAIN1], label: 'Principal 1' },
  { phases: [Phase.ATTACK, Phase.BLOCK, Phase.DAMAGE], label: 'Combate' }, { phases: [Phase.MAIN2], label: 'Principal 2' }, { phases: [Phase.END], label: 'Final' },
];

const match = new Match();
const engine = match.engine;
const seat = ref(0);
const opp = computed(() => 1 - seat.value);
const version = match.version;
const st = computed(() => (version.value, engine.state));
const myPs = computed(() => st.value.players[seat.value] || emptyPlayer());
const oppPs = computed(() => st.value.players[opp.value] || emptyPlayer());
const isLocal = computed(() => match.isLocal(seat.value));
const emptyPlayer = () => ({ name: '', life: 0, pool: {}, hand: [], library: [], graveyard: [], exile: [], battlefield: [] });

const rootEl = ref(null);
const shakeEl = ref(null);
const layerEl = ref(null);
const oppBarEl = ref(null);
const myBarEl = ref(null);
const oppFrontEl = ref(null);
const oppBackEl = ref(null);
const myFrontEl = ref(null);
const myBackEl = ref(null);
const handEl = ref(null);
const myFieldEl = ref(null);
const oppFieldEl = ref(null);
const logEl = ref(null);
const handHeight = ref(150);

const mode = ref('normal'); // normal | attack | block
const attackSel = ref(new Set());
const blocks = ref([]);
const pendingBlocker = ref(-1);
const selected = ref(-1);
const hover = ref(-1);
const previewCard = ref(null);
const actionBar = ref(null);
const sprites = shallowRef([]);
const floats = ref([]);
const banner = ref(null);
const reminders = ref([]);
const pick = ref(null);
const prompt = ref(null);
const zoomCard = ref(null);
const zoomIid = ref(-1);
const zoomActions = ref([]);
const zoomExtra = ref('');
const gameOver = ref(null);
const logLines = ref([]);
const chatText = ref('');
const spriteEls = new Map();
const origins = new Map();
const flashes = new Map();
const dying = new Set();
let pickResolve = null;
let promptResolve = null;
let seq = 0;
let unsubEvents = null;
let unsubRoom = null;
let collectionMatch = false; // online "Coleção" room: report the result for rewards
let lastBanner = -1;
let drag = null;
let layoutTimer = null;

// ---------------------------------------------------------------- setup

onMounted(() => {
  const cfg = session.pending;
  session.pending = null;
  if (!cfg) {
    router.replace('/');
    return;
  }
  playMusic('game');
  unsubEvents = match.onEvent(onEvent);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  const players = buildPlayers(cfg);
  if (!players) {
    toast('Nenhum deck jogável. Monte um deck primeiro.', 'warn', 4000);
    router.replace('/decks');
    return;
  }
  seat.value = cfg.mode === 'online' ? cfg.seat : 0;
  collectionMatch = cfg.mode === 'online' && !!cfg.collection;
  if (collectionMatch) {
    unsubRoom = lobby.onRoom((msg) => {
      if (msg.type !== 'match_result') return;
      if (msg.reward > 0) toast(`Partida registrada: +${msg.reward} créditos.`, 'ok', 5000);
      else if (msg.status === 'divergente') toast('Os resultados informados não bateram: partida sem recompensa.', 'warn', 5000);
      else if (msg.status === 'curta') toast('Partida curta demais para recompensa.', 'info', 4000);
      else toast('Partida registrada (limite diário de recompensas atingido).', 'info', 4000);
    });
  }
  match.start({ mode: cfg.mode, players, seat: seat.value, enforce: settings.enforceRules });
  scheduleLayout();
});

onBeforeUnmount(() => {
  unsubEvents?.();
  unsubRoom?.();
  match.dispose();
  window.removeEventListener('resize', scheduleLayout);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});

function buildPlayers(cfg) {
  if (cfg.mode === 'online') return cfg.players;
  const playable = allDecks().filter((d) => problemsForPlay(d) === '');
  let mine = cfg.deck && problemsForPlay(cfg.deck) === '' ? cfg.deck : (findDeck(settings.lastDeck));
  if (!mine || problemsForPlay(mine)) mine = playable[0];
  if (!mine) return null;
  const full = builtinDecks().filter((d) => count(d) >= 40);
  const pool = full.length ? full : builtinDecks().filter((d) => problemsForPlay(d) === '');
  const ai = pool[Math.floor(Math.random() * pool.length)] || mine;
  return [
    { name: settings.playerName, deckName: mine.name, deck: expand(mine) },
    { name: AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)], deckName: ai.name, deck: expand(ai), ai: true },
  ];
}

function restart() {
  session.pending = { mode: 'ai', deck: findDeck(settings.lastDeck) };
  gameOver.value = null;
  router.replace('/').then(() => router.replace('/game'));
}

function leave() {
  if (match.mode === 'online') router.push(net.room ? `/play/${net.room.code}` : '/play');
  else router.push('/');
}

// ---------------------------------------------------------------- events & fx

function onEvent(ev) {
  const s = engine.state;
  switch (ev.type) {
    case 'changed': scheduleLayout(); checkPrompts(); break;
    case 'setup': spriteEls.clear(); gameOver.value = null; break;
    case 'draw': for (const iid of ev.iids) origins.set(iid, barRect(ev.p, 'library')); sfx('draw'); break;
    case 'move': {
      const c = engine.card(ev.iid);
      if (c && [Zone.LIBRARY, Zone.GRAVEYARD, Zone.EXILE].includes(ev.from) && !spriteEls.has(ev.iid)) origins.set(ev.iid, barRect(c.owner, zoneKey(ev.from)));
      else if (c && ev.from === -1) flashes.set(ev.iid, '#27e1ff');
      break;
    }
    case 'play': { const c = engine.card(ev.iid); sfx(engine.isLand(c) ? 'land' : 'play'); flashes.set(ev.iid, '#3dff7a'); break; }
    case 'cast': sfx('play', { pitch: 1.2 }); flashes.set(ev.iid, '#ff3df0'); if (ev.p !== seat.value) toast(`${s.players[ev.p].name} lançou ${engine.displayName(engine.card(ev.iid))}`); break;
    case 'resolved': sfx('notify'); break;
    case 'countered': sfx('glitch'); break;
    case 'tap': sfx('tap'); break;
    case 'mana': if (ev.delta > 0) sfx('mana'); break;
    case 'life': {
      const r = barRect(ev.p, 'life');
      if (r) floatText(`${ev.delta > 0 ? '+' : ''}${ev.delta}`, r.x + r.w / 2, r.y + (ev.p === seat.value ? -30 : 40), ev.delta > 0 ? '#3dff7a' : '#ff4d5e');
      sfx(ev.delta > 0 ? 'heal' : 'damage');
      if (ev.delta <= -3 && ev.p === seat.value) shake();
      break;
    }
    case 'damage': { const r = spriteRect(ev.iid); if (r) floatText(`-${ev.amount}`, r.x + r.w / 2, r.y + r.h / 2, '#ff4d5e'); sfx('block'); break; }
    case 'dies': dying.add(ev.iid); sfx('destroy'); break;
    case 'attack': sfx('attack'); break;
    case 'block': sfx('block'); break;
    case 'turn':
      if (lastBanner !== ev.turn) {
        lastBanner = ev.turn;
        deselect();
        const mine = match.isLocal(ev.p);
        showBanner(mine ? 'SEU TURNO' : `TURNO DE ${s.players[ev.p].name.toUpperCase()}`, mine ? '#3dff7a' : '#ffd23d', `Turno ${ev.turn}`);
        sfx('turn');
      }
      break;
    case 'shuffle': sfx('shuffle'); break;
    case 'reminder': if (settings.showReminders) showReminder(ev); break;
    case 'reveal': { const c = engine.card(ev.iid); const card = c && getCard(c.uid); if (card && ev.p !== seat.value && remoteModalOk()) { zoomCard.value = card; zoomExtra.value = `${s.players[ev.p]?.name || '?'} revelou esta carta`; zoomActions.value = []; } break; }
    case 'reveal_hand': {
      if (ev.p === seat.value || !s.players[ev.p] || !remoteModalOk()) break;
      const entries = s.players[ev.p].hand.map((iid) => ({ card: getCard(engine.card(iid)?.uid), iid })).filter((e) => e.card);
      openPick({ title: `Mão de ${s.players[ev.p].name}`, entries, min: 0, max: 0, confirmLabel: 'Fechar' });
      break;
    }
    case 'game_over':
      // Both seats report; the server pays only when the two reports agree (RF-2.21).
      if (collectionMatch) lobby.result(ev.winner, match.state.turn);
      setTimeout(() => showGameOver(ev.winner), 700);
      break;
    case 'log': logLines.value.push({ text: ev.text }); trimLog(); break;
    case 'chat': logLines.value.push({ text: `${s.players[ev.from]?.name || '?'}: ${ev.text}`, chat: true }); trimLog(); sfx('notify'); break;
    default: break;
  }
}

let lastRemoteModal = 0;
/** The opponent can't keep dialogs open on my screen: at most one every 3 s, never over another one. */
function remoteModalOk() {
  const now = Date.now();
  if (pick.value || prompt.value || now - lastRemoteModal < 3000) return false;
  lastRemoteModal = now;
  return true;
}

function trimLog() {
  if (logLines.value.length > 200) logLines.value.splice(0, logLines.value.length - 200);
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; });
}

function floatText(text, x, y, color) {
  const id = seq += 1;
  floats.value.push({ id, text, x: x - 20, y: y - 20, color });
  setTimeout(() => { floats.value = floats.value.filter((f) => f.id !== id); }, 1100);
}

function showBanner(text, color, sub = '') {
  banner.value = { text, color, sub };
  setTimeout(() => { if (banner.value?.text === text) banner.value = null; }, 1400);
}

function shake() {
  if (settings.reducedMotion || !shakeEl.value) return;
  shakeEl.value.classList.remove('shake');
  void shakeEl.value.offsetWidth;
  shakeEl.value.classList.add('shake');
}

function showReminder(ev) {
  const c = engine.card(ev.iid);
  const card = c && getCard(c.uid);
  if (!card) return;
  const label = { etb: 'entrou em jogo', upkeep: 'efeito de manutenção', attack: 'atacou', end: 'efeito de fim de turno' }[ev.trigger] || 'efeito';
  const id = seq += 1;
  reminders.value.push({ id, card, label });
  if (reminders.value.length > 2) reminders.value.shift();
  sfx('notify', { gain: 0.5 });
  setTimeout(() => { reminders.value = reminders.value.filter((r) => r.id !== id); }, 7000);
}

function reminderClick(r) {
  reminders.value = reminders.value.filter((x) => x.id !== r.id);
  zoomCard.value = r.card;
  zoomActions.value = [];
  zoomExtra.value = '';
}

function showGameOver(winner) {
  const s = engine.state;
  const won = winner >= 0 && match.isLocal(winner);
  gameOver.value = { won, title: won ? 'VITÓRIA' : (winner >= 0 ? `${s.players[winner].name.toUpperCase()} VENCEU` : 'EMPATE') };
  playMusic(won ? 'victory' : 'defeat');
}

// ---------------------------------------------------------------- layout & sprites

function scheduleLayout() {
  if (layoutTimer) return;
  layoutTimer = requestAnimationFrame(() => {
    layoutTimer = null;
    layout();
  });
}

function rectOf(el) {
  if (!el || !layerEl.value) return null;
  const r = el.getBoundingClientRect();
  const l = layerEl.value.getBoundingClientRect();
  return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height };
}

function toLayer(r) {
  if (!r || !layerEl.value) return null;
  const l = layerEl.value.getBoundingClientRect();
  return { x: r.x - l.left, y: r.y - l.top, w: r.w, h: r.h };
}

function barRect(p, key) {
  const bar = p === seat.value ? myBarEl.value : oppBarEl.value;
  return toLayer(bar?.rects()[key]);
}

function zoneKey(z) {
  return { [Zone.LIBRARY]: 'library', [Zone.GRAVEYARD]: 'graveyard', [Zone.EXILE]: 'exile', [Zone.HAND]: 'hand' }[z] || 'library';
}

function spriteRect(iid) {
  const el = spriteEls.get(iid);
  return el ? rectOf(el) : null;
}

function spriteOf(iid) {
  return sprites.value.find((sp) => sp.iid === iid);
}

function registerSprite(iid, comp) {
  if (comp?.$el) spriteEls.set(iid, comp.$el);
}

function layout() {
  const s = engine.state;
  if (!s.players.length || !layerEl.value) return;
  const vh = window.innerHeight;
  handHeight.value = Math.max(104, Math.min(vh * 0.2, 200));
  updateMode();
  const rects = {
    oppFront: rectOf(oppFrontEl.value), oppBack: rectOf(oppBackEl.value), myFront: rectOf(myFrontEl.value), myBack: rectOf(myBackEl.value),
    hand: rectOf(handEl.value), oppHand: barRect(opp.value, 'hand'), stack: rectOf(myFieldEl.value) && { ...rectOf(myFieldEl.value), y: rectOf(myFieldEl.value).y - 40 },
  };
  const targets = computeLayout({ engine, seat: seat.value, rects, selected: selected.value, hover: hover.value, hideHand: !isLocal.value });
  const next = [];
  for (const [iidStr, t] of Object.entries(targets)) {
    const iid = Number(iidStr);
    const ci = engine.card(iid);
    if (!ci) continue;
    const { glow, glowColor, dim } = highlight(ci);
    // A face-down card carries nothing of the real card into the DOM (no image, no alt text).
    next.push({ iid, ci, card: ci.isToken || t.faceDown ? null : getCard(ci.uid), faceDown: t.faceDown, z: t.z, glow, glowColor, dim, t });
  }
  // Leaving sprites: fly to their zone and fade.
  const present = new Set(next.map((sp) => sp.iid));
  for (const [iid, el] of spriteEls) {
    if (present.has(iid)) continue;
    spriteEls.delete(iid);
    const ci = engine.card(iid);
    const ghost = el.cloneNode(true);
    ghost.style.pointerEvents = 'none';
    layerEl.value.appendChild(ghost);
    const r = el.getBoundingClientRect();
    const l = layerEl.value.getBoundingClientRect();
    gsap.set(ghost, { x: r.left - l.left, y: r.top - l.top, width: r.width, height: r.height, rotation: 0, scale: 1 });
    if (dying.has(iid)) {
      dying.delete(iid);
      gsap.to(ghost, { scale: 1.1, filter: 'brightness(3) blur(2px)', opacity: 0, duration: 0.45, ease: 'power2.in', onComplete: () => ghost.remove() });
    } else {
      const dest = ci ? barRect(ci.owner, zoneKey(ci.zone)) : null;
      const dx = dest ? dest.x + dest.w / 2 - r.width / 2 : r.left - l.left;
      const dy = dest ? dest.y + dest.h / 2 - r.height / 2 : r.top - l.top;
      gsap.to(ghost, { x: dx, y: dy, scale: 0.3, opacity: 0, duration: 0.35, ease: 'power2.inOut', onComplete: () => ghost.remove() });
    }
  }
  sprites.value = next;
  nextTick(() => {
    const dur = settings.reducedMotion ? 0 : 0.32;
    for (const sp of next) {
      const el = spriteEls.get(sp.iid);
      if (!el) continue;
      const t = sp.t;
      const isNew = !el.dataset.placed;
      if (isNew) {
        el.dataset.placed = '1';
        const o = origins.get(sp.iid);
        origins.delete(sp.iid);
        if (o) gsap.set(el, { x: o.x + o.w / 2 - t.w / 2, y: o.y + o.h / 2 - t.h / 2, width: t.w, height: t.h, scale: 0.4, rotation: 0, opacity: 1 });
        else gsap.set(el, { x: t.x, y: t.y, width: t.w, height: t.h, scale: 0.9, rotation: t.rot, opacity: 0 });
      }
      gsap.set(el, { transformOrigin: t.pivotBottom ? '50% 100%' : '50% 50%' });
      if (drag && drag.iid === sp.iid) continue;
      gsap.to(el, { x: t.x, y: t.y, width: t.w, height: t.h, rotation: t.rot, scale: t.scale, opacity: 1, duration: dur, ease: 'power3.out', overwrite: 'auto' });
      if (flashes.has(sp.iid)) {
        flashes.delete(sp.iid);
        gsap.fromTo(el, { filter: 'brightness(2.2)' }, { filter: 'brightness(1)', duration: 0.6 });
      }
    }
  });
}

function highlight(c) {
  const s = engine.state;
  const iid = c.iid;
  let color = '#3dff7a';
  let amount = 0;
  if (iid === selected.value) { color = '#27e1ff'; amount = 1; }
  else if (mode.value === 'attack' && c.controller === seat.value) {
    if (attackSel.value.has(iid)) { color = '#ff4d5e'; amount = 1; }
    else if (engine.canAttackWith(iid)) { color = '#ffd23d'; amount = 1; }
  } else if (mode.value === 'block') {
    if (iid === pendingBlocker.value) { color = '#27e1ff'; amount = 1; }
    else if (c.attacking) { color = '#ff4d5e'; amount = 1; }
    else if (blocks.value.some((b) => b[0] === iid)) { color = '#27e1ff'; amount = 1; }
  } else if (c.attacking) { color = '#ff4d5e'; amount = 1; }
  else if (c.blocking !== -1) { color = '#27e1ff'; amount = 1; }
  else if (c.zone === Zone.HAND && c.owner === seat.value && s.stage === Stage.PLAY && isLocal.value && engine.canPlay(seat.value, iid) === '') { amount = 1; }
  return { glow: amount, glowColor: color, dim: c.zone === Zone.BATTLEFIELD && c.tapped };
}

watch([selected, hover], scheduleLayout);

// ---------------------------------------------------------------- modes & center buttons

function updateMode() {
  const s = engine.state;
  const defenderLocal = s.stage === Stage.PLAY && s.phase === Phase.BLOCK && match.isLocal(engine.defendingPlayer());
  if (defenderLocal) {
    if (mode.value !== 'block') {
      mode.value = 'block';
      blocks.value = [];
      pendingBlocker.value = -1;
      toast('Você está sendo atacado! Clique na sua criatura e depois no atacante para bloquear.', 'warn', 3500);
    }
  } else if (mode.value === 'block') mode.value = 'normal';
  if (mode.value === 'attack' && (s.active !== seat.value || ![Phase.MAIN1, Phase.ATTACK].includes(s.phase))) {
    mode.value = 'normal';
    attackSel.value = new Set();
  }
}

const turnLabel = computed(() => {
  const s = st.value;
  if (s.stage === Stage.MULLIGAN) return 'Mulligan';
  if (s.stage !== Stage.PLAY && s.stage !== Stage.OVER) return '';
  return `Turno ${s.turn} · ${s.players[s.active]?.name}`;
});

const hasAttackers = computed(() => (version.value, myPs.value.battlefield?.some((iid) => engine.canAttackWith(iid))));

const buttons = computed(() => {
  const s = st.value;
  const m = mode.value;
  const atk = attackSel.value.size;
  const blk = blocks.value.length;
  if (s.stage === Stage.MULLIGAN) return { primary: 'Aguardando mulligan...', disabled: true };
  if (s.stage === Stage.OVER) return { primary: 'Fim de jogo', disabled: false };
  if (m === 'attack') return { primary: `Confirmar ataque (${atk})`, secondary: 'Cancelar', tertiary: 'Todos' };
  if (m === 'block') return { primary: `Confirmar bloqueios (${blk})`, secondary: 'Sem bloqueio' };
  if (s.active === seat.value && isLocal.value) {
    switch (s.phase) {
      case Phase.MAIN1: return hasAttackers.value ? { primary: 'Combate ⚔', secondary: 'Encerrar turno' } : { primary: 'Encerrar turno ⏎' };
      case Phase.ATTACK: return { primary: 'Combate ⚔', secondary: 'Pular combate' };
      case Phase.BLOCK: return { primary: 'Aguardando bloqueios...', disabled: true };
      case Phase.DAMAGE: return { primary: 'Resolver dano ⚡' };
      default: return { primary: 'Encerrar turno ⏎' };
    }
  }
  if (s.phase === Phase.DAMAGE && isLocal.value) return { primary: 'Resolver dano ⚡' };
  return { primary: 'Turno do oponente', disabled: true };
});

function centerAction(which) {
  const s = engine.state;
  sfx('click');
  if (s.stage === Stage.OVER) { showGameOver(s.winner); return; }
  if (mode.value === 'attack') {
    if (which === 'primary') { mode.value = 'normal'; submit({ t: 'attack', p: seat.value, attackers: [...attackSel.value] }); attackSel.value = new Set(); }
    else if (which === 'secondary') { mode.value = 'normal'; attackSel.value = new Set(); }
    else { for (const iid of s.players[seat.value].battlefield) if (engine.canAttackWith(iid)) attackSel.value.add(iid); attackSel.value = new Set(attackSel.value); }
    scheduleLayout();
    return;
  }
  if (mode.value === 'block') {
    const defender = engine.defendingPlayer();
    if (which === 'primary') { if (submit({ t: 'block', p: defender, blocks: [...blocks.value] }) === '') { blocks.value = []; mode.value = 'normal'; } }
    else { submit({ t: 'block', p: defender, blocks: [] }); blocks.value = []; mode.value = 'normal'; }
    scheduleLayout();
    return;
  }
  const label = buttons.value[which] || '';
  if (label.startsWith('Combate')) { mode.value = 'attack'; attackSel.value = new Set(); deselect(); toast('Clique nas criaturas que vão atacar e confirme.', 'info'); scheduleLayout(); }
  else if (label.startsWith('Encerrar turno')) endTurn();
  else if (label === 'Pular combate') submit({ t: 'attack', p: seat.value, attackers: [] });
  else if (label.startsWith('Resolver dano')) submit({ t: 'damage', p: seat.value });
}

async function endTurn() {
  const err = match.submit({ t: 'end_turn', p: seat.value });
  if (err !== DISCARD) { if (err) toast(err, 'error'); return; }
  const hand = engine.state.players[seat.value].hand;
  const extra = hand.length - HAND_LIMIT;
  const picked = await openPick({ title: `Descarte ${extra} carta(s)`, text: `Limite de ${HAND_LIMIT} cartas na mão no fim do turno.`, entries: hand.map((iid) => ({ card: getCard(engine.card(iid).uid), iid })), min: extra, max: extra, confirmLabel: 'Descartar' });
  if (!picked) return;
  for (const iid of picked) submit({ t: 'move', p: seat.value, iid, zone: Zone.GRAVEYARD });
  submit({ t: 'end_turn', p: seat.value });
}

function submit(cmd) {
  const err = match.submit(cmd);
  if (err && err !== DISCARD) toast(err, 'error');
  return err;
}

// ---------------------------------------------------------------- prompts

function openPick(opts) {
  return new Promise((resolve) => {
    pickResolve = resolve;
    pick.value = { cancellable: true, ...opts };
  });
}
function resolvePick(v) { pick.value = null; pickResolve?.(v); pickResolve = null; }
function ask(opts) {
  return new Promise((resolve) => {
    promptResolve = resolve;
    prompt.value = opts;
  });
}
function resolvePrompt(v) { prompt.value = null; promptResolve?.(v); promptResolve = null; }
const askNumber = (title, value = 1, min = 0, max = 99, text = '') => ask({ kind: 'number', title, value, min, max, text });
const askColor = (title, options = []) => ask({ kind: 'color', title, colors: options.length && !options.includes(ANY) ? options : ALL });
const askOptions = (title, options, text = '') => ask({ kind: 'options', title, options, text });

let promptBusy = false;
async function checkPrompts() {
  const s = engine.state;
  if (promptBusy || s.stage !== Stage.MULLIGAN) return;
  const ps = s.players[seat.value];
  if (!ps || ps.kept || !isLocal.value) return;
  promptBusy = true;
  const lands = ps.hand.filter((iid) => engine.isLand(engine.card(iid))).length;
  const text = `${lands} Cyberland(s) na mão.${ps.mulligans ? ` Ao manter, você colocará ${ps.mulligans} carta(s) no fundo do grimório.` : ''}`;
  const choice = await openPick({ title: 'Sua mão inicial', text, entries: ps.hand.map((iid) => ({ card: getCard(engine.card(iid).uid), iid })), min: 0, max: 0, confirmLabel: 'Manter mão', cancellable: true, cancelLabel: 'Mulligan' });
  if (choice === null) {
    const r = await askOptions('Mulligan?', [{ value: 'mull', label: 'Embaralhar e comprar 7 (mulligan)', style: 'btn-danger' }, { value: 'keep', label: 'Manter esta mão', style: 'btn-primary' }]);
    if (r === 'mull') { submit({ t: 'mulligan', p: seat.value }); promptBusy = false; checkPrompts(); return; }
  }
  let bottom = [];
  if (ps.mulligans > 0) {
    bottom = await openPick({ title: `Escolha ${ps.mulligans} carta(s) para o fundo do grimório`, entries: ps.hand.map((iid) => ({ card: getCard(engine.card(iid).uid), iid })), min: ps.mulligans, max: ps.mulligans, cancellable: false }) || [];
  }
  submit({ t: 'keep', p: seat.value, bottom });
  promptBusy = false;
}

// ---------------------------------------------------------------- card interaction

function deselect() {
  selected.value = -1;
  pendingBlocker.value = -1;
  actionBar.value = null;
}

function onPointerDown(e, sp) {
  if (e.button !== 0) return;
  const ci = sp.ci;
  const draggable = ci.zone === Zone.HAND && ci.owner === seat.value && isLocal.value && mode.value === 'normal';
  drag = { iid: sp.iid, sp, x: e.clientX, y: e.clientY, moved: false, draggable, el: spriteEls.get(sp.iid), timer: setTimeout(() => { if (drag && !drag.moved) { drag.long = true; onZoom(sp); } }, 500) };
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 12) {
    drag.moved = true;
    clearTimeout(drag.timer);
    if (!drag.draggable) return;
    deselect();
    gsap.killTweensOf(drag.el);
    gsap.set(drag.el, { zIndex: 100, rotation: 0, scale: 1 });
    const r = drag.el.getBoundingClientRect();
    drag.offX = e.clientX - r.left;
    drag.offY = e.clientY - r.top;
  }
  if (drag.moved && drag.draggable) {
    const l = layerEl.value.getBoundingClientRect();
    gsap.set(drag.el, { x: e.clientX - l.left - drag.offX, y: e.clientY - l.top - drag.offY });
  }
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  clearTimeout(d.timer);
  if (d.long) return;
  if (!d.moved) { onClick(d.sp); return; }
  if (!d.draggable) return;
  const overField = [myFieldEl.value, oppFieldEl.value].some((el) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
  if (overField) playCard(d.sp.ci, false);
  else scheduleLayout();
}

function onClick(sp) {
  const c = sp.ci;
  const s = engine.state;
  sfx('click');
  if (mode.value === 'attack') {
    if (c.controller === seat.value && engine.canAttackWith(c.iid)) {
      if (attackSel.value.has(c.iid)) attackSel.value.delete(c.iid); else attackSel.value.add(c.iid);
      attackSel.value = new Set(attackSel.value);
      scheduleLayout();
    }
    return;
  }
  if (mode.value === 'block') { blockClick(c); return; }
  if (c.zone === Zone.HAND && c.owner !== seat.value && !c.revealed) { toast(`Mão do oponente: ${s.players[c.owner].hand.length} carta(s).`); return; }
  if (c.zone === Zone.BATTLEFIELD && engine.isLand(c) && c.controller === seat.value && !c.tapped && isLocal.value) { tapForMana(c); return; }
  if (selected.value === c.iid) { deselect(); return; }
  selected.value = c.iid;
  nextTick(() => nextTick(() => showActionBar(c.iid)));
}

function onDouble(sp) {
  const c = sp.ci;
  if (mode.value !== 'normal' || !isLocal.value) return;
  if (c.zone === Zone.HAND && c.owner === seat.value) playCard(c, false);
  else if (c.zone === Zone.BATTLEFIELD && c.controller === seat.value) {
    if (engine.isLand(c) && !c.tapped) tapForMana(c);
    else submit({ t: 'tap', p: seat.value, iid: c.iid, value: !c.tapped });
  }
}

function onZoom(sp) {
  if (!sp || sp.faceDown) return;
  const c = sp.ci;
  deselect();
  if (c.isToken) { toast(`Ficha ${c.tokenName} ${engine.power(c)}/${engine.toughness(c)}`); return; }
  zoomCard.value = getCard(c.uid);
  zoomIid.value = c.iid;
  zoomActions.value = cardActions(c);
  zoomExtra.value = ZONE_NAMES[c.zone] || '';
}

function showActionBar(iid) {
  const c = engine.card(iid);
  const r = spriteRect(iid);
  if (!c || !r || selected.value !== iid) return;
  const actions = cardActions(c);
  const main = actions.slice(0, 3);
  if (actions.length > 3) main.push({ id: '__more', label: '⋯' });
  const x = Math.max(4, Math.min(r.x + r.w / 2 - 170, layerEl.value.clientWidth - 364));
  let y = r.y - 58;
  if (y < 4) y = r.y + r.h + 8;
  actionBar.value = { iid, x, y, actions: main, all: actions };
}

async function doAction(id, iid) {
  const c = engine.card(iid);
  if (!c) return;
  const p = seat.value;
  if (id === '__more') {
    const all = actionBar.value?.all || cardActions(c);
    actionBar.value = null;
    const r = await askOptions(engine.displayName(c), all.filter((a) => a.id !== '-').map((a) => ({ value: a.id, label: a.label, style: a.style })));
    if (r) doAction(r, iid);
    return;
  }
  deselect();
  switch (id) {
    case 'play': playCard(c, false); break;
    case 'play_force': playCard(c, true); break;
    case 'discard': case 'to_graveyard': submit({ t: 'move', p, iid, zone: Zone.GRAVEYARD }); break;
    case 'to_exile': submit({ t: 'move', p, iid, zone: Zone.EXILE }); break;
    case 'to_hand': submit({ t: 'move', p, iid, zone: Zone.HAND }); break;
    case 'to_top': submit({ t: 'move', p, iid, zone: Zone.LIBRARY, pos: 'top' }); break;
    case 'to_bottom': submit({ t: 'move', p, iid, zone: Zone.LIBRARY, pos: 'bottom' }); break;
    case 'reveal': submit({ t: 'reveal', p, iid }); break;
    case 'resolve': submit({ t: 'resolve', p, iid }); break;
    case 'counter': submit({ t: 'counter', p, iid }); break;
    case 'tap': submit({ t: 'tap', p, iid, value: !c.tapped }); break;
    case 'mana': tapForMana(c); break;
    case 'damage': { const n = await askNumber(`Dano em ${engine.displayName(c)}`, 1, 1, 99); if (n > 0) submit({ t: 'damage_card', p, iid, amount: n }); break; }
    case 'p1p1+': submit({ t: 'counter_add', p, iid, name: '+1/+1', delta: 1 }); break;
    case 'p1p1-': submit({ t: 'counter_add', p, iid, name: '+1/+1', delta: -1 }); break;
    case 'm1m1+': submit({ t: 'counter_add', p, iid, name: '-1/-1', delta: 1 }); break;
    case 'loyalty+': submit({ t: 'counter_add', p, iid, name: 'lealdade', delta: 1 }); break;
    case 'loyalty-': submit({ t: 'counter_add', p, iid, name: 'lealdade', delta: -1 }); break;
    case 'counter+': submit({ t: 'counter_add', p, iid, name: 'marcador', delta: 1 }); break;
    case 'counter-': submit({ t: 'counter_add', p, iid, name: 'marcador', delta: -1 }); break;
    case 'pump': case 'shrink': { const n = await askNumber(`${id === 'pump' ? '+' : '−'}X/X até o fim do turno`, 1, 1, 20); if (n > 0) { const k = id === 'pump' ? n : -n; submit({ t: 'pt_mod', p, iid, power: k, toughness: k }); } break; }
    case 'set_pt': { const pw = await askNumber(`Poder base de ${engine.displayName(c)}`, engine.basePower(c), 0, 99); if (pw === null) break; const tg = await askNumber(`Resistência base de ${engine.displayName(c)}`, Math.max(engine.baseToughness(c), 1), 0, 99); if (tg === null) break; submit({ t: 'set_pt', p, iid, power: pw, toughness: tg }); break; }
    case 'control': submit({ t: 'move', p, iid, zone: Zone.BATTLEFIELD, to: 1 - c.controller }); break;
    case 'attach': { const entries = engine.state.players.flatMap((ps) => ps.battlefield.filter((o) => o !== iid && !engine.card(o).isToken).map((o) => ({ card: getCard(engine.card(o).uid), iid: o }))); const picked = await openPick({ title: `Anexar ${engine.displayName(c)} a...`, entries, min: 1, max: 1, confirmLabel: 'Anexar' }); if (picked?.length) submit({ t: 'attach', p, iid, target: picked[0] }); break; }
    case 'detach': submit({ t: 'attach', p, iid, target: -1 }); break;
    default: break;
  }
}

function cardActions(c) {
  const a = [];
  if (!isLocal.value) return a;
  const mine = c.zone === Zone.BATTLEFIELD ? c.controller === seat.value : c.owner === seat.value;
  const d = c.isToken ? null : getCard(c.uid);
  if (c.zone === Zone.HAND && mine) {
    const err = engine.canPlay(seat.value, c.iid);
    a.push({ id: 'play', label: 'Jogar', style: err ? '' : 'btn-primary' }, { id: 'discard', label: 'Descartar' }, { id: 'reveal', label: 'Revelar' },
      { id: 'to_top', label: 'Topo do grimório' }, { id: 'to_bottom', label: 'Fundo do grimório' }, { id: 'to_exile', label: 'Exilar' }, { id: 'play_force', label: 'Jogar ignorando regras/custo' });
  } else if (c.zone === Zone.STACK) {
    a.push({ id: 'resolve', label: 'Resolver', style: 'btn-primary' }, { id: 'counter', label: 'Anular', style: 'btn-danger' });
  } else if (c.zone === Zone.BATTLEFIELD) {
    if (engine.isLand(c) && mine) a.push(c.tapped ? { id: 'tap', label: 'Desvirar' } : { id: 'mana', label: 'Gerar mana', style: 'btn-primary' });
    else a.push({ id: 'tap', label: c.tapped ? 'Desvirar' : 'Virar' });
    if (d?.hasManaAbility && !engine.isLand(c) && mine && !c.tapped) a.push({ id: 'mana', label: 'Gerar mana' });
    if (engine.isCreature(c)) a.push({ id: 'damage', label: 'Causar dano', style: 'btn-danger' }, { id: 'p1p1+', label: '+1/+1 (marcador)' }, { id: 'p1p1-', label: 'Remover +1/+1' }, { id: 'm1m1+', label: '−1/−1 (marcador)' }, { id: 'pump', label: '+X/+X até o fim do turno' }, { id: 'shrink', label: '−X/−X até o fim do turno' }, { id: 'set_pt', label: 'Definir P/R base' });
    if (engine.isPlaneswalker(c)) a.push({ id: 'loyalty+', label: 'Lealdade +1' }, { id: 'loyalty-', label: 'Lealdade −1' }, { id: 'damage', label: 'Causar dano' });
    a.push({ id: 'counter+', label: 'Adicionar marcador' }, { id: 'counter-', label: 'Remover marcador' }, { id: 'to_graveyard', label: 'Destruir (cemitério)' }, { id: 'to_exile', label: 'Exilar' }, { id: 'to_hand', label: 'Devolver à mão' }, { id: 'to_top', label: 'Topo do grimório' }, { id: 'to_bottom', label: 'Fundo do grimório' }, { id: 'control', label: 'Passar controle' });
    a.push(c.attachedTo === -1 ? { id: 'attach', label: 'Anexar a outra carta' } : { id: 'detach', label: 'Desanexar' });
  }
  return a;
}

async function playCard(c, force) {
  deselect();
  const d = getCard(c.uid);
  if (!d) return;
  let x = 0;
  if (d.cost.x > 0) { x = await askNumber(`Valor de X para ${d.name}`, 1, 0, 30); if (x === null) return; }
  const err = engine.canPlay(seat.value, c.iid, force, x);
  if (err === 'Mana insuficiente.') {
    const r = await askOptions('Mana insuficiente', [{ value: 'free', label: 'Jogar mesmo assim (efeito que reduz/zera o custo)', style: 'btn-danger' }], `Custo: ${d.costText}. Vire Cyberlands ou adicione mana à reserva. Se um efeito permite jogar sem pagar, use a opção abaixo.`);
    if (r !== 'free') { scheduleLayout(); return; }
    force = true;
  } else if (err) {
    if (engine.state.enforceRules) {
      const r = await askOptions('Não é possível jogar agora', [{ value: 'force', label: 'Jogar mesmo assim', style: 'btn-danger' }], `${err} Use somente se um efeito de carta permitir.`);
      if (r !== 'force') { scheduleLayout(); return; }
    }
    force = true;
  }
  submit({ t: 'play', p: seat.value, iid: c.iid, x, force });
}

async function tapForMana(c) {
  deselect();
  const d = c.isToken ? null : getCard(c.uid);
  const opts = d?.produces || [];
  let color = opts.length === 1 && opts[0] !== ANY ? opts[0] : await askColor(`Mana de ${engine.displayName(c)}`, opts);
  if (!color) return;
  submit({ t: 'mana_tap', p: seat.value, iid: c.iid, color });
}

function blockClick(c) {
  const defender = engine.defendingPlayer();
  if (c.controller === defender && engine.isCreature(c) && !c.tapped) {
    const i = blocks.value.findIndex((b) => b[0] === c.iid);
    if (i !== -1) { blocks.value.splice(i, 1); pendingBlocker.value = -1; scheduleLayout(); return; }
    pendingBlocker.value = c.iid;
  } else if (c.attacking && pendingBlocker.value !== -1) {
    if (!engine.canBlock(pendingBlocker.value, c.iid)) toast(`${engine.displayName(engine.card(pendingBlocker.value))} não pode bloquear ${engine.displayName(c)}.`, 'warn');
    else { blocks.value.push([pendingBlocker.value, c.iid]); sfx('block', { pitch: 1.2 }); }
    pendingBlocker.value = -1;
  } else if (c.attacking) toast('Primeiro clique na sua criatura que vai bloquear.', 'info');
  scheduleLayout();
}

// ---------------------------------------------------------------- bars / zones / menu

async function lifeMenu(p) {
  const ps = engine.state.players[p];
  const r = await askOptions(`Vida de ${ps.name} (${ps.life})`, [-5, -3, -1, 1, 3, 5].map((v) => ({ value: v, label: v > 0 ? `+${v}` : String(v) })).concat([{ value: 'x', label: 'Outro valor...' }]));
  if (r === null) return;
  let delta = r;
  if (r === 'x') {
    const n = await askNumber('Quantos pontos?', 1, 1, 99);
    if (!n) return;
    const sign = await askOptions(`Ganhar ou perder ${n}?`, [{ value: 1, label: 'Ganhar', style: 'btn-primary' }, { value: -1, label: 'Perder', style: 'btn-danger' }]);
    if (sign === null) return;
    delta = n * sign;
  }
  submit({ t: 'life', p, delta });
}

async function poolAdd() {
  const col = await askColor('Adicionar mana à reserva');
  if (col) submit({ t: 'pool', p: seat.value, color: col, delta: 1 });
}

async function tokenPrompt() {
  const t = await ask({ kind: 'token', title: 'Criar ficha (token)', confirmLabel: 'Criar' });
  if (t) submit({ t: 'token', p: seat.value, ...t });
}

async function onZone(p, zone) {
  const s = engine.state;
  const ps = s.players[p];
  const mine = p === seat.value && isLocal.value;
  if (zone === Zone.HAND) { toast(`Mão de ${ps.name}: ${ps.hand.length} carta(s).`); return; }
  if (zone === Zone.LIBRARY) {
    if (!mine) { toast(`Grimório de ${ps.name}: ${ps.library.length} carta(s).`); return; }
    libraryMenu(p);
    return;
  }
  const list = zone === Zone.GRAVEYARD ? ps.graveyard : ps.exile;
  if (!list.length) { toast(`${ZONE_NAMES[zone]} de ${ps.name} está vazio.`); return; }
  const entries = [...list].reverse().map((iid) => ({ card: getCard(engine.card(iid).uid), iid }));
  const picked = await openPick({ title: `${ZONE_NAMES[zone]} de ${ps.name} (${list.length})`, entries, min: 1, max: 1, confirmLabel: 'Mover carta...', text: 'Selecione uma carta para movê-la, ou feche.' });
  if (!picked?.length || !isLocal.value) return;
  const iid = picked[0];
  const opts = [{ value: Zone.HAND, label: 'Mão do dono', style: 'btn-primary' }, { value: Zone.BATTLEFIELD, label: 'Campo de batalha' }, { value: 'top', label: 'Topo do grimório' }, { value: 'bottom', label: 'Fundo do grimório' }, zone === Zone.GRAVEYARD ? { value: Zone.EXILE, label: 'Exílio' } : { value: Zone.GRAVEYARD, label: 'Cemitério' }];
  const dest = await askOptions(`Mover ${engine.displayName(engine.card(iid))} para...`, opts);
  if (dest === null) return;
  if (typeof dest === 'string') submit({ t: 'move', p: seat.value, iid, zone: Zone.LIBRARY, pos: dest });
  else submit({ t: 'move', p: seat.value, iid, zone: dest, to: dest === Zone.BATTLEFIELD ? seat.value : -1 });
}

async function libraryMenu(p) {
  const ps = engine.state.players[p];
  const r = await askOptions(`Grimório (${ps.library.length} cartas)`, [
    { value: 'draw', label: 'Comprar 1 carta', style: 'btn-primary' }, { value: 'draw_n', label: 'Comprar X cartas' }, { value: 'look', label: 'Olhar as X cartas do topo (vidência)' },
    { value: 'reveal', label: 'Revelar a carta do topo' }, { value: 'search', label: 'Buscar uma carta no grimório' }, { value: 'mill', label: 'Colocar X do topo no cemitério' }, { value: 'shuffle', label: 'Embaralhar' },
  ]);
  switch (r) {
    case 'draw': submit({ t: 'draw', p, n: 1 }); break;
    case 'draw_n': { const n = await askNumber('Comprar quantas cartas?', 2, 1, 20); if (n) submit({ t: 'draw', p, n }); break; }
    case 'mill': { const n = await askNumber('Quantas cartas para o cemitério?', 1, 1, 30); if (n) submit({ t: 'mill', p, n }); break; }
    case 'shuffle': submit({ t: 'shuffle', p }); break;
    case 'reveal': if (ps.library.length) { const top = ps.library.at(-1); submit({ t: 'reveal', p, iid: top }); zoomCard.value = getCard(engine.card(top).uid); zoomActions.value = []; zoomExtra.value = 'Topo do grimório (revelada)'; } break;
    case 'look': {
      const n = await askNumber('Olhar quantas cartas do topo?', 3, 1, Math.min(20, ps.library.length));
      if (!n) break;
      const top = ps.library.slice(-n).reverse();
      const bottom = await openPick({ title: 'Topo do grimório: escolha as que vão para o FUNDO', text: 'As não selecionadas continuam no topo, na mesma ordem (a primeira é o topo).', entries: top.map((iid) => ({ card: getCard(engine.card(iid).uid), iid })), min: 0, max: n });
      if (bottom === null) break;
      submit({ t: 'library_order', p, top: top.filter((i) => !bottom.includes(i)), bottom });
      break;
    }
    case 'search': {
      const entries = ps.library.map((iid) => ({ card: getCard(engine.card(iid).uid), iid })).sort((a, b) => a.card.name.localeCompare(b.card.name));
      const picked = await openPick({ title: 'Buscar no grimório', entries, min: 1, max: 1, confirmLabel: 'Escolher' });
      if (!picked?.length) break;
      const dest = await askOptions(`Para onde vai ${engine.displayName(engine.card(picked[0]))}?`, [{ value: Zone.HAND, label: 'Mão', style: 'btn-primary' }, { value: Zone.BATTLEFIELD, label: 'Campo de batalha' }, { value: Zone.GRAVEYARD, label: 'Cemitério' }, { value: Zone.EXILE, label: 'Exílio' }]);
      if (dest === null) break;
      submit({ t: 'move', p, iid: picked[0], zone: dest, to: dest === Zone.BATTLEFIELD ? p : -1 });
      submit({ t: 'shuffle', p });
      break;
    }
    default: break;
  }
}

async function openMenu() {
  const opts = [{ value: 'rules', label: 'Como jogar (resumo)' }];
  if (isLocal.value && engine.state.stage === Stage.PLAY) opts.push({ value: 'reveal_hand', label: 'Revelar minha mão' }, { value: 'untap', label: 'Desvirar todas as minhas permanentes' }, { value: 'concede', label: 'Desistir', style: 'btn-danger' });
  opts.push({ value: 'leave', label: 'Sair da partida', style: 'btn-danger' });
  const r = await askOptions('Menu', opts);
  switch (r) {
    case 'rules': await askOptions('Como jogar', [{ value: 1, label: 'Entendi' }], 'Clique numa carta para ver ações. Duplo clique joga/vira. Botão direito ou segurar amplia. Arraste da mão para o campo para jogar. Botão principal: Combate → escolha atacantes → confirme. O defensor clica na própria criatura e depois no atacante para bloquear. Depois resolva o dano e encerre o turno. Os efeitos escritos nas cartas são aplicados pelos jogadores com as ferramentas do grimório, cemitério, vida, mana, fichas e do menu ⋯ de cada carta.'); break;
    case 'reveal_hand': submit({ t: 'reveal_hand', p: seat.value }); break;
    case 'untap': for (const iid of engine.state.players[seat.value].battlefield) if (engine.card(iid).tapped) submit({ t: 'tap', p: seat.value, iid, value: false }); break;
    case 'concede': if (await askOptions('Desistir', [{ value: 1, label: 'Sim, desistir', style: 'btn-danger' }], 'Tem certeza que deseja desistir da partida?')) submit({ t: 'concede', p: seat.value }); break;
    case 'leave': if (engine.state.stage === Stage.OVER || await askOptions('Sair', [{ value: 1, label: 'Sair', style: 'btn-danger' }], 'Abandonar a partida atual?')) leave(); break;
    default: break;
  }
}

function sendChat() {
  const t = chatText.value.trim();
  if (!t) return;
  match.chat(t);
  chatText.value = '';
}

function onKey(e) {
  if (pick.value || prompt.value || zoomCard.value || e.target.tagName === 'INPUT') return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!buttons.value.disabled) centerAction('primary'); }
  else if (e.key.toLowerCase() === 'd' && isLocal.value) submit({ t: 'draw', p: seat.value, n: 1 });
  else if (e.key === 'Escape') { if (selected.value !== -1 || mode.value !== 'normal') { deselect(); mode.value = 'normal'; attackSel.value = new Set(); scheduleLayout(); } else openMenu(); }
}
</script>

<style scoped>
.field { border-radius: 12px; background: rgba(0, 0, 0, 0.14); border: 1px solid rgba(61, 255, 122, 0.08); }
.float-enter-active { transition: all 1s ease-out; }
.float-leave-active { transition: opacity 0.3s; }
.float-enter-from { opacity: 0; transform: translateY(10px) scale(0.5); }
.float-leave-to { opacity: 0; transform: translateY(-60px); }
.banner-enter-active { transition: all 0.2s ease-out; }
.banner-leave-active { transition: all 0.3s ease-in; }
.banner-enter-from, .banner-leave-to { opacity: 0; transform: translateY(-50%) scaleY(0); }
</style>
