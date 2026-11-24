// 白羽肉鸡（科宝/罗斯型）体重生长曲线，单位 kg，线性插值
const GROWTH_TABLE: { day: number; weight: number }[] = [
  { day: 1, weight: 0.042 },
  { day: 3, weight: 0.075 },
  { day: 7, weight: 0.17 },
  { day: 10, weight: 0.27 },
  { day: 14, weight: 0.45 },
  { day: 18, weight: 0.68 },
  { day: 21, weight: 0.88 },
  { day: 25, weight: 1.18 },
  { day: 28, weight: 1.42 },
  { day: 32, weight: 1.78 },
  { day: 35, weight: 2.05 },
  { day: 38, weight: 2.32 },
  { day: 42, weight: 2.65 },
]

export function weightAtAge(ageDay: number): number {
  if (ageDay <= GROWTH_TABLE[0].day) return GROWTH_TABLE[0].weight
  const last = GROWTH_TABLE[GROWTH_TABLE.length - 1]
  if (ageDay >= last.day) return last.weight
  for (let i = 1; i < GROWTH_TABLE.length; i++) {
    const a = GROWTH_TABLE[i - 1]
    const b = GROWTH_TABLE[i]
    if (ageDay <= b.day) {
      const k = (ageDay - a.day) / (b.day - a.day)
      return a.weight + (b.weight - a.weight) * k
    }
  }
  return last.weight
}

// 体型缩放：体积与体重近似成正比，线性尺寸按立方根缩放
export function bodyScaleAtAge(ageDay: number): number {
  return Math.cbrt(weightAtAge(ageDay) / weightAtAge(28))
}

// 鸡舍参考温度曲线（摄氏），雏鸡期高温逐步降温，叠加昼夜波动
export function targetTempAtAge(ageDay: number, hourOfDay: number): number {
  const base = ageDay < 3 ? 33 : ageDay < 7 ? 31 : ageDay < 14 ? 28 : ageDay < 21 ? 25 : ageDay < 28 ? 23 : 21
  const diurnal = 1.2 * Math.sin(((hourOfDay - 9) / 24) * Math.PI * 2)
  return base + diurnal
}
