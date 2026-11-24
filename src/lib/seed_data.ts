// 首次启动的演示数据
import type { Batch, HouseProfile, Settings } from '@/types'
import { uid } from '@/lib/equipment'

export function defaultHouse(): HouseProfile {
  const now = Date.now()
  return {
    id: uid('house'),
    name: '一号鸡舍',
    width: 15,
    length: 120,
    // 湿帘在 y=0 端，风机在 y=120 端
    wetPadY: 0,
    fanY: 120,
    partitions: [
      { id: uid('part'), y: 40, doors: [{ x: 6.5, width: 2 }] },
      { id: uid('part'), y: 80, doors: [{ x: 6.5, width: 2 }] },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

export function defaultBatch(houseId: string, layoutId: string): Batch {
  return {
    id: uid('batch'),
    houseId,
    layoutId,
    name: '2026 秋季第一批',
    breed: '科宝 500',
    birdCount: 30000,
    startAt: new Date(2026, 9, 1).getTime(),
    durationDays: 42,
    seed: 20261101,
    frameIntervalMin: 10,
    events: [
      {
        // 第 18 天夜里湿帘端失温，鸡群挤到风机端
        id: uid('evt'),
        type: 'coldSnap',
        startAgeMin: 17 * 1440 + 19 * 60,
        endAgeMin: 18 * 1440 + 5 * 60,
        pos: { x: 7.5, y: 108 },
        radius: 14,
        strength: 0.85,
      },
      {
        // 第 26 天一条水线漏水，周围鸡只回避
        id: uid('evt'),
        type: 'waterLeak',
        startAgeMin: 25 * 1440 + 8 * 60,
        endAgeMin: 27 * 1440 + 20 * 60,
        pos: { x: 5.25, y: 55 },
        radius: 6,
        strength: 1,
      },
    ],
    createdAt: Date.now(),
  }
}

export function defaultSettings(): Settings {
  return {
    id: 'app',
    cellSize: 0.25,
    densityLimit: 38,
    maxDrinkerDistance: 3,
    maxFeederDistance: 4,
    huddleCellArea: 0.18,
    huddleMinBirds: 40,
  }
}
