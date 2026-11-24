// 计算网格与隔栏几何
import type { HouseProfile, Partition, Vec2 } from '@/types'

export interface GridGeometry {
  width: number
  length: number
  cellSize: number
  gridW: number
  gridH: number
  cellArea: number
  // 按 y 升序的隔栏（含墙所在格行）
  partitions: (Partition & { cellRow: number })[]
  // 每格是否被墙占用
  blocked: Uint8Array
  // 门洞覆盖的格列区间（每个隔栏一组）
  doorCells: { row: number; colStart: number; colEnd: number }[]
}

export function cellIndex(g: GridGeometry, col: number, row: number): number {
  return row * g.gridW + col
}

export function cellCenter(g: GridGeometry, col: number, row: number): Vec2 {
  return {
    x: (col + 0.5) * g.cellSize,
    y: (row + 0.5) * g.cellSize,
  }
}

export function pointToCell(g: GridGeometry, p: Vec2): { col: number; row: number } {
  return {
    col: Math.min(g.gridW - 1, Math.max(0, Math.floor(p.x / g.cellSize))),
    row: Math.min(g.gridH - 1, Math.max(0, Math.floor(p.y / g.cellSize))),
  }
}

export function buildGrid(house: HouseProfile, cellSize: number): GridGeometry {
  const gridW = Math.max(8, Math.round(house.width / cellSize))
  const gridH = Math.max(8, Math.round(house.length / cellSize))
  const blocked = new Uint8Array(gridW * gridH)
  const doorCells: GridGeometry['doorCells'] = []
  const partitions = house.partitions
    .slice()
    .sort((a, b) => a.y - b.y)
    .map((p) => {
      const row = Math.min(gridH - 1, Math.max(0, Math.round(p.y / cellSize) - 1))
      for (const d of p.doors) {
        const colStart = Math.max(0, Math.floor(d.x / cellSize))
        const colEnd = Math.min(gridW - 1, Math.floor((d.x + d.width) / cellSize))
        doorCells.push({ row, colStart, colEnd })
        // 门洞以外的格子标墙
        for (let c = 0; c < gridW; c++) {
          if (c < colStart || c > colEnd) blocked[cellIndexRaw(gridW, c, row)] = 1
        }
      }
      if (p.doors.length === 0) {
        for (let c = 0; c < gridW; c++) blocked[cellIndexRaw(gridW, c, row)] = 1
      }
      return { ...p, cellRow: row }
    })
  return {
    width: house.width,
    length: house.length,
    cellSize,
    gridW,
    gridH,
    cellArea: cellSize * cellSize,
    partitions,
    blocked,
    doorCells,
  }
}

function cellIndexRaw(gridW: number, col: number, row: number): number {
  return row * gridW + col
}

// 点所在的分段索引（按隔栏切分）
export function segmentAtY(house: HouseProfile, y: number): number {
  const sorted = house.partitions.slice().sort((a, b) => a.y - b.y)
  let seg = 0
  for (const p of sorted) {
    if (y >= p.y) seg++
    else break
  }
  return seg
}

export function segmentCount(house: HouseProfile): number {
  return house.partitions.length + 1
}

// 找某隔栏上距点最近的门洞中心
export function nearestDoor(partition: Partition, x: number): number {
  let best = partition.doors[0]?.x ?? 0
  let bestDist = Infinity
  for (const d of partition.doors) {
    const center = d.x + d.width / 2
    const dist = Math.abs(center - x)
    if (dist < bestDist) {
      bestDist = dist
      best = center
    }
  }
  return best
}
