import { createRouter, createWebHashHistory } from 'vue-router';
import { account, accountReady, isStaff } from './stores/account.js';

// Hash history keeps every route working on GitHub Pages (no server rewrites).
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/decks', name: 'decks', component: () => import('./views/DeckBuilderView.vue') },
    { path: '/play', name: 'lobby', component: () => import('./views/LobbyView.vue') },
    { path: '/play/:code', name: 'room', component: () => import('./views/LobbyView.vue'), props: true },
    { path: '/game', name: 'game', component: () => import('./views/GameView.vue') },
    { path: '/rules', name: 'rules', component: () => import('./views/RulesView.vue') },
    { path: '/loja', name: 'shop', component: () => import('./views/ShopView.vue') },
    { path: '/colecao', name: 'collection', component: () => import('./views/CollectionView.vue') },
    { path: '/carteira', name: 'wallet', component: () => import('./views/WalletView.vue') },
    { path: '/perfil', name: 'profile', component: () => import('./views/ProfileView.vue') },
    { path: '/privacidade', name: 'privacy', component: () => import('./views/PrivacyView.vue') },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      // Convenience only: every /api/admin call is authorized by the server (ADR-07).
      beforeEnter: async () => {
        await accountReady;
        return account.user && isStaff() ? true : '/perfil';
      },
      children: [
        { path: '', name: 'admin', component: () => import('./views/admin/AdminDashboard.vue') },
        { path: 'cartas', name: 'admin-cards', component: () => import('./views/admin/AdminCards.vue') },
        { path: 'economia', name: 'admin-economy', component: () => import('./views/admin/AdminEconomy.vue') },
        { path: 'jogadores', name: 'admin-users', component: () => import('./views/admin/AdminUsers.vue') },
        { path: 'ledger', name: 'admin-ledger', component: () => import('./views/admin/AdminLedger.vue') },
        { path: 'salas', name: 'admin-rooms', component: () => import('./views/admin/AdminRooms.vue') },
        { path: 'auditoria', name: 'admin-audit', component: () => import('./views/admin/AdminAudit.vue') },
        { path: 'sistema', name: 'admin-system', component: () => import('./views/admin/AdminSystem.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
