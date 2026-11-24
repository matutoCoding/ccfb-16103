// Node 自测：JFA 维诺、chamfer 扫描 + 松弛距离场，对照 CPU 精确解
// 用小网格 + 少量鸡，全量逐格比对

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MiniGrid {
  w: number
  h: number
  blocked: Uint8Array
}

function idx(g: MiniGrid, c: number, r: number): number {
  return r * g.w + c
}

// ---- CPU 参考：精确维诺（格心到鸡位点欧氏距离）----
function exactVoronoi(g: MiniGrid, birds: { x: number; y: number }[]): Int32Array {
  const owner = new Int32Array(g.w * g.h).fill(-1)
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const i = idx(g, c, r)
      if (g.blocked[i]) continue
      const px = c + 0.5
      const py = r + 0.5
      let best = -1
      let bd = Infinity
      birds.forEach((b, bi) => {
        const d = (b.x - px) ** 2 + (b.y - py) ** 2
        if (d < bd) {
          bd = d
          best = bi
        }
      })
      owner[i] = best
    }
  }
  return owner
}

// ---- TS 移植版 JFA（与 shaders_jfa.ts 同逻辑，site 存连续位置，距离对格心计算）----
function jfa(g: MiniGrid, birds: { x: number; y: number }[]): Int32Array {
  const n = g.w * g.h
  // vec4: siteX, siteY, birdId, valid
  let src = new Float32Array(n * 4)
  let dst = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) src[i * 4 + 2] = -1
  birds.forEach((b, bi) => {
    const c = Math.min(g.w - 1, Math.max(0, Math.floor(b.x)))
    const r = Math.min(g.h - 1, Math.max(0, Math.floor(b.y)))
    const i = idx(g, c, r)
    if (g.blocked[i]) return
    if (src[i * 4 + 3] < 0.5 || bi < src[i * 4 + 2]) {
      src[i * 4] = b.x
      src[i * 4 + 1] = b.y
      src[i * 4 + 2] = bi
      src[i * 4 + 3] = 1
    }
  })
  let step = 1
  while (step * 2 <= Math.max(g.w, g.h)) step *= 2
  const jfaPass = (curStep: number, srcBuf: Float32Array, dstBuf: Float32Array) => {
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        const i = idx(g, c, r)
        if (g.blocked[i]) {
          dstBuf.set([0, 0, -1, 0], i * 4)
          continue
        }
        const px = c + 0.5
        const py = r + 0.5
        let best = srcBuf.slice(i * 4, i * 4 + 4)
        for (let sy = -1; sy <= 1; sy++) {
          for (let sx = -1; sx <= 1; sx++) {
            const nc = c + sx * curStep
            const nr = r + sy * curStep
            if (nc < 0 || nc >= g.w || nr < 0 || nr >= g.h) continue
            const ni = idx(g, nc, nr)
            if (g.blocked[ni]) continue
            const cand = srcBuf.slice(ni * 4, ni * 4 + 4)
            if (cand[3] < 0.5) continue
            if (best[3] < 0.5) {
              best = cand
              continue
            }
            const dc = (cand[0] - px) ** 2 + (cand[1] - py) ** 2
            const dp = (best[0] - px) ** 2 + (best[1] - py) ** 2
            if (dc < dp) best = cand
          }
        }
        dstBuf.set(best, i * 4)
      }
    }
  }
  while (step >= 1) {
    jfaPass(step, src, dst)
    ;[src, dst] = [dst, src]
    step = Math.floor(step / 2)
  }
  // 收尾补一轮步长 1
  jfaPass(1, src, dst)
  ;[src, dst] = [dst, src]

  // 精确化：自适应扩张桶环。桶边长 B，环 r 的桶与本桶切比雪夫距离为 r。
  // 环 r 内任意鸡到本格中心的距离下界 = (r-1)*B（格单位）。
  // 当已找到候选且当前最优距离 <= 下一环下界时，更远环不可能更优，停止。
  const B = 8
  const bucketsX = Math.ceil(g.w / B)
  const bucketsY = Math.ceil(g.h / B)
  const bCount = new Uint32Array(bucketsX * bucketsY)
  const birdBucket = new Int32Array(birds.length)
  birds.forEach((b, bi) => {
    const bc = Math.min(bucketsX - 1, Math.floor(b.x / B))
    const br = Math.min(bucketsY - 1, Math.floor(b.y / B))
    const id = br * bucketsX + bc
    birdBucket[bi] = id
    bCount[id]++
  })
  const bOffset = new Uint32Array(bucketsX * bucketsY)
  for (let i = 1; i < bCount.length; i++) bOffset[i] = bOffset[i - 1] + bCount[i - 1]
  const bBirds = new Uint32Array(birds.length)
  const bCursor = bOffset.slice()
  birds.forEach((_, bi) => (bBirds[bCursor[birdBucket[bi]]++] = bi))

  const owner = new Int32Array(n).fill(-1)
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const i = idx(g, c, r)
      if (g.blocked[i]) continue
      const px = c + 0.5
      const py = r + 0.5
      const homeBx = Math.floor(c / B)
      const homeBy = Math.floor(r / B)
      let best = -1
      let bestD = Infinity
      const maxRing = Math.max(bucketsX, bucketsY)
      for (let ring = 0; ring <= maxRing; ring++) {
        const r0 = Math.max(0, homeBy - ring)
        const r1 = Math.min(bucketsY - 1, homeBy + ring)
        const c0 = Math.max(0, homeBx - ring)
        const c1 = Math.min(bucketsX - 1, homeBx + ring)
        for (let br = r0; br <= r1; br++) {
          for (let bc = c0; bc <= c1; bc++) {
            if (ring > 0 && br > r0 && br < r1 && bc > c0 && bc < c1) continue
            const id = br * bucketsX + bc
            for (let k = 0; k < bCount[id]; k++) {
              const bi = bBirds[bOffset[id] + k]
              const d = (birds[bi].x - px) ** 2 + (birds[bi].y - py) ** 2
              if (d < bestD) {
                bestD = d
                best = bi
              }
            }
          }
        }
        // 下一环鸡到本格的切比雪夫下界（格单位），平方后比较
        const nextLower = ring * B
        if (best >= 0 && bestD <= nextLower * nextLower) break
      }
      owner[i] = best
    }
  }
  return owner
}

