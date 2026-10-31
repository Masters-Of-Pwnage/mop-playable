import { ERRORS } from './protocol.js';

/** API error body: { error: code, message: text in pt-BR } (docs/sdd/00-arquitetura.md §5). */
export function apiError(code, message) {
  return { error: code, message: message || ERRORS[code] || code };
}
