<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>分布分析</h1>
        <p class="muted">单帧 GPU 维诺图、绕障距离场与局部密度；右侧给出 CPU 精确解抽查与计时</p>
      </div>
    </header>

    <div class="card">
      <div class="toolbar">
        <label class="muted">帧</label>
        <input v-model.number="frameIndex" type="number" :min="0" :max="maxFrame" style="width: 110px" />
        <span class="muted">/ {{ maxFrame }}</span>
        <button :disabled="busy" @click="frameIndex = Math.max(0, frameIndex - 144)">前一天</button>
        <button :disabled="busy" @click="frameIndex = Math.min(maxFrame, frameIndex + 144)">后一天</button>
        <button class="primary" :disabled="busy" @click="run">{{ busy ? '计算中...' : '计算该帧' }}</button>
        <button :disabled="busy || !frame" @click="validate">GPU/CPU 抽查校验</button>
        <div class="tag" v-if="frame">日龄 {{ frame.ageDay.toFixed(1) }} 天 · {{ frame.hourOfDay.toFixed(0) }} 时</div>
      </div>
      <div class="toolbar" style="margin-top: var(--sp-3)">
        <label class="muted">图层</label>
        <button v-for="m in modes" :key="m.value" :class="{ primary: mode === m.value }" @click="mode = m.value">{{ m.label }}</button>
      </div>
      <p v-if="errorMsg" class="danger-text" style="margin-top: var(--sp-3)">{{ errorMsg }}</p>
    </div>

    <div class="analysis-grid">
      <div class="card">
        <h3>{{ modeLabel }}（俯视，纵向 120m）</h3>
        <HeatmapCanvas
          v-if="frame"
          :output="frame.output"
          :mode="mode"
          :threshold="thresholdForMode"
          :huddles="frame.huddles"
          :width="640"
        />
        <div v-else class="empty-state">
          <div class="empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4 19V5m0 14h16M8 16v-5m4 5V8m4 8v-8" />
            </svg>
          </div>
          <h3>尚未计算</h3>
          <p>选择帧后点击"计算该帧"</p>
        </div>
        <div v-if="frame" class="stat-grid">
          <div class="stat"><span>本帧扎堆</span><b>{{ frame.huddles.length }} 处</b></div>
          <div class="stat"><span>最大密度</span><b :class="maxDensity > settings.densityLimit ? 'danger-text' : ''">{{ maxDensity.toFixed(1) }} kg/m²</b></div>
          <div class="stat"><span>饮水超标格占比</span><b>{{ pct(waterBadRatio) }}</b></div>
          <div class="stat"><span>料盘超标格占比</span><b>{{ pct(feederBadRatio) }}</b></div>
        </div>
      </div>

      <div class="side-col">
        <div class="card">
          <h3>GPU 计时</h3>
          <ul v-if="frame" class="metrics">
            <li><span>JFA 维诺 + 面积 + 密度</span><b>{{ frame.timing.jfaMs.toFixed(1) }} ms</b></li>
            <li><span>料盘绕障距离场</span><b>{{ frame.timing.feederDistMs.toFixed(1) }} ms</b></li>
            <li><span>饮水绕障距离场</span><b>{{ frame.timing.drinkerDistMs.toFixed(1) }} ms</b></li>
            <li><span>整帧合计（含读回）</span><b :class="frame.timing.totalMs > 100 ? 'danger-text' : 'success-text'">{{ frame.timing.totalMs.toFixed(1) }} ms</b></li>
          </ul>
          <p v-else class="muted">计算后展示，目标 100ms 内</p>
        </div>

        <div class="card">
          <h3>CPU 精确解校验</h3>
          <div v-if="check" class="check-list">
            <div class="check-row">
              <span>维诺归属不一致格</span>
              <b :class="check.voronoi.mismatchCount === 0 ? 'success-text' : 'danger-text'">
                {{ check.voronoi.mismatchCount }} / {{ check.voronoi.sampled }}
              </b>
            </div>
            <div class="check-row">
              <span>维诺面积最大偏差</span>
              <b :class="check.voronoi.maxAreaDiff > frame!.output.cellSize ** 2 ? 'danger-text' : 'success-text'">
                {{ check.voronoi.maxAreaDiff.toFixed(3) }} m²
              </b>
            </div>
            <div class="check-row">
              <span>料盘距离最大偏差</span>
              <b :class="check.feeder.badCellCount ? 'danger-text' : 'success-text'">
                {{ check.feeder.maxDiffMeters.toFixed(3) }} m（{{ check.feeder.maxDiffCells.toFixed(2) }} 格）
              </b>
            </div>
            <div class="check-row">
              <span>饮水距离最大偏差</span>
              <b :class="check.drinker.badCellCount ? 'danger-text' : 'success-text'">
                {{ check.drinker.maxDiffMeters.toFixed(3) }} m（{{ check.drinker.maxDiffCells.toFixed(2) }} 格）
              </b>
            </div>
            <p class="muted" style="margin-top: var(--sp-3)">
              验收线：距离误差不超过 1 个格子（{{ settings.cellSize }}m），超差格数为 0 即通过
            </p>
          </div>
          <p v-else class="muted">点击"GPU/CPU 抽查校验"，CPU 侧用 Dijkstra 多源精确解和全网格精确维诺对照</p>
        </div>

        <div class="card" v-if="frame && frame.huddles.length">
          <h3>扎堆明细</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>中心 (x, y)</th><th>鸡只数</th><th>平均占地 m²</th></tr></thead>
              <tbody>
                <tr v-for="(h, i) in frame.huddles" :key="i">
                  <td>({{ h.center.x.toFixed(1) }}, {{ h.center.y.toFixed(1) }})</td>
                  <td>{{ h.birdCount }}</td>
                  <td>{{ h.avgArea.toFixed(3) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '@/store/app'
import { analyzeFrame, type AnalyzedFrame } from '@/services/analysis'
import { frameCount, generateFrame } from '@/lib/simulation'
import { buildGrid } from '@/lib/grid'
import { sourceCellsFor } from '@/lib/equipment'
import {
  checkDistance,
  checkVoronoi,
  cpuGeodesicDistance,
  cpuVoronoiFast,
  type DistanceCheck,
  type VoronoiCheck,
} from '@/lib/cpu_reference'
import HeatmapCanvas from '@/components/heatmap_canvas.vue'

const store = useStore()
const settings = computed(() => store.state.settings)
const frameIndex = ref(17 * 144 + 22 * 6) // 默认落在冷应激夜里
const mode = ref<'density' | 'feeder' | 'drinker' | 'area'>('density')
const frame = ref<AnalyzedFrame | null>(null)
const busy = ref(false)
const errorMsg = ref('')
const check = ref<{ voronoi: VoronoiCheck; feeder: DistanceCheck; drinker: DistanceCheck } | null>(null)

const modes = [
  { value: 'density', label: '局部密度' },
  { value: 'area', label: '维诺占地' },
  { value: 'drinker', label: '到饮水器距离' },
  { value: 'feeder', label: '到料盘距离' },
] as const

const maxFrame = computed(() => (store.currentBatch.value ? frameCount(store.currentBatch.value) - 1 : 0))
const modeLabel = computed(() => modes.find((m) => m.value === mode.value)?.label ?? '')
const thresholdForMode = computed(() => {
  if (mode.value === 'density') return settings.value.densityLimit
  if (mode.value === 'drinker') return settings.value.maxDrinkerDistance
  if (mode.value === 'feeder') return settings.value.maxFeederDistance
  return undefined
})

const maxDensity = computed(() => (frame.value ? Math.max(...frame.value.output.density) : 0))
const waterBadRatio = computed(() => badRatio(frame.value, 'drinker'))
const feederBadRatio = computed(() => badRatio(frame.value, 'feeder'))

function badRatio(f: AnalyzedFrame | null, kind: 'drinker' | 'feeder'): number {
  if (!f) return 0
  const arr = kind === 'drinker' ? f.output.drinkerDistance : f.output.feederDistance
  const limit = kind === 'drinker' ? settings.value.maxDrinkerDistance : settings.value.maxFeederDistance
  let bad = 0
  let open = 0
  for (let i = 0; i < arr.length; i++) {
    if (f.output.blocked[i]) continue
    open++
    if (Number.isFinite(arr[i]) && arr[i] > limit) bad++
  }
  return bad / Math.max(1, open)
}

async function run(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const batch = store.currentBatch.value
  if (!house || !layout || !batch) return
  busy.value = true
  errorMsg.value = ''
  check.value = null
  try {
    frame.value = await analyzeFrame(house, layout, batch, settings.value, frameIndex.value, true)
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function validate(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const batch = store.currentBatch.value
  if (!house || !layout || !batch || !frame.value) return
  busy.value = true
  try {
    const grid = buildGrid(house, settings.value.cellSize)
    const sim = generateFrame(batch, house, frameIndex.value)
    const cpuOwner = cpuVoronoiFast(grid, sim.positions, batch.birdCount)
    const voronoi = checkVoronoi(frame.value.output, cpuOwner, batch.birdCount)
    const feederCells = sourceCellsFor(layout, house, grid, 'feeder')
    const drinkerCells = sourceCellsFor(layout, house, grid, 'drinker')
    const feeder = checkDistance(frame.value.output, cpuGeodesicDistance(grid, feederCells), 'feeder')
    const drinker = checkDistance(frame.value.output, cpuGeodesicDistance(grid, drinkerCells), 'drinker')
    check.value = { voronoi, feeder, drinker }
  } finally {
    busy.value = false
  }
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1360px; }
.page-head p { margin: var(--sp-2) 0 0; }
.analysis-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: var(--sp-5); align-items: start; }
.side-col { display: flex; flex-direction: column; gap: var(--sp-5); }
.stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-3); margin-top: var(--sp-4); }
.stat { border: 1px solid var(--c-border); border-radius: var(--radius-sm); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); background: var(--c-surface-2); }
.stat span { color: var(--c-text-2); }
.metrics { list-style: none; padding: 0; margin: var(--sp-4) 0 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.metrics li { display: flex; justify-content: space-between; }
.metrics span { color: var(--c-text-2); }
.check-list { display: flex; flex-direction: column; gap: var(--sp-3); margin-top: var(--sp-4); }
.check-row { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding-bottom: var(--sp-2); border-bottom: 1px solid var(--c-border); }
.check-row span { color: var(--c-text-2); }
@media (max-width: 1100px) { .analysis-grid { grid-template-columns: 1fr; } }
</style>
