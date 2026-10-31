# 02 — Dinheiro interno: moedas, créditos, loja e trocas

> Depende de: [00-arquitetura.md](00-arquitetura.md) (ADR-05, tabelas de economia) e [01-login-google.md](01-login-google.md). As lições do MTGO que mudaram esta spec estão em [05-analise-adversarial-mtgo.md](05-analise-adversarial-mtgo.md) (§4).

## 1. Objetivo

Criar uma economia interna em que o jogador:

1. obtém e troca **moedas** (PwnCoins);
2. converte moedas em **créditos**;
3. usa créditos para **comprar cartas** com preço, raridade e disponibilidade definidos pelo admin ([04-admin.md](04-admin.md));
4. monta decks só com o que possui nas salas do modo "Coleção".

## 2. Glossário e regras de ouro

| Termo | Definição |
|---|---|
| **PwnCoin (PWC)** | Moeda "dura". Transferível entre jogadores **apenas dentro de uma troca** (não existe "enviar moedas"). Na v1 não se compra com dinheiro real (ver D1) |
| **Crédito (CR)** | Moeda "mole". **Não é transferível.** Serve para comprar cartas e, no futuro, entradas de liga. Vem da conversão de PWC e de recompensas por jogar |
| **Conversão** | PWC → CR, só nesse sentido, à taxa `economy.pwc_to_cr` (padrão **1 PWC = 10 CR**) |
| **Coleção** | `user_cards`: quantas cópias de cada `uid` o jogador possui |
| **Venda de volta** | Devolver uma cópia excedente por `sell_credits` (padrão 20 % do preço) |

Regras de ouro (inegociáveis):

- **R1** Todo valor muda só por `ledger_tx`, com soma zero, idempotente e auditável (ADR-05).
- **R2** Não existe saque nem conversão para dinheiro real. Os termos de uso dizem que PWC/CR não têm valor monetário.
- **R3** Créditos nunca circulam entre contas. Isso fecha o canal mais simples de farm com contas alternativas.
- **R4** Saldo parado não é confiscado. Nada que o jogador obteve expira em silêncio. É uma lição do MTGO: tokens apagados no downtime geram reclamação.
- **R5** Toda compra mostra o preço final, o saldo antes e o saldo depois. Como só há conversão PWC→CR, a UI nunca força o jogador a "comprar a mais" (lição dos Play Points): a conversão é feita na quantidade exata que falta.

## 3. Fontes e sumidouros

| Fonte (entra) | Moeda | Padrão | Limites |
|---|---|---|---|
| Cadastro (`signup_grant`) | CR | 500 | 1× por `sub` |
| Coleção inicial | cartas | 1 cópia de cada carta dos decks em `src/data/starter-decks.json` (mais cyberlands suficientes) | 1× |
| Login diário | CR | 50 | 1×/dia (America/Sao_Paulo) |
| Partida online concluída (participação) | CR | 20 | 5/dia, só em sala com 2 contas, ≥ 4 turnos, relatos `result` iguais, mesmo par de jogadores conta no máximo 2×/dia |
| Vitória online | CR | +10 | 3/dia, mesmas condições. Pequena de propósito (host-authoritative) |
| Código de resgate (eventos H2HC, BSides etc.) | PWC/CR/cartas | definido no lote | 1 uso por conta por código |
| Concessão administrativa | qualquer | — | Exige motivo + step-up e fica no audit log |
| Compra com dinheiro real | PWC | — | **Desligada** (flag `payments`, fase F6, decisão D1) |

| Sumidouro (sai) | Moeda | Padrão |
|---|---|---|
| Compra de carta | CR | preço da carta ou padrão da raridade |
| Taxa de troca | PWC | 5 % do PWC trocado, arredondado para cima, mínimo 1 se houver PWC (vai para `system:burn`) |
| Entrada de liga (futuro, ver 05 §6) | CR | definido por liga |

Preços padrão por raridade (`rarity_defaults`, editáveis no admin):

