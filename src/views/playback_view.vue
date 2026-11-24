<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>回放</h1>
        <p class="muted">三万只鸡实例化渲染，按日龄换体型；拖动时间轴观察昼夜、喂料与冷应激前后鸡群走向</p>
      </div>
      <div class="toolbar">
        <button :class="{ primary: viewMode === '3d' }" @click="viewMode = '3d'">三维鸡舍</button>
        <button :class="{ primary: viewMode === '2d' }" @click="viewMode = '2d'">二维热力</button>
      </div>
    </header>

    <div class="card">
      <div class="toolbar">
        <button :disabled="playing" @click="stepFrame(-1)">上一帧</button>
        <button class="primary" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
        <button :disabled="playing" @click="stepFrame(1)">下一帧</button>
        <select v-model="stepMode" style="width: 130px">
          <option value="frame">逐帧（10 分钟）</option>
          <option value="hour">逐小时</option>
          <option value="day">逐天（同时刻）</option>
        </select>
        <div class="tag">第 {{ ageInfo.ageDay.toFixed(1) }} 天 · {{ String(ageInfo.hourOfDay.toFixed(0)).padStart(2, '0') }} 时</div>
        <div class="tag" :class="{ danger: tempNow < 24 }">舍温参考 {{ tempNow.toFixed(1) }} ℃</div>
        <div class="tag" v-if="frame">本帧扎堆 {{ frame.huddles.length }} 处</div>
      </div>

      <div class="timeline" style="margin-top: var(--sp-4)">
        <input v-model.number="frameIndex" type="range" :min="0" :max="maxFrame" style="flex: 1" @change="onScrub" />
        <span class="muted">{{ frameIndex }} / {{ maxFrame }}</span>
      </div>
      <div class="toolbar" style="margin-top: var(--sp-3)">
        <label class="muted">快速跳转</label>
        <button v-for="preset in presets" :key="preset.label" @click="jumpTo(preset.frame)">{{ preset.label }}</button>
      </div>
      <div class="toolbar" style="margin-top: var(--sp-3)">
        <label class="muted">着色</label>
        <button v-for="m in colorModes" :key="m.value" :class="{ primary: colorMode === m.value }" @click="colorMode = m.value; refreshColors()">{{ m.label }}</button>
      </div>
      <p v-if="errorMsg" class="danger-text" style="margin-top: var(--sp-3)">{{ errorMsg }}</p>
    </div>

    <div class="card render-card">
      <canvas v-show="viewMode === '3d'" ref="canvasRef" class="render-canvas"></canvas>
      <HeatmapCanvas
        v-if="viewMode === '2d' && frame"
        :output="frame.output"
        mode="density"
        :threshold="store.state.settings.densityLimit"
        :huddles="frame.huddles"
        :width="760"
      />
      <div v-if="!frame" class="empty-state">
        <div class="empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M8 5v14l11-7zM4 5v14" />
          </svg>
        </div>
        <h3>等待首帧</h3>
        <p>点击播放或拖动时间轴开始</p>
      </div>
    </div>

    <div class="card" v-if="frame">
      <div class="toolbar" style="justify-content: space-between">
        <h3>当天舍温曲线与扎堆时点</h3>
        <button :disabled="scanningDay" @click="scanDayHuddles">{{ scanningDay ? '扫描中...' : '扫描当天 24 小时扎堆' }}</button>
      </div>
      <TempCurve
        :age-day="ageInfo.ageDay"
        :current-hour="ageInfo.hourOfDay"
        :huddle-hours="dayHuddleHours"
        style="margin-top: var(--sp-4)"
      />
      <h3 style="margin-top: var(--sp-5)">本帧扎堆明细</h3>
      <div class="table-wrap" style="margin-top: var(--sp-3)">
        <table>
          <thead><tr><th>扎堆中心 (x, y)</th><th>鸡只数</th><th>平均占地 m²</th><th>当前舍温</th></tr></thead>
          <tbody>
            <tr v-if="frame.huddles.length === 0"><td colspan="4" class="muted">本帧无连片拥挤</td></tr>
            <tr v-for="(h, i) in frame.huddles" :key="i">
              <td>({{ h.center.x.toFixed(1) }}, {{ h.center.y.toFixed(1) }})</td>
              <td>{{ h.birdCount }}</td>
              <td>{{ h.avgArea.toFixed(3) }}</td>
              <td>{{ tempNow.toFixed(1) }} ℃</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from '@/store/app'
import { analyzeFrame, getEngine, resetEngine, type AnalyzedFrame } from '@/services/analysis'
import { frameCount, frameToAge } from '@/lib/simulation'
import { targetTempAtAge } from '@/lib/growth'
import { FlockRenderer, type BirdColorMode } from '@/gpu/flock_renderer'
import HeatmapCanvas from '@/components/heatmap_canvas.vue'
import TempCurve from '@/components/temp_curve.vue'
import { detectHuddles } from '@/lib/huddle'

const store = useStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const frameIndex = ref(0)
const maxFrame = computed(() => (store.currentBatch.value ? frameCount(store.currentBatch.value) - 1 : 0))
const frame = ref<AnalyzedFrame | null>(null)
const playing = ref(false)
const busy = ref(false)
const errorMsg = ref('')
const viewMode = ref<'3d' | '2d'>('3d')
const colorMode = ref<BirdColorMode>('uniform')
const stepMode = ref<'frame' | 'hour' | 'day'>('hour')
let renderer: FlockRenderer | null = null
let playTimer: number | null = null
const dayHuddleHours = ref<number[]>([])
const scanningDay = ref(false)

