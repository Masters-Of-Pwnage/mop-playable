<template>
  <section class="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
    <h1 class="title text-3xl font-bold">Perfil</h1>

    <div v-if="!account.loaded" class="mt-6 muted">Carregando…</div>

    <div v-else-if="!account.enabled" class="panel-glass mt-6 p-5">
      <p>Contas não estão disponíveis nesta versão do jogo. Você continua podendo montar decks e jogar como convidado.</p>
    </div>

    <div v-else-if="!account.user" class="panel-glass mt-6 flex flex-col items-start gap-4 p-5">
      <p>Entre com sua conta Google para guardar seus decks em qualquer dispositivo e, em breve, montar sua coleção.</p>
      <button class="btn google-btn" @click="login"><GoogleIcon class="h-4 w-4" /> Entrar com o Google</button>
      <RouterLink to="/privacidade" class="text-sm underline muted hover:text-neon">Como usamos seus dados</RouterLink>
    </div>

    <template v-else>
      <div class="panel-glass mt-6 p-5">
        <div class="flex items-center gap-4">
          <img v-if="account.user.showAvatar && account.user.googleAvatarUrl" :src="account.user.googleAvatarUrl" alt="" class="h-14 w-14 rounded-full" referrerpolicy="no-referrer" />
          <div v-else class="grid h-14 w-14 place-items-center rounded-full border border-neon/60 font-mono text-2xl text-neon">{{ account.user.displayName.slice(0, 1).toUpperCase() }}</div>
          <div class="min-w-0">
            <div class="truncate text-xl font-bold">{{ account.user.displayName }}</div>
            <div class="text-sm muted">Conta desde {{ since }} · {{ roleLabel }}</div>
          </div>
        </div>

        <form class="mt-6 flex flex-col gap-4" @submit.prevent="save">
          <label class="flex flex-col gap-1">
            <span class="text-sm muted">Apelido (aparece no lobby e nas partidas)</span>
            <input v-model="name" class="input" maxlength="24" required />
          </label>
          <label class="flex items-center gap-2">
            <input v-model="showAvatar" type="checkbox" class="h-4 w-4 accent-[color:var(--neon)]" />
            <span>Mostrar a foto da minha conta Google para outros jogadores</span>
          </label>
          <div>
            <button class="btn btn-primary" :disabled="saving || !dirty">Salvar</button>
          </div>
        </form>
      </div>

      <div class="panel-glass mt-4 p-5">
        <h2 class="subtitle text-lg font-bold">Sessões</h2>
        <ul class="mt-3 flex flex-col gap-2 text-sm">
          <li v-for="(s, i) in sessions" :key="i" class="flex flex-wrap items-center justify-between gap-2 border-b border-neon/10 pb-2">
            <span class="min-w-0 truncate">{{ device(s.userAgent) }}<span v-if="s.current" class="ml-2 text-neon">(esta)</span></span>
            <span class="muted">desde {{ date(s.createdAt) }}</span>
          </li>
        </ul>
        <div class="mt-4 flex flex-wrap gap-2">
          <button class="btn" @click="signOut(false)">Sair</button>
          <button class="btn" @click="signOut(true)">Sair de todos os dispositivos</button>
        </div>
      </div>

      <div class="panel-glass mt-4 p-5">
        <h2 class="subtitle text-lg font-bold">Seus dados</h2>
        <p class="mt-2 text-sm muted">Baixe tudo que guardamos sobre você ou exclua sua conta. <RouterLink to="/privacidade" class="underline hover:text-neon">Política de privacidade</RouterLink>.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button class="btn" @click="exportData">Baixar meus dados</button>
          <button class="btn btn-danger" @click="deleteOpen = true">Excluir conta</button>
        </div>
      </div>
    </template>

    <UiModal :open="deleteOpen" title="Excluir conta" @close="deleteOpen = false">
      <p>Seus decks e dados pessoais serão apagados. Isso não pode ser desfeito.</p>
      <p class="mt-3 text-sm muted">Para confirmar, digite seu apelido: <strong class="text-[color:var(--text)]">{{ account.user?.displayName }}</strong></p>
      <input v-model="confirmName" class="input mt-2 w-full" autocomplete="off" />
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn" @click="deleteOpen = false">Cancelar</button>
        <button class="btn btn-danger" :disabled="confirmName !== account.user?.displayName || saving" @click="deleteAccount">Excluir definitivamente</button>
      </div>
    </UiModal>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import UiModal from '../components/UiModal.vue';
import GoogleIcon from '../components/GoogleIcon.vue';
import { account, api, login, logout, updateProfile } from '../stores/account.js';
import { useLocalDecks } from '../stores/decks.js';
import { toast } from '../composables/toast.js';

const router = useRouter();
const name = ref('');
const showAvatar = ref(false);
const saving = ref(false);
const sessions = ref([]);
const deleteOpen = ref(false);
const confirmName = ref('');

const ROLES = { player: 'Jogador', moderator: 'Moderação', admin: 'Administração', owner: 'Dono do jogo' };
const roleLabel = computed(() => ROLES[account.user?.role] || '');
const date = (ms) => new Date(ms).toLocaleDateString('pt-BR');
const since = computed(() => (account.user ? date(account.user.createdAt) : ''));
const dirty = computed(() => account.user && (name.value.trim() !== account.user.displayName || showAvatar.value !== account.user.showAvatar));

function device(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${browser} · ${os}`;
}

watch(() => account.user, (user) => {
  if (!user) return;
  name.value = user.displayName;
  showAvatar.value = user.showAvatar;
  api('GET', '/me/sessions').then((r) => { sessions.value = r.sessions; }).catch(() => {});
}, { immediate: true });

async function save() {
  saving.value = true;
  try {
    await updateProfile({ displayName: name.value, showAvatar: showAvatar.value });
    toast('Perfil salvo.', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function signOut(all) {
  await logout(all).catch(() => {});
  useLocalDecks();
  toast(all ? 'Você saiu de todos os dispositivos.' : 'Você saiu da conta.', 'info');
  router.push('/');
}

async function exportData() {
  try {
    const data = await api('GET', '/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'mop-meus-dados.json' });
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteAccount() {
  saving.value = true;
  try {
    await api('DELETE', '/me', { confirm: confirmName.value });
    await logout().catch(() => {});
    useLocalDecks();
    deleteOpen.value = false;
    toast('Conta excluída.', 'info', 4000);
    router.push('/');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.google-btn { background: #fff; color: #1f1f1f; border-color: #dadce0; font-family: Roboto, Arial, sans-serif; font-weight: 500; }
.google-btn:hover:not(:disabled) { background: #f8f9fa; border-color: #c6c9cc; box-shadow: none; }
</style>
