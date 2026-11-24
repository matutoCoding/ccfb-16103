// 绕障距离场：块内串行有序 chamfer 扫描 + 全网格 8 邻域松弛
// 距离以"格"为单位，CPU 侧乘 cellSize 还原米
// 每个 workgroup 负责一行/一列，workgroup 内按 uniform 循环逐格串行，
// 保证 workgroupBarrier 总在均匀控制流中被所有 lane 执行

export const DIST_SWEEP_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  // 0: 行前向 1: 行后向 2: 列下向 3: 列上向
  direction: u32,
  pad: u32,
};

const D1: f32 = 1.0;
const D2: f32 = 1.41421356237;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> dist: array<f32>;
@group(0) @binding(2) var<storage, read> blocked: array<u32>;
@group(0) @binding(3) var<storage, read_write> changes: array<atomic<u32>>;

fn tryRelax(idx: u32, nb: u32, step: f32) {
  if (blocked[idx] == 1u || blocked[nb] == 1u) { return; }
  let cand = dist[nb] + step;
  if (cand < dist[idx]) {
    dist[idx] = cand;
    atomicAdd(&changes[0], 1u);
  }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let line = gid.x;
  let lane = lid.x;
  // 列扫时 workgroup 数可能小于 workgroup 尺寸，多余 lane 标记空闲，
  // 但仍须走到每个 workgroupBarrier，否则违反屏障均匀控制流要求
  let idle = false;

  if (u.direction < 2u) {
    // 每个 workgroup 一行
    if (line >= u.gridH) { idle = true; }
    let rowBase = line * u.gridW;
    for (var k = 0u; k < u.gridW; k++) {
      if (!idle && lane == k % 64u) {
        let c = select(k, u.gridW - 1u - k, u.direction == 1u);
        let idx = rowBase + c;
        if (blocked[idx] == 0u) {
          if (u.direction == 0u && c > 0u) {
            tryRelax(idx, idx - 1u, D1);
            if (line > 0u) { tryRelax(idx, idx - u.gridW - 1u, D2); }
            if (line + 1u < u.gridH) { tryRelax(idx, idx + u.gridW - 1u, D2); }
          }
          if (u.direction == 1u && c + 1u < u.gridW) {
            tryRelax(idx, idx + 1u, D1);
            if (line > 0u) { tryRelax(idx, idx - u.gridW + 1u, D2); }
            if (line + 1u < u.gridH) { tryRelax(idx, idx + u.gridW + 1u, D2); }
          }
        }
      }
      workgroupBarrier();
    }
  } else {
    // 每个 workgroup 一列
    if (line >= u.gridW) { idle = true; }
    for (var k = 0u; k < u.gridH; k++) {
      if (!idle && lane == k % 64u) {
        let r = select(k, u.gridH - 1u - k, u.direction == 3u);
        let idx = r * u.gridW + line;
        if (blocked[idx] == 0u) {
          if (u.direction == 2u && r > 0u) {
            tryRelax(idx, idx - u.gridW, D1);
            if (line > 0u) { tryRelax(idx, idx - u.gridW - 1u, D2); }
            if (line + 1u < u.gridW) { tryRelax(idx, idx - u.gridW + 1u, D2); }
          }
          if (u.direction == 3u && r + 1u < u.gridH) {
            tryRelax(idx, idx + u.gridW, D1);
            if (line > 0u) { tryRelax(idx, idx + u.gridW - 1u, D2); }
            if (line + 1u < u.gridW) { tryRelax(idx, idx + u.gridW + 1u, D2); }
          }
        }
      }
      workgroupBarrier();
    }
  }
}
`;

// 全网格 8 邻域松弛，配合变化计数决定是否收敛
export const DIST_RELAX_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  pad0: u32,
  pad1: u32,
};

const D1: f32 = 1.0;
const D2: f32 = 1.41421356237;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<storage, read> blocked: array<u32>;
@group(0) @binding(4) var<storage, read_write> changes: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let n = u.gridW * u.gridH;
  if (idx >= n) { return; }
  dst[idx] = src[idx];
  if (blocked[idx] == 1u) { return; }
  let col = i32(idx % u.gridW);
  let row = i32(idx / u.gridW);
  var best = src[idx];
  for (var sy = -1; sy <= 1; sy++) {
    for (var sx = -1; sx <= 1; sx++) {
      if (sx == 0 && sy == 0) { continue; }
      let nc = col + sx;
      let nr = row + sy;
      if (nc < 0 || nc >= i32(u.gridW) || nr < 0 || nr >= i32(u.gridH)) { continue; }
      let ni = u32(nr) * u.gridW + u32(nc);
      if (blocked[ni] == 1u) { continue; }
      let step = select(D2, D1, sx == 0 || sy == 0);
      let cand = src[ni] + step;
      if (cand < best) { best = cand; }
    }
  }
  if (best < src[idx]) {
    dst[idx] = best;
    atomicAdd(&changes[0], 1u);
  }
}
`;
