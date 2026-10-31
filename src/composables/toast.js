import { reactive } from 'vue';
import { sfx } from '../stores/audio.js';

export const toasts = reactive([]);
let seq = 0;

/** kind: info | ok | warn | error */
export function toast(text, kind = 'info', ms = 2800) {
  const id = seq += 1;
  toasts.push({ id, text, kind });
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  }, ms);
  if (kind === 'error') sfx('error');
  else if (kind === 'ok') sfx('notify');
}
