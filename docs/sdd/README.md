# SDD — Contas, economia, animações e administração do Masters of Pwnage

**Data:** 2026-10-31 · **Status:** proposta para revisão · **Base:** rewrite web (Vue 3 + engine JS + lobby `ws`) do branch `CleBeeR/masters-pwnage-godot-port-ef19e8`

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 00 | [Arquitetura, dados e decisões](00-arquitetura.md) | Estado atual, arquitetura alvo, 7 ADRs, schema SQL, convenções de API, protocolo v2, segurança/LGPD, testes |
| 01 | [Login com Google](01-login-google.md) | OIDC (code + PKCE), sessões, perfil, migração de decks locais |
| 02 | [Dinheiro interno](02-economia.md) | PwnCoins (PWC) → Créditos (CR), loja, coleção, trocas, códigos, salas "Coleção" |
| 03 | [Animações dos personagens](03-animacoes.md) | Níveis N0–N3, pipeline com o MCP do Artlist, orçamento real, consentimento, novos assets |
| 04 | [Tela de administração](04-admin.md) | RBAC, gestão de cartas (preço, raridade, disponibilidade, estoque), economia, moderação, auditoria |
| 05 | [Análise adversarial do MTGO](05-analise-adversarial-mtgo.md) | O que o MTGO acerta e erra, casos de abuso contra este plano, 13 novas features |

## Resumo

- **Hoje:**
  - o MOP é um site estático com engine no navegador e um lobby que só repassa mensagens;
  - não há conta, banco, saldo nem raridade;
  - nas partidas online quem cria a sala é a autoridade.
- **Proposta:**
  - o mesmo container ganha **API + SQLite**;
  - login **Google** com sessão por cookie;
  - economia com **ledger de partidas dobradas** (PWC transferível só em troca, CR intransferível para comprar cartas);
  - **catálogo administrável** como camada sobre `cards/`, que continua intocado;
  - **admin** com RBAC, step-up e auditoria;
  - **animações** em níveis: CSS para todos e vídeo Artlist para raras ou acima com consentimento.
- **Limitação assumida:** enquanto a partida rodar no navegador do host, recompensas de vitória ficam pequenas e com teto. Prêmio relevante (ligas, temporadas) depende da fase F6, com a engine no servidor.

## Roadmap

| Fase | Entrega | Inclui | Depende de |
|---|---|---|---|
| **F0** | Fundação | Fastify, SQLite + migrações, volume e backup, envs, CSP, refatorar o rate limit | — |
| **F1** | Contas | Login Google, perfil, sessões, decks na conta, LGPD | F0 |
| **F2** | Catálogo + loja | Catálogo overlay, raridade e visual de raridade, loja com CR, coleção, kit inicial, diário, deck builder com posse | F1 |
| **F3** | Admin núcleo | RBAC, cartas (edição, massa, CSV), economia, jogadores, ledger, auditoria, flags, sistema | F2 (pode começar junto) |
| **F4** | Moedas e trocas | PWC, conversão, trocas, lista de desejos, códigos de resgate, salas Coleção (protocolo v2), recompensas de partida | F2, F3 |
| **F5** | Animações | N1 em CSS (pode começar em F0), assets Artlist, piloto, pipeline, ondas N2 | F3 para revisão; N1 é independente |
| **F6** | Servidor autoritativo + pagamentos (opcional) | Engine no servidor para salas ranqueadas; compra de PWC com dinheiro real (se D1) | F4 + decisões D1/D2 |
| **F7** | Plataforma P1 (vinda do MTGO) | Amigos, match de trocas, notícias e status, deploy sem derrubar partidas, desafio diário | F4 |
| **F8** | Plataforma P2 | Ligas, cubo fantasma com draft contra IA, espectador, replays, temporadas, trilha mensal | F6 para prêmios |

Antes de abrir o site para a internet (`deploy_mop.py --publico`), rodar o pentest de retest com foco em authn, authz e lógica de negócio (00 §7, S8).

## Decisões (fechadas com o dono do produto em 2026-10-31)

| # | Decisão | Resolução |
|---|---|---|
| D1 | Vender PwnCoins por dinheiro real? | **Não na v1.** PWC vem de códigos de evento e concessão do admin |
| D2 | Boosters aleatórios? | **Sim, os pacotes existem** ([02 §5.7](02-economia.md)), com probabilidades publicadas e restrição a maiores de 18. A flag `packs` fica **desligada em produção** até a validação jurídica (D10) |
| D3 | Prática contra a IA com todas as cartas liberadas? | **Sim.** Posse só vale para salas Coleção e ligas |
| D4 | Build do GitHub Pages continua? | **Sim, só convidado** (`VITE_ACCOUNTS=0`) |
| D5 | Consentimento para animar pessoas reais | **As autorizações já existem.** Personagens entram com `animation_consent = 'concedido'`. O opt-out continua disponível no admin |
| D6 | Banco | **SQLite** (ADR-01) |
| D7 | Site continua só LAN+VPN? | **Sim, por enquanto.** Abrir exige o pentest antes |
| D8 | Importar decks do `localStorage` no primeiro login? | **Sim**, marcando como incompletos os que têm cartas não possuídas |
| D9 | Prêmios de temporada | **Físicos e presenciais**, decididos pelo organizador do evento |
| D10 | Validação jurídica (ECA Digital, Lei 5.768/1971) | **Adiada.** Tudo que depende dela (`packs` em produção, prêmios) fica desligado |
| D11 | Servidor HTTP | **Fastify** (ADR-02) |
| D12 | Valores iniciais da economia, nomes PwnCoin/Crédito, regras de troca, origem das PWC | **Aprovados** como estão em 02 |
| D13 | Pasta `game/` (port Godot) | **Mantida como está**, fora dos commits |
| D14 | Orçamento Artlist | Piloto (~2,7 mil créditos) e teto da onda 1 (~8 mil) **aprovados**. Uso dos gerados num jogo público **confirmado** nos termos do plano |

## Convenções deste SDD

- IDs: `RF-x.y` (requisito funcional), `CA-x.y` (critério de aceite), `S#` (segurança transversal), `D#` (decisão), `F-M#` (feature vinda da análise do MTGO).
- Restrições permanentes do projeto: **nunca editar `cards/*.json` nem `images/*`**. Os assets gerados vão para `public/` (build) ou `/data/media` (servidor). Assets de produto versionados vão para `src/assets/art/`.
