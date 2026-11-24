// 批次报告：抽样帧汇总各段密度、扎堆、料水覆盖
import type { Batch, BatchReport, EquipmentLayout, HouseProfile, Settings } from '@/types'
import { analyzeFrame } from '@/services/analysis'
import { frameCount } from '@/lib/simulation'
import { segmentAtY, segmentCount } from '@/lib/grid'
import { coverageFromOutput } from '@/services/analysis'

// 每天抽 4 帧（6 小时间隔），42 天 168 帧
export function sampleFrameIndices(batch: Batch, perDay = 4): number[] {
  const total = frameCount(batch)
  const step = Math.floor(144 / perDay)
  const indices: number[] = []
  for (let f = 0; f < total; f += step) indices.push(f)
  return indices
}

export async function generateReport(
  house: HouseProfile,
  layout: EquipmentLayout,
  batch: Batch,
  settings: Settings,
  onProgress?: (ratio: number) => void,
): Promise<BatchReport> {
  const segN = segmentCount(house)
  const acc = Array.from({ length: segN }, () => ({
    densitySum: 0,
    samples: 0,
    huddleCount: 0,
    drinkerBadCells: 0,
    feederBadCells: 0,
    openCells: 0,
  }))
  let totalHuddles = 0
  let globalWaterBad = 0
  let globalFeedBad = 0
  let globalOpen = 0

  const indices = sampleFrameIndices(batch)
  for (let k = 0; k < indices.length; k++) {
    const frame = await analyzeFrame(house, layout, batch, settings, indices[k], true)
    const { output, huddles } = frame
    for (let i = 0; i < output.density.length; i++) {
      if (output.blocked[i]) continue
      const row = (i / output.gridW) | 0
      const y = (row + 0.5) * output.cellSize
      const seg = segmentAtY(house, y)
      acc[seg].samples++
      acc[seg].densitySum += output.density[i]
      acc[seg].openCells++
      if (Number.isFinite(output.drinkerDistance[i]) && output.drinkerDistance[i] > settings.maxDrinkerDistance) {
        acc[seg].drinkerBadCells++
        globalWaterBad++
      }
      if (Number.isFinite(output.feederDistance[i]) && output.feederDistance[i] > settings.maxFeederDistance) {
        acc[seg].feederBadCells++
        globalFeedBad++
      }
      globalOpen++
    }
    for (const h of huddles) {
      const seg = segmentAtY(house, h.center.y)
      acc[seg].huddleCount++
      totalHuddles++
    }
    onProgress?.((k + 1) / indices.length)
  }

  return {
    batchId: batch.id,
    generatedAt: Date.now(),
    totalHuddles,
    overallBadDrinkerRatio: globalWaterBad / Math.max(1, globalOpen),
    overallBadFeederRatio: globalFeedBad / Math.max(1, globalOpen),
    segmentStats: acc.map((a, i) => ({
      segmentIndex: i,
      avgDensity: a.samples ? a.densitySum / a.samples : 0,
      huddleCount: a.huddleCount,
      drinkerBadAreaRatio: a.drinkerBadCells / Math.max(1, a.openCells),
      feederBadAreaRatio: a.feederBadCells / Math.max(1, a.openCells),
    })),
  }
}

export function downloadJson(report: BatchReport, filename: string): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
}

export function downloadCsv(report: BatchReport, filename: string): void {
  const rows = [
    ['分段', '平均密度(kg/m2)', '扎堆次数', '饮水超标面积占比', '料盘超标面积占比'],
    ...report.segmentStats.map((s) => [
      `第${s.segmentIndex + 1}段`,
      s.avgDensity.toFixed(2),
      String(s.huddleCount),
      (s.drinkerBadAreaRatio * 100).toFixed(1) + '%',
      (s.feederBadAreaRatio * 100).toFixed(1) + '%',
    ]),
    [],
    ['全舍扎堆总次数', String(report.totalHuddles)],
    ['全舍饮水超标面积占比', (report.overallBadDrinkerRatio * 100).toFixed(1) + '%'],
    ['全舍料盘超标面积占比', (report.overallBadFeederRatio * 100).toFixed(1) + '%'],
  ]
  const csv = rows.map((r) => r.join(',')).join('\n')
  triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export { coverageFromOutput }
