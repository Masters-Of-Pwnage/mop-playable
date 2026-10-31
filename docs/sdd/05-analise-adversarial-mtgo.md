# 05 — Análise adversarial do Magic: The Gathering Online (MTGO) e novas features para o MOP

> Pesquisa feita em 2026-10-31. Complementa [02-economia.md](02-economia.md) e [04-admin.md](04-admin.md) e alimenta as fases F7–F8 do [README](README.md).

## 1. Escopo, método e limites

- **Objetivo:** usar o MTGO, o cliente digital mais antigo de um card game no mesmo gênero do MOP, como **adversário e espelho**:
  1. o que ele resolve bem e vale adaptar;
  2. o que deu errado e o MOP deve evitar;
  3. como cada feature proposta pode ser abusada.
- **Fontes:**
  - site oficial (`/home`, `/getting-started`, `/premier-play`, `/player-rewards` e anúncio semanal de 27/10/2026);
  - guias e críticas da comunidade (Draftsim, MTGGoldfish, MTGPrice, Cardhoarder, StarCityGames, MTGRocks).
  - Links na §8.
- **Limites:**
  - não instalamos nem testamos o cliente (só Windows, 16 GB de disco);
  - as críticas de comunidade são em boa parte de 2014–2024 e foram tratadas como tendência, não como estado atual;
  - nenhum teste ativo foi feito contra serviços do MTGO.
- **Guarda de originalidade:** o MOP é um jogo próprio da comunidade. Esta análise extrai **mecânicas de plataforma genéricas do gênero** (ligas, temporadas, trocas, espectador). Não copia nomes, marcas, interface, textos, arte nem sistemas proprietários. Todos os nomes de feature abaixo são do MOP.

## 2. O que o MTGO oferece (mapa de features)

| Área | Como funciona no MTGO | Evidência |
|---|---|---|
| Cliente | Desktop só Windows 10/11, 8–16 GB RAM, 16–32 GB de disco, download `setup.exe` | `/home` (requisitos) |
| Entrada | Conta básica gratuita com coleção instantânea de ~3 000 cartas, 5 decks prontos e jogo aberto. **Upgrade pago único (~US$ 5)** libera trocas, chat, desafio direto a amigos, eventos com prêmio e +6 000 cartas | `/getting-started` |
| Moedas | **Event Tickets** (US$ 1 na loja, transferíveis, uso oficial só como entrada de evento) e **Play Points** (ganhos jogando, intransferíveis, não conversíveis) | Draftsim, MTGPrice |
| Mercado | Troca P2P existe, mas na prática **bots de lojas terceiras dominam** compra e venda de cartas e tickets. Há mercado secundário de tickets abaixo de US$ 1 e muita fraude | Draftsim, Cardhoarder |
| Loja | Boosters, boosters premium (US$ 6,99), decks Commander (US$ 29,99–39,99), bundles de cubo, tokens de draft, avatares | anúncio de 27/10/2026 |
| Caixas aleatórias | **Treasure Chests** (conteúdo aleatório) como prêmio e produto | `/home` (link) |
| Recompensas | Até 6 pacotes promocionais por mês: 3 por jogar (1 evento / 5 eventos) e **3 por gastar** (US$ 20 / US$ 40). Só residentes dos EUA maiores de idade | `/player-rewards` |
| Modos | Constructed (ligas, torneios, filas, jogo aberto) e Limited (sealed, draft, cubo curado e rotativo, Pack Wars). Eventos **Phantom** (as cartas não entram na coleção) e **Keeper** (você fica com as cartas) | `/getting-started`, anúncio |
| Ligas | Inscrição paga, 5 partidas jogadas quando o jogador quiser contra outros da mesma liga, prêmio pelo número de vitórias | `/premier-play` |
| Competitivo | Temporadas de ~17 semanas, **Qualifier Points** ganhos em ligas e desafios, Preliminaries, Challenges, Qualifiers e um Showcase final de 8 jogadores com prêmio em dinheiro e vaga em campeonato mundial | `/premier-play` |
| Novatos | Eventos gratuitos com meio-deck fantasma, "Gauntlet" com decks pré-construídos | `/getting-started` |
| Conteúdo | Decklists publicadas dos eventos, notícias semanais, streams (canal educativo), programa de criadores, Discord, programa beta por ticket | `/home`, anúncio |
| Físico | **Redemption**: trocar um set digital completo pelo físico | `/home` |
| Operação | **Downtime semanal programado** (ex.: 4/11, 6h–12h PT) para lançamentos. Histórico de quedas longas (~24 h em jan/2024) | anúncio, MTGRocks |
| Integridade | Problema histórico de *win trading* (colusão em eventos), restrições de país e verificação para prêmios, política de conduta | MTGRocks, `/premier-play` |

