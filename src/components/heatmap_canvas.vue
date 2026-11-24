<template>
  <div class="heatmap-wrap">
    <canvas ref="canvasRef" class="heatmap-canvas"></canvas>
    <div class="legend">
      <span>低</span>
      <span class="legend-bar"></span>
      <span>高</span>
      <span v-if="thresholdLabel" class="muted">{{ thresholdLabel }}</span>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { FrameOutput, HuddleSnapshot } from '@/types'

const props = defineProps<{
  output: FrameOutput | null
  mode: 'density' | 'feeder' | 'drinker' | 'area'
  threshold?: number
  huddles?: HuddleSnapshot[]
  width?: number
  height?: number
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const thresholdLabel = computed(() => {
  if (props.mode === 'density' && props.threshold) return `红线阈值 ${props.threshold} kg/m²`
  if (props.mode === 'drinker' && props.threshold) return `超标距离 ${props.threshold} m`
  if (props.mode === 'feeder' && props.threshold) return `超标距离 ${props.threshold} m`
  return ''
})

function heat(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [38, 90, 217],
    [51, 191, 204],
    [89, 204, 102],
    [242, 204, 64],
    [230, 64, 51],
  ]
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const k = x - i
  return [
    stops[i][0] + (stops[i + 1][0] - stops[i][0]) * k,
    stops[i][1] + (stops[i + 1][1] - stops[i][1]) * k,
    stops[i][2] + (stops[i + 1][2] - stops[i][2]) * k,
  ]
}

function render(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const out = props.output
  const w = props.width ?? 720
  const h = props.height ?? Math.round((w * (out?.gridH ?? 60)) / Math.max(1, out?.gridW ?? 480))
  canvas.width = out?.gridW ?? 480
  canvas.height = out?.gridH ?? 60
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(canvas.width, canvas.height)
  if (!out) {
    ctx.putImageData(img, 0, 0)
    return
  }
  const n = out.gridW * out.gridH
  for (let i = 0; i < n; i++) {
    const p = i * 4
    if (out.blocked[i]) {
      img.data[p] = 15
      img.data[p + 1] = 23
      img.data[p + 2] = 42
      img.data[p + 3] = 255
      continue
    }
    let t = 0
    let over = false
    if (props.mode === 'density') {
      const limit = props.threshold ?? 40
      t = out.density[i] / limit
      over = out.density[i] > limit
    } else if (props.mode === 'feeder') {
      const limit = props.threshold ?? 4
      t = Number.isFinite(out.feederDistance[i]) ? out.feederDistance[i] / limit : 1
      over = Number.isFinite(out.feederDistance[i]) && out.feederDistance[i] > limit
    } else if (props.mode === 'drinker') {
      const limit = props.threshold ?? 3
      t = Number.isFinite(out.drinkerDistance[i]) ? out.drinkerDistance[i] / limit : 1
      over = Number.isFinite(out.drinkerDistance[i]) && out.drinkerDistance[i] > limit
    } else {
      // 维诺面积：面积越小越红
      const owner = out.owner[i]
      const area = owner >= 0 ? out.areas[owner] : 0
      t = 1 - Math.min(1, area / 0.5)
    }
    const [r, g, b] = over ? [220, 38, 38] : heat(t)
    img.data[p] = r
    img.data[p + 1] = g
    img.data[p + 2] = b
    img.data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  // 扎堆圈注
  if (props.huddles?.length) {
    const sx = canvas.width / (out.gridW * out.cellSize)
    const sy = canvas.height / (out.gridH * out.cellSize)
    ctx.strokeStyle = '#fde047'
    ctx.lineWidth = 2
    for (const hd of props.huddles) {
      ctx.beginPath()
      ctx.arc(hd.center.x * sx, hd.center.y * sy, 10, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

onMounted(render)
watch(() => [props.output, props.mode, props.threshold, props.huddles], render, { deep: false })
</script>

<style scoped>
.heatmap-wrap { display: flex; flex-direction: column; gap: var(--sp-2); }
.heatmap-canvas {
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  image-rendering: pixelated;
  max-width: 100%;
}
.legend {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}
.legend-bar {
  width: 160px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgb(38, 90, 217), rgb(51, 191, 204), rgb(89, 204, 102), rgb(242, 204, 64), rgb(230, 64, 51));
}
</style>