| Raridade | Preço (CR) | Venda de volta (CR) | Visual |
|---|---|---|---|
| Comum | 50 | 10 | — |
| Incomum | 150 | 30 | borda prateada |
| Rara | 400 | 80 | borda dourada + brilho holo |
| Mítica | 1 000 | 200 | holo animado |
| Lendária | 2 500 | 500 | holo animado + animação em vídeo (ver 03) |

**Semente inicial de raridade** (o admin ajusta depois):

- cyberland → comum;
- tipo contendo "Lendária"/"Mítico"/"Planinauta" → lendária/mítica;
- "Player Card" → `indisponivel` na loja (só código de evento);
- o resto → comum.

## 4. Histórias de usuário

- **US-2.1** Como jogador, vejo meu saldo de PWC e CR no topo e o extrato em `/#/carteira`.
- **US-2.2** Como jogador, converto PWC em CR informando a quantidade, com prévia do resultado.
- **US-2.3** Como jogador, navego pela loja (`/#/loja`) filtrando por raridade, tipo, preço e "não tenho", e compro uma carta. Se faltar CR e houver PWC, a loja oferece converter exatamente o que falta.
- **US-2.4** Como jogador, vejo minha coleção (`/#/colecao`) com a contagem de cópias, as cartas que faltam em silhueta e o botão "vender excedentes".
- **US-2.5** Como jogador, no deck builder vejo quantas cópias tenho de cada carta. O builder avisa (não bloqueia) quando o deck passa do que possuo, e oferece "comprar o que falta" com o total em CR.
- **US-2.6** Como jogador, proponho uma troca a outro jogador (cartas + PWC de cada lado), ele aceita ou recusa, e tudo é trocado de uma vez.
- **US-2.7** Como jogador, resgato um código de evento.
- **US-2.8** Como jogador, crio uma sala "Coleção" e o servidor garante que os dois decks são legais e possuídos.

## 5. Requisitos funcionais

### 5.1 Ledger e carteiras

| ID | Requisito |
|---|---|
| RF-2.1 | `server/src/economy/ledger.js` expõe `post(db, {kind, idempotencyKey, actor, entries:[{wallet, amount}], meta, reason})`, que valida soma zero por moeda, aplica tudo em `BEGIN IMMEDIATE`, atualiza `wallets.balance` e devolve o tx. Se a chave já existe, devolve o tx original sem reaplicar |
| RF-2.2 | Movimentos de carta (`inventory_moves` + `user_cards`) acontecem **na mesma transação** do lançamento financeiro correspondente |
| RF-2.3 | Reversão (`reversal`) cria um tx espelhado com `reverses_tx_id`. Nunca apaga nem edita um lançamento. Se o usuário já gastou o valor, a reversão falha e o admin decide (ajuste manual com motivo) |
| RF-2.4 | `GET /api/me/ledger` pagina o extrato com descrição legível ("Comprou CleBeer (Lendária)") |

### 5.2 Loja

| ID | Requisito |
|---|---|
| RF-2.5 | A carta só é comprável se `availability = 'loja'`, se agora está em `[available_from, available_until)`, se ainda há estoque, se `per_user_limit` não foi atingido, se a posse ficaria ≤ `max_owned` (padrão: 4; cyberland sem limite, igual a `copyLimit` em `src/stores/decks.js`) e se a flag `shop` está ligada |
| RF-2.6 | O preço vem de `price_credits ?? rarity_defaults.price_credits` **lido dentro da transação**. O cliente manda `expectedPrice`, e se o preço mudou a resposta é `409 price_changed` com o preço novo. Isso evita comprar caro depois de o admin mudar o valor |
| RF-2.7 | Compra em lote ("comprar o que falta para este deck") roda numa transação só: ou tudo, ou nada |
| RF-2.8 | Venda de volta só para cópias acima de `economy.keep_min_copies` (padrão: 0, mas a UI sugere manter 4) e nunca para cartas `evento`/`recompensa` (não revendáveis) |