## 3. Ataque ao MTGO: onde a plataforma falha

Cada falha vira uma regra de design para o MOP.

| # | Falha observada | Por que acontece | Regra para o MOP |
|---|---|---|---|
| A1 | **Bots e lojas terceiras viraram o mercado.** A troca entre pessoas "praticamente não existe" | Sem descoberta de parceiros nem preço de referência dentro do jogo, o atalho é o bot | O MOP precisa resolver a descoberta dentro do jogo: lista de desejos + "quem tem o que eu quero" + valor de referência (02 RF-2.16). Bots de troca são proibidos nos termos |
| A2 | **Moeda transferível com valor em dólar** gera mercado secundário, fraude e lavagem | Ticket comprado a US$ 1 e transferível é dinheiro de fato | PWC não se compra na v1 (D1), não existe "enviar moedas", troca exige contrapartida e há revisão de troca desequilibrada |
| A3 | **Moeda dupla que prende saldo** (Play Points não conversíveis obrigam a pagar a mais) | Sumidouros rígidos e saldo órfão | Conversão PWC→CR na quantidade exata que falta, nada expira (02 R4/R5) |
| A4 | **Itens que expiram no downtime sem reembolso** (tokens de draft) | Conveniência operacional à custa do jogador | Itens do MOP não expiram. Evento cancelado devolve a entrada automaticamente via `reversal` |
| A5 | **Recompensa atrelada a gasto** e restrita por país | Monetização direta | Recompensa só por jogar. Nenhum bônus por gastar, nem quando houver pagamento (F6) |
| A6 | **Caixas aleatórias pagas** | Receita | Os pacotes existem (D2), mas só com CR, com probabilidades públicas, garantia anti-azar, restrição a maiores de 18 e flag `packs` desligada em produção até a validação jurídica (D10). A Lei 15.211/2025 (ECA Digital) restringe *loot boxes* em jogos acessíveis a menores |
| A7 | **Cliente pesado, só Windows, interface datada** | Legado de mais de 20 anos | Vantagem do MOP: navegador, celular, PWA, sem instalar. Manter o orçamento de desempenho (03 RNF) |
| A8 | **Downtime semanal e quedas longas** | Deploy monolítico com estado | O MOP tem o mesmo defeito em escala menor: as salas vivem em memória e **um deploy derruba as partidas em andamento**. Ver feature F-M10 |
| A9 | **Colusão / win trading** em eventos com prêmio | Incentivo alto e detecção fraca | No MOP é pior, porque o host é autoritativo. Nenhum prêmio relevante antes do servidor autoritativo (F6). Detecção por pares repetidos (02 §3) |
| A10 | **Paywall de US$ 5 para trocar** (anti-alt) | Atrito pago como antifraude | O MOP usa atrito **por jogo**: 7 dias + 10 partidas (02 RF-2.11), sem cobrar |
| A11 | **Comunicação opaca sobre bugs e conduta** | Processo interno fechado | Página de status + changelog in-game + motivo visível em toda punição (04 §6) |
| A12 | **Liquidez depende de milhares de jogadores online** (drafts de 8, torneios agendados) | Escala grande | O MOP é comunidade pequena. Preferir formatos **assíncronos** (ligas) e com IA preenchendo vagas (draft contra bots). Torneio agendado só em evento presencial |

## 4. O que o MTGO acerta (vale adaptar)

