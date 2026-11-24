// WebGPU 三维实例化渲染：鸡舍、隔栏、设备、三万只鸡单 draw call
import { bodyScaleAtAge } from '@/lib/growth'
import type { EquipmentLayout, HouseProfile } from '@/types'

export type BirdColorMode = 'area' | 'water' | 'uniform'

const RENDER_WGSL = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
};
struct Instance {
  pos: vec3<f32>,
  scale: f32,
  color: vec3<f32>,
  pad: f32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>,
      @builtin(instance_index) ii: u32) -> VsOut {
  let inst = instances[ii];
  let world = vec4<f32>(position * inst.scale + inst.pos, 1.0);
  var out: VsOut;
  out.clip = cam.viewProj * world;
  out.normal = normal;
  out.color = inst.color;
  return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let light = normalize(vec3<f32>(0.4, 0.8, 0.6));
  let lambert = clamp(dot(normalize(in.normal), light), 0.25, 1.0);
  return vec4<f32>(in.color * (0.35 + 0.65 * lambert), 1.0);
}
`;

const LINE_WGSL = /* wgsl */ `
struct Camera { viewProj: mat4x4<f32> };
@group(0) @binding(0) var<uniform> cam: Camera;
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) color: vec3<f32> };
@vertex
fn vs(@location(0) p: vec3<f32>, @location(1) c: vec3<f32>) -> VOut {
  var out: VOut;
  out.clip = cam.viewProj * vec4<f32>(p, 1.0);
  out.color = c;
  return out;
}
@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;

interface CameraState {
  yaw: number
  pitch: number
  dist: number
  target: [number, number, number]
}

// 低模椭球（单位球，实例侧缩放）
function unitSphere(latBands = 8, lonBands = 12): { vertices: Float32Array; indices: Uint16Array } {
  const verts: number[] = []
  const idx: number[] = []
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands
      const x = Math.sin(theta) * Math.cos(phi)
      const y = Math.cos(theta)
      const z = Math.sin(theta) * Math.sin(phi)
      verts.push(x * 0.16, y * 0.11, z * 0.22, x, y, z)
    }
  }
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon
      const second = first + lonBands + 1
      idx.push(first, second, first + 1, second, second + 1, first + 1)
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idx) }
}

function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2)
  const nf = 1 / (near - far)
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}

function mat4LookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z = norm3(sub3(eye, target))
  const x = norm3(cross3(up, z))
  const y = cross3(z, x)
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ])
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return o
}
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm3 = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

const MAX_INSTANCES = 40000
const INSTANCE_FLOATS = 8

