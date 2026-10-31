# Masters of Pwnage Playable

Aplicação web do **Masters of Pwnage**, o card game da comunidade hacker brasileira: monte decks
com as cartas oficiais, imprima frente e verso em PDF e **jogue no navegador** contra a IA ou
online, em salas públicas ou particulares.

Acesse: https://masters-of-pwnage.github.io/mop-playable/

Todo o projeto é gerenciado pelo GitHub (issues, milestones, releases) e desenvolvido por
voluntários, em código aberto.

## O que o site faz

- **Construtor de decks** com busca por nome/texto, filtros por custo, tipo e cor de mana, curva
  de mana, estatísticas, limite de 60 cartas e 4 cópias (terrenos ilimitados), decks salvos no
  navegador, importação/exportação em JSON (compatível com o formato antigo) e 5 decks temáticos
  prontos + o deck campeão da H2HC 2024.
- **Impressão em PDF** (A4, 63×88 mm, 9 cartas por folha): cada página de versos é seguida pela
  página de frentes com as colunas espelhadas, para impressão frente e verso alinhada.
- **Jogo completo no navegador** com regras assistidas (mana, custos híbridos/genéricos/X,
  fases, pilha, combate com voar/alcance/vigilância/ímpeto/atropelar/toque mortífero/vínculo
  com a vida/iniciativa/indestrutível/bloqueio duplo, fichas, contadores, limite de mão,
  mulligan), modo livre (sem imposição de regras), animações de cartas (GSAP), zoom das cartas,
  log e chat.
- **Partida contra a IA** direto do construtor ("Testar contra a IA").
- **Jogo online** com salas **públicas** (listadas no lobby) e **particulares** (código de 6
  letras ou link direto `#/play/CODIGO`), chat, reconexão automática e aviso quando o oponente
  cai.
