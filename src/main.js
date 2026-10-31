import './styles/main.css';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadCards } from './stores/cards.js';
import { initDecks } from './stores/decks.js';
import { loadAccount } from './stores/account.js';
import { loadCatalog } from './stores/economy.js';
import { applyVolumes, unlockAudio } from './stores/audio.js';
import { settings } from './stores/settings.js';
import { watch } from 'vue';

const app = createApp(App);
app.use(router);
app.mount('#app');

Promise.all([loadCards(), loadAccount().then(() => loadCatalog().catch(() => {}))]).then(() => initDecks());
watch(() => [settings.music, settings.sfx], applyVolumes);
// Audio contexts only start after a user gesture.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlockAudio, { passive: true });
