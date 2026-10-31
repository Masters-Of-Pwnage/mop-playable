<template>
  <section class="mx-auto w-full max-w-3xl flex-1 px-4 py-8 leading-relaxed sm:px-6">
    <h1 class="title text-3xl font-bold">Privacidade</h1>
    <p class="mt-2 text-sm muted">Última atualização: 31/10/2026</p>

    <div class="panel-glass mt-6 flex flex-col gap-4 p-5">
      <p>O Masters of Pwnage é um projeto da comunidade. Jogar como convidado não exige conta e não guarda dados seus no servidor: seus decks ficam só neste navegador. O site não usa rastreadores de publicidade nem carrega fontes ou scripts de terceiros.</p>

      <h2 class="subtitle text-lg font-bold">Quem cuida dos seus dados</h2>
      <p>
        Controlador: {{ privacy.controller || 'o mantenedor do projeto Masters of Pwnage' }}.
        Pedidos sobre seus dados (acesso, correção, exclusão, dúvidas):
        <a v-if="contactHref" :href="contactHref" class="underline hover:text-neon">{{ privacy.contact }}</a>
        <a v-else href="https://github.com/Masters-Of-Pwnage/mop-playable/issues" class="underline hover:text-neon" rel="noopener">GitHub do projeto</a>.
      </p>

      <h2 class="subtitle text-lg font-bold">Ao entrar com o Google, guardamos</h2>
      <ul class="list-disc pl-5">
        <li>o identificador da sua conta Google (para reconhecer você no próximo login);</li>
        <li>seu e-mail, se verificado pelo Google (para contato e administração do jogo, nunca exibido a outros jogadores);</li>
        <li>seu nome (como apelido inicial, que você pode trocar) e o endereço da sua foto de perfil do Google, exibida só se você permitir;</li>
        <li>seus decks, sua coleção, lista de desejos, trocas, partidas valendo recompensa e movimentações de PwnCoins e créditos;</li>
        <li>suas sessões abertas: navegador, <b>endereço IP</b> e data;</li>
        <li>um registro de segurança do que acontece com a conta (criação, sanções, mudança de papel, revisão de trocas, exclusão), com data e o <b>endereço IP</b> de quem fez a ação.</li>
      </ul>

      <h2 class="subtitle text-lg font-bold">Para que usamos e com que base legal (LGPD, art. 7º)</h2>
      <ul class="list-disc pl-5">
        <li><b>Prestar o serviço que você pediu</b> (execução de contrato, art. 7º, V): login, decks, coleção, loja, trocas e partidas.</li>
        <li><b>Segurança e prevenção de fraude</b> (legítimo interesse, art. 7º, IX): sessões com IP, registro de segurança, limites contra abuso e moderação.</li>
        <li><b>Exibir sua foto</b> (consentimento, art. 7º, I): só quando você liga a opção no perfil, e você pode desligar quando quiser.</li>
      </ul>
      <p>Não vendemos seus dados nem os usamos para publicidade.</p>

      <h2 class="subtitle text-lg font-bold">Quem vê o quê</h2>
      <ul class="list-disc pl-5">
        <li><b>Outros jogadores</b> veem seu apelido, seu identificador público, sua foto (se permitida) e, para propor trocas, as cartas repetidas da sua coleção.</li>
        <li><b>A equipe do jogo</b> (moderação e administração) vê, para moderar e investigar fraude, seu apelido, e-mail (mascarado para moderadores), IPs das sessões, coleção e movimentações.</li>
        <li><b>Prestadores de infraestrutura</b> processam os dados para que o site funcione: a Cloudflare (rede de entrega e armazenamento das cópias de segurança cifradas) e o Google Cloud (servidor). Eles podem tratar dados fora do Brasil, com as garantias contratuais desses serviços (LGPD, art. 33). O Google também participa do login.</li>
      </ul>

      <h2 class="subtitle text-lg font-bold">Por quanto tempo</h2>
      <ul class="list-disc pl-5">
        <li>Sessões: até expirarem (30 dias sem uso; 12 horas para a equipe) ou até você sair.</li>
        <li>Conta, decks e coleção: enquanto a conta existir.</li>
        <li>Movimentações da economia e registro de segurança: enquanto a economia do jogo existir, porque garantem os saldos de todos os jogadores. Na exclusão da conta eles continuam ligados a um identificador interno, mas sem seu nome, e-mail, foto ou conta Google.</li>
        <li>Cópias de segurança do banco: 7 dias no servidor e até 7 meses numa cópia externa cifrada, apagadas pela rotação automática. Dados de uma conta excluída somem delas nesse prazo.</li>
      </ul>

      <h2 class="subtitle text-lg font-bold">Seus direitos (LGPD, art. 18)</h2>
      <p>No seu <RouterLink to="/perfil" class="underline hover:text-neon">perfil</RouterLink> você baixa uma cópia dos dados da sua conta (perfil, saldo, movimentações, coleção, lista de desejos, trocas, partidas, sessões com IP e registro de segurança), corrige seu apelido e exclui sua conta. Na exclusão, apagamos seu e-mail, identificador do Google, foto, nome e decks e encerramos suas sessões; coleção, saldo, movimentações e registro de segurança ficam ligados só a um identificador interno, sem nenhum dado que identifique você, para manter a integridade dos saldos dos outros jogadores. Para qualquer outro pedido, use o canal acima.</p>

      <h2 class="subtitle text-lg font-bold">Moedas e créditos</h2>
      <p>PwnCoins e créditos são itens do jogo, sem valor monetário, e não podem ser trocados por dinheiro.</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { account } from '../stores/account.js';

const privacy = computed(() => account.privacy);
// An e-mail becomes mailto:, an https address a link; anything else is not linked.
const contactHref = computed(() => {
  const c = privacy.value.contact;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) return `mailto:${c}`;
  return /^https:\/\//.test(c) ? c : '';
});
</script>
