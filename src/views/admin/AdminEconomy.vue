<template>
  <section class="flex flex-col gap-3">
    <h1 class="title text-2xl">> Economia</h1>

    <div class="panel-glass p-4">
      <h2 class="subtitle font-bold">Preço padrão por raridade</h2>
      <p class="mt-1 text-xs muted">Vale para toda carta sem preço próprio. Mudanças aparecem na loja em até 1 minuto.</p>
      <table class="mt-3 w-full max-w-lg text-sm">
        <thead class="text-left text-xs muted"><tr><th class="p-1">Raridade</th><th class="p-1">Preço (CR)</th><th class="p-1">Revenda (CR)</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rarities" :key="r.rarity">
            <td class="p-1" :style="{ color: RARITY_COLORS[r.rarity] }">{{ RARITY_LABELS[r.rarity] }}</td>
            <td class="p-1"><input v-model.number="r.price" type="number" min="0" class="input w-28" :disabled="!canEdit" /></td>
            <td class="p-1"><input v-model.number="r.sellPrice" type="number" min="0" class="input w-28" :disabled="!canEdit" /></td>
            <td class="p-1"><button v-if="canEdit" class="btn btn-sm" :disabled="busy" @click="saveRarity(r)">Salvar</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel-glass p-4">
      <h2 class="subtitle font-bold">Recompensas, conversão e trocas</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label v-for="s in numeric" :key="s.key" class="flex flex-col gap-1 text-sm">
          <span>{{ LABELS[s.key] || s.key }} <span class="text-xs muted">(padrão {{ s.default }})</span></span>
          <div class="flex gap-2">
            <input v-model.number="s.value" type="number" min="0" class="input" :disabled="!canEdit" />
            <button v-if="canEdit" class="btn btn-sm" :disabled="busy" @click="saveSetting(s)">Salvar</button>
          </div>
        </label>
      </div>
      <div v-if="cap" class="mt-4 text-sm">
        <div>Teto de ajuste manual por administrador <span class="text-xs muted">(acima disso só o dono)</span></div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <input v-model.number="cap.value.CR" type="number" min="0" class="input w-28" :disabled="!isOwner" /> CR
          <input v-model.number="cap.value.PWC" type="number" min="0" class="input w-28" :disabled="!isOwner" /> PWC
          <button v-if="isOwner" class="btn btn-sm" :disabled="busy" @click="saveSetting(cap)">Salvar</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { account } from '../../stores/account.js';
import { loadCatalog, RARITY_LABELS } from '../../stores/economy.js';
import { toast } from '../../composables/toast.js';
import { api, RARITY_COLORS, showError } from './adminApi.js';

const LABELS = {
  'economy.signup_grant_cr': 'Créditos no cadastro',
  'economy.daily_cr': 'Bônus diário (CR)',
  'economy.pwc_to_cr': 'Conversão: créditos por 1 PwnCoin',
  'economy.convert_max_per_day': 'Conversão máxima por dia (PWC)',
  'economy.match_participation_cr': 'Partida online concluída (CR)',
  'economy.match_participation_max_day': 'Partidas recompensadas por dia',
  'economy.match_win_cr': 'Vitória online (CR)',
  'economy.match_win_max_day': 'Vitórias recompensadas por dia',
  'trade.fee_pct': 'Taxa de troca (% do PWC)',
  'trade.max_per_day': 'Trocas por dia',
  'trade.max_imbalance_cr': 'Desequilíbrio que vai para revisão (CR)',
  'trade.new_account_days': 'Dias de conta antes de trocar',
  'trade.new_account_matches': 'Partidas antes de trocar',
};
const canEdit = computed(() => ['admin', 'owner'].includes(account.user?.role));
const isOwner = computed(() => account.user?.role === 'owner');
const rarities = ref([]);
const settings = ref([]);
const busy = ref(false);
const numeric = computed(() => settings.value.filter((s) => typeof s.default === 'number'));
const cap = computed(() => settings.value.find((s) => s.key === 'admin.adjust_cap'));

onMounted(async () => {
  try {
    const [r, s] = await Promise.all([api('GET', '/admin/rarity-defaults'), api('GET', '/admin/settings')]);
    rarities.value = r.rarities;
    settings.value = s.settings;
  } catch (err) {
    showError(err);
  }
});

async function saveRarity(r) {
  busy.value = true;
  try {
    await api('PUT', `/admin/rarity-defaults/${r.rarity}`, { price: r.price, sellPrice: r.sellPrice });
    toast(`Preço padrão de ${RARITY_LABELS[r.rarity]} salvo.`, 'ok');
    loadCatalog().catch(() => {});
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function saveSetting(s) {
  busy.value = true;
  try {
    await api('PUT', `/admin/settings/${encodeURIComponent(s.key)}`, { value: s.value });
    toast('Configuração salva.', 'ok');
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>