// ---- TS 移植版距离场（扫描 + 松弛），单位：格 ----
const SQRT2 = Math.SQRT2
function gpuStyleDistance(g: MiniGrid, sources: number[]): Float32Array {
  const n = g.w * g.h
  const INF = 1e9
  let dist = new Float32Array(n).fill(INF)
  for (const s of sources) if (!g.blocked[s]) dist[s] = 0

  // 四向串行扫描（与 DIST_SWEEP_WGSL 同邻接结构）
  const relax = (i: number, nb: number, stepLen: number) => {
    if (g.blocked[i] || g.blocked[nb]) return
    const cand = dist[nb] + stepLen
    if (cand < dist[i]) dist[i] = cand
  }
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const i = idx(g, c, r)
      if (c > 0) relax(i, idx(g, c - 1, r), 1)
      if (c > 0 && r > 0) relax(i, idx(g, c - 1, r - 1), SQRT2)
      if (c > 0 && r + 1 < g.h) relax(i, idx(g, c - 1, r + 1), SQRT2)
    }
  }
  for (let r = 0; r < g.h; r++) {
    for (let c = g.w - 1; c >= 0; c--) {
      const i = idx(g, c, r)
      if (c + 1 < g.w) relax(i, idx(g, c + 1, r), 1)
      if (c + 1 < g.w && r > 0) relax(i, idx(g, c + 1, r - 1), SQRT2)
      if (c + 1 < g.w && r + 1 < g.h) relax(i, idx(g, c + 1, r + 1), SQRT2)
    }
  }
  for (let c = 0; c < g.w; c++) {
    for (let r = 0; r < g.h; r++) {
      const i = idx(g, c, r)
      if (r > 0) relax(i, idx(g, c, r - 1), 1)
      if (r > 0 && c > 0) relax(i, idx(g, c - 1, r - 1), SQRT2)
      if (r > 0 && c + 1 < g.w) relax(i, idx(g, c + 1, r - 1), SQRT2)
    }
  }
  for (let c = 0; c < g.w; c++) {
    for (let r = g.h - 1; r >= 0; r--) {
      const i = idx(g, c, r)
      if (r + 1 < g.h) relax(i, idx(g, c, r + 1), 1)
      if (r + 1 < g.h && c > 0) relax(i, idx(g, c - 1, r + 1), SQRT2)
      if (r + 1 < g.h && c + 1 < g.w) relax(i, idx(g, c + 1, r + 1), SQRT2)
    }
  }

  // 8 邻域松弛到无变化
  let ndist = new Float32Array(dist)
  for (let iter = 0; iter < 40; iter++) {
    ndist.set(dist)
    let changes = 0
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        const i = idx(g, c, r)
        if (g.blocked[i]) continue
        let best = dist[i]
        for (let sy = -1; sy <= 1; sy++) {
          for (let sx = -1; sx <= 1; sx++) {
            if (!sx && !sy) continue
            const nc = c + sx
            const nr = r + sy
            if (nc < 0 || nc >= g.w || nr < 0 || nr >= g.h) continue
            const ni = idx(g, nc, nr)
            if (g.blocked[ni]) continue
            const stepLen = sx && sy ? SQRT2 : 1
            const cand = dist[ni] + stepLen
            if (cand < best) best = cand
          }
        }
        if (best < dist[i]) {
          ndist[i] = best
          changes++
        }
      }
    }
    dist = ndist
    ndist = new Float32Array(dist)
    if (changes === 0) break
  }
  return dist
}