### 5.3 Conversão

| ID | Requisito |
|---|---|
| RF-2.9 | `POST /api/me/convert {pwc}` debita PWC e credita `pwc × taxa` em CR. A taxa é lida na transação, e o cliente envia `expectedRate` (409 se mudou). Inteiros positivos, ≤ saldo, máximo `economy.convert_max_per_day` |

### 5.4 Trocas

| ID | Requisito |
|---|---|
| RF-2.10 | Uma troca tem `offer` e `request`, cada um com `{pwc, cards:[{uid, qty}]}`, até 20 itens por lado. Só cartas e PWC (R3). Cartas `evento` podem ser marcadas como intransferíveis no catálogo |
| RF-2.11 | Para criar ou aceitar uma troca, as duas contas precisam estar `active`, ter `trade_locked_until` vencido (conta nova: **7 dias** e ≥ 10 partidas concluídas) e respeitar o limite diário (`trade.max_per_day`, padrão 10) |
| RF-2.12 | Itens **não ficam reservados** ao criar a oferta. No aceite, uma transação confere posse e saldo dos dois lados, aplica a taxa e troca tudo atomicamente. Se algo faltar: `409 trade_stale` e a oferta vira `expirada` |
| RF-2.13 | Qualquer edição gera uma **nova** oferta, e a anterior é cancelada. O aceite envia o `hash` do conteúdo que o aceitante viu, e se diferir: 409. Isso evita o golpe de trocar o item no último segundo |
| RF-2.14 | Oferta expira em 72 h. Quem enviou pode cancelar enquanto ela está `aberta` |
| RF-2.15 | Heurística de presente suspeito: troca com valor estimado (soma de `price_credits` + PWC×taxa) desequilibrado acima de `trade.max_imbalance_cr` (padrão 2 000 CR) vai para `em_revisao` e precisa de aprovação de moderador. Combate lavagem e farm por alts |
| RF-2.16 | Encontrar parceiros: lista de desejos e "quem tem o que eu quero" (ver 05 §6.5). Substitui os bots de troca que dominaram o MTGO |

### 5.5 Códigos de resgate

| ID | Requisito |
|---|---|
| RF-2.17 | Códigos de 12 caracteres no alfabeto de `CODE_ALPHABET` (`server/src/rooms.js`). O banco guarda só o `sha256`. Gerados em lote pelo admin, exportados uma única vez em CSV |
| RF-2.18 | Tentativa inválida conta para o rate limit (5/min por conta, 20/h por IP), reaproveitando a lógica de `joinFailures` |

### 5.6 Salas "Coleção" (online)

| ID | Requisito |
|---|---|
| RF-2.19 | `create {mode:'colecao'}` exige conta e `join` exige conta. O protocolo v2 está em 00 §6 |
| RF-2.20 | `deck {deckId}`: o servidor carrega o deck da conta, aplica `problemsForPlay` (portada para `server/src/economy/decks.js`, compartilhando `MIN_PLAY_CARDS`/`MAX_COPIES`) e confere cópias ≤ `user_cards` |
| RF-2.21 | Recompensas de partida usam `result` dos dois lados mais os critérios da tabela de fontes, numa transação com `reward_counters` |
| RF-2.22 | A prática contra a IA e as salas "Livre" continuam com **todas** as cartas liberadas (decisão D3), sem recompensa |

### 5.7 Pacotes aleatórios (D2 — flag `packs`, desligada em produção até D10)