export class FlockRenderer {
  canvas: HTMLCanvasElement
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
  house: HouseProfile
  layout: EquipmentLayout
  camera: CameraState = { yaw: 0.6, pitch: 0.9, dist: 90, target: [7.5, 4, 60] }
  private instanceBuf: GPUBuffer
  private instanceCount = 0
  private camBuf: GPUBuffer
  private birdPipeline: GPURenderPipeline
  private linePipeline: GPURenderPipeline
  private sphereVbo: GPUBuffer
  private sphereIbo: GPUBuffer
  private indexCount: number
  private lineVbo: GPUBuffer
  private lineVertexCount = 0
  private depthTex: GPUTexture
  private raf = 0
  private dragging = false
  private lastPointer = [0, 0]
  constructor(canvas: HTMLCanvasElement, device: GPUDevice, house: HouseProfile, layout: EquipmentLayout) {
    this.canvas = canvas
    this.device = device
    this.house = house
    this.layout = layout
    const ctx = canvas.getContext('webgpu')
    if (!ctx) throw new Error('Canvas 无法初始化 WebGPU')
    this.context = ctx
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' })

    this.camBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.instanceBuf = device.createBuffer({
      size: MAX_INSTANCES * INSTANCE_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const sphere = unitSphere()
    this.sphereVbo = device.createBuffer({ size: sphere.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(this.sphereVbo, 0, sphere.vertices)
    this.sphereIbo = device.createBuffer({ size: sphere.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(this.sphereIbo, 0, sphere.indices)
    this.indexCount = sphere.indices.length

    const birdModule = device.createShaderModule({ code: RENDER_WGSL })
    this.birdPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: birdModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: { module: birdModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    })
    const lineModule = device.createShaderModule({ code: LINE_WGSL })
    this.linePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: { module: lineModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    })
    this.lineVbo = device.createBuffer({ size: 256 * 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.depthTex = this.makeDepth()
    this.buildStaticLines()
    this.bindPointer()
  }

  private makeDepth(): GPUTexture {
    return this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  private camBindGroup(pipeline: GPURenderPipeline): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.camBuf } }],
    })
  }

  private birdBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.birdPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: this.instanceBuf } }],
    })
  }

  private buildStaticLines(): void {
    const h = this.house
    const verts: number[] = []
    const push = (a: number[], b: number[], color: number[]) => verts.push(...a, ...color, ...b, ...color)
    const floor = [0.55, 0.57, 0.6]
    // 地面四边
    push([0, 0, 0], [h.width, 0, 0], floor)
    push([h.width, 0, 0], [h.width, 0, h.length], floor)
    push([h.width, 0, h.length], [0, 0, h.length], floor)
    push([0, 0, h.length], [0, 0, 0], floor)
    // 隔栏（门洞断开）
    const wallColor = [0.9, 0.55, 0.2]
    for (const p of h.partitions) {
      const cuts = [...p.doors].sort((a, b) => a.x - b.x)
      let cursor = 0
      for (const d of cuts) {
        push([cursor, 0.02, p.y], [d.x, 0.02, p.y], wallColor)
        push([d.x, 0.02, p.y], [d.x, 1.4, p.y], wallColor)
        push([d.x + d.width, 0.02, p.y], [d.x + d.width, 1.4, p.y], wallColor)
        cursor = d.x + d.width
      }
      push([cursor, 0.02, p.y], [h.width, 0.02, p.y], wallColor)
    }
    // 设备线
    for (const line of this.layout.lines) {
      const color = line.kind === 'feeder' ? [0.35, 0.7, 0.95] : [0.4, 0.85, 0.55]
      push([line.x, line.height, line.yStart], [line.x, line.height, line.yEnd], color)
      for (const node of this.layout.nodes.filter((n) => n.lineId === line.id)) {
        push(
          [node.pos.x, line.height, node.pos.y],
          [node.pos.x, 0.05, node.pos.y],
          color.map((v) => v * 0.7),
        )
      }
    }
    // 湿帘/风机标记
    push([0, 1.5, h.wetPadY], [h.width, 1.5, h.wetPadY], [0.3, 0.7, 1])
    push([0, 1.5, h.fanY], [h.width, 1.5, h.fanY], [0.8, 0.4, 0.4])
    const data = new Float32Array(verts)
    if (data.byteLength > this.lineVbo.size) {
      this.lineVbo.destroy()
      this.lineVbo = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    }
    this.device.queue.writeBuffer(this.lineVbo, 0, data)
    this.lineVertexCount = verts.length / 6
  }

  updateBirds(positions: Float32Array, ageDay: number, colorMode: BirdColorMode, colorValues?: Float32Array): void {
    const count = positions.length / 2
    const scale = bodyScaleAtAge(ageDay)
    const data = new Float32Array(count * INSTANCE_FLOATS)
    for (let i = 0; i < count; i++) {
      const o = i * INSTANCE_FLOATS
      data[o] = positions[i * 2]
      data[o + 1] = 0.12 * scale
      data[o + 2] = positions[i * 2 + 1]
      data[o + 3] = scale
      let color: number[]
      if (colorMode === 'area' && colorValues) {
        color = heatColor(1 - clamp01(colorValues[i] / 0.5))
      } else if (colorMode === 'water' && colorValues) {
        color = heatColor(clamp01(colorValues[i] / 4))
      } else {
        color = [0.92, 0.85, 0.72]
      }
      data[o + 4] = color[0]
      data[o + 5] = color[1]
      data[o + 6] = color[2]
      data[o + 7] = 0
    }
    this.device.queue.writeBuffer(this.instanceBuf, 0, data)
    this.instanceCount = count
  }

  setLayout(layout: EquipmentLayout): void {
    this.layout = layout
    this.buildStaticLines()
  }

  private bindPointer(): void {
    const el = this.canvas
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.lastPointer = [e.clientX, e.clientY]
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointerup', () => (this.dragging = false))
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastPointer[0]
      const dy = e.clientY - this.lastPointer[1]
      this.lastPointer = [e.clientX, e.clientY]
      this.camera.yaw -= dx * 0.006
      this.camera.pitch = Math.min(1.45, Math.max(0.15, this.camera.pitch - dy * 0.005))
    })
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.camera.dist = Math.min(220, Math.max(15, this.camera.dist * (1 + Math.sign(e.deltaY) * 0.08)))
      },
      { passive: false },
    )
  }

  private viewProj(): Float32Array {
    const { yaw, pitch, dist, target } = this.camera
    const eye = [
      target[0] + dist * Math.sin(pitch) * Math.sin(yaw),
      target[1] + dist * Math.cos(pitch),
      target[2] + dist * Math.sin(pitch) * Math.cos(yaw),
    ]
    const aspect = this.canvas.width / Math.max(1, this.canvas.height)
    return mul4(mat4Perspective((55 * Math.PI) / 180, aspect, 0.1, 500), mat4LookAt(eye, target, [0, 1, 0]))
  }

  resize(w: number, h: number): void {
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.depthTex.destroy()
    this.depthTex = this.makeDepth()
  }

  render(): void {
    this.device.queue.writeBuffer(this.camBuf, 0, this.viewProj())
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })
    // 静态线框
    pass.setPipeline(this.linePipeline)
    pass.setBindGroup(0, this.camBindGroup(this.linePipeline))
    pass.setVertexBuffer(0, this.lineVbo)
    pass.draw(this.lineVertexCount)
    // 实例化鸡群
    if (this.instanceCount > 0) {
      pass.setPipeline(this.birdPipeline)
      pass.setBindGroup(0, this.camBindGroup(this.birdPipeline))
      pass.setBindGroup(1, this.birdBindGroup())
      pass.setVertexBuffer(0, this.sphereVbo)
      pass.setIndexBuffer(this.sphereIbo, 'uint16')
      pass.drawIndexed(this.indexCount, this.instanceCount)
    }
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  start(): void {
    const loop = () => {
      this.render()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// 蓝 → 青 → 绿 → 黄 → 红
function heatColor(t: number): number[] {
  const stops = [
    [0.15, 0.35, 0.85],
    [0.2, 0.75, 0.8],
    [0.35, 0.8, 0.4],
    [0.95, 0.8, 0.25],
    [0.9, 0.25, 0.2],
  ]
  const x = clamp01(t) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const k = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