| # | Acerto | Adaptação no MOP |
|---|---|---|
| B1 | **Coleção inicial generosa** e decks prontos, que deixam jogar no minuto 1 | Kit inicial a partir de `src/data/starter-decks.json` (02 §3) |
| B2 | **Eventos fantasma** (joga com cartas que não ficam na coleção) | Modo "Cubo MOP" fantasma: experimentar o jogo inteiro sem pressão econômica |
| B3 | **Ligas assíncronas** de 5 partidas | Ligas MOP (F-M1), que resolvem a liquidez baixa |
| B4 | **Temporadas com pontos de classificação** e final | Temporadas MOP ligadas aos eventos reais da comunidade (H2HC, BSides SP, que já têm deck em `decks/h2hc-2024.json`) |
| B5 | **Cubo curado e rotativo** | Cubo MOP curado no admin, com rotação |
| B6 | **Decklists publicadas** | Metagame e decks campeões publicados (o import de deck já existe no builder) |
| B7 | **Ponte digital ↔ físico** (Redemption) | "Imprimir minha coleção" como proxies, usando o `PrintPreview.vue`/`src/game/print.js` que já existe, e códigos de resgate distribuídos em eventos físicos |
| B8 | **Programa beta** e anúncios semanais | Papel `beta` + flags por papel + notícias in-game |
| B9 | **Gauntlet com decks pré-construídos** | Desafio de decks iniciais contra a IA com recompensa diária |

## 5. Ataque ao próprio plano do MOP (casos de abuso)

Ataques que o MTGO sofreu ou sofreria, aplicados às features deste SDD:

| ID | Ataque | Alvo | Severidade | Mitigação (onde) |
|---|---|---|---|---|
| X1 | Farm com contas alternativas: N contas Google → cadastro + diário → presente para a conta principal | economia | Alta | CR intransferível, trava de troca, revisão de desequilíbrio (02 RF-2.11/2.15). Admin vê o grafo de trocas por IP/dispositivo (04 §6) |
| X2 | Vitória combinada / partida-relâmpago para farmar recompensa | recompensas | Média | Consenso de `result`, ≥ 4 turnos, teto diário, mesmo par no máximo 2×/dia (02 §3) |
| X3 | Host modificado que trapaceia na partida | salas Coleção, ligas | Alta para ligas | Ligas com prêmio só com servidor autoritativo (F6). Até lá, ligas sem prêmio de valor |
| X4 | Bait-and-switch em troca | trocas | Média | Ofertas imutáveis + `contentHash` (02 RF-2.13) |
| X5 | RMT (venda de PWC/cartas por PIX fora do jogo) | economia | Média | Termos de uso, auditoria de padrões, banimento. Sem pagamento oficial na v1 |
| X6 | *Ghosting*: espectador repassa informação oculta a um jogador | espectador (F-M3) | Alta | Espectador vê só a informação pública (`redactFor` sem mão), atraso de 1 turno, espectar sala Coleção/liga exige autorização dos dois |
| X7 | Replay revela a mão/deck de quem ainda está jogando | replays (F-M4) | Média | Replay só disponível depois do fim da partida. Liga: depois do fim da rodada |
| X8 | Vazamento de lote de códigos de evento | códigos | Média | Export único, desativação por lote, 1 uso por conta, rate limit (02 RF-2.17/18) |
| X9 | Admin interno abusando (concede a si mesmo) | admin | Alta | Teto por papel, step-up, audit imutável, alerta para o `owner` em autoconcessão (04 §2) |
| X10 | Inflação: emissão de CR > sumidouros | economia | Média | Painel emitido × queimado, simulador (04 §5), ajuste de recompensas por flag |
| X11 | Spam/assédio em chat livre | social (F-M5) | Média | Sem chat livre na v1: só emotes predefinidos e frases rápidas (convidados e possíveis menores) |
| X12 | Deploy derruba as partidas das ligas | operação | Média | F-M10 (drenagem + snapshot de salas) |

## 6. Novas features propostas para o MOP

Prioridade: **P1** = alto valor e baixo custo, ou necessária para a segurança da economia. **P2** = alto valor e custo médio. **P3** = depois.

