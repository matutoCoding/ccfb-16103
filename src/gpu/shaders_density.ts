// 局部密度：每个非墙格统计 (2r+1)^2 窗口内质量 → kg/m2

export const DENSITY_WGSL = /* wgsl */ `
struct Uniforms {
  gridW: u32,
  gridH: u32,
  radius: u32,
  cellArea: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> mass: array<f32>;
@group(0) @binding(2) var<storage, read_write> density: array<f32>;
@group(0) @binding(3) var<storage, read> blocked: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let n = u.gridW * u.gridH;
  if (idx >= n) { return; }
  if (blocked[idx] == 1u) {
    density[idx] = 0.0;
    return;
  }
  let col = i32(idx % u.gridW);
  let row = i32(idx / u.gridW);
  let r = i32(u.radius);
  var sum = 0.0;
  var cells = 0.0;
  for (var dr = -r; dr <= r; dr++) {
    let nr = row + dr;
    if (nr < 0 || nr >= i32(u.gridH)) { continue; }
    for (var dc = -r; dc <= r; dc++) {
      let nc = col + dc;
      if (nc < 0 || nc >= i32(u.gridW)) { continue; }
      let ni = u32(nr) * u.gridW + u32(nc);
      if (blocked[ni] == 1u) { continue; }
      sum += mass[ni];
      cells += 1.0;
    }
  }
  density[idx] = sum / (cells * u.cellArea);
}
`;
