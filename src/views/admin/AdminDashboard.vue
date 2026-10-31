<template>
  <section class="flex flex-col gap-3">
    <h1 class="title text-2xl">> Painel</h1>
    <div v-if="!data" class="muted">Carregando…</div>
    <template v-else>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div v-for="k in kpis" :key="k.label" class="panel-glass p-4">
          <div class="text-xs muted">{{ k.label }}</div>
          <div class="font-mono text-2xl" :class="k.cls">{{ k.value }}</div>
          <div v-if="k.sub" class="text-xs muted">{{ k.sub }}</div>
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div class="panel-glass p-4">
          <h2 class="subtitle font-bold">Vendas por raridade (7 dias)</h2>
          <div v-if="!data.salesByRarity7d.length" class="mt-2 text-sm muted">Nenhuma venda ainda.</div>
          <div v-for="r in salesByRarity" :key="r.rarity" class="mt-2 flex items-center gap-2 text-sm">
            <span class="w-20" :style="{ color: RARITY_COLORS[r.rarity] }">{{ RARITY_LABELS[r.rarity] }}</span>
            <div class="h-3 flex-1 overflow-hidden rounded bg-white/10"><div class="h-full rounded" :style="{ width: `${(r.copies / maxSale) * 100}%`, background: RARITY_COLORS[r.rarity] }"></div></div>
            <span class="w-10 text-right font-mono">{{ r.copies }}</span>
          </div>
        </div>
        <div class="panel-glass p-4">
          <h2 class="subtitle font-bold">Mais compradas (7 dias)</h2>
          <ol class="mt-2 flex flex-col gap-1 text-sm">
            <li v-for="c in data.topCards7d" :key="c.uid" class="flex justify-between gap-2"><span class="truncate">{{ c.name }}</span><span class="font-mono">{{ c.copies }}</span></li>
          </ol>
          <div v-if="!data.topCards7d.length" class="mt-2 text-sm muted">Nenhuma venda ainda.</div>
        </div>
      </div>
      <div class="panel-glass p-4 text-sm">
        <span class="muted">Flags ligadas:</span> <span class="font-mono text-cyan">{{ data.flags.join(', ') || 'nenhuma' }}</span>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, fmtNum, RARITY_COLORS, showError } from './adminApi.js';
import { RARITIES, RARITY_LABELS } from '../../stores/economy.js';

const data = ref(null);
onMounted(async () => {
  try {
    data.value = await api('GET', '/admin/dashboard');
  } catch (err) {
    showError(err);
  }
});

const kpis = computed(() => {
  const d = data.value;
  return [
    { label: 'Jogadores', value: fmtNum(d.users), sub: `+${d.newUsers7d} em 7 dias`, cls: 'text-neon' },
    { label: 'Ativos', value: fmtNum(d.active24h), sub: `${d.active7d} em 7 dias`, cls: 'text-cyan' },
    { label: 'Salas agora', value: fmtNum(d.rooms.rooms), sub: `${d.rooms.sessions} conexões`, cls: 'text-cyan' },
    { label: 'Créditos em circulação', value: fmtNum(d.credits.inCirculation), sub: `emitidos ${fmtNum(d.credits.issued)} · loja ${fmtNum(d.credits.shopRevenue)}`, cls: 'text-neon' },
  ];
});
const salesByRarity = computed(() => RARITIES.map((r) => ({ rarity: r, copies: data.value.salesByRarity7d.find((x) => x.rarity === r)?.copies || 0 })));
const maxSale = computed(() => Math.max(1, ...salesByRarity.value.map((r) => r.copies)));
</script>
