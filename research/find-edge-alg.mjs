// Shortest sequence taking the U-F white edge to D-F with white facing F, keeping U-R, U-B, U-L edges home.
// Its inverse inserts a bottom edge whose white faces sideways.
import { MOVES, SOLVED_CUBE, applyMove } from "../app/cube.ts";
const byId = (s) => Object.fromEntries(s.map((x) => [x.id, x]));
const home = byId(SOLVED_CUBE);
const same = (a, b) => a.pos.join() === b.pos.join() && a.normal.join() === b.normal.join();
const white = SOLVED_CUBE.find((s) => s.normal[1] === 1 && s.pos.join() === "0,1,1");
const keep = SOLVED_CUBE.filter((s) => ["1,1,0", "0,1,-1", "-1,1,0"].includes(s.pos.join()));
let frontier = [{ s: SOLVED_CUBE, path: [] }];
const found = [];
for (let d = 1; d <= 4 && found.length < 6; d++) {
  const next = [];
  for (const { s, path } of frontier) for (const m of MOVES) {
    if (path.length && path.at(-1)[0] === m[0]) continue;
    const c = applyMove(s, m); const p = [...path, m];
    const b = byId(c);
    if (same(b[white.id], { pos: [0, -1, 1], normal: [0, 0, 1] }) && keep.every((k) => same(b[k.id], home[k.id]))) found.push(p.join(" "));
    next.push({ s: c, path: p });
  }
  frontier = next;
}
console.log(found.slice(0, 6));
