<template>
  <div class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-4 sm:px-4 lg:flex-row">
    <aside class="panel-glass shrink-0 p-3 lg:w-56 lg:self-start">
      <div class="mb-2 flex items-center justify-between lg:block">
        <div class="title text-lg">Admin</div>
        <div class="text-xs muted">{{ ROLE_LABELS[account.user?.role] }}</div>
      </div>
      <nav class="flex gap-1 overflow-x-auto lg:flex-col">
        <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="btn btn-ghost btn-sm shrink-0 justify-start" :class="{ 'text-neon': isActive(item) }">{{ item.label }}</RouterLink>
      </nav>
    </aside>
    <main class="min-w-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
import { account } from '../../stores/account.js';
import { ROLE_LABELS } from './adminApi.js';

const route = useRoute();
const items = [
  { to: '/admin', label: 'Painel', exact: true },
  { to: '/admin/cartas', label: 'Cartas' },
  { to: '/admin/economia', label: 'Economia' },
  { to: '/admin/jogadores', label: 'Jogadores' },
  { to: '/admin/ledger', label: 'Ledger' },
  { to: '/admin/trocas', label: 'Trocas' },
  { to: '/admin/codigos', label: 'Códigos' },
  { to: '/admin/pacotes', label: 'Pacotes' },
  { to: '/admin/animacoes', label: 'Animações' },
  { to: '/admin/salas', label: 'Salas' },
  { to: '/admin/auditoria', label: 'Auditoria' },
  { to: '/admin/sistema', label: 'Sistema' },
];
const isActive = (item) => (item.exact ? route.path === item.to : route.path.startsWith(item.to));
</script>
