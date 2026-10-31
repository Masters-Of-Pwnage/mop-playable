# 04 — Tela de administração do jogo

> Depende de: [00-arquitetura.md](00-arquitetura.md) (ADR-07, `audit_log`, `settings`, S4/S5/S9), [02-economia.md](02-economia.md) e [03-animacoes.md](03-animacoes.md).

## 1. Objetivo

Uma área `/#/admin` para o dono do jogo administrar tudo, em especial **valor, raridade e disponibilidade de cada carta** para compra, além de usuários, economia, trocas, salas, animações, conteúdo e segurança.

## 2. Papéis e permissões

| Capacidade | moderator | admin | owner |
|---|:-:|:-:|:-:|
| Ver painel, usuários, trocas, salas, logs | ✔ | ✔ | ✔ |
| Suspender/banir jogador, cancelar troca, fechar sala | ✔ | ✔ | ✔ |
| Editar catálogo (preço, raridade, disponibilidade, estoque) | | ✔ | ✔ |
| Configurar economia, flags, notícias, ligas | | ✔ | ✔ |
| Ajustar saldo/coleção, reverter tx, emitir códigos (step-up) | | ✔ (até `admin.adjust_cap`, padrão 5 000 CR / 500 PWC) | ✔ (sem teto) |
| Aprovar animações, marcar consentimento | | ✔ | ✔ |
| Conceder/revogar papéis, tokens de API, exportar banco | | | ✔ |

Toda rota `/api/admin/*` passa por `requireRole(min)`. Ações marcadas com step-up exigem `auth_time` < 15 min (S4). Toda mutação grava no `audit_log` com `before`/`after`.

## 3. Mapa de telas

```
/#/admin
├── Painel           KPIs: jogadores ativos (24h/7d), partidas, salas agora, CR/PWC emitidos × queimados,
│                    vendas por raridade, top cartas compradas, trocas em revisão, alertas de invariantes
├── Cartas           catálogo (foco desta spec, §4)
│   ├── Lista + edição em massa
│   ├── Detalhe da carta (preço, raridade, disponibilidade, estoque, animação, histórico)
│   └── Importar/Exportar CSV
├── Economia         taxa PWC→CR, preços padrão por raridade, recompensas e tetos, taxas de troca,
│                    trava de contas novas, simulador de impacto
├── Jogadores        busca, perfil, coleção, extrato, sessões, ações (suspender, banir, ajustar, papéis)
├── Ledger           consulta de tx (filtros), detalhe, reversão
├── Trocas           abertas, em revisão, histórico; aprovar/recusar/reverter
├── Códigos          lotes de resgate (criar, exportar uma vez, desativar, uso)
├── Salas            salas ao vivo (RoomManager), encerrar sala, expulsar seat
├── Animações        fila, revisão (player sobre a moldura real), consentimento, custo por onda
├── Conteúdo         notícias in-game, banner, janela de manutenção (ver 05)
├── Ligas/Temporadas (fase F7, ver 05 §6)
├── Flags            accounts, shop, trades, animations, packs, payments, leagues, spectate
├── Auditoria        audit_log filtrável e exportável
└── Sistema          saúde (invariantes I1–I5), backup/último backup, versão, tokens de API
```

## 4. Gestão de cartas (requisito central)

### 4.1 Campos editáveis por carta (`card_catalog`)

| Campo | Controle | Regras |
|---|---|---|
| Raridade | select (comum, incomum, rara, mítica, lendária) | Mudar a raridade com o preço "padrão" mostra o preço novo antes de salvar |
| Preço (CR) | número ou "usar padrão da raridade" | Inteiro ≥ 0. Mudança maior que ±50 % pede confirmação |
| Venda de volta (CR) | número ou padrão | ≤ preço |
| Disponibilidade | `loja` · `recompensa` · `evento` · `indisponivel` | `evento`/`recompensa` não aparecem na loja |
| Janela | início/fim (data-hora, America/Sao_Paulo) | início < fim. Fora da janela, a carta aparece como "em breve" ou "encerrada" |
| Estoque global | ilimitado ou N | N ≥ vendidos. Mostra a barra de vendidos/estoque |
| Limite por jogador | vazio ou N | — |
| Posse máxima | padrão (4; cyberland livre) ou N | — |
| Transferível em troca | sim/não | Cartas de evento ficam não por padrão |
| Consentimento de animação | pendente · concedido · negado · não se aplica | Mudar para "negado" arquiva a animação na hora |
| Peso em booster | número | Só visível com a flag `packs` ligada |