// ---- CPU Dijkstra 精确绕障距离 ----
function dijkstra(g: MiniGrid, sources: number[]): Float32Array {
  const n = g.w * g.h
  const dist = new Float32Array(n).fill(Infinity)
  const heap: number[] = []
  const heapD = new Float32Array(n).fill(Infinity)
  const push = (i: number, d: number) => {
    heap.push(i)
    heapD[i] = d
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heapD[heap[p]] <= heapD[heap[k]]) break
      ;[heap[k], heap[p]] = [heap[p], heap[k]]
      k = p
    }
  }
  const pop = (): number => {
    const top = heap[0]
    const last = heap.pop() as number
    if (heap.length) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = k * 2 + 1
        const r = l + 1
        let s = k
        if (l < heap.length && heapD[heap[l]] < heapD[heap[s]]) s = l
        if (r < heap.length && heapD[heap[r]] < heapD[heap[s]]) s = r
        if (s === k) break
        ;[heap[k], heap[s]] = [heap[s], heap[k]]
        k = s
      }
    }
    return top
  }
  for (const s of sources) {
    if (g.blocked[s] || dist[s] === 0) continue
    dist[s] = 0
    push(s, 0)
  }
  while (heap.length) {
    const i = pop()
    const c = i % g.w
    const r = (i / g.w) | 0
    for (let sy = -1; sy <= 1; sy++) {
      for (let sx = -1; sx <= 1; sx++) {
        if (!sx && !sy) continue
        const nc = c + sx
        const nr = r + sy
        if (nc < 0 || nc >= g.w || nr < 0 || nr >= g.h) continue
        const ni = idx(g, nc, nr)
        if (g.blocked[ni]) continue
        const stepLen = sx && sy ? SQRT2 : 1
        const nd = dist[i] + stepLen
        if (nd < dist[ni]) {
          dist[ni] = nd
          push(ni, nd)
        }
      }
    }
  }
  return dist
}

function buildGridWithWalls(w: number, h: number, wallRows: { row: number; doorStart: number; doorEnd: number }[]): MiniGrid {
  const blocked = new Uint8Array(w * h)
  for (const wall of wallRows) {
    for (let c = 0; c < w; c++) {
      if (c < wall.doorStart || c > wall.doorEnd) blocked[idx({ w, h, blocked }, c, wall.row)] = 1
    }
  }
  return { w, h, blocked }
}

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++
    console.error(`  失败: ${msg}`)
  } else {
    console.log(`  通过: ${msg}`)
  }
}

// 测试 1：无墙网格 JFA 与精确维诺一致
{
  const rng = mulberry32(42)
  const g: MiniGrid = { w: 40, h: 30, blocked: new Uint8Array(40 * 30) }
  const birds = Array.from({ length: 120 }, () => ({ x: rng() * g.w, y: rng() * g.h }))
  const exact = exactVoronoi(g, birds)
  const got = jfa(g, birds)
  let mismatch = 0
  for (let i = 0; i < g.w * g.h; i++) if (exact[i] !== got[i]) mismatch++
  assert(mismatch === 0, `无墙 JFA 维诺全格一致（不一致 ${mismatch} / ${g.w * g.h}）`)
}

