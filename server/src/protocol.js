import { CODE_ALPHABET, CODE_LENGTH } from './rooms.js';

export const PROTOCOL_VERSION = 1;
export const MAX_NAME = 24;
export const MAX_ROOM_NAME = 32;

// Control characters, zero-width and bidi override characters (used for name spoofing).
const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return '';
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return '';
  return code;
}

export function parseMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return null;
  return msg;
}

export const ERRORS = {
  bad_request: 'Mensagem inválida.',
  not_ready: 'Envie hello primeiro.',
  room_not_found: 'Sala não encontrada. Confira o código.',
  room_full: 'A sala já está cheia.',
  room_started: 'A partida desta sala já começou.',
  server_full: 'O servidor está lotado. Tente mais tarde.',
  rate_limited: 'Muitas mensagens. Aguarde um pouco.',
  too_many_attempts: 'Muitas tentativas de código inválido. Aguarde um minuto.',
  not_in_room: 'Você não está em uma sala.',
  payload_too_large: 'Mensagem grande demais.',
  bad_token: 'Sessão expirada.',
  version: 'Versão do jogo incompatível com o servidor. Atualize o jogo.',
  not_found: 'Recurso não encontrado.',
  internal: 'Erro interno. Tente novamente.',
  unauthenticated: 'Entre com sua conta para continuar.',
  forbidden: 'Você não tem permissão para isso.',
  bad_origin: 'Origem da requisição não permitida.',
  bad_csrf: 'Sessão inválida para esta ação. Recarregue a página.',
  accounts_disabled: 'Contas não estão habilitadas neste servidor.',
  too_many_decks: 'Limite de decks da conta atingido.',
  deck_invalid: 'Deck inválido.',
  confirm_mismatch: 'A confirmação não confere.',
};
