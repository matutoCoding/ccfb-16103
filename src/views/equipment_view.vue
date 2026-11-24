<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>设备布置</h1>
        <p class="muted">料盘与乳头饮水器按间距沿线自动排布；线高随日龄调整，任意分段可单独停用</p>
      </div>
      <div class="toolbar">
        <button @click="addLine('feeder')">加料线</button>
        <button @click="addLine('drinker')">加水线</button>
        <button class="primary" @click="save">保存布局</button>
      </div>
    </header>

    <div v-if="!layout || !house" class="card empty-state">
      <div class="empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </div>
      <h3>暂无布局</h3>
      <p>请先在鸡舍档案中建档</p>
    </div>

    <template v-else>
      <div class="card">
        <div class="toolbar" style="justify-content: space-between">
          <h3>管线清单（{{ layout.lines.length }} 条，节点 {{ layout.nodes.length }} 个）</h3>
          <span class="muted">分段数：{{ segmentCount(house) }}</span>
        </div>
        <div class="table-wrap" style="margin-top: var(--sp-4)">
          <table>
            <thead>
              <tr>
                <th>名称</th><th>类型</th><th>x（米）</th><th>起点 y</th><th>终点 y</th>
                <th>间距（米）</th><th>线高（米）</th><th>停用分段</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in form.lines" :key="line.id">
                <td><input v-model="line.name" style="width: 110px" /></td>
                <td><span class="tag" :class="{ danger: line.kind === 'drinker' }">{{ line.kind === 'feeder' ? '料线' : '水线' }}</span></td>
                <td><input v-model.number="line.x" type="number" min="0.5" step="0.1" style="width: 80px" /></td>
                <td><input v-model.number="line.yStart" type="number" min="0" step="1" style="width: 80px" /></td>
                <td><input v-model.number="line.yEnd" type="number" min="1" step="1" style="width: 80px" /></td>
                <td><input v-model.number="line.spacing" type="number" min="0.3" step="0.1" style="width: 80px" /></td>
                <td><input v-model.number="line.height" type="number" min="0.05" step="0.01" style="width: 80px" /></td>
                <td>
                  <select
                    :value="line.disabledSegmentIds.join(',')"
                    @change="toggleSegment(line, ($event.target as HTMLSelectElement).value)"
                    style="width: 130px"
                  >
                    <option value="">全部启用</option>
                    <option v-for="s in segmentCount(house)" :key="s" :value="`seg-${s - 1}`">停用第 {{ s }} 段</option>
                  </select>
                </td>
                <td><button class="danger" @click="removeLine(line.id)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="toolbar" style="margin-top: var(--sp-4)">
          <label class="muted">按日龄批量调线高：</label>
          <input v-model.number="ageForHeight" type="number" min="1" max="42" style="width: 90px" />
          <span class="muted">日龄</span>
          <button @click="applyHeights">应用推荐线高</button>
        </div>
      </div>

      <div class="card" style="margin-top: var(--sp-5)">
        <h3>设备平面图</h3>
        <EquipmentPlan :layout="form" :house="house" class="plan" />
      </div>

      <div class="card" style="margin-top: var(--sp-5)">
        <div class="toolbar" style="justify-content: space-between">
          <h3>布局方案对比</h3>
          <span class="muted">用同一批真实鸡群分布，评估备选布局下的料水距离</span>
        </div>
        <LayoutCompare class="plan" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useStore } from '@/store/app'
import { regenerateNodes, recommendedLineHeight, uid } from '@/lib/equipment'
import { segmentCount } from '@/lib/grid'
import EquipmentPlan from '@/components/equipment_plan.vue'
import LayoutCompare from '@/components/layout_compare.vue'
import type { EquipmentLayout, EquipmentLine } from '@/types'

const store = useStore()
const house = store.currentHouse
const layout = store.currentLayout
const form = reactive<EquipmentLayout>(JSON.parse(JSON.stringify(layout.value ?? { lines: [], nodes: [] })))
const ageForHeight = ref(21)

watch(layout, (v) => {
  if (v) Object.assign(form, JSON.parse(JSON.stringify(v)))
})

function addLine(kind: 'feeder' | 'drinker'): void {
  if (!house.value) return
  const n = form.lines.filter((l) => l.kind === kind).length
  const line: EquipmentLine = {
    id: uid(kind === 'feeder' ? 'feed-line' : 'water-line'),
    kind,
    x: 2 + n * 3,
    yStart: 2,
    yEnd: house.value.length - 2,
    spacing: kind === 'feeder' ? 1.2 : 0.6,
    height: kind === 'feeder' ? 0.12 : 0.14,
    disabledSegmentIds: [],
    name: kind === 'feeder' ? `料线 ${n + 1}` : `水线 ${n + 1}`,
  }
  form.lines.push(line)
  regenerateIntoForm()
}

function removeLine(id: string): void {
  form.lines = form.lines.filter((l) => l.id !== id)
  regenerateIntoForm()
}

function toggleSegment(line: EquipmentLine, segId: string): void {
  line.disabledSegmentIds = segId ? [segId] : []
}

function applyHeights(): void {
  for (const line of form.lines) line.height = Number(recommendedLineHeight(ageForHeight.value, line.kind).toFixed(3))
}

function regenerateIntoForm(): void {
  const next = regenerateNodes({ ...form, lines: [...form.lines] })
  form.nodes = next.nodes
}

async function save(): Promise<void> {
  const next = regenerateNodes({ ...form, lines: [...form.lines], updatedAt: Date.now() })
  await store.saveLayout(next)
  Object.assign(form, JSON.parse(JSON.stringify(next)))
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1360px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
.page-head p { margin: var(--sp-2) 0 0; }
.plan { margin-top: var(--sp-4); }
</style>
