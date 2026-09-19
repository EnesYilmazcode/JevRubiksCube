// Search ring-layout options for one where every belt slides like a conveyor (all 12 stickers shift the same slot count).
import { MOVES, SOLVED_CUBE, applyMove, moveGeometry } from "../app/cube.ts";
import { buildRingLayout, locKey } from "../app/ringView.ts";

const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const signs = [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]];
const results = [];
for (const corners of perms) for (const radiusSign of signs) for (const innerSign of signs) {
  const L = buildRingLayout({ corners, radiusSign, innerSign });
  let bad = 0, faceBad = 0;
  for (const move of MOVES.filter((m) => m.length === 1)) {
    const { axis, layer } = moveGeometry(move);
    const c = L.centers[axis];
    const after = applyMove(SOLVED_CUBE, move);
    const beltIdx = SOLVED_CUBE.map((s, i) => i).filter((i) => SOLVED_CUBE[i].pos[axis] === layer && SOLVED_CUBE[i].normal[axis] === 0);
    const ang = (p) => Math.atan2(p.y - c.y, p.x - c.x);
    const order = beltIdx.map((i) => ({ key: locKey(SOLVED_CUBE[i].pos, SOLVED_CUBE[i].normal), a: ang(L.slot.get(locKey(SOLVED_CUBE[i].pos, SOLVED_CUBE[i].normal))) }))
      .sort((x, y) => x.a - y.a).map((o) => o.key);
    const shifts = new Set(beltIdx.map((i) => (order.indexOf(locKey(after[i].pos, after[i].normal)) - order.indexOf(locKey(SOLVED_CUBE[i].pos, SOLVED_CUBE[i].normal)) + 12) % 12));
    if (shifts.size !== 1) bad += 1;
  }
  // minimum spacing between any two sticker slots
  const pts = [...L.slot.values()];
  let minD = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  results.push({ corners: corners.join(""), radiusSign: radiusSign.join(","), innerSign: innerSign.join(","), bad, minD: +minD.toFixed(3) });
}
const good = results.filter((r) => r.bad === 0);
console.log("total", results.length, "conveyor-consistent", good.length);
console.log(good.sort((a, b) => b.minD - a.minD).slice(0, 12));
console.log("default", results.find((r) => r.corners === "120" && r.radiusSign === "1,1,1" && r.innerSign === "1,1,1"));
