<template>
  <div class="eq-plan-wrap">
    <svg :viewBox="`0 0 ${house.width} ${house.length}`" class="eq-svg" preserveAspectRatio="none">
      <rect x="0" y="0" :width="house.width" :height="house.length" fill="var(--c-surface-2)" stroke="var(--c-text-3)" stroke-width="0.25" />
      <g v-for="p in house.partitions" :key="p.id">
        <line
          v-for="seg in wallSegments(p)"
          :key="seg.x0"
          :x1="seg.x0"
          :x2="seg.x1"
          :y1="p.y"
          :y2="p.y"
          stroke="#d97706"
          stroke-width="0.4"
        />
      </g>
      <g v-for="line in layout.lines" :key="line.id">
        <line
          :x1="line.x"
          :x2="line.x"
          :y1="line.yStart"
          :y2="line.yEnd"
          :stroke="line.kind === 'feeder' ? '#2563eb' : '#16a34a'"
          :stroke-width="0.35"
          :stroke-dasharray="line.disabledSegmentIds.length ? '1.2 0.8' : 'none'"
        />
        <circle
          v-for="node in nodesOf(line.id)"
          :key="node.id"
          :cx="node.pos.x"
          :cy="node.pos.y"
          :r="0.35"
          :fill="line.kind === 'feeder' ? '#2563eb' : '#16a34a'"
        />
      </g>
    </svg>
    <div class="plan-labels">
      <span class="tag">蓝：料线/料盘</span>
      <span class="tag" style="background: #dcfce7; color: #15803d">绿：水线/饮水器</span>
      <span class="tag">虚线：含停用分段</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EquipmentLayout, HouseProfile, Partition } from '@/types'

const props = defineProps<{ layout: EquipmentLayout; house: HouseProfile }>()

function nodesOf(lineId: string) {
  return props.layout.nodes.filter((n) => n.lineId === lineId)
}

function wallSegments(p: Partition): { x0: number; x1: number }[] {
  const cuts = [...p.doors].sort((a, b) => a.x - b.x)
  const out: { x0: number; x1: number }[] = []
  let cursor = 0
  for (const d of cuts) {
    if (d.x > cursor) out.push({ x0: cursor, x1: d.x })
    cursor = d.x + d.width
  }
  if (cursor < props.house.width) out.push({ x0: cursor, x1: props.house.width })
  return out
}
</script>

<style scoped>
.eq-plan-wrap { display: flex; flex-direction: column; gap: var(--sp-3); }
.eq-svg { width: 100%; height: 440px; border-radius: var(--radius-sm); }
.plan-labels { display: flex; gap: var(--sp-3); flex-wrap: wrap; }
</style>
