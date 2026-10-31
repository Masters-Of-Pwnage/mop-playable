<template>
  <div class="relative flex flex-1 flex-col">
    <NeonBackdrop :src="hero" :tiny="heroTiny" :darken="0.35" :rain="0.1" position="70% center" />
    <section class="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-10 sm:px-8 lg:py-16">
      <div class="max-w-xl">
        <img :src="logo" alt="Masters of Pwnage" class="flicker w-[min(90vw,480px)] drop-shadow-[0_0_24px_rgba(61,255,122,0.45)]" />
        <p class="subtitle mt-4 text-sm sm:text-base">// jogo de cartas hacker — edição digital</p>
        <p class="mt-4 max-w-lg text-lg leading-relaxed text-[color:var(--text)]/90">
          Monte seu deck com as <strong class="text-neon">{{ cardsStore.cards.length || '300+' }} cartas</strong> da comunidade,
          imprima frente e verso para jogar na mesa ou enfrente outros hackers <strong class="text-cyan">online</strong>
          em salas públicas ou privadas.
        </p>
        <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <RouterLink to="/play" class="btn btn-primary btn-lg pulse-neon" @click="sfx('select')">▶ Jogar online</RouterLink>
          <RouterLink to="/decks" class="btn btn-lg" @click="sfx('click')">Montar deck</RouterLink>
          <button class="btn btn-lg" @click="practice">Treinar contra a IA</button>
        </div>
        <div class="mt-10 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div v-for="f in features" :key="f.title" class="panel-glass p-4">
            <div class="font-mono text-base font-bold text-neon">{{ f.title }}</div>
            <div class="mt-1 muted">{{ f.text }}</div>
          </div>
        </div>
      </div>
    </section>
    <footer class="mx-auto w-full max-w-7xl px-4 pb-6 text-xs muted sm:px-8">
      Projeto open source da comunidade · <a class="underline hover:text-neon" href="https://github.com/Masters-Of-Pwnage/mop-playable" target="_blank" rel="noopener">GitHub</a>
    </footer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import NeonBackdrop from '../components/NeonBackdrop.vue';
import hero from '../assets/art/hero.jpg';
import heroTiny from '../assets/art/hero-tiny.jpg';
import logo from '../assets/art/logo.webp';
import { cardsStore } from '../stores/cards.js';
import { sfx } from '../stores/audio.js';
import { session } from '../game/session.js';

const router = useRouter();
const features = [
  { title: '> deck builder', text: 'Filtros por nome, tipo, custo e cor. Exporta e importa o mesmo JSON do site antigo e gera o PDF para impressão frente e verso.' },
  { title: '> salas online', text: 'Crie uma sala pública para qualquer um entrar ou uma sala privada e compartilhe o código com um amigo.' },
  { title: '> regras assistidas', text: 'Turnos, mana, combate e palavras-chave automáticos. Os efeitos das cartas você aplica como na mesa, com ferramentas na tela.' },
];

function practice() {
  sfx('select');
  session.pending = { mode: 'ai' };
  router.push('/game');
}
</script>