### 4.2 Lista e edição em massa

- Tabela virtualizada com miniatura (`thumb`), nome, tipo, raridade, preço efetivo, disponibilidade, estoque, vendidas (7d/total), donos, animação (N0–N2) e consentimento.
- Filtros: texto, tipo (reaproveita `FILTER_TYPES`), raridade, disponibilidade, "sem preço próprio", "órfãs", "com/sem animação", "consentimento pendente".
- **Edição em massa:** selecionar por filtro ou por checkbox e aplicar raridade, preço, % de reajuste, disponibilidade, janela ou limite. Antes de salvar mostra uma **prévia** com o diff por carta e o impacto ("12 cartas, preço médio 150 → 180 CR").
- **CSV:** exportar e importar com as colunas `uid,name,rarity,price_credits,sell_credits,availability,available_from,available_until,stock_total,per_user_limit,max_owned,tradeable`. A importação faz *dry-run* com o diff e só aplica depois de confirmar. `uid` desconhecido é erro.
- **Histórico** por carta vindo do `audit_log`, com botão "restaurar esta versão".
- **Prévia ao vivo:** o `CardTile` real com o visual da raridade e a animação aprovada.

### 4.3 Programação de vitrine

- "Destaques da semana": lista ordenada de `uid` com janela de exibição, mostrada no topo da loja.
- "Promoção": desconto em % com janela, aplicado ao preço efetivo e mostrado riscado na loja. Fica em `settings.promotions`, e o preço com desconto é calculado no servidor dentro da transação.

## 5. Economia (configuração)

Tudo em `settings` (chave/valor JSON), versionado pelo `audit_log`:

| Chave | Padrão |
|---|---|
| `economy.pwc_to_cr` | 10 |
| `economy.signup_grant_cr` | 500 |
| `economy.daily_cr` | 50 |
| `economy.match_participation_cr` / `_max_day` | 20 / 5 |
| `economy.match_win_cr` / `_max_day` | 10 / 3 |
| `economy.convert_max_per_day` | 1 000 PWC |
| `trade.fee_pct` / `trade.max_per_day` / `trade.max_imbalance_cr` | 5 / 10 / 2 000 |
| `trade.new_account_days` / `trade.new_account_matches` | 7 / 10 |
| `admin.adjust_cap` | `{CR: 5000, PWC: 500}` |

**Simulador:** com os dados dos últimos 30 dias, estima a emissão diária de CR, o preço médio para completar uma coleção e os dias de jogo para comprar uma lendária. Ajuda a calibrar antes de salvar.

## 6. Jogadores e moderação

- Busca por apelido, `publicId` ou e-mail. O e-mail aparece mascarado para `moderator`.
- Perfil: status, papel, datas, sessões (revogar), coleção, extrato, trocas, salas recentes, códigos usados e notas internas.
- Ações:
  - suspender com prazo e motivo;
  - banir (revoga sessões e cancela trocas abertas);
  - "trava de trocas" com prazo;
  - ajustar saldo/coleção, que exige motivo, step-up e passa por `ledger.post(kind:'admin_adjust')`. Nunca é um UPDATE direto.
- **Reversão** de tx: escolher o tx, ver o efeito e confirmar. Cria um `reversal` (02 RF-2.3).

## 7. Salas ao vivo

- `GET /api/admin/rooms` lê `RoomManager` (código, visibilidade, modo, seats com conta/convidado, IPs mascarados, início, mensagens buffer). `rooms.stats()` já existe.
- Ações: encerrar sala (`leaveRoom` para os dois com motivo `admin`) e expulsar um seat.
- Para ver uma partida, usa-se o modo espectador (05 §6.3) com o mesmo filtro de redação de `redactFor`.

## 8. API administrativa (resumo)

