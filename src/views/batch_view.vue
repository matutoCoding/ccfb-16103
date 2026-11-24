<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>批次管理</h1>
        <p class="muted">一批 1 至 42 日龄，十分钟一帧确定性生成；冷应激扎堆与漏水回避事件在此配置</p>
      </div>
      <button class="primary" @click="createBatch">新建批次</button>
    </header>

    <div class="card">
      <h3>批次列表</h3>
      <div class="table-wrap" style="margin-top: var(--sp-4)">
        <table>
          <thead>
            <tr><th>名称</th><th>品种</th><th>鸡只数</th><th>天数</th><th>帧数</th><th>事件</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in store.state.batches" :key="b.id" :class="{ selected: b.id === form.id }">
              <td>{{ b.name }}</td>
              <td>{{ b.breed }}</td>
              <td>{{ b.birdCount.toLocaleString() }}</td>
              <td>{{ b.durationDays }}</td>
              <td>{{ frameCountOf(b) }}</td>
              <td>
                <span v-for="e in b.events" :key="e.id" class="tag" :class="{ danger: e.type === 'coldSnap' }" style="margin-right: var(--sp-2)">
                  {{ e.type === 'coldSnap' ? '冷应激' : '漏水' }}
                </span>
              </td>
              <td><button @click="edit(b)">编辑</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top: var(--sp-5)">
      <h3>批次参数</h3>
      <div class="form-grid" style="margin-top: var(--sp-4)">
        <div class="field"><label>名称</label><input v-model="form.name" /></div>
        <div class="field"><label>品种</label><input v-model="form.breed" /></div>
        <div class="field"><label>鸡只数</label><input v-model.number="form.birdCount" type="number" :max="36000" step="1000" /></div>
        <div class="field"><label>饲养天数</label><input v-model.number="form.durationDays" type="number" min="7" max="60" /></div>
        <div class="field"><label>帧间隔（分钟）</label><input v-model.number="form.frameIntervalMin" type="number" min="5" step="5" /></div>
        <div class="field"><label>仿真种子</label><input v-model.number="form.seed" type="number" /></div>
      </div>

      <div class="toolbar" style="margin-top: var(--sp-5); justify-content: space-between">
        <h3>仿真事件</h3>
        <div class="toolbar">
          <button @click="addEvent('coldSnap')">加冷应激事件</button>
          <button @click="addEvent('waterLeak')">加漏水事件</button>
        </div>
      </div>
      <div class="table-wrap" style="margin-top: var(--sp-3)">
        <table>
          <thead>
            <tr><th>类型</th><th>开始（日龄天/时）</th><th>结束</th><th>中心 x</th><th>中心 y</th><th>半径 m</th><th>强度</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in form.events" :key="e.id">
              <td>{{ e.type === 'coldSnap' ? '冷应激' : '漏水' }}</td>
              <td>
                <input v-model.number="e.startAgeMin" type="number" :step="60" style="width: 100px" />
                <span class="muted">分钟</span>
              </td>
              <td>
                <input v-model.number="e.endAgeMin" type="number" :step="60" style="width: 100px" />
                <span class="muted">分钟</span>
              </td>
              <td><input v-model.number="e.pos.x" type="number" step="0.5" style="width: 80px" /></td>
              <td><input v-model.number="e.pos.y" type="number" step="0.5" style="width: 80px" /></td>
              <td><input v-model.number="e.radius" type="number" min="1" step="0.5" style="width: 80px" /></td>
              <td><input v-model.number="e.strength" type="number" min="0.1" max="1" step="0.05" style="width: 80px" /></td>
              <td><button class="danger" @click="form.events.splice(i, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top: var(--sp-5)">
        <button class="primary" @click="save">保存批次</button>
      </div>
    </div>

    <div class="card" style="margin-top: var(--sp-5)">
      <div class="toolbar" style="justify-content: space-between">
        <h3>扎堆事件追踪</h3>
        <button :disabled="scanningHuddle" @click="scanHuddles">
          {{ scanningHuddle ? '扫描中 ' + Math.round(huddleProgress * 100) + '%' : '全批扫描扎堆（每小时一帧）' }}
        </button>
      </div>
      <div v-if="scanningHuddle" class="progress" style="margin-top: var(--sp-4)"><span :style="{ width: huddleProgress * 100 + '%' }"></span></div>
      <div class="table-wrap" style="margin-top: var(--sp-4)">
        <table>
          <thead>
            <tr><th>起始日龄</th><th>中心 (x, y)</th><th>峰值鸡只</th><th>平均占地 m²</th><th>持续时长</th></tr>
          </thead>
          <tbody>
            <tr v-if="huddleEvents.length === 0"><td colspan="5" class="muted">尚未扫描或本批无连片扎堆</td></tr>
            <tr v-for="h in huddleEvents" :key="h.id">
              <td>{{ (h.ageMin / 1440 + 1).toFixed(1) }} 天</td>
              <td>({{ h.center.x.toFixed(1) }}, {{ h.center.y.toFixed(1) }})</td>
              <td>{{ h.birdCount }}</td>
              <td>{{ h.avgArea.toFixed(3) }}</td>
              <td>{{ h.durationMin }} 分钟</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top: var(--sp-5)">
      <div class="toolbar" style="justify-content: space-between">
        <h3>出栏批次分析报告</h3>
        <div class="toolbar">
          <button :disabled="generating" @click="generate">{{ generating ? '生成中 ' + Math.round(progress * 100) + '%' : '生成报告' }}</button>
          <button v-if="report" @click="downloadJson(report, `${form.name}-report.json`)">导出 JSON</button>
          <button v-if="report" @click="downloadCsv(report, `${form.name}-report.csv`)">导出 CSV</button>
        </div>
      </div>
      <div v-if="generating" class="progress" style="margin-top: var(--sp-4)"><span :style="{ width: progress * 100 + '%' }"></span></div>
      <div v-if="report" style="margin-top: var(--sp-4)">
        <div class="kpi-row">
          <div class="kpi"><span>全舍扎堆总次数</span><b>{{ report.totalHuddles }}</b></div>
          <div class="kpi"><span>饮水超标面积占比</span><b :class="report.overallBadDrinkerRatio > 0.1 ? 'danger-text' : ''">{{ pct(report.overallBadDrinkerRatio) }}</b></div>
          <div class="kpi"><span>料盘超标面积占比</span><b :class="report.overallBadFeederRatio > 0.1 ? 'danger-text' : ''">{{ pct(report.overallBadFeederRatio) }}</b></div>
        </div>
        <div class="table-wrap" style="margin-top: var(--sp-5)">
          <table>
            <thead><tr><th>分段</th><th>平均密度 kg/m²</th><th>扎堆次数</th><th>饮水超标占比</th><th>料盘超标占比</th></tr></thead>
            <tbody>
              <tr v-for="s in report.segmentStats" :key="s.segmentIndex">
                <td>第 {{ s.segmentIndex + 1 }} 段</td>
                <td :class="s.avgDensity > store.state.settings.densityLimit ? 'danger-text' : ''">{{ s.avgDensity.toFixed(2) }}</td>
                <td>{{ s.huddleCount }}</td>
                <td>{{ pct(s.drinkerBadAreaRatio) }}</td>
                <td>{{ pct(s.feederBadAreaRatio) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useStore } from '@/store/app'
import { defaultBatch } from '@/lib/seed_data'
import { uid } from '@/lib/equipment'
import { frameCount } from '@/lib/simulation'
import { db } from '@/lib/db'
import { downloadCsv, downloadJson, generateReport } from '@/services/report'
import { scanBatchHuddles } from '@/services/huddle_scan'
import type { Batch, BatchReport, HuddleEvent, SimulationEvent } from '@/types'
type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] }
type RoBatch = DeepReadonly<Batch>

