// 设备布局：按线和间距生成料盘/饮水器节点，计算有效源格
import type { EquipmentLayout, EquipmentLine, HouseProfile, NodeType } from '@/types'
import type { GridGeometry } from '@/lib/grid'

let seq = 0
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export function regenerateNodes(layout: EquipmentLayout): EquipmentLayout {
  const nodes = []
  for (const line of layout.lines) {
    const span = line.yEnd - line.yStart
    const count = Math.max(1, Math.round(span / line.spacing))
    for (let i = 0; i <= count; i++) {
      const y = Math.min(line.yEnd, line.yStart + i * line.spacing)
      nodes.push({
        id: `${line.id}-n${i}`,
        type: line.kind,
        lineId: line.id,
        pos: { x: line.x, y },
      })
    }
  }
  return { ...layout, nodes, updatedAt: Date.now() }
}

// 判断节点所在分段是否被该线停用
export function isNodeEnabled(line: EquipmentLine, house: HouseProfile, y: number): boolean {
  if (line.disabledSegmentIds.length === 0) return true
  const walls = house.partitions.slice().sort((a, b) => a.y - b.y)
  let seg = 0
  for (const p of walls) {
    if (y >= p.y) seg++
  }
  return !line.disabledSegmentIds.includes(`seg-${seg}`)
}

export function sourceCellsFor(
  layout: EquipmentLayout,
  house: HouseProfile,
  grid: GridGeometry,
  type: NodeType,
): Int32Array {
  const cells: number[] = []
  for (const node of layout.nodes) {
    if (node.type !== type) continue
    const line = layout.lines.find((l) => l.id === node.lineId)
    if (line && !isNodeEnabled(line, house, node.pos.y)) continue
    const col = Math.min(grid.gridW - 1, Math.max(0, Math.floor(node.pos.x / grid.cellSize)))
    const row = Math.min(grid.gridH - 1, Math.max(0, Math.floor(node.pos.y / grid.cellSize)))
    const idx = row * grid.gridW + col
    if (!grid.blocked[idx]) cells.push(idx)
  }
  return Int32Array.from(new Set(cells))
}

// 推荐线高（米）：随日龄抬升，约等于鸡背高
export function recommendedLineHeight(ageDay: number, kind: NodeType): number {
  const backHeight = 0.09 + 0.006 * Math.min(42, ageDay)
  return kind === 'drinker' ? backHeight + 0.05 : backHeight + 0.02
}

export function defaultLayout(house: HouseProfile): EquipmentLayout {
  const lines: EquipmentLine[] = []
  const lineXs = [house.width * 0.2, house.width * 0.4, house.width * 0.6, house.width * 0.8]
  lineXs.forEach((x, i) => {
    lines.push({
      id: uid('feed-line'),
      kind: 'feeder',
      x,
      yStart: 2,
      yEnd: house.length - 2,
      spacing: 1.2,
      height: 0.12,
      disabledSegmentIds: [],
      name: `料线 ${i + 1}`,
    })
  })
  const waterXs = [house.width * 0.1, house.width * 0.35, house.width * 0.65, house.width * 0.9]
  waterXs.forEach((x, i) => {
    lines.push({
      id: uid('water-line'),
      kind: 'drinker',
      x,
      yStart: 2,
      yEnd: house.length - 2,
      spacing: 0.6,
      height: 0.14,
      disabledSegmentIds: [],
      name: `水线 ${i + 1}`,
    })
  })
  return regenerateNodes({
    id: uid('layout'),
    houseId: house.id,
    name: '默认料水布局',
    lines,
    nodes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}
