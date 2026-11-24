<template>
  <div v-if="!store.state.ready" class="boot">
    <div class="progress" style="width: 240px"><span style="width: 60%"></span></div>
    <p class="muted">正在初始化本地数据库...</p>
  </div>
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M12 3l8 4v10l-8 4-8-4V7z" />
          <path d="M12 12l8-5M12 12v9M12 12L4 7" />
        </svg>
        <div>
          <div class="brand-name">鸡群分布分析</div>
          <div class="brand-sub">Flock Scope</div>
        </div>
      </div>
      <nav>
        <button
          v-for="r in router.routes"
          :key="r.name"
          class="nav-item"
          :class="{ active: router.route.value === r.name }"
          @click="router.go(r.name)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path :d="r.icon" />
          </svg>
          <span>{{ r.label }}</span>
        </button>
      </nav>
      <div class="sidebar-foot muted">
        <div>{{ store.currentHouse.value?.name ?? '未选择鸡舍' }}</div>
        <div>{{ store.currentBatch.value?.name ?? '未选择批次' }}</div>
      </div>
    </aside>
    <main class="content">
      <HouseView v-if="router.route.value === 'house'" />
      <EquipmentView v-else-if="router.route.value === 'equipment'" />
      <BatchView v-else-if="router.route.value === 'batch'" />
      <AnalysisView v-else-if="router.route.value === 'analysis'" />
      <PlaybackView v-else-if="router.route.value === 'playback'" />
      <SettingsView v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { initStore, useStore } from '@/store/app'
import { useRouter } from '@/router'
import HouseView from '@/views/house_view.vue'
import EquipmentView from '@/views/equipment_view.vue'
import BatchView from '@/views/batch_view.vue'
import AnalysisView from '@/views/analysis_view.vue'
import PlaybackView from '@/views/playback_view.vue'
import SettingsView from '@/views/settings_view.vue'

const store = useStore()
const router = useRouter()
onMounted(initStore)
</script>

<style scoped>
.boot {
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--sp-4);
}
.layout {
  display: grid;
  grid-template-columns: 232px 1fr;
  height: 100%;
}
.sidebar {
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  padding: var(--sp-5) var(--sp-3);
  gap: var(--sp-4);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--c-primary);
  padding: 0 var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--c-border);
}
.brand-name { font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--c-text); }
.brand-sub { font-size: var(--fs-xs); color: var(--c-text-3); letter-spacing: 1px; }
nav { display: flex; flex-direction: column; gap: var(--sp-1); flex: 1; }
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  border: none;
  background: transparent;
  padding: var(--sp-3) var(--sp-3);
  border-radius: var(--radius-sm);
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  text-align: left;
}
.nav-item:hover { background: var(--c-surface-2); color: var(--c-text); }
.nav-item.active {
  background: var(--c-primary-weak);
  color: var(--c-primary);
  font-weight: var(--fw-medium);
}
.sidebar-foot {
  border-top: 1px solid var(--c-border);
  padding-top: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
}
.content {
  padding: var(--sp-6);
  overflow: auto;
}
</style>
