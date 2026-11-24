// 全批扎堆扫描：按小时抽帧，检测后跨帧追踪，事件持久化到 IndexedDB
import type { Batch, EquipmentLayout, HouseProfile, HuddleEvent, Settings } from '@/types'
import { analyzeFrame } from '@/services/analysis'
import { trackHuddles } from '@/lib/huddle'
import { frameCount, frameToAge } from '@/lib/simulation'
import { db } from '@/lib/db'

// 每小时抽一帧（10 分钟一帧 → 每 6 帧）
export async function scanBatchHuddles(
  house: HouseProfile,
  layout: EquipmentLayout,
  batch: Batch,
  settings: Settings,
  onProgress?: (ratio: number) => void,
): Promise<HuddleEvent[]> {
  const total = frameCount(batch)
  const frames: { frameIndex: number; snaps: Awaited<ReturnType<typeof analyzeFrame>>['huddles'] }[] = []
  const sampled: number[] = []
  for (let f = 0; f < total; f += 6) sampled.push(f)

  for (let k = 0; k < sampled.length; k++) {
    const frameIndex = sampled[k]
    const frame = await analyzeFrame(house, layout, batch, settings, frameIndex, true)
    frames.push({ frameIndex, snaps: frame.huddles })
    onProgress?.((k + 1) / sampled.length)
  }

  const tracked = trackHuddles(batch.id, frames, 60, 8)
  await db.huddles.clearBatch(batch.id)
  const events: HuddleEvent[] = tracked.map((t, i) => ({
    id: `${batch.id}-huddle-${i}`,
    batchId: batch.id,
    frameIndex: t.startFrame,
    ageMin: frameToAge(batch, t.startFrame).ageMin,
    center: t.center,
    birdCount: t.peakBirds,
    avgArea: t.avgArea,
    durationMin: t.durationMin,
  }))
  for (const e of events) await db.huddles.put(e)
  return events
}