- Arte, trilhas sonoras e identidade visual próprias (ver [Créditos](#créditos-de-arte-e-áudio)).

As cartas em `cards/*.json` e `images/` são a fonte da verdade e **não são alteradas**: o build
só gera cópias redimensionadas e um índice em `public/`.

## Rodando localmente

Requisitos: Node.js 20+.

```bash
npm install
npm run cards      # gera public/cards.json, public/image e public/thumb a partir de cards/ e images/
npm run dev        # http://localhost:5173/mop-playable/
```

Outros scripts:

| Script | O que faz |
| --- | --- |
| `npm test` | Testes do motor de regras (`tests/engine.test.mjs`): custos, pagamento de mana, combate, mulligan, IA, serialização. |
| `npm run build` | Build de produção em `dist/` (roda `npm run cards` antes). Use `BASE_PATH=/ npm run build` para servir na raiz. |
| `npm run preview` | Serve a build de produção. |
| `npm run server` | Sobe o servidor de salas (ver abaixo). |

Para jogar online em desenvolvimento, suba o servidor em outro terminal (`npm run server`) e, na
tela **Jogar online**, informe `ws://localhost:8787/ws` em "Servidor" (ou defina
`VITE_SERVER_URL` antes do `npm run dev`).

## Servidor de salas (`server/`)

Servidor Node.js (dependência única: `ws`) que:

- serve a build estática (`dist/`) e o endpoint `/config.json` (informa a URL do WebSocket ao site);
- mantém o lobby em `/ws`: sessões com token de retomada, salas públicas/particulares com código
  de 6 caracteres, relé de mensagens entre os dois jogadores (o anfitrião é a autoridade do
  estado da partida), tolerância a quedas (60 s por padrão), limites de taxa e de tamanho;
- expõe `/health` e `/api/rooms` (salas públicas abertas).

```bash
cd server
npm install
npm test           # testes do lobby e do protocolo
npm start          # http://localhost:8787
```

Variáveis de ambiente (todas opcionais):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Porta e interface. |
| `STATIC_DIR` | `../dist` | Pasta da build do site (vazio = só o lobby). |
| `ALLOWED_ORIGINS` | (qualquer) | Lista separada por vírgula de origens aceitas no WebSocket. |
| `PUBLIC_WS_URL` | (derivada) | URL pública do WebSocket informada em `/config.json`. |
| `RECONNECT_GRACE_SECONDS` | `60` | Tempo para um jogador voltar à sala após cair. |
| `MAX_CLIENTS`, `MAX_CLIENTS_PER_IP`, `MAX_ROOMS` | — | Limites de capacidade. |
| `MAX_MESSAGE_BYTES`, `MAX_RELAY_BYTES`, `RATE_LIMIT_*`, `JOIN_FAILURES_PER_MINUTE` | — | Limites de abuso. |
| `TRUST_PROXY` | `0` | Número de proxies reversos na frente (`1` atrás de um proxy/CDN). O IP do cliente é lido da direita do `X-Forwarded-For`, a parte que ele não consegue forjar. |
| `CLIENT_IP_HEADER` | (vazio) | Cabeçalho com o IP do cliente escrito pela plataforma (no Fly: `Fly-Client-IP`). Tem prioridade sobre `TRUST_PROXY`. Só use um cabeçalho que o proxy sobrescreve. |
| `MAX_ROOMS_PER_IP`, `MAX_BUFFERED_BYTES`, `MAX_TOTAL_BUFFERED_BYTES`, `MAX_SOCKET_BACKLOG_BYTES`, `RATE_LIMIT_BYTES_PER_SECOND`, `RATE_LIMIT_BURST_BYTES` | 5, 8 MiB, 64 MiB, 4 MiB, 2 MiB, 8 MiB | Tetos por IP e em bytes (fila de quem caiu, fila de quem não lê, tráfego por conexão). |
| `CROSS_ORIGIN_ISOLATION` | `0` | Envia cabeçalhos COOP/COEP. |
| `TRUSTED_PROXIES` | (qualquer) | CIDRs dos proxies que podem informar o IP do cliente (`CLIENT_IP_HEADER`/`X-Forwarded-For`). Vindo de outro endereço, vale o IP da conexão. Defina sempre que algo além do proxy alcançar a porta do servidor. |
| `ADMIN_ALLOW_CIDRS` | (qualquer) | CIDRs que podem usar `/api/admin/*` (ex.: rede de casa e VPN). Fora da lista: 403 antes do login. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | (vazio) | Cloudflare Access na frente de `/api/admin/*` (ex.: `somosum.cloudflareaccess.com` e a AUD da aplicação). Com os dois, o servidor também exige o JWT do Access nessas rotas. O admin entra por `/api/admin/access`; o `scripts/anim/push.mjs` usa um service token (`CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`). |
| `REQUEST_TIMEOUT_SECONDS` | `30` | Prazo para receber uma requisição HTTP inteira (cabeçalhos + corpo). |
| `CSP_MODE` | `enforce` | `report` manda a CSP das páginas como `Report-Only` (só para diagnosticar um asset novo). |
| `PRIVACY_CONTROLLER`, `PRIVACY_CONTACT` | (vazio) | Controlador dos dados e canal do titular (e-mail ou URL https) exibidos no aviso de privacidade. |
| `BACKUP_HOURS`, `BACKUP_KEEP` | `24`, `7` | Cópia do SQLite em `DATA_DIR/backups` (0600). A cópia externa cifrada e o ensaio de restauração ficam em `scripts/ops/` (restic). |

## Deploy

**Site (GitHub Pages)** — o workflow `.github/workflows/gh-pages.yml` instala, testa, gera as
cartas e publica `dist/` a cada push em `main`. Defina a variável de repositório
`LOBBY_SERVER_URL` (ex.: `wss://masters-of-pwnage.fly.dev/ws`) para o site publicado apontar para
o seu servidor de salas. Sem ela, o site tenta `/config.json` na mesma origem e, por fim, `/ws`.

**Servidor (site + salas na mesma origem)** — a imagem Docker (`Dockerfile`) faz a build com
`BASE_PATH=/` e sobe o servidor servindo o site. Arquivos prontos:

- `fly.toml` — Fly.io (`fly launch --copy-config && fly deploy`);
- `render.yaml` — Render.com (blueprint, plano gratuito, health check em `/health`);
- `docker build -t mop . && docker run -p 8787:8787 mop` — qualquer host com Docker.

Ordem de resolução da URL do servidor no cliente: campo "Servidor" na tela de jogo online →
`VITE_SERVER_URL` (build) → `/config.json` da origem → `ws(s)://<origem>/ws`.

## Estrutura do projeto

```
├── cards/                  # JSON oficial das cartas (fonte da verdade, não editar pelo build)
├── images/                 # Imagens oficiais das cartas
├── decks/                  # Decks de referência (ex.: campeão H2HC 2024)
├── scripts/
│   ├── build-cards.mjs     # cards/ + images/ -> public/cards.json, public/image, public/thumb
│   └── build-starter-decks.mjs  # decks temáticos -> src/data/starter-decks.json
├── public/                 # favicon, ícones, og.jpg (+ saídas geradas, ignoradas pelo git)
├── src/
│   ├── engine/             # Motor de regras puro (sem Vue): mana.js, cards.js, engine.js, ai.js
│   ├── game/               # match.js (local/online), layout.js (mesa), print.js (PDF), session.js
│   ├── net/client.js       # Cliente do lobby (WebSocket, reconexão, salas)
│   ├── stores/             # cards, decks (localStorage), settings, audio
│   ├── views/              # Home, DeckBuilder, Lobby, Game, Rules
│   ├── components/         # Cartas, filtros, modais, mesa de jogo (components/game)
│   ├── assets/art, audio   # Arte e trilhas geradas (ver créditos)
│   └── styles/main.css     # Tema neon (Tailwind)
├── server/                 # Servidor de salas + estático (Node + ws), com testes
├── tests/engine.test.mjs   # Testes do motor
├── Dockerfile, fly.toml, render.yaml
└── game/                   # Versão Godot (desktop/mobile), independente do site
```

Stack: Vue 3, Vite 6, Tailwind 3, vue-router (hash), GSAP, jsPDF, sharp (build), Node `ws`.

## Formato do deck (JSON)

```json
{
  "id": "uuid",
  "name": "Meu deck",
  "author": "Nome",
  "author_social": "@social",
  "cards": [{ "id": "<id da carta>", "name": "...", "amount": 2 }]
}
```

`amount`/`ammount` são aceitos na importação; cartas com `id` duplicado no catálogo recebem um
`uid` (`id#arquivo`) que também é aceito.

## Protocolo online (resumo)

O lobby só repassa mensagens. Dentro da sala, o anfitrião (assento 0) executa todos os comandos
do motor e transmite cada um (`cmd`); o convidado envia pedidos (`req`), que o anfitrião valida e
só aceita para o assento 1. Snapshots completos (`state`) ressincronizam um convidado que
reconectou ou detectou divergência. Toda aleatoriedade (embaralhar, mulligan, quem começa) é
resolvida pelo anfitrião e enviada como parte do comando, então os dois lados ficam idênticos.

## Créditos de arte e áudio

- Arte de fundo (home, mesa, lobby, deck, vitória/derrota) gerada no Artlist (Seedream 5.0) e
  logo (GPT Image), sem alterar nenhuma carta.
- Trilhas (menu, construtor, partida, vitória, derrota) geradas no Artlist (Lyria 3 Pro).
- Efeitos sonoros sintetizados em tempo real com Web Audio. Para trocar qualquer efeito por uma
  gravação, coloque um arquivo com o mesmo nome em `src/assets/audio/sfx/` (ex.: `click.mp3`,
  `draw.mp3`, `attack.mp3`).

## Como contribuir

1. Faça um fork deste repositório.
2. Escolha uma única tarefa/issue, faça o commit no seu fork e abra um Pull Request.
   Para mudanças visuais, inclua uma captura de tela.
3. Código em inglês; comunicação (issues, comentários, PRs) pode ser em português.
4. Seja cordial, estamos todos aqui para aprender.
