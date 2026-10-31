/**
 * Carries the match configuration between the lobby/home and the game view.
 * pending = { mode: 'ai' | 'online', deckId?, players?: [...], seat?: number }
 */
import { reactive } from 'vue';

export const session = reactive({ pending: null, result: null });
