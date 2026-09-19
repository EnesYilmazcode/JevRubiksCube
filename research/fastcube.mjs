// Fast permutation cube + BFS distance table, derived from app/cube.ts so the move semantics match exactly.
import { FACES, MOVES, SOLVED_CUBE, applyMove, faceGrid, serializeCube } from "../app/cube.ts";

export { MOVES };
export const LETTERS = "WRGYOB"; // color index for faces U R F D L B
const COLOR_IDX = { white: 0, red: 1, green: 2, yellow: 3, orange: 4, blue: 5 };
const FACE_LETTER = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

// slot i = face FACES[i/9], cell i%9 (same order as serializeCube)
const slotOfId = new Map();
FACES.forEach((face, f) => faceGrid(SOLVED_CUBE, face).forEach((s, k) => slotOfId.set(s.id, f * 9 + k)));
export const SLOT_POS = [];
FACES.forEach((face) => faceGrid(SOLVED_CUBE, face).forEach((s) => SLOT_POS.push(s.pos)));

export const PERM = {};
for (const m of MOVES) {
  const moved = applyMove(SOLVED_CUBE, m);
  const perm = [];
  FACES.forEach((face) => faceGrid(moved, face).forEach((s) => perm.push(slotOfId.get(s.id))));
  PERM[m] = Uint8Array.from(perm);
}
export const SOLVED = Uint8Array.from(Array.from({ length: 54 }, (_, i) => Math.floor(i / 9)));
export function move(state, m) { const p = PERM[m]; const out = new Uint8Array(54); for (let i = 0; i < 54; i++) out[i] = state[p[i]]; return out; }
export function moves(state, seq) { return seq.reduce(move, state); }
export const key = (s) => { let r = ""; for (let i = 0; i < 54; i++) r += LETTERS[s[i]]; return r; };
export const fromKey = (k) => Uint8Array.from(k, (c) => LETTERS.indexOf(c));
export const isSolvedKey = (k) => k === key(SOLVED);
export function faces(s) { const k = key(s); return Object.fromEntries(FACES.map((f, i) => [f, k.slice(i * 9, i * 9 + 9)])); }

// cubie slots: group the 54 slots by 3D position
const groups = new Map();
SLOT_POS.forEach((p, i) => { const g = p.join(","); groups.set(g, [...(groups.get(g) ?? []), i]); });
const ORDER = "UDFBRL";
export const CUBIE_SLOTS = [...groups.values()].filter((g) => g.length > 1).map((g) => {
  const sorted = g.slice().sort((a, b) => ORDER.indexOf(FACES[Math.floor(a / 9)]) - ORDER.indexOf(FACES[Math.floor(b / 9)]));
  return { name: sorted.map((i) => FACES[Math.floor(i / 9)]).join(""), slots: sorted };
}).sort((a, b) => b.slots.length - a.slots.length || a.name.localeCompare(b.name));
export function cubies(s) {
  return CUBIE_SLOTS.map(({ name, slots }) => {
    const here = slots.map((i) => LETTERS[s[i]]).join("");
    const home = slots.map((i) => FACE_LETTER[FACES[Math.floor(i / 9)]]).join("");
    return `${name}:${here}/${home}`;
  }).join(" ");
}

// BFS table
export function buildTable(maxDepth = 5) {
  const dist = new Map(); const layers = [[key(SOLVED)]]; dist.set(key(SOLVED), 0);
  for (let d = 1; d <= maxDepth; d++) {
    const layer = [];
    for (const k of layers[d - 1]) { const s = fromKey(k); for (const m of MOVES) { const c = key(move(s, m)); if (!dist.has(c)) { dist.set(c, d); layer.push(c); } } }
    layers.push(layer);
  }
  return { dist, layers };
}

// self-check against app/cube.ts
export function verify() {
  let st = SOLVED_CUBE, fs = SOLVED;
  for (let t = 0; t < 300; t++) {
    const m = MOVES[Math.floor(Math.random() * 18)];
    st = applyMove(st, m); fs = move(fs, m);
    const a = Object.values(serializeCube(st)).join("");
    if (a !== key(fs)) throw new Error(`mismatch after ${t} moves (${m})`);
  }
  return true;
}