| Método | Rota |
|---|---|
| GET | `/api/admin/dashboard` |
| GET | `/api/admin/catalog?filters` · `/api/admin/catalog/:uid` · `/api/admin/catalog/:uid/history` |
| PATCH | `/api/admin/catalog/:uid` (`If-Match: updated_at`, 409 em edição concorrente) |
| POST | `/api/admin/catalog/bulk` (`{selector, changes, dryRun}`) |
| GET/POST | `/api/admin/catalog/export.csv` · `/api/admin/catalog/import` (`dryRun`) |
| GET/PUT | `/api/admin/settings/:key` · `/api/admin/rarity-defaults` |
| GET | `/api/admin/users?q=` · `/api/admin/users/:id` |
| POST | `/api/admin/users/:id/{suspend,ban,unban,trade-lock,adjust,role,revoke-sessions}` |
| GET | `/api/admin/ledger?filters` · `/api/admin/ledger/:tx` |
| POST | `/api/admin/ledger/:tx/reverse` |
| GET/POST | `/api/admin/trades` · `/api/admin/trades/:id/{approve,reject,reverse}` |
| GET/POST | `/api/admin/codes` · `/api/admin/codes/:batch/{export,disable}` |
| GET/POST | `/api/admin/rooms` · `/api/admin/rooms/:code/{close,kick}` |
| GET/POST | `/api/admin/animations` · `/api/admin/animations/:uid` (upload) · `/:id/{approve,reject,archive}` |
| GET/PUT | `/api/admin/news` · `/api/admin/maintenance` · `/api/admin/flags` |
| GET | `/api/admin/audit?filters` · `/api/admin/health/ledger` |
| GET/POST/DELETE | `/api/admin/tokens` (owner) |

## 9. Front-end

- Rota `/admin` com filhas, carregadas sob demanda (`() => import('./views/admin/...')`) para não pesar no bundle do jogador, e guard que checa `account.user.role`. O guard é só conveniência: a proteção está no servidor.
- Pasta `src/views/admin/` com `AdminLayout.vue` (menu lateral; vira gaveta no celular), `CardsAdmin.vue`, `CardEditor.vue`, `EconomyAdmin.vue`, `UsersAdmin.vue`, `LedgerAdmin.vue`, `TradesAdmin.vue`, `CodesAdmin.vue`, `RoomsAdmin.vue`, `AnimationsAdmin.vue`, `ContentAdmin.vue`, `FlagsAdmin.vue`, `AuditAdmin.vue`, `SystemAdmin.vue`.
- Componentes reaproveitados: `CardTile`, `FilterPanel`, `UiModal`, `toast`.
- Confirmações destrutivas usam `UiModal` com digitação do alvo (por exemplo, o apelido para banir), nunca `window.confirm`.
- O visual segue o tema existente (`src/styles/main.css`, tokens Tailwind) e o fundo gerado no Artlist (03 §5).

## 10. Critérios de aceite

- **CA-4.1** Dado um `player` chamando `PATCH /api/admin/catalog/:uid`, então a resposta é 403 e nada muda.
- **CA-4.2** Dado um admin que muda o preço da carta X de 400 para 500, então `GET /api/catalog` reflete a mudança em ≤ 60 s, a compra com `expectedPrice=400` responde 409 e o `audit_log` registra antes/depois.
- **CA-4.3** Dada uma edição em massa com `dryRun=true`, então nada muda e a resposta lista o diff.
- **CA-4.4** Dado um CSV com um `uid` inexistente, então a importação falha inteira com a linha indicada.
- **CA-4.5** Dada uma carta com janela futura, então a loja mostra "em breve" e a compra responde `409 not_available`.
- **CA-4.6** Dado um ajuste de saldo sem step-up recente, então a resposta é `401 step_up_required` e a UI redireciona ao Google com `max_age=0`.
- **CA-4.7** Dado um admin ajustando acima de `admin.adjust_cap`, então a resposta é 403 (só `owner`).
- **CA-4.8** Dados dois admins editando a mesma carta, então o segundo salvamento com `If-Match` antigo responde 409.
- **CA-4.9** Dado o painel Sistema, então mostra I1–I5 em verde e a data do último backup.

## 11. Tarefas

1. [ ] Middlewares RBAC + step-up + audit + migração `004_admin.sql`.
2. [ ] Endpoints de catálogo (lista, detalhe, patch, bulk, CSV, histórico) e o front `CardsAdmin`/`CardEditor`.
3. [ ] Economia: settings, rarity defaults, simulador.
4. [ ] Jogadores, ledger, reversão.
5. [ ] Trocas em revisão e códigos.
6. [ ] Salas ao vivo (ponte com `RoomManager`).
7. [ ] Animações (upload, revisão, consentimento).
8. [ ] Conteúdo, flags, manutenção.
9. [ ] Auditoria, sistema, tokens de API.
10. [ ] Access list do NPM em `/api/admin` (S9; o `/#/admin` é fragmento e nunca chega ao proxy, então a proteção fica toda na API) + pentest focado em authz.
