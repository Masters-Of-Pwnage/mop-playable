/** Helpers shared by the admin pages. */
import { api, login } from '../../stores/account.js';
import { toast } from '../../composables/toast.js';

export { api };

/** Shows an API error; a step-up refusal sends the admin to a fresh Google login (S4). */
export function showError(err) {
  if (err?.code === 'step_up_required') {
    toast('Por segurança, entre de novo com o Google para confirmar esta ação.', 'warn', 4000);
    setTimeout(() => login({ stepUp: true }), 1500);
    return;
  }
  if (err?.code === 'access_required') {
    // One trip to the Access login per minute: if it keeps failing, say so instead of looping.
    let last = 0;
    try { last = Number(sessionStorage.getItem('mop_access_redirect')) || 0; } catch { /* storage off */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem('mop_access_redirect', String(Date.now())); } catch { /* storage off */ }
      toast('Abrindo o login do Cloudflare Access para o painel de administração…', 'warn', 4000);
      setTimeout(() => window.location.assign('/api/admin/access'), 1500);
      return;
    }
  }
  const extra = err?.data?.field ? ` (campo: ${err.data.field})` : err?.data?.uid ? ` (carta: ${err.data.uid})` : '';
  toast(`${err?.message || 'Erro'}${extra}`, 'error', 5000);
}

export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR') : '–');
export const fmtNum = (n) => (n ?? 0).toLocaleString('pt-BR');

/** datetime-local input value <-> epoch ms (local time). */
export function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export const RARITY_COLORS = { comum: '#9aa5ad', incomum: '#d6e2ea', rara: '#ffc94d', mitica: '#ff7a45', lendaria: '#ff5ef0' };
export const AVAILABILITY_LABELS = { loja: 'Loja', recompensa: 'Recompensa', evento: 'Evento', indisponivel: 'Indisponível' };
export const CONSENT_LABELS = { pendente: 'Pendente', concedido: 'Concedido', negado: 'Negado', nao_se_aplica: 'Não se aplica' };
export const ROLE_LABELS = { player: 'Jogador', moderator: 'Moderação', admin: 'Administração', owner: 'Dono' };
