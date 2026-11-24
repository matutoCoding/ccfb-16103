<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <p class="muted">计算精度与饲养标准；网格精度变更后下一帧自动重建 GPU 引擎</p>
      </div>
      <button class="primary" @click="save">保存设置</button>
    </header>

    <div class="grid-2">
      <section class="card">
        <h3>计算参数</h3>
        <div class="form-grid" style="margin-top: var(--sp-4)">
          <div class="field">
            <label>网格边长（米）</label>
            <select v-model.number="form.cellSize" @change="onCellSize">
              <option :value="0.2">0.20（最精细，约 45000 格）</option>
              <option :value="0.25">0.25（推荐，28800 格）</option>
              <option :value="0.5">0.50（高性能，7200 格）</option>
            </select>
          </div>
          <div class="field">
            <label>扎堆判定占地阈值（m²/只）</label>
            <input v-model.number="form.huddleCellArea" type="number" min="0.05" step="0.01" />
          </div>
          <div class="field">
            <label>扎堆最少鸡只数</label>
            <input v-model.number="form.huddleMinBirds" type="number" min="5" step="5" />
          </div>
        </div>
      </section>

      <section class="card">
        <h3>饲养与覆盖标准</h3>
        <div class="form-grid" style="margin-top: var(--sp-4)">
          <div class="field">
            <label>饲养密度上限（kg/m²）</label>
            <input v-model.number="form.densityLimit" type="number" min="20" max="60" step="1" />
          </div>
          <div class="field">
            <label>到饮水器最大距离（米）</label>
            <input v-model.number="form.maxDrinkerDistance" type="number" min="1" max="8" step="0.5" />
          </div>
          <div class="field">
            <label>到料盘最大距离（米）</label>
            <input v-model.number="form.maxFeederDistance" type="number" min="1" max="10" step="0.5" />
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <h3>性能与验收口径</h3>
      <ul class="spec-list">
        <li>维诺图：GPU 跳跃泛洪（JFA），面积 = 归属格数 × 单格面积，CPU 全网格精确维诺抽查，归属不一致格数应为 0</li>
        <li>绕障距离：GPU 行列 chamfer 扫描 + 8 邻域松弛至无变化，CPU Dijkstra 多源精确解对照，误差不超过 1 个格子</li>
        <li>性能目标：三万只鸡一帧的维诺图加两张距离场，端到端 100ms 内（含 GPU 读回）</li>
        <li>数据存储：鸡舍、布局、批次、报告存 IndexedDB；鸡只坐标由种子确定性生成，不占用浏览器存储</li>
      </ul>
      <p v-if="savedTip" class="success-text" style="margin-top: var(--sp-4)">{{ savedTip }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useStore } from '@/store/app'
import { resetEngine } from '@/services/analysis'
import type { Settings } from '@/types'

const store = useStore()
const form = reactive<Settings>({ ...store.state.settings })
const savedTip = ref('')

watch(
  () => store.state.settings,
  (s) => Object.assign(form, s),
)

function onCellSize(): void {
  resetEngine()
}

async function save(): Promise<void> {
  store.mutateSettings({ ...form })
  await store.saveSettings()
  resetEngine()
  savedTip.value = '已保存，下一帧计算将应用新设置'
  setTimeout(() => (savedTip.value = ''), 2500)
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1180px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
.page-head p { margin: var(--sp-2) 0 0; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-5); }
.spec-list { margin: var(--sp-4) 0 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-3); color: var(--c-text-2); }
@media (max-width: 980px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
