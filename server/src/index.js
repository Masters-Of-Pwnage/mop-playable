import fs from 'node:fs';
import { createServer } from './server.js';

const server = createServer();
const { config } = server;
const address = await server.listen();
const hasGame = fs.existsSync(`${config.staticDir}/index.html`);
console.log(`[mop-server] ouvindo em http://${address.address}:${address.port}`);
console.log(`[mop-server] lobby WebSocket: ws://<host>:${address.port}/ws`);
console.log(hasGame
  ? `[mop-server] servindo o jogo web de ${config.staticDir}`
  : `[mop-server] AVISO: build web não encontrado em ${config.staticDir} (exporte o preset "Web" do Godot)`);

function shutdown() {
  console.log('[mop-server] encerrando...');
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
