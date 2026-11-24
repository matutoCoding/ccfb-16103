// 扎堆识别：维诺小单元连通块 + 持续时间归并
import type { FrameOutput, HuddleSnapshot, Vec2 } from '@/types'

// 8 邻域洪水填充，找出拥挤鸡连片区域
export function detectHuddles(
  output: FrameOutput,
  positions: Float32Array,
  areaThreshold: number,
  minBirds: number,
): HuddleSnapshot[] {
  const { owner, gridW, gridH, blocked, areas } = output
  const crowded = new Uint8Array(areas.length)
  for (let b = 0; b < areas.length; b++) {
    if (areas[b] > 0 && areas[b] < areaThreshold) crowded[b] = 1
  }
  const visitedCell = new Uint8Array(gridW * gridH)
  const result: HuddleSnapshot[] = []

  for (let i = 0; i < gridW * gridH; i++) {
    if (visitedCell[i] || blocked[i]) continue
    const bird = owner[i]
    if (bird < 0 || !crowded[bird]) continue
    // BFS 连通的拥挤格
    const queue = [i]
    const birdSet = new Set<number>()
    let sx = 0
    let sy = 0
    let cells = 0
    visitedCell[i] = 1
    while (queue.length) {
      const idx = queue.shift() as number
      const col = idx % gridW
      const row = (idx / gridW) | 0
      const b = owner[idx]
      if (b >= 0 && crowded[b]) {
        birdSet.add(b)
        sx += positions[b * 2]
        sy += positions[b * 2 + 1]
        cells++
      }
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const nc = col + dc
          const nr = row + dr
          if (nc < 0 || nc >= gridW || nr < 0 || nr >= gridH) continue
          const ni = nr * gridW + nc
          if (visitedCell[ni] || blocked[ni]) continue
          const nb = owner[ni]
          if (nb >= 0 && crowded[nb]) {
            visitedCell[ni] = 1
            queue.push(ni)
          }
        }
      }
    }
    if (birdSet.size >= minBirds) {
      const birdIds = [...birdSet]
      let avgArea = 0
      for (const b of birdIds) avgArea += areas[b]
      avgArea /= birdIds.length
      result.push({
        center: { x: sx / Math.max(1, cells), y: sy / Math.max(1, cells) },
        birdCount: birdSet.size,
        avgArea,
        birdIds,
      })
    }
  }
  return result
}

// 相邻帧扎堆事件按中心距离归并，计算持续时长
export interface TrackedHuddle {
  id: string
  batchId: string
  startFrame: number
  endFrame: number
  center: Vec2
  peakBirds: number
  avgArea: number
}

interface InternalTrack extends TrackedHuddle {
  snapCenter: Vec2
  areaSum: number
  areaN: number
}

export function trackHuddles(
  batchId: string,
  frames: { frameIndex: number; snaps: HuddleSnapshot[] }[],
  frameIntervalMin: number,
  mergeRadiusM: number,
): (TrackedHuddle & { durationMin: number })[] {
  const tracks: InternalTrack[] = []
  let prev: InternalTrack[] = []
  for (const frame of frames) {
    const matched = new Set<number>()
    const current: InternalTrack[] = []
    for (const snap of frame.snaps) {
      let bestIdx = -1
      let bestDist = mergeRadiusM
      prev.forEach((t, i) => {
        if (matched.has(i)) return
        const d = Math.hypot(t.snapCenter.x - snap.center.x, t.snapCenter.y - snap.center.y)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      })
      if (bestIdx >= 0) {
        matched.add(bestIdx)
        const t = prev[bestIdx]
        t.endFrame = frame.frameIndex
        t.snapCenter = snap.center
        t.peakBirds = Math.max(t.peakBirds, snap.birdCount)
        t.areaSum += snap.avgArea
        t.areaN += 1
        t.avgArea = t.areaSum / t.areaN
        current.push(t)
      } else {
        current.push({
          id: `${batchId}-h${tracks.length}`,
          batchId,
          startFrame: frame.frameIndex,
          endFrame: frame.frameIndex,
          center: snap.center,
          peakBirds: snap.birdCount,
          avgArea: snap.avgArea,
          snapCenter: snap.center,
          areaSum: snap.avgArea,
          areaN: 1,
        })
      }
    }
    // 本帧没匹配上的旧轨迹收尾入库
    prev.forEach((t, i) => {
      if (!matched.has(i)) tracks.push(t)
    })
    prev = current
  }
  prev.forEach((t) => tracks.push(t))
  return tracks
    .map(({ snapCenter: _sc, areaSum: _as, areaN: _an, ...t }) => ({
      ...t,
      durationMin: (t.endFrame - t.startFrame + 1) * frameIntervalMin,
    }))
    .filter((t) => t.durationMin >= frameIntervalMin)
}
