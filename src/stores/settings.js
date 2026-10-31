/** User preferences persisted in localStorage. */
import { reactive, watch } from 'vue';

const KEY = 'mop.settings.v1';

export const settings = reactive({
  playerName: '',
  music: 0.5,
  sfx: 0.8,
  reducedMotion: false,
  showReminders: true,
  enforceRules: true,
  lastDeck: '',
  serverUrl: '',
  // Character animations: 'sempre' (also on hover) | 'ampliar' (zoom only) | 'desligado'.
  cardMotion: window.matchMedia?.('(hover: hover)').matches ? 'sempre' : 'ampliar',
});

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  Object.assign(settings, saved);
} catch { /* storage unavailable */ }

if (!settings.playerName) settings.playerName = `Hacker${Math.floor(Math.random() * 900 + 100)}`;
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settings.reducedMotion = true;

watch(settings, (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* ignore */ }
}, { deep: true });

/** Whether character animations may play (zoom = the card zoom dialog). Off with reduced motion or data saver. */
export function motionEnabled(zoom = false) {
  if (settings.reducedMotion || navigator.connection?.saveData) return false;
  if (settings.cardMotion === 'desligado') return false;
  return zoom || settings.cardMotion === 'sempre';
}

/** Lobby server WebSocket URL: setting > build env > config.json > same origin. */
export async function resolveServerUrl() {
  if (settings.serverUrl) return settings.serverUrl;
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.server_url) return cfg.server_url;
    }
  } catch { /* no config */ }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
