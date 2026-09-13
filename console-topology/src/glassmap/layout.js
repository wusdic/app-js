// 动态布局：区域个数与每个区域的业务个数都来自数据
//   每个区域按业务数决定网格列数（≈√n）与平台尺寸；区域按行排列、行内居中、首个区域放在最前一行中央；
//   视角为正向（行沿深度方向依次后退），不做斜向旋转
export const CELL = 1.2, PAD = 0.62, GAP = 0.95, TITLE = 0.36;

function centerOut(list) {
  const out = new Array(list.length); const m = Math.floor((list.length - 1) / 2);
  list.forEach((item, i) => { const step = Math.ceil(i / 2), sign = i % 2 === 1 ? 1 : -1; out[i === 0 ? m : m + sign * step] = item; });
  return out;
}

export function layoutZones(zones) {
  const tiles = zones.map((z) => {
    const n = Math.max(1, z.businesses.length);
    const bc = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(n)))), br = Math.max(1, Math.ceil(n / bc));
    return { zone: z, n, bc, br, w: bc * CELL + 2 * PAD, d: br * CELL + 2 * PAD + TITLE };
  });
  const N = tiles.length, cols = Math.max(1, Math.round(Math.sqrt(N * 1.4)));
  const rows = []; for (let i = 0; i < N; i += cols) rows.push(tiles.slice(i, i + cols));
  const rowDepths = rows.map((r) => Math.max(...r.map((t) => t.d)));
  const totalD = rowDepths.reduce((s, d) => s + d, 0) + GAP * (rows.length - 1);
  let zFront = totalD / 2; const placed = []; let maxW = 0;
  rows.forEach((row, ri) => {
    const depth = rowDepths[ri];
    const order = centerOut(row);
    const totalW = order.reduce((s, t) => s + t.w, 0) + GAP * (order.length - 1); maxW = Math.max(maxW, totalW);
    let x = -totalW / 2;
    for (const t of order) { t.x = x + t.w / 2; t.z = zFront - depth / 2; t.d = depth; x += t.w + GAP; placed.push(t); }
    zFront -= depth + GAP;
  });
  for (const t of placed) {
    t.blocks = new Map();
    const zc = t.z + TITLE / 2; // 标题条占平台后沿，方块网格在其余区域居中
    t.zone.businesses.forEach((id, i) => {
      const c = i % t.bc, r = Math.floor(i / t.bc);
      t.blocks.set(id, { x: t.x - (t.bc - 1) * CELL / 2 + c * CELL, z: zc - (t.br - 1) * CELL / 2 + r * CELL, col: c, row: r });
    });
  }
  return { tiles, width: maxW, depth: totalD };
}
