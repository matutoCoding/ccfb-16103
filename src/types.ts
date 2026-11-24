// 全局领域类型定义

export interface Vec2 {
  x: number
  y: number
}

// 隔栏：横向封闭墙，仅门洞可通行
export interface Partition {
  id: string
  // 沿鸡舍纵向（y 轴，米）的位置
  y: number
  // 门洞，沿宽（x 轴，米），可多个
  doors: { x: number; width: number }[]
}

// 设备类型：料盘 / 乳头饮水器
export type NodeType = 'feeder' | 'drinker'

export interface EquipmentNode {
  id: string
  type: NodeType
  lineId: string
  pos: Vec2
}

export interface EquipmentLine {
  id: string
  kind: NodeType
  // 纵向线，x 固定，沿 y 铺
  x: number
  yStart: number
  yEnd: number
  // 节点间距，米
  spacing: number
  // 线高，米，按日龄调整
  height: number
  // 按隔栏分段，停用某段
  disabledSegmentIds: string[]
  name: string
}

export interface EquipmentLayout {
  id: string
  houseId: string
  name: string
  lines: EquipmentLine[]
  nodes: EquipmentNode[]
  createdAt: number
  updatedAt: number
}

export interface HouseProfile {
  id: string
  name: string
  // 米
  width: number
  length: number
  // 湿帘位置（沿 y 的一端）
  wetPadY: number
  // 风机位置（另一端 y）
  fanY: number
  partitions: Partition[]
  createdAt: number
  updatedAt: number
}

// 仿真事件
export type SimulationEventType = 'coldSnap' | 'waterLeak'

export interface SimulationEvent {
  id: string
  type: SimulationEventType
  startAgeMin: number
  endAgeMin: number
  // coldSnap: 扎堆中心；waterLeak: 漏水点
  pos: Vec2
  radius: number
  strength: number
}

export interface Batch {
  id: string
  houseId: string
  layoutId: string
  name: string
  breed: string
  birdCount: number
  startAt: number
  durationDays: number
  // 确定性仿真种子
  seed: number
  // 每帧间隔，分钟
  frameIntervalMin: number
  events: SimulationEvent[]
  createdAt: number
}

export interface Settings {
  id: string
  // 计算网格边长，米
  cellSize: number
  // 饲养密度上限，kg/m2
  densityLimit: number
  // 到饮水器允许最大距离，米
  maxDrinkerDistance: number
  // 到料盘允许最大距离，米
  maxFeederDistance: number
  // 维诺单元面积低于该值（平方米）判为拥挤个体
  huddleCellArea: number
  // 拥挤连通块最少鸡只数才算扎堆
  huddleMinBirds: number
}

export interface HuddleEvent {
  id: string
  batchId: string
  frameIndex: number
  ageMin: number
  center: Vec2
  birdCount: number
  avgArea: number
  durationMin: number
}

export interface FrameOutput {
  frameIndex: number
  // 每个网格的维诺归属
  owner: Int32Array
  // 每只鸡的维诺面积，平方米
  areas: Float32Array
  // 每格局部密度 kg/m2
  density: Float32Array
  // 绕障到最近料盘距离，米
  feederDistance: Float32Array
  // 绕障到最近饮水器距离，米
  drinkerDistance: Float32Array
  // 墙格标记
  blocked: Uint8Array
  gridW: number
  gridH: number
  cellSize: number
}

export interface HuddleSnapshot {
  center: Vec2
  birdCount: number
  avgArea: number
  birdIds: number[]
}

export interface BatchReport {
  batchId: string
  generatedAt: number
  segmentStats: {
    segmentIndex: number
    avgDensity: number
    huddleCount: number
    drinkerBadAreaRatio: number
    feederBadAreaRatio: number
  }[]
  totalHuddles: number
  overallBadDrinkerRatio: number
  overallBadFeederRatio: number
}
