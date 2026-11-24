<template>
  <div class="plan-canvas-wrap">
    <svg :viewBox="`0 0 ${house.width} ${house.length}`" class="plan-svg" preserveAspectRatio="none">
      <rect x="0" y="0" :width="house.width" :height="house.length" fill="var(--c-surface-2)" stroke="var(--c-text-3)" stroke-width="0.25" />
      <line :x1="0" :x2="house.width" :y1="house.wetPadY" :y2="house.wetPadY" stroke="#3b82f6" stroke-width="0.4" />
      <line :x1="0" :x2="house.width" :y1="house.fanY" :y2="house.fanY" stroke="#ef4444" stroke-width="0.4" />
      <g v-for="p in sortedParts" :key="p.id">
        <line
          v-for="seg in wallSegments(p)"
          :key="seg.x0"
          :x1="seg.x0"
          :x2="seg.x1"
          :y1="p.y"
          :y2="p.y"
          stroke="#d97706"
          stroke-width="0.5"
        />
      </g>
    </svg>
    <div class="plan-labels">
      <span class="tag">蓝线：湿帘端</span>
      <span class="tag danger">红线：风机端</span>
      <span class="tag">橙线：隔栏（缺口为门洞）</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HouseProfile, Partition } from '@/types'

const props = defineProps<{ house: HouseProfile }>()

const sortedParts = computed(() => props.house.partitions.slice().sort((a, b) => a.y - b.y))

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
.plan-canvas-wrap { display: flex; flex-direction: column; gap: var(--sp-3); }
.plan-svg { width: 100%; height: 420px; border-radius: var(--radius-sm); background: var(--c-surface-2); }
.plan-labels { display: flex; gap: var(--sp-3); flex-wrap: wrap; }
</style>
