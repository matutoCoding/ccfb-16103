<template>
  <div class="compare">
    <div class="toolbar">
      <button class="primary" :disabled="running" @click="runCompare">
        {{ running ? '计算中...' : '基于当前帧真实分布评估' }}
      </button>
      <select v-model.number="frameIndex" style="width: 220px">
        <option v-for="opt in frameOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <button @click="resetAlternative">重置备选布局为当前布局副本</button>
    </div>

    <div v-if="result" class="compare-grid">
      <div class="compare-card">
        <h3>当前布局</h3>
        <ul class="metrics">
          <li><span>平均到料盘距离</span><b>{{ result.current.avgFeederDistance.toFixed(2) }} m</b></li>
          <li><span>平均到饮水器距离</span><b>{{ result.current.avgDrinkerDistance.toFixed(2) }} m</b></li>
          <li><span>料盘超标面积占比</span><b :class="ratioClass(result.current.feederBadRatio)">{{ pct(result.current.feederBadRatio) }}</b></li>
          <li><span>饮水超标面积占比</span><b :class="ratioClass(result.current.drinkerBadRatio)">{{ pct(result.current.drinkerBadRatio) }}</b></li>
        </ul>
      </div>
      <div class="compare-card">
        <h3>备选布局</h3>
        <ul class="metrics">
          <li><span>平均到料盘距离</span><b>{{ result.alt.avgFeederDistance.toFixed(2) }} m</b></li>
          <li><span>平均到饮水器距离</span><b>{{ result.alt.avgDrinkerDistance.toFixed(2) }} m</b></li>
          <li><span>料盘超标面积占比</span><b :class="ratioClass(result.alt.feederBadRatio)">{{ pct(result.alt.feederBadRatio) }}</b></li>
          <li><span>饮水超标面积占比</span><b :class="ratioClass(result.alt.drinkerBadRatio)">{{ pct(result.alt.drinkerBadRatio) }}</b></li>
        </ul>
        <div class="toolbar" style="margin-top: var(--sp-3)">
          <label class="muted">备选整体 x 平移（米）</label>
          <input v-model.number="altShiftX" type="number" step="0.2" style="width: 100px" @change="runCompare" />
          <label class="muted">间距缩放</label>
          <input v-model.number="altSpacingScale" type="number" min="0.5" max="2" step="0.1" style="width: 100px" @change="runCompare" />
        </div>
      </div>
    </div>
    <p v-else class="muted" style="margin-top: var(--sp-4)">
      备选布局由当前布局派生：整体横向平移 + 节点间距缩放，用于快速评估改造方向。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '@/store/app'
import { analyzeFrame, coverageFromOutput, type LayoutCoverage } from '@/services/analysis'
import { regenerateNodes } from '@/lib/equipment'
import { frameCount, frameToAge } from '@/lib/simulation'
import type { EquipmentLayout } from '@/types'

const store = useStore()
const running = ref(false)
const frameIndex = ref(0)
const altShiftX = ref(1.2)
const altSpacingScale = ref(1)
const result = ref<{ current: LayoutCoverage; alt: LayoutCoverage } | null>(null)

const frameOptions = computed(() => {
  const batch = store.currentBatch.value
  if (!batch) return []
  const total = frameCount(batch)
  const opts: { value: number; label: string }[] = []
  for (let day = 0; day < batch.durationDays; day += 3) {
    const f = day * 144
    if (f < total) {
      const { ageDay, hourOfDay } = frameToAge(batch, f)
      opts.push({ value: f, label: `第 ${ageDay.toFixed(0)} 天 ${String(hourOfDay | 0).padStart(2, '0')} 时` })
    }
  }
  return opts
})

function buildAlternative(): EquipmentLayout | null {
  const base = store.currentLayout.value
  const house = store.currentHouse.value
  if (!base || !house) return null
  const lines = base.lines.map((l) => ({
    ...l,
    id: `${l.id}-alt`,
    x: Math.min(house.width - 0.5, Math.max(0.5, l.x + altShiftX.value)),
    spacing: Math.max(0.3, Number((l.spacing * altSpacingScale.value).toFixed(2))),
    disabledSegmentIds: [...l.disabledSegmentIds],
  }))
  return regenerateNodes({
    ...base,
    id: `${base.id}-alt`,
    name: `${base.name}（备选）`,
    lines,
    nodes: [],
  })
}

async function runCompare(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  const batch = store.currentBatch.value
  if (!house || !layout || !batch) return
  running.value = true
  try {
    const alt = buildAlternative()
    if (!alt) return
    // 同一 GPU 上下文的 scratch 缓冲共享，必须串行
    const a = await analyzeFrame(house, layout, batch, store.state.settings, frameIndex.value, false)
    const b = await analyzeFrame(house, alt, batch, store.state.settings, frameIndex.value, false)
    result.value = {
      current: coverageFromOutput(a.output, store.state.settings),
      alt: coverageFromOutput(b.output, store.state.settings),
    }
  } finally {
    running.value = false
  }
}

function resetAlternative(): void {
  altShiftX.value = 0
  altSpacingScale.value = 1
  result.value = null
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}
function ratioClass(v: number): string {
  return v > 0.15 ? 'danger-text' : v > 0.05 ? 'warn-text' : 'success-text'
}
</script>

<style scoped>
.compare { display: flex; flex-direction: column; gap: var(--sp-4); }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-5); }
.compare-card { border: 1px solid var(--c-border); border-radius: var(--radius); padding: var(--sp-4); background: var(--c-surface-2); }
.metrics { list-style: none; margin: var(--sp-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.metrics li { display: flex; justify-content: space-between; align-items: center; }
.metrics span { color: var(--c-text-2); }
.warn-text { color: var(--c-warning); }
@media (max-width: 980px) { .compare-grid { grid-template-columns: 1fr; } }
</style>
