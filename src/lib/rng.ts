// 确定性 PRNG，保证同一帧任意时刻复现同一只鸡的位置
export function hashU32(a: number): number {
  a = (a + 0x6d2b79f5) | 0
  a = Math.imul(a ^ (a >>> 15), a | 1)
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61)
  return (a ^ (a >>> 14)) >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 为 (帧, 鸡) 组合生成独立种子
export function frameBirdSeed(baseSeed: number, frameIndex: number, birdId: number): number {
  return hashU32(hashU32(baseSeed ^ hashU32(frameIndex)) ^ hashU32(birdId * 2654435761))
}

export function frameSeed(baseSeed: number, frameIndex: number): number {
  return hashU32(baseSeed ^ hashU32(frameIndex * 40503))
}

// 平滑随机游走：多个正弦叠加，无需跨帧状态
export function wander1(rand01: number, t: number, frequency: number): number {
  const phase = rand01 * Math.PI * 2
  const phase2 = rand01 * Math.PI * 4
  return (
    0.5 * Math.sin(t * frequency + phase) +
    0.32 * Math.sin(t * frequency * 2.37 + phase2) +
    0.18 * Math.sin(t * frequency * 5.1 + phase * 1.7)
  )
}
