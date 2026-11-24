// 单帧计算编排：JFA 维诺 → 面积 → 密度 → 两个绕障距离场
import { GpuContext, INF, WORKGROUP } from '@/gpu/gpu_context'
import type { FrameOutput } from '@/types'

export interface EngineTiming {
  jfaMs: number
  areaMs: number
  densityMs: number
  feederDistMs: number
  drinkerDistMs: number
  totalMs: number
}

export interface ComputeResult {
  output: FrameOutput
  timing: EngineTiming
}

export class FrameComputer {
  ctx: GpuContext

  constructor(ctx: GpuContext) {
    this.ctx = ctx
  }

  // JFA 种子：site 存鸡的连续位置（格单位浮点），同格多鸡取编号小者
  private buildJfaSeed(positions: Float32Array, birdCount: number): Float32Array {
    const { gridW, gridH, cellSize, blocked } = this.ctx.grid
    const n = this.ctx.cellCount
    const seed = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      seed[i * 4 + 2] = -1
      seed[i * 4 + 3] = 0
    }
    for (let b = 0; b < birdCount; b++) {
      const siteX = positions[b * 2] / cellSize
      const siteY = positions[b * 2 + 1] / cellSize
      const col = Math.min(gridW - 1, Math.max(0, Math.floor(siteX)))
      const row = Math.min(gridH - 1, Math.max(0, Math.floor(siteY)))
      const idx = row * gridW + col
      if (blocked[idx]) continue
      if (seed[idx * 4 + 3] < 0.5 || b < seed[idx * 4 + 2]) {
        seed[idx * 4] = siteX
        seed[idx * 4 + 1] = siteY
        seed[idx * 4 + 2] = b
        seed[idx * 4 + 3] = 1
      }
    }
    return seed
  }

  // 全量鸡位置（格单位），refine 精确化用，不按格去重
  private buildBirdPositions(positions: Float32Array, birdCount: number): Float32Array {
    const cell = this.ctx.grid.cellSize
    const out = new Float32Array(birdCount * 2)
    for (let b = 0; b < birdCount; b++) {
      out[b * 2] = positions[b * 2] / cell
      out[b * 2 + 1] = positions[b * 2 + 1] / cell
    }
    return out
  }

  // CSR 空间分桶：桶边长 8 格，自适应环扩张精确化用
  private buildBuckets(
    positions: Float32Array,
    birdCount: number,
  ): { offset: Uint32Array; count: Uint32Array; birds: Uint32Array; bucketSize: number } {
    const bucketSize = 8
    const { gridW, gridH, cellSize } = this.ctx.grid
    const bucketsX = Math.ceil(gridW / bucketSize)
    const bucketsY = Math.ceil(gridH / bucketSize)
    const bucketN = bucketsX * bucketsY
    const count = new Uint32Array(bucketN)
    const birdBucket = new Uint32Array(birdCount)
    for (let b = 0; b < birdCount; b++) {
      const col = Math.min(gridW - 1, Math.max(0, Math.floor(positions[b * 2] / cellSize)))
      const row = Math.min(gridH - 1, Math.max(0, Math.floor(positions[b * 2 + 1] / cellSize)))
      const bc = Math.min(bucketsX - 1, Math.floor(col / bucketSize))
      const br = Math.min(bucketsY - 1, Math.floor(row / bucketSize))
      const bi = br * bucketsX + bc
      birdBucket[b] = bi
      count[bi]++
    }
    const offset = new Uint32Array(bucketN)
    for (let i = 1; i < bucketN; i++) offset[i] = offset[i - 1] + count[i - 1]
    const birds = new Uint32Array(birdCount)
    const cursor = offset.slice()
    for (let b = 0; b < birdCount; b++) birds[cursor[birdBucket[b]]++] = b
    return { offset, count, birds, bucketSize }
  }

  private buildMassField(positions: Float32Array, weights: Float32Array, birdCount: number): Float32Array {
    const { gridW, gridH, cellSize } = this.ctx.grid
    const mass = new Float32Array(this.ctx.cellCount)
    for (let b = 0; b < birdCount; b++) {
      const col = Math.min(gridW - 1, Math.max(0, Math.floor(positions[b * 2] / cellSize)))
      const row = Math.min(gridH - 1, Math.max(0, Math.floor(positions[b * 2 + 1] / cellSize)))
      mass[row * gridW + col] += weights[b]
    }
    return mass
  }

  private distanceSeed(sourceCells: Int32Array): Float32Array {
    const dist = new Float32Array(this.ctx.cellCount).fill(INF)
    for (const c of sourceCells) {
      if (c >= 0 && c < this.ctx.cellCount && !this.ctx.grid.blocked[c]) dist[c] = 0
    }
    return dist
  }

  async computeFrame(
    frameIndex: number,
    positions: Float32Array,
    weights: Float32Array,
    birdCount: number,
    feederCells: Int32Array,
    drinkerCells: Int32Array,
    densityRadiusCells: number,
  ): Promise<ComputeResult> {
    const c = this.ctx
    const d = c.device
    const n = c.cellCount
    const t0 = performance.now()

    // 上传种子与全量鸡位置、CSR 分桶
    d.queue.writeBuffer(c.jfaA, 0, this.buildJfaSeed(positions, birdCount))
    d.queue.writeBuffer(c.countBuf, 0, new Uint32Array(40000))
    d.queue.writeBuffer(c.massBuf, 0, this.buildMassField(positions, weights, birdCount))
    d.queue.writeBuffer(c.birdPosBuf, 0, this.buildBirdPositions(positions, birdCount))
    const buckets = this.buildBuckets(positions, birdCount)
    d.queue.writeBuffer(c.bucketOffsetBuf, 0, buckets.offset)
    d.queue.writeBuffer(c.bucketCountBuf, 0, buckets.count)
    d.queue.writeBuffer(c.bucketBirdsBuf, 0, buckets.birds)

    // JFA 主流程单独一个 encoder 并先提交，后续 refine 依赖它的结果
    const enc = d.createCommandEncoder()
    let pass = enc.beginComputePass()
    const maxDim = Math.max(c.grid.gridW, c.grid.gridH)
    let step = 1
    while (step * 2 <= maxDim) step *= 2
    let srcIsA = true
    while (step >= 1) {
      d.queue.writeBuffer(c.jfaUniformBuf, 0, new Uint32Array([c.grid.gridW, c.grid.gridH, step, step]))
      pass.setPipeline(c.jfaPipeline)
      pass.setBindGroup(0, c.jfaBindGroup(srcIsA))
      pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
      srcIsA = !srcIsA
      step = Math.floor(step / 2)
    }
    // 收尾补一轮步长 1，消除 JFA 末档只查步长 1 邻居的遗漏
    d.queue.writeBuffer(c.jfaUniformBuf, 0, new Uint32Array([c.grid.gridW, c.grid.gridH, 1, 1]))
    pass.setPipeline(c.jfaPipeline)
    pass.setBindGroup(0, c.jfaBindGroup(srcIsA))
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
    srcIsA = !srcIsA
    pass.end()
    d.queue.submit([enc.finish()])

    // 精确化：自适应扩张桶环，单轮 dispatch 得到与 CPU 全枚举一致的维诺归属
    const refineEnc = d.createCommandEncoder()
    d.queue.writeBuffer(
      c.refineUniformBuf,
      0,
      new Uint32Array([c.grid.gridW, c.grid.gridH, birdCount, buckets.bucketSize]),
    )
    const rfPass = refineEnc.beginComputePass()
    rfPass.setPipeline(c.jfaRefinePipeline)
    rfPass.setBindGroup(0, c.jfaRefineBindGroup())
    rfPass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
    rfPass.end()
    d.queue.submit([refineEnc.finish()])

    const statEnc = d.createCommandEncoder()
    d.queue.writeBuffer(c.areaUniformBuf, 0, new Uint32Array([c.grid.gridW, c.grid.gridH, birdCount, 0]))
    pass = statEnc.beginComputePass()
    pass.setPipeline(c.areaPipeline)
    pass.setBindGroup(0, c.areaBindGroup())
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
    pass.end()

    // u32 字段与 f32 字段共用 uniform，用同一 ArrayBuffer 的两种视图打包
    const densPack = new ArrayBuffer(16)
    new Uint32Array(densPack).set([c.grid.gridW, c.grid.gridH, densityRadiusCells, 0])
    new Float32Array(densPack).set([c.grid.cellArea], 3)
    d.queue.writeBuffer(c.densityUniformBuf, 0, densPack)
    pass = statEnc.beginComputePass()
    pass.setPipeline(c.densityPipeline)
    pass.setBindGroup(0, c.densityBindGroup())
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
    pass.end()
    d.queue.submit([statEnc.finish()])
    await d.queue.onSubmittedWorkDone()
    const tAfterVoronoi = performance.now()

    // 两个距离场
    await this.runDistanceField(this.distanceSeed(feederCells), c.feederDistBuf)
    const tAfterFeeder = performance.now()
    await this.runDistanceField(this.distanceSeed(drinkerCells), c.drinkerDistBuf)
    const tAfterDrinker = performance.now()

    // 一次性读回
    const readEnc = d.createCommandEncoder()
    const offsets = {
      owner: 0,
      density: n * 4,
      feeder: n * 8,
      drinker: n * 12,
      counts: n * 16,
    }
    readEnc.copyBufferToBuffer(c.ownerBuf, 0, c.readbackBuf, offsets.owner, n * 4)
    readEnc.copyBufferToBuffer(c.densityBuf, 0, c.readbackBuf, offsets.density, n * 4)
    readEnc.copyBufferToBuffer(c.feederDistBuf, 0, c.readbackBuf, offsets.feeder, n * 4)
    readEnc.copyBufferToBuffer(c.drinkerDistBuf, 0, c.readbackBuf, offsets.drinker, n * 4)
    readEnc.copyBufferToBuffer(c.countBuf, 0, c.readbackBuf, offsets.counts, birdCount * 4)
    d.queue.submit([readEnc.finish()])
    await c.readbackBuf.mapAsync(GPUMapMode.READ)
    const raw = new Float32Array(c.readbackBuf.getMappedRange().slice(0))
    c.readbackBuf.unmap()

    const owner = Int32Array.from(new Int32Array(raw.buffer, offsets.owner, n))
    const density = new Float32Array(raw.buffer, offsets.density, n).slice()
    const feederRaw = new Float32Array(raw.buffer, offsets.feeder, n)
    const drinkerRaw = new Float32Array(raw.buffer, offsets.drinker, n)
    const cellCounts = new Uint32Array(raw.buffer, offsets.counts, birdCount)
    const areas = new Float32Array(birdCount)
    for (let b = 0; b < birdCount; b++) areas[b] = cellCounts[b] * c.grid.cellArea
    const toMeters = (v: number): number => (v >= INF / 2 ? Infinity : v * c.grid.cellSize)
    const feederDistance = Float32Array.from(feederRaw, toMeters)
    const drinkerDistance = Float32Array.from(drinkerRaw, toMeters)

    return {
      output: {
        frameIndex,
        owner,
        areas,
        density,
        feederDistance,
        drinkerDistance,
        blocked: c.grid.blocked,
        gridW: c.grid.gridW,
        gridH: c.grid.gridH,
        cellSize: c.grid.cellSize,
      },
      timing: {
        jfaMs: tAfterVoronoi - t0,
        areaMs: 0,
        densityMs: 0,
        feederDistMs: tAfterFeeder - tAfterVoronoi,
        drinkerDistMs: tAfterDrinker - tAfterFeeder,
        totalMs: performance.now() - t0,
      },
    }
  }

  // 四向有序扫描 + 8 邻域松弛至无变化，结果复制到 outBuf
  private async runDistanceField(seed: Float32Array, outBuf: GPUBuffer): Promise<void> {
    const c = this.ctx
    const d = c.device
    const n = c.cellCount
    d.queue.writeBuffer(c.distScratchA, 0, seed)
    d.queue.writeBuffer(c.changeBuf, 0, new Uint32Array(4))

    const sweepEnc = d.createCommandEncoder()
    for (let dir = 0; dir < 4; dir++) {
      d.queue.writeBuffer(c.distUniformBuf, 0, new Uint32Array([c.grid.gridW, c.grid.gridH, dir, 0]))
      const pass = sweepEnc.beginComputePass()
      pass.setPipeline(c.sweepPipeline)
      pass.setBindGroup(0, c.sweepBindGroup(c.distScratchA))
      pass.dispatchWorkgroups(dir < 2 ? c.grid.gridH : c.grid.gridW)
      pass.end()
    }
    d.queue.submit([sweepEnc.finish()])

    for (let iter = 0; iter < 12; iter++) {
      d.queue.writeBuffer(c.changeBuf, 0, new Uint32Array(4))
      const enc = d.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(c.relaxPipeline)
      pass.setBindGroup(0, c.relaxBindGroup())
      pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP))
      pass.end()
      enc.copyBufferToBuffer(c.changeBuf, 0, c.scalarReadback, 0, 16)
      d.queue.submit([enc.finish()])
      await d.queue.onSubmittedWorkDone()
      await c.scalarReadback.mapAsync(GPUMapMode.READ, 0, 16)
      const changes = new Uint32Array(c.scalarReadback.getMappedRange(0, 16).slice(0))[0]
      c.scalarReadback.unmap()

      const copyEnc = d.createCommandEncoder()
      copyEnc.copyBufferToBuffer(c.distScratchB, 0, c.distScratchA, 0, n * 4)
      d.queue.submit([copyEnc.finish()])
      if (changes === 0) break
    }

    const out = d.createCommandEncoder()
    out.copyBufferToBuffer(c.distScratchA, 0, outBuf, 0, n * 4)
    d.queue.submit([out.finish()])
    await d.queue.onSubmittedWorkDone()
  }
}