// 深拷贝去掉 store 的 readonly 包装
function cloneBatch(b: RoBatch): Batch {
  return JSON.parse(JSON.stringify(b)) as Batch
}

const store = useStore()
const initialBatch = store.currentBatch.value as RoBatch | undefined
const form = reactive<Batch>(initialBatch ? cloneBatch(initialBatch) : defaultBatch('none', 'none'))
const generating = ref(false)
const progress = ref(0)
const report = ref<BatchReport | null>(null)
const huddleEvents = ref<HuddleEvent[]>([])
const scanningHuddle = ref(false)
const huddleProgress = ref(0)

watch(
  () => store.currentBatch.value,
  async (b) => {
    if (!b) return
    Object.assign(form, cloneBatch(b as RoBatch))
    report.value = (await db.reports.get(b.id)) ?? null
    huddleEvents.value = await db.huddles.byBatch(b.id)
  },
  { immediate: true },
)

function edit(b: RoBatch): void {
  store.setCurrentBatch(b.id)
  Object.assign(form, cloneBatch(b))
}

function frameCountOf(b: RoBatch): number {
  return frameCount(b as unknown as Batch)
}

function createBatch(): void {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  if (!house || !layout) return
  const b = defaultBatch(house.id, layout.id)
  b.name = `新批次 ${store.state.batches.length + 1}`
  void store.saveBatch(b)
  store.setCurrentBatch(b.id)
  Object.assign(form, cloneBatch(b))
}

function addEvent(type: SimulationEvent['type']): void {
  form.events.push({
    id: uid('evt'),
    type,
    startAgeMin: 10 * 1440,
    endAgeMin: 10 * 1440 + 8 * 60,
    pos: { x: store.currentHouse.value ? store.currentHouse.value.width / 2 : 7.5, y: 60 },
    radius: type === 'coldSnap' ? 12 : 5,
    strength: 0.8,
  })
}

async function save(): Promise<void> {
  await store.saveBatch({ ...form, events: form.events.map((e) => ({ ...e, pos: { ...e.pos } })) })
}

async function generate(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  if (!house || !layout) return
  generating.value = true
  progress.value = 0
  try {
    const r = await generateReport(house, layout, form, store.state.settings, (v) => (progress.value = v))
    report.value = r
    await db.reports.put(r)
  } finally {
    generating.value = false
  }
}

async function scanHuddles(): Promise<void> {
  const house = store.currentHouse.value
  const layout = store.currentLayout.value
  if (!house || !layout) return
  scanningHuddle.value = true
  huddleProgress.value = 0
  try {
    huddleEvents.value = await scanBatchHuddles(house, layout, form, store.state.settings, (v) => (huddleProgress.value = v))
  } finally {
    scanningHuddle.value = false
  }
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1360px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; }
.page-head p { margin: var(--sp-2) 0 0; }
tr.selected { background: var(--c-primary-weak); }
.kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-4); }
.kpi {
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--c-surface-2);
}
.kpi span { color: var(--c-text-2); }
.kpi b { font-size: var(--fs-lg); }
</style>