// 测试 2：带门洞隔栏的 JFA（墙格不参与，开放格仍有归属）
{
  const rng = mulberry32(7)
  const g = buildGridWithWalls(36, 48, [
    { row: 16, doorStart: 16, doorEnd: 19 },
    { row: 32, doorStart: 16, doorEnd: 19 },
  ])
  const birds = Array.from({ length: 90 }, () => ({ x: rng() * g.w, y: rng() * g.h })).filter(
    (b) => !g.blocked[idx(g, Math.floor(b.x), Math.floor(b.y))],
  )
  const exact = exactVoronoi(g, birds)
  const got = jfa(g, birds)
  let mismatch = 0
  for (let i = 0; i < g.w * g.h; i++) if (!g.blocked[i] && exact[i] !== got[i]) mismatch++
  assert(mismatch === 0, `带墙 JFA 维诺开放格一致（不一致 ${mismatch}）`)
}

// 测试 3：绕障距离 vs Dijkstra，无墙场景
{
  const g: MiniGrid = { w: 44, h: 28, blocked: new Uint8Array(44 * 28) }
  const sources = [idx(g, 3, 3), idx(g, 40, 24), idx(g, 20, 14)]
  const exact = dijkstra(g, sources)
  const got = gpuStyleDistance(g, sources)
  let maxDiff = 0
  let overOneCell = 0
  for (let i = 0; i < g.w * g.h; i++) {
    const diff = Math.abs(got[i] - exact[i])
    if (diff > maxDiff) maxDiff = diff
    if (diff > 1 + 1e-6) overOneCell++
  }
  assert(overOneCell === 0, `无墙距离场误差不超过 1 格（最大偏差 ${maxDiff.toFixed(3)} 格，超差 ${overOneCell}）`)
}

// 测试 4：两道隔栏单门洞，绕路距离必须绕门洞
{
  const g = buildGridWithWalls(30, 60, [
    { row: 20, doorStart: 14, doorEnd: 15 },
    { row: 40, doorStart: 14, doorEnd: 15 },
  ])
  const sources = [idx(g, 2, 2)]
  const exact = dijkstra(g, sources)
  const got = gpuStyleDistance(g, sources)
  let maxDiff = 0
  let overOneCell = 0
  for (let i = 0; i < g.w * g.h; i++) {
    if (g.blocked[i] || !Number.isFinite(exact[i])) continue
    const diff = Math.abs(got[i] - exact[i])
    if (diff > maxDiff) maxDiff = diff
    if (diff > 1 + 1e-6) overOneCell++
  }
  // 墙远端点：直线穿墙会很短，正确绕路必须明显更长（绕两道门）
  const farCell = idx(g, 27, 58)
  const straightLine = Math.hypot(27 - 2, 58 - 2)
  assert(
    got[farCell] > straightLine + 3,
    `远端点距离确实绕门洞（got=${got[farCell].toFixed(1)} 格，直线=${straightLine.toFixed(1)} 格）`,
  )
  assert(overOneCell === 0, `绕障距离场误差不超过 1 格（最大偏差 ${maxDiff.toFixed(3)} 格，超差 ${overOneCell}）`)
}

// 测试 5：面积守恒——维诺面积总和约等于开放格总面积
{
  const rng = mulberry32(99)
  const g: MiniGrid = { w: 50, h: 40, blocked: new Uint8Array(50 * 40) }
  // 鸡数远少于格数，保证每只都能分到格
  const birds = Array.from({ length: 60 }, () => ({ x: rng() * g.w, y: rng() * g.h }))
  const got = jfa(g, birds)
  const counts = new Uint32Array(birds.length)
  let covered = 0
  for (let i = 0; i < g.w * g.h; i++) {
    if (got[i] >= 0) {
      counts[got[i]]++
      covered++
    }
  }
  const sumArea = counts.reduce((a, b) => a + b, 0)
  assert(sumArea === covered && covered === g.w * g.h, `维诺面积守恒（${sumArea} 格 = 开放 ${covered} 格）`)
  assert(counts.every((c) => c > 0), `每只鸡至少分到 1 格（最小 ${Math.min(...counts)}）`)
}

console.log(failures === 0 ? '\n全部自测通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