| ID | Feature | Inspirada em | Prioridade | Depende de |
|---|---|---|---|---|
| F-M1 | Ligas assíncronas | B3, A12 | P2 | contas, F6 para prêmios |
| F-M2 | Cubo MOP fantasma + draft contra IA | B2, B5, A12 | P2 | engine (Limited), IA de picks |
| F-M3 | Modo espectador | streams/educação | P2 | protocolo v2 |
| F-M4 | Replays | (o MTGO não tem; é diferencial) | P2 | log de comandos |
| F-M5 | Amigos e desafio direto | buddies | P1 | contas |
| F-M6 | Lista de desejos + match de trocas | A1 | P1 | economia |
| F-M7 | Temporadas e ranking ligados a eventos reais | B4 | P2 | ligas, F6 |
| F-M8 | Metagame e decklists publicadas | B6 | P3 | salas Coleção/ligas |
| F-M9 | Notícias in-game, status e changelog | B8, A11 | P1 | admin |
| F-M10 | Deploy sem derrubar partidas | A8 | P1 | servidor |
| F-M11 | Recompensa mensal por jogar (passe sem compra) | A5 invertido | P2 | economia |
| F-M12 | Proxies da coleção para imprimir | B7 | P3 | coleção |
| F-M13 | Desafio diário com decks iniciais | B9 | P1 | economia |

### 6.1 F-M1 — Ligas assíncronas

- O admin cria uma liga com nome, formato (Coleção, Cubo fantasma, Decks iniciais), janela, entrada em CR (pode ser 0), número de partidas (padrão 5) e tabela de prêmios por vitórias.
- O jogador se inscreve com um deck, que fica **travado** durante a liga, e clica "procurar partida". O servidor pareia com outro inscrito da mesma liga por proximidade de vitórias. Se ninguém aparecer em 60 s, oferece "jogar contra a IA" (conta como partida, com recompensa menor) ou continuar esperando.
- Resultado: na v1 por consenso, sem prêmio de valor. Prêmio em CR só depois do F6 (servidor autoritativo).
- Tabelas `leagues`, `league_entries`, `league_matches`. Admin: 04 §3 "Ligas/Temporadas".
- Aceite: inscrição debita a entrada uma vez (idempotente). Liga cancelada estorna todas as entradas por `reversal`.

### 6.2 F-M2 — Cubo MOP fantasma + draft contra a IA

- O admin monta um cubo (lista de `uid` com cópias, ~180 cartas) e uma rotação.
- O draft é feito em pods de 2–8 com **assentos vazios preenchidos por IA de picks**: heurística por cor/curva, uma extensão do `src/engine/ai.js`. O deck é de 40 cartas, mínimo 20 (`MIN_PLAY_CARDS` já é 20).
- As cartas são fantasmas e não entram na coleção (B2). Isso dá o "jogo completo" sem pressão econômica e funciona com 1 jogador humano.
- Fase 2: "Keeper" com cartas ficando na coleção, **só** se D2 permitir.

### 6.3 F-M3 — Modo espectador

- Lista de partidas públicas assistíveis.
- O servidor abre um canal de leitura: o host envia ao servidor o estado redigido **para um observador neutro**, ou seja, `redactFor` com seat `-1`, sem mãos nem ordem do deck, com atraso de 1 turno.
- Salas Coleção, ligas e salas privadas: espectar só com permissão dos dois jogadores (X6).
- Contador de espectadores visível. Admin assiste qualquer partida pública.

### 6.4 F-M4 — Replays

- Hoje o host já gera comandos e eventos (`src/game/match.js`, `_capture`). Ao fim da partida, o host envia o log de comandos com as seeds, e o servidor guarda comprimido, por até 30 dias ou para sempre em favoritos.
- O player de replay reaproveita `GameEngine` em modo de reprodução determinística: pausar, avançar por turno, visão de qualquer jogador.
- Só fica disponível depois do fim da partida (X7). Link compartilhável `/#/replay/:id`, ótimo para conteúdo de evento e criadores.

### 6.5 F-M6 — Lista de desejos + match de trocas

- Lista de desejos por carta/quantidade. "Pasta de troca" = cópias acima de N que o jogador aceita trocar.
- `GET /api/trades/matches` cruza desejos × pastas e ordena por reciprocidade ("vocês dois querem algo do outro").
- Valor de referência por carta = preço efetivo da loja, mostrado no editor de troca para reduzir golpes de assimetria.
- Notificação in-game quando alguém passa a ter uma carta desejada para troca.

