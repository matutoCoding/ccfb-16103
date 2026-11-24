// CPU 精确参照解，用于校验 GPU 结果
import type { FrameOutput } from '@/types'
import type { GridGeometry } from '@/lib/grid'
import { INF } from '@/gpu/gpu_context'

export interface VoronoiCheck {
  maxCellDiff: number
  mismatchCount: number
  sampled: number
  // 面积差异（平方米）最大的鸡
  maxAreaDiff: number
  areaMismatchBirds: number
}

export interface DistanceCheck {
  maxDiffMeters: number
  maxDiffCells: number
  badCellCount: number
  sampled: number
}

// 精确维诺：每格枚举全部鸡，取欧氏距离最小者（仅用于抽查，全量走空间哈希加速版）
export function cpuVoronoiOwner(
  grid: GridGeometry,
  positions: Float32Array,
  birdCount: number,
): Int32Array {
  const owner = new Int32Array(grid.gridW * grid.gridH).fill(-1)
  const cell = grid.cellSize
  for (let r = 0; r < grid.gridH; r++) {
    for (let c = 0; c < grid.gridW; c++) {
      const idx = r * grid.gridW + c
      if (grid.blocked[idx]) continue
      const px = (c + 0.5) * cell
      const py = (r + 0.5) * cell
      let best = -1
      let bestD = Infinity
      for (let b = 0; b < birdCount; b++) {
        const dx = positions[b * 2] - px
        const dy = positions[b * 2 + 1] - py
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = b
        }
      }
      owner[idx] = best
    }
  }
  return owner
}

// 精确维诺（网格分桶版）：把鸡按所在格建桶，每格只检查 3×3 邻桶；
// 桶边长等于 cellSize，最近鸡必落在本格或相邻格，结果与全枚举一致
export function cpuVoronoiFast(grid: GridGeometry, positions: Float32Array, birdCount: number): Int32Array {
  const { gridW, gridH, cellSize, blocked } = grid
  const buckets: number[][] = Array.from({ length: gridW * gridH }, () => [])
  for (let b = 0; b < birdCount; b++) {
    const col = Math.min(gridW - 1, Math.max(0, Math.floor(positions[b * 2] / cellSize)))
    const row = Math.min(gridH - 1, Math.max(0, Math.floor(positions[b * 2 + 1] / cellSize)))
    buckets[row * gridW + col].push(b)
  }
  const owner = new Int32Array(gridW * gridH).fill(-1)
  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const idx = r * gridW + c
      if (blocked[idx]) continue
      const px = (c + 0.5) * cellSize
      const py = (r + 0.5) * cellSize
      let best = -1
      let bestD = Infinity
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr
        if (nr < 0 || nr >= gridH) continue
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc
          if (nc < 0 || nc >= gridW) continue
          for (const b of buckets[nr * gridW + nc]) {
            const dx = positions[b * 2] - px
            const dy = positions[b * 2 + 1] - py
            const d = dx * dx + dy * dy
            if (d < bestD) {
              bestD = d
              best = b
            }
          }
        }
      }
      owner[idx] = best
    }
  }
  return owner
}

export function checkVoronoi(gpu: FrameOutput, cpuOwner: Int32Array, birdCount: number, sampleSize = 2000): VoronoiCheck {
  const n = gpu.owner.length
  const open: number[] = []
  for (let i = 0; i < n; i++) if (!gpu.blocked[i]) open.push(i)
  const step = Math.max(1, Math.floor(open.length / sampleSize))
  let mismatch = 0
  let sampled = 0
  for (let k = 0; k < open.length; k += step) {
    const i = open[k]
    sampled++
    if (gpu.owner[i] !== cpuOwner[i]) mismatch++
  }
  const cpuCounts = new Uint32Array(birdCount)
  for (let i = 0; i < n; i++) {
    if (cpuOwner[i] >= 0) cpuCounts[cpuOwner[i]]++
  }
  let maxAreaDiff = 0
  let areaMismatchBirds = 0
  for (let b = 0; b < birdCount; b++) {
    const cpuArea = cpuCounts[b] * gpu.cellSize * gpu.cellSize
    const diff = Math.abs(cpuArea - gpu.areas[b])
    if (diff > maxAreaDiff) maxAreaDiff = diff
    if (diff > gpu.cellSize * gpu.cellSize + 1e-6) areaMismatchBirds++
  }
  return {
    maxCellDiff: mismatch,
    mismatchCount: mismatch,
    sampled,
    maxAreaDiff,
    areaMismatchBirds,
  }
}

// Dijkstra 多源精确绕障距离（8 邻域，单位：格）
export function cpuGeodesicDistance(grid: GridGeometry, sourceCells: Int32Array): Float32Array {
  const { gridW, gridH, blocked } = grid
  const n = gridW * gridH
  const dist = new Float32Array(n).fill(Infinity)
  // 二叉堆
  const heap: number[] = []
  const heapDist = new Float32Array(n).fill(Infinity)
  const push = (idx: number, d: number) => {
    heap.push(idx)
    heapDist[idx] = d
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapDist[heap[p]] <= heapDist[heap[i]]) break
      ;[heap[i], heap[p]] = [heap[p], heap[i]]
      i = p
    }
  }
  const pop = (): number => {
    const top = heap[0]
    const last = heap.pop() as number
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let smallest = i
        if (l < heap.length && heapDist[heap[l]] < heapDist[heap[smallest]]) smallest = l
        if (r < heap.length && heapDist[heap[r]] < heapDist[heap[smallest]]) smallest = r
        if (smallest === i) break
        ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
        i = smallest
      }
    }
    return top
  }

  for (const s of sourceCells) {
    if (s >= 0 && s < n && !blocked[s] && dist[s] !== 0) {
      dist[s] = 0
      push(s, 0)
    }
  }
  const SQRT2 = Math.SQRT2
  while (heap.length) {
    const idx = pop()
    const cur = dist[idx]
    if (cur > heapDist[idx] + 1e-9) continue
    const col = idx % gridW
    const row = (idx / gridW) | 0
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nc >= gridW || nr < 0 || nr >= gridH) continue
        const ni = nr * gridW + nc
        if (blocked[ni]) continue
        const stepLen = dr && dc ? SQRT2 : 1
        const nd = cur + stepLen
        if (nd < dist[ni]) {
          dist[ni] = nd
          push(ni, nd)
        }
      }
    }
  }
  return dist
}

export function checkDistance(gpu: FrameOutput, cpuDistCells: Float32Array, kind: 'feeder' | 'drinker'): DistanceCheck {
  const gpuDist = kind === 'feeder' ? gpu.feederDistance : gpu.drinkerDistance
  const cell = gpu.cellSize
  let maxDiff = 0
  let bad = 0
  let sampled = 0
  for (let i = 0; i < gpuDist.length; i++) {
    if (gpu.blocked[i]) continue
    if (!Number.isFinite(cpuDistCells[i])) continue
    sampled++
    const gpuCells = gpuDist[i] / cell
    const diff = Math.abs(gpuCells - cpuDistCells[i])
    if (diff > maxDiff) maxDiff = diff
    // 验收线：误差不超过一个格子
    if (diff > 1.0 + 1e-6) bad++
  }
  return {
    maxDiffMeters: maxDiff * cell,
    maxDiffCells: maxDiff,
    badCellCount: bad,
    sampled,
  }
}

export { INF }
