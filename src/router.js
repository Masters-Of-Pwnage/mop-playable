import { createRouter, createWebHashHistory } from 'vue-router';

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
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