| ID | Requisito |
|---|---|
| RF-2.23 | O admin define **produtos de pacote**: nome, arte, preço em CR, número de cartas, **slots** (ex.: 4 slots "comum", 2 "incomum+", 1 "rara+"), janela e limite diário por jogador |
| RF-2.24 | Cada slot sorteia uma raridade pelas **probabilidades do slot** e depois uma carta dessa raridade entre as `card_catalog` com `pack_weight > 0`, proporcionalmente ao peso. Estoque global e `max_owned` são respeitados. Carta que estouraria `max_owned` vira o reembolso de `sell_credits` em CR, mostrado na abertura |
| RF-2.25 | As **probabilidades efetivas por raridade e por carta são públicas**: página "Probabilidades" do pacote, calculada pelo servidor a partir da configuração vigente |
| RF-2.26 | O sorteio usa `crypto.randomInt` no servidor, **dentro da transação** de compra. O cliente só recebe o resultado. Cada abertura grava `pack_openings` (produto, versão da configuração, cartas, seed de auditoria) |
| RF-2.27 | Garantia anti-azar: a cada `packs.pity_n` pacotes (padrão 10) sem rara ou superior, o próximo garante rara ou superior. O contador fica por jogador e por produto |
| RF-2.28 | Pacotes só se compram com **CR** (sem dinheiro real, D1) e exigem uma declaração de **maioridade** no perfil (`users.adult_confirmed_at`). Sem ela, o botão fica bloqueado com explicação |
| RF-2.29 | Mudar probabilidades ou pesos gera uma **nova versão** da configuração. Aberturas antigas continuam ligadas à versão em que aconteceram |
| RF-2.30 | Ligar a flag `packs` exige papel `owner` e fica registrado no `audit_log` |

Tabelas extras (migração `005_packs.sql`): `pack_products(id, name, art, price_credits, slots JSON, version, window, daily_limit, active)`, `pack_openings(id, user_id, product_id, version, tx_id, cards JSON, created_at)`, `pack_pity(user_id, product_id, since_rare)`.

API: `GET /api/packs` (produtos + probabilidades), `POST /api/packs/:id/open` (`{expectedPrice}` + `Idempotency-Key`) → `{tx, cards, refunds, balances}`, `GET /api/me/packs/history`.

UI: abertura com animação GSAP (as cartas viram uma a uma, brilho pela raridade) em `PackOpenView.vue`. A arte dos pacotes é gerada no Artlist ([03 §5](03-animacoes.md)).

## 6. API

| Método | Rota | Corpo / resposta |
|---|---|---|
| GET | `/api/catalog` | `[{uid, rarity, price, sellPrice, availability, window, stockLeft, perUserLimit, animation}]` (público, cache 60 s) |
| GET | `/api/me/wallet` | `{PWC, CR, rate, limits}` |
| GET | `/api/me/ledger?cursor=` | extrato |
| POST | `/api/me/convert` | `{pwc, expectedRate}` → `{tx, balances}` |
| GET | `/api/me/collection` | `[{uid, qty}]` |
| POST | `/api/shop/buy` | `{items:[{uid, qty, expectedPrice}]}` → `{tx, balances, collection}` |
| POST | `/api/shop/sell` | `{items:[{uid, qty, expectedPrice}]}` |
| POST | `/api/me/redeem` | `{code}` |
| GET | `/api/trades?box=in\|out\|history` | lista |
| POST | `/api/trades` | `{to: publicId, offer, request}` |
| POST | `/api/trades/:id/accept` | `{contentHash}` |
| POST | `/api/trades/:id/decline` · `/cancel` | — |
| GET/PUT | `/api/me/wishlist` | `[{uid, qty}]` |
| GET | `/api/trades/matches` | jogadores que têm o que desejo e desejam o que tenho |

Todas as mutações exigem `Idempotency-Key` e `X-CSRF-Token`.

## 7. Front-end

- **Views novas:**
  - `ShopView.vue` (`/#/loja`): grade com `CardTile` + selo de raridade e preço, filtros reaproveitando `FilterPanel.vue`, carrinho e prévia de conversão;
  - `CollectionView.vue` (`/#/colecao`);
  - `WalletView.vue` (`/#/carteira`);
  - `TradesView.vue` (`/#/trocas`): caixa de entrada/saída, editor de troca lado a lado com o resumo "você dá / você recebe" e o valor estimado de cada lado.
