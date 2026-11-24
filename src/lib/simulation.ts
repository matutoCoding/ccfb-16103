// 确定性鸡群仿真：任意帧按需复现，不落库
import type { Batch, HouseProfile, SimulationEvent, Vec2 } from '@/types'
import { frameBirdSeed, mulberry32, wander1 } from '@/lib/rng'
import { weightAtAge } from '@/lib/growth'
import { nearestDoor } from '@/lib/grid'

export interface FrameBirds {
  // 平铺 x,y
  positions: Float32Array
  weights: Float32Array
  ageDay: number
  hourOfDay: number
}

const MARGIN = 0.4
const WANDER_SPEED = 0.55 // 每天的游走频率基数

export function frameCount(batch: Batch): number {
  return Math.floor((batch.durationDays * 24 * 60) / batch.frameIntervalMin)
}

export function frameToAge(batch: Batch, frameIndex: number): { ageDay: number; ageMin: number; hourOfDay: number } {
  const ageMin = frameIndex * batch.frameIntervalMin
  return { ageDay: ageMin / 1440 + 1, ageMin, hourOfDay: (ageMin / 60) % 24 }
}

interface BirdMeta {
  homeSegment: number
  rx: number
  ry: number
  fx: number
  fy: number
  baseX: number
  baseY: number
  phase: number
}

// 每只鸡的固定属性（整批复用，懒缓存）
const metaCache = new Map<string, BirdMeta[]>()

function getBirdMeta(batch: Batch, house: HouseProfile): BirdMeta[] {
  const cached = metaCache.get(batch.id)
  if (cached) return cached
  const rng = mulberry32(batch.seed ^ 0x9e3779b9)
  const segCount = house.partitions.length + 1
  const meta: BirdMeta[] = []
  for (let i = 0; i < batch.birdCount; i++) {
    meta.push({
      homeSegment: i % segCount,
      rx: 0.7 + rng() * 0.6,
      ry: 0.7 + rng() * 0.6,
      fx: 0.6 + rng() * 1.4,
      fy: 0.6 + rng() * 1.4,
      baseX: rng(),
      baseY: rng(),
      phase: rng() * Math.PI * 2,
    })
  }
  metaCache.set(batch.id, meta)
  return meta
}

export function clearSimCache(): void {
  metaCache.clear()
}

function segmentBounds(house: HouseProfile, segment: number): { y0: number; y1: number } {
  const walls = house.partitions.slice().sort((a, b) => a.y - b.y)
  const y0 = segment === 0 ? MARGIN : walls[segment - 1].y + 0.35
  const y1 = segment === walls.length ? house.length - MARGIN : walls[segment].y - 0.35
  return { y0, y1 }
}

function activeEvents(events: SimulationEvent[], ageMin: number): SimulationEvent[] {
  return events.filter((e) => ageMin >= e.startAgeMin && ageMin <= e.endAgeMin)
}

export function generateFrame(batch: Batch, house: HouseProfile, frameIndex: number): FrameBirds {
  const { ageDay, ageMin, hourOfDay } = frameToAge(batch, frameIndex)
  const meta = getBirdMeta(batch, house)
  const positions = new Float32Array(batch.birdCount * 2)
  const weights = new Float32Array(batch.birdCount)
  const events = activeEvents(batch.events, ageMin)
  const cold = events.find((e) => e.type === 'coldSnap')
  const leak = events.find((e) => e.type === 'waterLeak')
  const t = ageMin / 1440
  const walls = house.partitions.slice().sort((a, b) => a.y - b.y)
  const nightDim = hourOfDay >= 19 || hourOfDay < 5 ? 0.55 : 1

  for (let i = 0; i < batch.birdCount; i++) {
    const m = meta[i]
    const rng = mulberry32(frameBirdSeed(batch.seed, frameIndex, i))
    const jitter = rng()
    const bounds = segmentBounds(house, m.homeSegment)
    const spanX = house.width - MARGIN * 2
    const spanY = bounds.y1 - bounds.y0

    // 基础游走位置（分段内）
    let x = MARGIN + (0.5 + 0.42 * wander1(m.baseX, t * WANDER_SPEED * m.fx, m.fx)) * spanX * m.rx * 0.9
    x = Math.min(house.width - MARGIN, MARGIN + Math.max(0, Math.min(1, (x - MARGIN) / spanX)) * spanX)
    let y = bounds.y0 + (0.5 + 0.4 * wander1(m.baseY, t * WANDER_SPEED * m.fy, m.fy)) * spanY * m.ry * 0.9
    y = Math.max(bounds.y0, Math.min(bounds.y1, y))

    // 喂料时段（每天 6 点、12 点、18 点前后一小时）向料线方向轻微聚拢
    const feedWave = Math.exp(-Math.pow(((hourOfDay % 6) - 1.5) / 1.1, 2))
    if (feedWave > 0.25) {
      x += (jitter - 0.5) * 0.6 * feedWave
    }

    if (cold) {
      // 夜间冷应激：整舍向风机端收缩，按鸟编号比例决定卷入程度
      const involved = (i % 100) / 100 < cold.strength
      const isNight = hourOfDay >= 19 || hourOfDay < 6
      if (involved && isNight) {
        const target: Vec2 = {
          x: cold.pos.x + (rng() - 0.5) * cold.radius,
          y: cold.pos.y + (rng() - 0.5) * cold.radius * 0.6,
        }
        // 必须穿过的门洞序列，按从当前位置到目标的顺序逐段靠拢
        const loY = Math.min(y, target.y)
        const hiY = Math.max(y, target.y)
        const crossed = walls.filter((w) => w.y > loY && w.y < hiY)
        let legFrom: Vec2 = { x, y }
        for (const wall of crossed) {
          const door: Vec2 = { x: nearestDoor(wall, legFrom.x), y: wall.y }
          x = x * 0.55 + door.x * 0.45
          y = y * 0.55 + door.y * 0.45
          legFrom = { x, y }
        }
        const k = 0.82
        x = x * (1 - k) + target.x * k
        y = y * (1 - k) + target.y * k
      }
    }

    if (leak) {
      const dx = x - leak.pos.x
      const dy = y - leak.pos.y
      const dist = Math.hypot(dx, dy)
      if (dist < leak.radius) {
        const push = (1 - dist / leak.radius) * leak.strength * 2.2
        const nx = dist > 0.01 ? dx / dist : rng() - 0.5
        const ny = dist > 0.01 ? dy / dist : rng() - 0.5
        x += nx * push
        y += ny * push
      }
    }

    // 夜间活动范围收窄
    if (nightDim < 1) {
      x += (m.baseX * house.width - x) * 0.08
      y += (bounds.y0 + m.baseY * spanY - y) * 0.08
    }

    // 夹到舍内且不进墙格
    x = Math.max(MARGIN, Math.min(house.width - MARGIN, x))
    y = Math.max(MARGIN, Math.min(house.length - MARGIN, y))
    for (const wall of walls) {
      if (Math.abs(y - wall.y) < 0.3) {
        const nearDoor = wall.doors.some((d) => x > d.x - 0.3 && x < d.x + d.width + 0.3)
        if (!nearDoor) y = y < wall.y ? wall.y - 0.35 : wall.y + 0.35
      }
    }

    positions[i * 2] = x
    positions[i * 2 + 1] = y
    weights[i] = weightAtAge(ageDay)
  }
  return { positions, weights, ageDay, hourOfDay }
}