### 6.6 F-M7 — Temporadas e ranking

- Temporada alinhada ao calendário da comunidade, por exemplo encerrando na H2HC ou na BSides SP.
- Pontos de temporada vêm de ligas (vitórias) e desafios. Ranking público com apelido e moldura de avatar da temporada (asset Artlist, 03 §5).
- Final presencial no evento, com prêmio físico decidido pelo organizador. **Não** há prêmio em dinheiro na plataforma: no Brasil, distribuir prêmios exige autorização (Lei 5.768/1971), o que precisa de validação jurídica.

### 6.7 F-M9 — Notícias, status e changelog

- O admin publica notícias, que aparecem como card na home e badge no menu.
- `/#/status` mostra a saúde do servidor (`/health`), a próxima manutenção e incidentes.
- O changelog é gerado das tags de release.

### 6.8 F-M10 — Deploy sem derrubar partidas

- Ao receber SIGTERM, o servidor para de aceitar salas novas, avisa as salas ativas ("manutenção em X min") e espera até `DRAIN_SECONDS` (padrão 15 min) ou até as salas acabarem.
- O host já envia snapshots redigidos. O servidor guarda o último snapshot de cada sala Coleção ou liga no SQLite, e após o restart os clientes fazem `resume` e o host recarrega o snapshot.
- `deploy_mop.py` ganha `--drain` e a janela de manutenção aparece em F-M9.

### 6.9 F-M11 — Recompensa mensal por jogar

- Trilha mensal com marcos por partidas concluídas (5, 15, 30), cosméticos (molduras, verso de carta) e CR. Nenhum marco é comprável (A5 invertido).

### 6.10 F-M13 — Desafio diário com decks iniciais

- Todo dia, um deck inicial contra a IA em dificuldade crescente, com recompensa de CR uma vez por dia. Ótimo para onboarding e retenção solo.

## 7. Impacto no SDD

- **02-economia:**
  - as regras R3–R5 e RF-2.11/2.13/2.15/2.16 vieram desta análise;
  - os boosters aleatórios continuam desligados;
  - as entradas de liga viram um sumidouro novo de CR.
- **04-admin:** novas telas Ligas/Temporadas, Conteúdo (notícias, manutenção) e Cubo.
- **00-arquitetura:** tabelas novas (`leagues`, `league_entries`, `league_matches`, `cubes`, `replays`, `friends`, `wishlist`, `news`, `room_snapshots`) e protocolo v2 com `spectate`, `league_queue` e `replay_upload`.
- **Roadmap:** fases **F7** (P1: F-M5, F-M6, F-M9, F-M10, F-M13) e **F8** (P2: F-M1, F-M2, F-M3, F-M4, F-M7, F-M11). F-M8/F-M12 ficam no backlog.

## 8. Fontes

- [MTGO — Home](https://www.mtgo.com/home)
- [MTGO — Getting Started](https://www.mtgo.com/getting-started)
- [MTGO — Premier Play](https://www.mtgo.com/premier-play)
- [MTGO — Player Rewards](https://www.mtgo.com/player-rewards)
- [MTGO — Weekly Announcements, 27/10/2026](https://www.mtgo.com/news/mtgo102726)
- [Draftsim — Is MTG Online free?](https://draftsim.com/is-mtg-online-free/)
- [MTGGoldfish — The pitfalls of an intangible currency](https://www.mtggoldfish.com/articles/the-pitfalls-of-an-intangible-currency)
- [Cardhoarder — Economy: cashing out](https://intercom.help/cardhoarder/en/articles/8674937-economy-cashing-out)
- [MTGPrice — Understanding MTGO treasure chests](https://blog.mtgprice.com/page/127/?cat=-1)
- [MTGRocks — The MTG win trading problem has finally been addressed](https://mtgrocks.com/the-mtg-win-trading-problem-has-finally-been-addressed/)
- [MTGRocks — Persistent problems cause near 24 hour MTG Online outage](https://mtgrocks.com/persistent-problems-cause-near-24-hour-mtg-online-outage/)
- [StarCityGames — Bugged Out: The Failings of Magic Online](https://articles.starcitygames.com/articles/bugged-out-the-failings-of-magic-online/)