const ageInfo = computed(() =>
  store.currentBatch.value ? frameToAge(store.currentBatch.value, frameIndex.value) : { ageDay: 1, hourOfDay: 0, ageMin: 0 },
)
const tempNow = computed(() => targetTempAtAge(ageInfo.value.ageDay, ageInfo.value.hourOfDay))

const colorModes: { value: BirdColorMode; label: string }[] = [
  { value: 'uniform', label: '统一色' },
  { value: 'area', label: '按维诺占地' },
  { value: 'water', label: '按到水线距离' },
]

const presets = computed(() => [
  { label: '第 1 天', frame: 0 },
  { label: '冷应激当夜', frame: 17 * 144 + 22 * 6 },
  { label: '漏水期间', frame: 26 * 144 + 10 * 6 },
  { label: '出栏前夜', frame: 41 * 144 + 22 * 6 },
])

async function loadFrame(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const batch = store.currentBatch.value
  if (!house || !layout || !batch) return
  busy.value = true
  try {
    frame.value = await analyzeFrame(house, layout, batch, store.state.settings, frameIndex.value, true)
    if (renderer) pushBirds()
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function pushBirds(): void {
  if (!renderer || !frame.value) return
  const colorValues =
    colorMode.value === 'area'
      ? frame.value.output.areas
      : colorMode.value === 'water'
        ? birdWaterDistances()
        : undefined
  renderer.updateBirds(frame.value.positions, frame.value.ageDay, colorMode.value, colorValues)
}

// 格级距离场映射回每只鸡所在格
function birdWaterDistances(): Float32Array {
  const out = frame.value
  if (!out) return new Float32Array(0)
  const batch = store.currentBatch.value
  if (!batch) return new Float32Array(0)
  const values = new Float32Array(batch.birdCount)
  const { gridW, cellSize } = out.output
  for (let b = 0; b < batch.birdCount; b++) {
    const col = Math.min(gridW - 1, Math.max(0, Math.floor(out.positions[b * 2] / cellSize)))
    const row = Math.min(out.output.gridH - 1, Math.max(0, Math.floor(out.positions[b * 2 + 1] / cellSize)))
    values[b] = out.output.drinkerDistance[row * gridW + col]
  }
  return values
}

function refreshColors(): void {
  pushBirds()
}

// 扫描当前日龄当天每小时一帧，记录出现扎堆的小时
async function scanDayHuddles(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const batch = store.currentBatch.value
  if (!house || !layout || !batch) return
  scanningDay.value = true
  dayHuddleHours.value = []
  try {
    const dayStart = Math.floor(ageInfo.value.ageDay - 1) * 144
    const hours: number[] = []
    for (let h = 0; h < 24; h++) {
      const f = dayStart + h * 6
      if (f > maxFrame.value) break
      const result = await analyzeFrame(house, layout, batch, store.state.settings, f, false)
      // 复用纯 CPU 判定，避免再跑一次 GPU 扎堆连通
      const snaps = detectHuddles(
        result.output,
        result.positions,
        store.state.settings.huddleCellArea,
        store.state.settings.huddleMinBirds,
      )
      if (snaps.length) hours.push(h)
    }
    dayHuddleHours.value = hours
  } finally {
    scanningDay.value = false
  }
}

async function ensureRenderer(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const canvas = canvasRef.value
  if (!house || !layout || !canvas || renderer) return
  const { ctx } = await getEngine(house, store.state.settings)
  renderer = new FlockRenderer(canvas, ctx.device, house, layout)
  renderer.resize(900, 560)
  renderer.start()
  if (frame.value) pushBirds()
}

function stepFrame(delta: number): void {
  const unit = stepMode.value === 'day' ? 144 : stepMode.value === 'hour' ? 6 : 1
  frameIndex.value = Math.min(maxFrame.value, Math.max(0, frameIndex.value + delta * unit))
  void loadFrame()
}

function jumpTo(f: number): void {
  frameIndex.value = Math.min(maxFrame.value, f)
  void loadFrame()
}

function onScrub(): void {
  void loadFrame()
}

function togglePlay(): void {
  if (playing.value) {
    playing.value = false
    if (playTimer) window.clearInterval(playTimer)
    return
  }
  playing.value = true
  playTimer = window.setInterval(() => {
    if (busy.value) return
    if (frameIndex.value >= maxFrame.value) {
      togglePlay()
      return
    }
    stepFrame(1)
  }, 350)
}

watch(viewMode, async (v) => {
  if (v === '3d') await ensureRenderer()
})

// 网格精度或鸡舍变更后 GPU 上下文重建，渲染器必须跟着重建
watch(
  () => [store.state.settings.cellSize, store.state.currentHouseId],
  async () => {
    renderer?.stop()
    renderer = null
    resetEngine()
    await loadFrame()
    await ensureRenderer()
  },
)

onMounted(async () => {
  resetEngine()
  await loadFrame()
  await ensureRenderer()
})

onBeforeUnmount(() => {
  if (playTimer) window.clearInterval(playTimer)
  renderer?.stop()
  renderer = null
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1360px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
.page-head p { margin: var(--sp-2) 0 0; }
.timeline { display: flex; align-items: center; gap: var(--sp-4); }
.render-card { min-height: 600px; display: grid; place-items: center; }
.render-canvas { width: 900px; max-width: 100%; height: 560px; border-radius: var(--radius-sm); border: 1px solid var(--c-border); }
</style>
