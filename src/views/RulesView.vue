<template>
  <div class="relative flex-1">
    <NeonBackdrop :src="bg" :tiny="bgTiny" :darken="0.7" :rain="0.06" />
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 class="title text-3xl">> Como jogar</h1>
      <div class="panel-glass mt-5 space-y-7 p-5 sm:p-8">
        <section v-for="s in sections" :key="s.title">
          <h2 class="subtitle mb-2 text-xl font-bold">{{ s.title }}</h2>
          <ul v-if="s.items" class="list-disc space-y-1 pl-5 leading-relaxed">
            <li v-for="(it, i) in s.items" :key="i" v-html="it"></li>
          </ul>
          <p v-else class="leading-relaxed" v-html="s.text"></p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import NeonBackdrop from '../components/NeonBackdrop.vue';
import bg from '../assets/art/deck.jpg';
import bgTiny from '../assets/art/deck-tiny.jpg';

const b = (t) => `<strong class="text-neon">${t}</strong>`;
const sections = [
  { title: 'Objetivo', text: `Cada jogador começa com ${b('20 pontos de vida')}. Reduza a vida do oponente a 0 usando criaturas hackers, exploits e ferramentas. Quem precisar comprar de um grimório vazio também perde.` },
  { title: 'Decks', items: [
    `Até ${b('60 cartas')} por deck, no máximo ${b('4 cópias')} de cada carta.`,
    `${b('Cyberlands')} (terrenos) não têm limite de cópias — o deck campeão da H2HC 2024 usa 10× RedZone.`,
    'Os decks são salvos no navegador e podem ser exportados/importados em JSON (o mesmo formato do construtor antigo) ou impressos em PDF frente e verso.',
  ] },
  { title: 'Tipos de carta', items: [
    `${b('Cyberland')}: gera mana. Um por turno, na sua fase principal. Toque nele para gerar mana.`,
    `${b('Criatura')}: ataca e bloqueia. Tem Poder/Resistência (P/R) e entra com enjoo de invocação (não ataca no turno em que entrou, exceto com Ímpeto).`,
    `${b('Mágica Instantânea')}: pode ser jogada a qualquer momento, inclusive no turno do oponente.`,
    `${b('Feitiço')}: só na sua fase principal. Mágicas vão para a pilha e depois para o cemitério.`,
    `${b('Encantamento / Artefato')}: permanentes com efeitos contínuos. ${b('Planinauta')}: entra com marcadores de lealdade.`,
  ] },
  { title: 'Mana', text: `Custos usam símbolos: ${b('W')} branco, ${b('U')} azul, ${b('B')} preto, ${b('R')} vermelho, ${b('G')} verde, ${b('C')} incolor e números (mana genérica). Ao jogar uma carta o jogo vira automaticamente os Cyberlands necessários. Cyberlands sem cor definida no texto geram mana da cor que você escolher.` },
  { title: 'Turno', items: [
    `1. ${b('Desvirar')} · 2. ${b('Manutenção')} · 3. ${b('Compra')} (quem começa não compra no 1º turno)`,
    `4. ${b('Principal 1')}: jogue Cyberland e cartas`,
    `5. ${b('Combate')}: declare atacantes → o oponente declara bloqueadores → dano`,
    `6. ${b('Principal 2')} · 7. ${b('Final')}: descarte até ficar com 7 cartas`,
  ] },
  { title: 'Combate', text: 'Atacantes viram (exceto com Vigilância). Criaturas não bloqueadas causam dano ao jogador; bloqueadas trocam dano com os bloqueadores. Dano igual ou maior que a resistência destrói a criatura. O dano some no fim do turno.' },
  { title: 'Palavras-chave reconhecidas', text: `${b('Voar')} (só bloqueada por Voar/Alcance) · ${b('Alcance')} · ${b('Vigilância')} · ${b('Ímpeto')} · ${b('Atropelar')} · ${b('Defensor')} · ${b('Toque Mortífero')} · ${b('Vínculo com a Vida')} · ${b('Iniciativa')} · ${b('Indestrutível')} · ${b('Ameaça')} · ${b('Lampejo')}` },
  { title: 'Efeitos das cartas', text: 'O texto de cada carta é aplicado pelos jogadores, como na mesa. O jogo mostra lembretes quando uma carta entra em jogo, ataca ou tem efeito de manutenção, e oferece ferramentas: comprar, buscar no grimório, olhar o topo, revelar, mover entre zonas, marcadores, +X/+X até o fim do turno, fichas, dano direto, vida e reserva de mana.' },
  { title: 'Controles', items: [
    `${b('Clique')} numa carta: seleciona e mostra as ações. ${b('Duplo clique')}: joga a carta / gera mana com o Cyberland.`,
    `${b('Arrastar')} da mão para o campo: joga a carta. ${b('Botão direito')} ou ${b('segurar')}: amplia a carta.`,
    `Botão principal no centro: Combate → escolha atacantes → confirme. O defensor clica na própria criatura e depois no atacante para bloquear.`,
    `Atalhos: ${b('Espaço')} botão principal · ${b('D')} comprar · ${b('Esc')} cancelar.`,
  ] },
];
</script>
