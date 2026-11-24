<template>
  <div class="temp-curve">
    <svg :viewBox="`0 0 ${width} ${height}`" class="curve-svg">
      <polyline
        :points="tempPoints"
        fill="none"
        stroke="var(--c-primary)"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <line
        v-if="currentX > 0"
        :x1="currentX"
        :x2="currentX"
        y1="0"
        :y2="height"
        stroke="var(--c-warning)"
        stroke-width="1.5"
        stroke-dasharray="4 3"
      />
      <circle
        v-for="m in huddleMarks"
        :key="m.x"
        :cx="m.x"
        :cy="m.y"
        r="4"
        fill="var(--c-danger)"
      />
    </svg>
    <div class="curve-foot">
      <span class="muted">0 时</span>
      <div class="legend-line">
        <span class="dot dot-temp"></span><span class="muted">舍温</span>
        <span class="dot dot-huddle"></span><span class="muted">该小时出现扎堆</span>
      </div>
      <span class="muted">24 时</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { targetTempAtAge } from '@/lib/growth'

const props = defineProps<{
  ageDay: number
  currentHour: number
  // 当天各小时（0-23）是否有扎堆
  huddleHours: number[]
  width?: number
  height?: number
}>()

const width = computed(() => props.width ?? 640)
const height = computed(() => props.height ?? 160)
const padding = 12

const tempSeries = computed(() =>
  Array.from({ length: 25 }, (_, h) => ({ hour: h, temp: targetTempAtAge(props.ageDay, h) })),
)

const tempRange = computed(() => {
  const temps = tempSeries.value.map((t) => t.temp)
  return { min: Math.min(...temps) - 1, max: Math.max(...temps) + 1 }
})

const tempPoints = computed(() =>
  tempSeries.value
    .map((t) => {
      const x = padding + (t.hour / 24) * (width.value - padding * 2)
      const k = (t.temp - tempRange.value.min) / (tempRange.value.max - tempRange.value.min)
      const y = height.value - padding - k * (height.value - padding * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' '),
)

const currentX = computed(() => padding + (props.currentHour / 24) * (width.value - padding * 2))

const huddleMarks = computed(() =>
  props.huddleHours.map((h) => {
    const x = padding + (h / 24) * (width.value - padding * 2)
    const temp = targetTempAtAge(props.ageDay, h)
    const k = (temp - tempRange.value.min) / (tempRange.value.max - tempRange.value.min)
    const y = height.value - padding - k * (height.value - padding * 2)
    return { x, y }
  }),
)
</script>

<style scoped>
.temp-curve { display: flex; flex-direction: column; gap: var(--sp-2); }
.curve-svg { width: 100%; height: 160px; }
.curve-foot { display: flex; justify-content: space-between; align-items: center; }
.legend-line { display: flex; align-items: center; gap: var(--sp-2); }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot-temp { background: var(--c-primary); }
.dot-huddle { background: var(--c-danger); }
</style>