- **Store** `src/stores/economy.js` (catálogo mesclado, coleção, saldo e ações). `cards.js` ganha `catalogFor(uid)`.
- **`DeckBuilderView.vue`**: contador "tenho N", destaque do que falta e botão "Comprar o que falta (X CR)".
- **`LobbyView.vue`**: seletor de modo Livre/Coleção ao criar a sala e escolha do deck da conta.
- **Visual de raridade** em `CardTile.vue`: classe `card-tile--r-<raridade>` com borda e brilho holo em CSS, aproveitando o `card-tile__shine` existente. Respeita `settings.reducedMotion`.
- Animações de recompensa (moedas voando para o saldo) com GSAP, já usado em `GameView.vue`.

## 8. Critérios de aceite

- **CA-2.1** Dadas 50 requisições paralelas de compra da última unidade em estoque, então exatamente 1 dá certo e `stock_sold = stock_total`.
- **CA-2.2** Dada a mesma `Idempotency-Key` enviada 2×, então existe 1 tx e o saldo foi debitado uma vez.
- **CA-2.3** Dado que o admin mudou o preço entre a exibição e o clique, então a compra responde 409 `price_changed` e nada é debitado.
- **CA-2.4** Dado um aceite de troca em que o remetente já não tem a carta, então a resposta é 409, nada muda e a oferta fica `expirada`.
- **CA-2.5** Dado um aceite com `contentHash` diferente do conteúdo atual, então a resposta é 409.
- **CA-2.6** Dada uma conta com menos de 7 dias, então criar troca responde 403 `trade_locked`.
- **CA-2.7** Dada uma sala Coleção em que o deck tem 4 cópias e a coleção 3, então o servidor responde `deck_invalid` com a carta e a quantidade.
- **CA-2.8** Dado o teste de propriedade (10 mil operações aleatórias entre 20 contas), então I1–I5 valem ao final.
- **CA-2.9** Dados relatos `result` divergentes, então nenhuma recompensa de partida é paga.
- **CA-2.10** Dado o 6º jogo do dia, então não há recompensa de participação e a UI mostra "limite diário atingido".

## 9. Tarefas

1. [ ] Migrações `002_catalog.sql`, `003_economy.sql`, sync do catálogo no boot e semente de raridade.
2. [ ] `ledger.js` + testes de propriedade e de concorrência.
3. [ ] Kit inicial no cadastro e login diário.
4. [ ] Loja (buy/sell), conversão, extrato.
5. [ ] Coleção + integração com o deck builder.
6. [ ] Protocolo v2: salas Coleção, `deck`, `decks`, `result`, recompensas.
7. [ ] Trocas + lista de desejos + matches + revisão de troca suspeita.
8. [ ] Códigos de resgate.
9. [ ] UI: loja, coleção, carteira, trocas, visual de raridade.
10. [ ] Termos de uso: moeda sem valor monetário, proibição de RMT, penalidades.

## 10. Riscos e abusos (resumo; detalhes em 05 §5)

| Abuso | Mitigação |
|---|---|
| Farm com contas alternativas (cadastro + diário + presentes) | CR intransferível, trava de 7 dias/10 partidas, revisão de troca desequilibrada, limite diário, mesmo par conta no máximo 2×/dia |
| Colusão / vitória combinada | Recompensa de vitória pequena e com teto, consenso de `result`, servidor autoritativo antes de qualquer prêmio relevante (F6) |
| Mercado secundário de PWC por dinheiro real | Termos proíbem, não existe transferência direta, troca só com contrapartida, auditoria de padrões e banimento |
| Golpe de troca (bait-and-switch) | Ofertas imutáveis + `contentHash` no aceite |
| Corrida de saldo / gasto duplo | `BEGIN IMMEDIATE` + `CHECK balance >= 0` + idempotência |
| Admin malicioso ou conta admin comprometida | Step-up, audit log imutável, RBAC (ajustes acima de um teto exigem `owner`) |
