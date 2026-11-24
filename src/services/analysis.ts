// 单帧分析编排：仿真 → GPU 计算 → 可选扎堆检测
import type { Batch, EquipmentLayout, FrameOutput, HuddleSnapshot, HouseProfile, Settings } from '@/types'
import { buildGrid, type GridGeometry } from '@/lib/grid'
import { generateFrame } from '@/lib/simulation'
import { sourceCellsFor } from '@/lib/equipment'
import { GpuContext } from '@/gpu/gpu_context'
import { FrameComputer, type EngineTiming } from '@/gpu/frame_computer'
import { detectHuddles } from '@/lib/huddle'

export interface AnalyzedFrame {
  output: FrameOutput
  timing: EngineTiming
  huddles: HuddleSnapshot[]
  ageDay: number
  hourOfDay: number
  positions: Float32Array
  weights: Float32Array
}

// 网格随设置变化，引擎缓存复用
let cached: { key: string; ctx: GpuContext; grid: GridGeometry } | null = null

export async function getEngine(house: HouseProfile, settings: Settings): Promise<{ ctx: GpuContext; grid: GridGeometry }> {
  const key = `${house.id}-${house.width}-${house.length}-${house.partitions.map((p) => `${p.y}:${p.doors.map((d) => d.x).join(',')}`).join('|')}-${settings.cellSize}`
  if (cached && cached.key === key) return { ctx: cached.ctx, grid: cached.grid }
  if (cached) cached.ctx.destroy()
  const grid = buildGrid(house, settings.cellSize)
  const ctx = await GpuContext.create(grid)
  cached = { key, ctx, grid }
  return { ctx, grid }
}

export function resetEngine(): void {
  if (cached) {
    cached.ctx.destroy()
    cached = null
  }
}

export async function analyzeFrame(
  house: HouseProfile,
  layout: EquipmentLayout,
  batch: Batch,
  settings: Settings,
  frameIndex: number,
  withHuddles = true,
): Promise<AnalyzedFrame> {
  const { ctx, grid } = await getEngine(house, settings)
  const frame = generateFrame(batch, house, frameIndex)
  const feederCells = sourceCellsFor(layout, house, grid, 'feeder')
  const drinkerCells = sourceCellsFor(layout, house, grid, 'drinker')
  const radius = Math.max(1, Math.round(1 / settings.cellSize))
  const result = await new FrameComputer(ctx).computeFrame(
    frameIndex,
    frame.positions,
    frame.weights,
    batch.birdCount,
    feederCells,
    drinkerCells,
    radius,
  )
  const huddles = withHuddles
    ? detectHuddles(result.output, frame.positions, settings.huddleCellArea, settings.huddleMinBirds)
    : []
  return {
    output: result.output,
    timing: result.timing,
    huddles,
    ageDay: frame.ageDay,
    hourOfDay: frame.hourOfDay,
    positions: frame.positions,
    weights: frame.weights,
  }
}

// 布局对比：同一帧真实分布，换一套布局只重算距离场
export interface LayoutCoverage {
  feederBadRatio: number
  drinkerBadRatio: number
  avgFeederDistance: number
  avgDrinkerDistance: number
}

export function coverageFromOutput(output: FrameOutput, settings: Settings): LayoutCoverage {
  let feedBad = 0
  let waterBad = 0
  let feedSum = 0
  let waterSum = 0
  let open = 0
  for (let i = 0; i < output.feederDistance.length; i++) {
    if (output.blocked[i]) continue
    open++
    if (Number.isFinite(output.feederDistance[i])) {
      feedSum += output.feederDistance[i]
      if (output.feederDistance[i] > settings.maxFeederDistance) feedBad++
    }
    if (Number.isFinite(output.drinkerDistance[i])) {
      waterSum += output.drinkerDistance[i]
      if (output.drinkerDistance[i] > settings.maxDrinkerDistance) waterBad++
    }
  }
  return {
    feederBadRatio: feedBad / open,
    drinkerBadRatio: waterBad / open,
    avgFeederDistance: feedSum / open,
    avgDrinkerDistance: waterSum / open,
  }
}
