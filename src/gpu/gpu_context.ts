// WebGPU 计算引擎：资源与管线装配
import { JFA_STEP_WGSL, JFA_REFINE_WGSL, AREA_STATS_WGSL } from '@/gpu/shaders_jfa'
import { DIST_SWEEP_WGSL, DIST_RELAX_WGSL } from '@/gpu/shaders_distance'
import { DENSITY_WGSL } from '@/gpu/shaders_density'
import type { GridGeometry } from '@/lib/grid'

export const INF = 1e9
export const WORKGROUP = 64
const MAX_BIRDS = 40000

export class GpuContext {
  device: GPUDevice
  grid: GridGeometry
  cellCount: number
  supportsTimestamps: boolean

  jfaA: GPUBuffer
  jfaB: GPUBuffer
  birdPosBuf: GPUBuffer
  bucketOffsetBuf: GPUBuffer
  bucketCountBuf: GPUBuffer
  bucketBirdsBuf: GPUBuffer
  refineUniformBuf: GPUBuffer
  blockedBuf: GPUBuffer
  countBuf: GPUBuffer
  ownerBuf: GPUBuffer
  massBuf: GPUBuffer
  densityBuf: GPUBuffer
  distScratchA: GPUBuffer
  distScratchB: GPUBuffer
  feederDistBuf: GPUBuffer
  drinkerDistBuf: GPUBuffer
  changeBuf: GPUBuffer
  readbackBuf: GPUBuffer
  scalarReadback: GPUBuffer
  jfaUniformBuf: GPUBuffer
  distUniformBuf: GPUBuffer
  densityUniformBuf: GPUBuffer
  areaUniformBuf: GPUBuffer

  jfaPipeline: GPUComputePipeline
  jfaRefinePipeline: GPUComputePipeline
  areaPipeline: GPUComputePipeline
  sweepPipeline: GPUComputePipeline
  relaxPipeline: GPUComputePipeline
  densityPipeline: GPUComputePipeline

  constructor(device: GPUDevice, grid: GridGeometry) {
    this.device = device
    this.grid = grid
    this.cellCount = grid.gridW * grid.gridH
    this.supportsTimestamps = device.features.has('timestamp-query')
    const n = this.cellCount
    const storage = GPUBufferUsage.STORAGE
    const dst = GPUBufferUsage.COPY_DST
    const src = GPUBufferUsage.COPY_SRC

    this.jfaA = this.buf(n * 16, storage | dst)
    this.jfaB = this.buf(n * 16, storage | dst)
    // 全量鸡位置（格单位 x,y）+ CSR 空间分桶，容量按 4 万鸡
    this.birdPosBuf = this.buf(MAX_BIRDS * 8, storage | dst)
    this.bucketOffsetBuf = this.buf(n * 4, storage | dst)
    this.bucketCountBuf = this.buf(n * 4, storage | dst)
    this.bucketBirdsBuf = this.buf(MAX_BIRDS * 4, storage | dst)
    this.refineUniformBuf = this.buf(16, GPUBufferUsage.UNIFORM | dst)
    this.blockedBuf = this.buf(n * 4, storage | dst)
    this.countBuf = this.buf(MAX_BIRDS * 4, storage | dst | src)
    this.ownerBuf = this.buf(n * 4, storage | src)
    this.massBuf = this.buf(n * 4, storage | dst)
    this.densityBuf = this.buf(n * 4, storage | src)
    this.distScratchA = this.buf(n * 4, storage | dst | src)
    this.distScratchB = this.buf(n * 4, storage | dst)
    this.feederDistBuf = this.buf(n * 4, storage | dst | src)
    this.drinkerDistBuf = this.buf(n * 4, storage | dst | src)
    this.changeBuf = this.buf(16, storage | dst | src)
    // 读回区：owner + density + 两个距离场 + 面积
    this.readbackBuf = this.buf(n * 4 * 4 + MAX_BIRDS * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)
    this.scalarReadback = this.buf(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)
    this.jfaUniformBuf = this.buf(16, GPUBufferUsage.UNIFORM | dst)
    this.distUniformBuf = this.buf(16, GPUBufferUsage.UNIFORM | dst)
    this.densityUniformBuf = this.buf(16, GPUBufferUsage.UNIFORM | dst)
    this.areaUniformBuf = this.buf(16, GPUBufferUsage.UNIFORM | dst)

    this.device.queue.writeBuffer(this.blockedBuf, 0, this.grid.blocked)
    this.jfaPipeline = this.pipeline(JFA_STEP_WGSL)
    this.jfaRefinePipeline = this.pipeline(JFA_REFINE_WGSL)
    this.areaPipeline = this.pipeline(AREA_STATS_WGSL)
    this.sweepPipeline = this.pipeline(DIST_SWEEP_WGSL)
    this.relaxPipeline = this.pipeline(DIST_RELAX_WGSL)
    this.densityPipeline = this.pipeline(DENSITY_WGSL)
  }

  static async create(grid: GridGeometry): Promise<GpuContext> {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU，请使用最新版 Chrome/Edge')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('找不到可用的 GPU 适配器')
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    })
    return new GpuContext(device, grid)
  }

  private buf(size: number, usage: number): GPUBuffer {
    return this.device.createBuffer({ size, usage })
  }

  private pipeline(code: string): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' },
    })
  }

  // JFA 每步乒乓绑定
  jfaBindGroup(srcIsA: boolean): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.jfaPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.jfaUniformBuf } },
        { binding: 1, resource: { buffer: srcIsA ? this.jfaA : this.jfaB } },
        { binding: 2, resource: { buffer: srcIsA ? this.jfaB : this.jfaA } },
        { binding: 3, resource: { buffer: this.blockedBuf } },
      ],
    })
  }

  jfaRefineBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.jfaRefinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.refineUniformBuf } },
        { binding: 1, resource: { buffer: this.birdPosBuf } },
        { binding: 2, resource: { buffer: this.bucketOffsetBuf } },
        { binding: 3, resource: { buffer: this.bucketCountBuf } },
        { binding: 4, resource: { buffer: this.bucketBirdsBuf } },
        { binding: 5, resource: { buffer: this.ownerBuf } },
        { binding: 6, resource: { buffer: this.blockedBuf } },
      ],
    })
  }

  areaBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.areaPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.areaUniformBuf } },
        { binding: 1, resource: { buffer: this.ownerBuf } },
        { binding: 2, resource: { buffer: this.blockedBuf } },
        { binding: 3, resource: { buffer: this.countBuf } },
      ],
    })
  }

  densityBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.densityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.densityUniformBuf } },
        { binding: 1, resource: { buffer: this.massBuf } },
        { binding: 2, resource: { buffer: this.densityBuf } },
        { binding: 3, resource: { buffer: this.blockedBuf } },
      ],
    })
  }

  sweepBindGroup(buf: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.sweepPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.distUniformBuf } },
        { binding: 1, resource: { buffer: buf } },
        { binding: 2, resource: { buffer: this.blockedBuf } },
        { binding: 3, resource: { buffer: this.changeBuf } },
      ],
    })
  }

  relaxBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.relaxPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.distUniformBuf } },
        { binding: 1, resource: { buffer: this.distScratchA } },
        { binding: 2, resource: { buffer: this.distScratchB } },
        { binding: 3, resource: { buffer: this.blockedBuf } },
        { binding: 4, resource: { buffer: this.changeBuf } },
      ],
    })
  }

  destroy(): void {
    this.device.destroy()
  }
}
