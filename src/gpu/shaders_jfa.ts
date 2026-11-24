// WGSL 计算着色器源码
// JFA 乒乓缓冲：每个网格格心存 (siteX, siteY, birdId, valid)
// siteX/siteY 存鸡的连续位置（格单位浮点），距离对当前格心计算，边界归属才精确

export const JFA_STEP_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  offX: u32,
  offY: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> src: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> blocked: array<u32>;

fn better(cand: vec4<f32>, cur: vec4<f32>, px: f32, py: f32) -> vec4<f32> {
  if (cand.w < 0.5) { return cur; }
  if (cur.w < 0.5) { return cand; }
  let dc = (cand.x - px) * (cand.x - px) + (cand.y - py) * (cand.y - py);
  let dp = (cur.x - px) * (cur.x - px) + (cur.y - py) * (cur.y - py);
  if (dc < dp) { return cand; }
  return cur;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let n = u.gridW * u.gridH;
  if (idx >= n) { return; }
  if (blocked[idx] == 1u) {
    dst[idx] = vec4<f32>(0.0, 0.0, -1.0, 0.0);
    return;
  }
  // 格心的连续格坐标
  let colC = f32(idx % u.gridW);
  let rowC = f32(idx / u.gridW);
  let px = colC + 0.5;
  let py = rowC + 0.5;
  var best = src[idx];
  let ox = i32(u.offX);
  let oy = i32(u.offY);
  for (var sy = -1; sy <= 1; sy++) {
    for (var sx = -1; sx <= 1; sx++) {
      let nc = i32(colC) + sx * ox;
      let nr = i32(rowC) + sy * oy;
      if (nc >= 0 && nc < i32(u.gridW) && nr >= 0 && nr < i32(u.gridH)) {
        let ni = u32(nr) * u.gridW + u32(nc);
        if (blocked[ni] == 0u) {
          best = better(src[ni], best, px, py);
        }
      }
    }
  }
  dst[idx] = best;
}
`;

// 精确化：自适应扩张桶环。桶边长 B，环 r 与本桶切比雪夫距离为 r，
// 环 r 内鸡到格心距离下界为 (r-1)*B 格。已找到候选且最优距离不超过
// 下一环下界时停止，保证与全枚举精确维诺一致，又把每格扫描量压到局部。
export const JFA_REFINE_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  birdCount: u32,
  bucketSize: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> birdPos: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> bucketOffset: array<u32>;
@group(0) @binding(3) var<storage, read> bucketCount: array<u32>;
@group(0) @binding(4) var<storage, read> bucketBirds: array<u32>;
@group(0) @binding(5) var<storage, read_write> ownerOut: array<i32>;
@group(0) @binding(6) var<storage, read> blocked: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let n = u.gridW * u.gridH;
  if (idx >= n) { return; }
  ownerOut[idx] = -1;
  if (blocked[idx] == 1u) { return; }
  let colC = i32(idx % u.gridW);
  let rowC = i32(idx / u.gridW);
  let px = f32(colC) + 0.5;
  let py = f32(rowC) + 0.5;
  let bucketsX = (u.gridW + u.bucketSize - 1u) / u.bucketSize;
  let bucketsY = (u.gridH + u.bucketSize - 1u) / u.bucketSize;
  let homeBx = colC / i32(u.bucketSize);
  let homeBy = rowC / i32(u.bucketSize);
  var bestBird = -1;
  var bestD = 3.402823e+38;
  let maxRing = max(bucketsX, bucketsY);
  for (var ring = 0u; ring <= maxRing; ring++) {
    let r0 = max(0, homeBy - i32(ring));
    let r1 = min(i32(bucketsY) - 1, homeBy + i32(ring));
    let c0 = max(0, homeBx - i32(ring));
    let c1 = min(i32(bucketsX) - 1, homeBx + i32(ring));
    for (var br = r0; br <= r1; br++) {
      for (var bc = c0; bc <= c1; bc++) {
        // 内环桶已在历史环扫过，只处理当前环外壳
        if (ring > 0u && br > r0 && br < r1 && bc > c0 && bc < c1) { continue; }
        let bIdx = u32(br) * bucketsX + u32(bc);
        let start = bucketOffset[bIdx];
        let cnt = bucketCount[bIdx];
        for (var k = 0u; k < cnt; k++) {
          let bird = bucketBirds[start + k];
          let p = birdPos[bird];
          let d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
          if (d < bestD) {
            bestD = d;
            bestBird = i32(bird);
          }
        }
      }
    }
    // 下一环切比雪夫下界（格单位），平方后与当前最优比较
    let nextLower = f32(ring) * f32(u.bucketSize);
    if (bestBird >= 0 && bestD <= nextLower * nextLower) { break; }
  }
  ownerOut[idx] = bestBird;
}
`;

export const AREA_STATS_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  birdCount: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> ownerIn: array<i32>;
@group(0) @binding(2) var<storage, read> blocked: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCounts: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let n = u.gridW * u.gridH;
  if (idx >= n) { return; }
  if (blocked[idx] == 1u) { return; }
  let bird = ownerIn[idx];
  if (bird < 0 || u32(bird) >= u.birdCount) { return; }
  atomicAdd(&cellCounts[u32(bird)], 1u);
}
`;
