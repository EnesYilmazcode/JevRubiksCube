import { FACE_COLORS, SOLVED_CUBE, applyMoves, faceForNormal, serializeCube, type Move, type Sticker, type Vec3 } from "./cube.ts";

// The beginner's layer-by-layer method, as data. Our cube has white on U and yellow on D, so the
// standard algorithms (written with the last layer on top) are turned over with x2 before use:
// U<->D, F<->B, R and L unchanged. A "view" re-aims an algorithm at another side, like turning the
// cube in your hands. Jev chooses among these steps; the method only supplies the menu.

export type Macro = { id: string; label: string; moves: Move[] };
export type Stage = {
  id: string;
  title: string;
  /** Plain-language goal shown to Jev. */
  goal: string;
  /** Sub-goals in order; each must hold before moving on. */
  checks: ((stickers: Sticker[]) => boolean)[];
  /** Optional instruction for each sub-goal, shown to Jev as the current task. */
  tasks?: string[];
  macros: Macro[];
  /** Stickers that must match the solved cube when the stage is done ('.' elsewhere). */
  pattern: (pos: Vec3, normal: Vec3) => boolean;
  /** Pieces (by home slot) that Jev gets a where-is-it summary for. */
  pieces: (home: Vec3) => boolean;
};

const X2: Record<string, string> = { U: "D", D: "U", F: "B", B: "F", R: "R", L: "L" };
const VIEWS: Record<string, string>[] = [
  { F: "F", R: "R", B: "B", L: "L" },
  { F: "R", R: "B", B: "L", L: "F" },
  { F: "B", R: "L", B: "F", L: "R" },
  { F: "L", R: "F", B: "R", L: "B" },
];

/** Standard notation (last layer on top), seen from `view`, in our cube's frame. */
export function alg(text: string, view = 0): Move[] {
  if (!text.trim()) return [];
  return text.trim().split(/\s+/).map((token) => {
    const face = VIEWS[view][token[0]] ?? token[0];
    return `${X2[face]}${token.slice(1)}` as Move;
  });
}

const repeat = (text: string, times: number) => Array(times).fill(text).join(" ");
const invert = (move: Move): Move => (move.endsWith("2") ? move : move.endsWith("'") ? move[0] as Move : `${move}'` as Move);
const setups = ["", "U", "U2", "U'"];

// ---------- piece bookkeeping (our frame: white layer y=1, yellow layer y=-1) ----------

type Pieces = Map<string, Sticker[]>;
function pieces(stickers: Sticker[]): Pieces {
  const map: Pieces = new Map();
  for (const s of stickers) {
    const key = s.pos.join(",");
    const list = map.get(key);
    if (list) list.push(s); else map.set(key, [s]);
  }
  return map;
}
const home = (s: Sticker) => s.color === FACE_COLORS[faceForNormal(s.normal)];
const SLOTS = [...new Set(SOLVED_CUBE.map((s) => s.pos.join(",")))].map((k) => k.split(",").map(Number) as Vec3);
const zeros = (p: Vec3) => p.filter((v) => v === 0).length;
const EDGE_SLOTS = SLOTS.filter((p) => zeros(p) === 1);
const CORNER_SLOTS = SLOTS.filter((p) => zeros(p) === 0);
const at = (list: Vec3[], y: number) => list.filter((p) => p[1] === y);

function countSolved(stickers: Sticker[], slots: Vec3[]) {
  const map = pieces(stickers);
  return slots.filter((p) => map.get(p.join(","))!.every(home)).length;
}
const whiteEdges = (s: Sticker[]) => countSolved(s, at(EDGE_SLOTS, 1));
const whiteCorners = (s: Sticker[]) => countSolved(s, at(CORNER_SLOTS, 1));
const middleEdges = (s: Sticker[]) => countSolved(s, at(EDGE_SLOTS, 0));
/** White edges not yet placed that sit in the yellow (bottom) layer, ready to be lifted. */
const looseOnYellow = (s: Sticker[]) => {
  const map = pieces(s);
  return at(EDGE_SLOTS, -1).filter((p) => map.get(p.join(","))!.some((st) => st.color === "white")).length;
};
const firstLayer = (s: Sticker[]) => whiteEdges(s) === 4 && whiteCorners(s) === 4;
const firstTwo = (s: Sticker[]) => firstLayer(s) && middleEdges(s) === 4;
const yellowDown = (s: Sticker[], slots: Vec3[]) => {
  const map = pieces(s);
  return slots.filter((p) => map.get(p.join(","))!.some((st) => st.color === "yellow" && st.normal[1] === -1)).length;
};
const yellowEdgesUp = (s: Sticker[]) => yellowDown(s, at(EDGE_SLOTS, -1));
const yellowCornersUp = (s: Sticker[]) => yellowDown(s, at(CORNER_SLOTS, -1));
const yellowEdgesSolved = (s: Sticker[]) => countSolved(s, at(EDGE_SLOTS, -1));
function yellowCornersPlaced(s: Sticker[]) {
  const map = pieces(s);
  return at(CORNER_SLOTS, -1).every((p) => {
    const colors = map.get(p.join(","))!.map((st) => st.color).sort().join();
    const wanted = SOLVED_CUBE.filter((st) => st.pos.join() === p.join()).map((st) => st.color).sort().join();
    return colors === wanted;
  });
}
export const progress = { whiteEdges, whiteCorners, middleEdges, yellowEdgesUp, yellowEdgesSolved, yellowCornersUp, yellowCornersPlaced, firstTwo };
export const isSolvedCube = (s: Sticker[]) => countSolved(s, SLOTS) === SLOTS.length;

// ---------- the menus ----------

/** Our frame, seen from `view` (turning the cube about the white-yellow axis). */
function ours(text: string, view = 0): Move[] {
  return text.trim().split(/\s+/).map((token) => `${VIEWS[view][token[0]] ?? token[0]}${token.slice(1)}` as Move);
}

// White cross menu: lift a bottom edge into the slot above it (a double turn when white faces down,
// D R F' R' when white faces the side), after turning the yellow side to line it up; plus single side
// turns to drop a stray white edge to the bottom.
function crossMenu(): Macro[] {
  const out: Macro[] = [];
  const seen = new Set<string>();
  const add = (label: string, moves: Move[]) => {
    const key = Object.values(serializeCube(applyMoves(SOLVED_CUBE, moves))).join("") + moves.length;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `x${out.length}`, label, moves });
  };
  const sides = ["front", "right", "back", "left"];
  for (const turn of ["D", "D2", "D'"]) add(`turn the yellow side (${turn})`, [turn as Move]);
  for (let view = 0; view < 4; view += 1) {
    for (const t of ["F", "F'", "F2"]) add(`turn the ${sides[view]} (${ours(t, view)[0]})`, ours(t, view));
    add(`drop the ${sides[view]}-right middle edge to the yellow side (${ours("R' D' R", view).join(" ")})`, ours("R' D' R", view));
    add(`drop the ${sides[view]}-left middle edge to the yellow side (${ours("L D L'", view).join(" ")})`, ours("L D L'", view));
    for (const setup of ["", "D", "D2", "D'"]) {
      const pre = setup ? ours(setup) : [];
      add(`${setup ? `turn the yellow side (${setup}), then ` : ""}lift the ${sides[view]} edge with a double turn`, [...pre, ...ours("F2", view)]);
      add(`${setup ? `turn the yellow side (${setup}), then ` : ""}lift the ${sides[view]} edge sideways (D R F' R')`, [...pre, ...ours("D R F' R'", view)]);
    }
  }
  return out;
}

function menu(prefix: string, items: { text: string; label: string; views?: number[]; setups?: string[] }[]): Macro[] {
  const out: Macro[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const view of item.views ?? [0]) for (const setup of item.setups ?? [""]) {
      const moves = [...alg(setup), ...alg(item.text, view)];
      if (!moves.length) continue;
      const key = Object.values(serializeCube(applyMoves(SOLVED_CUBE, moves))).join("") + moves.length;
      if (seen.has(key)) continue;
      seen.add(key);
      const side = ["front", "right", "back", "left"][view];
      const turn = setup ? `turn the yellow side ${setup === "U2" ? "twice" : setup === "U" ? "once" : "back once"}, then ` : "";
      out.push({ id: `${prefix}${out.length}`, label: `${turn}${item.label}${item.views ? ` on the ${side}` : ""}`, moves });
    }
  }
  return out;
}

const ALL_VIEWS = [0, 1, 2, 3];
const U_TURNS = [{ text: "U", label: "turn the yellow side once" }, { text: "U2", label: "turn the yellow side twice" }, { text: "U'", label: "turn the yellow side back once" }];

const pat = {
  whiteEdges: (p: Vec3) => p[1] === 1 && zeros(p) === 1,
  whiteLayer: (p: Vec3) => p[1] === 1,
  firstTwo: (p: Vec3) => p[1] >= 0,
};
const centers = (p: Vec3) => zeros(p) === 2;

export const STAGES: Stage[] = [
  {
    id: "cross", title: "White cross",
    goal: "Build the white cross: each white edge sits next to the white center with its other color matching the center beside it. Keep white edges already placed. A white edge on the yellow side can be lifted into place in one step once the yellow side is turned to line it up; a white edge in the middle layer, or on the white side in the wrong slot or flipped, first has to be turned down to the yellow side.",
    // Two checkpoints per edge, each one step: drop a loose white edge to the yellow side, then lift it.
    checks: [1, 2, 3, 4].flatMap((k) => [
      (s: Sticker[]) => whiteEdges(s) >= k - 1 && whiteEdges(s) + looseOnYellow(s) >= k,
      (s: Sticker[]) => whiteEdges(s) >= k,
    ]),
    tasks: [1, 2, 3, 4].flatMap(() => [
      "Get one loose white edge (one not yet in its place) down onto the yellow side, without moving white edges that are already placed.",
      "Lift a white edge from the yellow side into its place on the white side: turn the yellow side until the edge sits under the center it belongs next to, then lift it. Keep placed white edges where they are.",
    ]),
    macros: crossMenu(),
    pattern: (p) => centers(p) || pat.whiteEdges(p),
    pieces: (h) => h[1] === 1 && zeros(h) === 1,
  },
  {
    id: "corners", title: "White corners",
    goal: "Finish the white layer: put the white corners in place without breaking the white cross. A white corner on the yellow side goes in by lining it up under its slot and repeating R U R' U'; a white corner stuck in the wrong white-side slot, or twisted in its own slot, first has to be popped out with one R U R' U' there.",
    checks: [1, 2, 3, 4].map((k) => (s: Sticker[]) => whiteEdges(s) === 4 && whiteCorners(s) >= k),
    macros: menu("c", [
      ...U_TURNS,
      { text: "R U R' U'", label: "R U R' U' once", views: ALL_VIEWS, setups },
      { text: repeat("R U R' U'", 3), label: "R U R' U' three times", views: ALL_VIEWS, setups },
      { text: repeat("R U R' U'", 5), label: "R U R' U' five times", views: ALL_VIEWS, setups },
    ]),
    pattern: (p) => centers(p) || pat.whiteLayer(p),
    pieces: (h) => h[1] === 1,
  },
  {
    id: "middle", title: "Middle layer",
    goal: "Fill the middle layer: slot each middle edge between its two matching centers, keeping the white layer whole. An edge on the yellow side without yellow on it goes in with an insert once its side color lines up with a center; an edge stuck in the wrong middle slot, or flipped, first has to be popped out with any insert at that slot.",
    checks: [1, 2, 3, 4].map((k) => (s: Sticker[]) => firstLayer(s) && middleEdges(s) >= k),
    macros: menu("m", [
      ...U_TURNS,
      { text: "U R U' R' U' F' U F", label: "insert right", views: ALL_VIEWS, setups },
      { text: "U' L' U L U F U' F'", label: "insert left", views: ALL_VIEWS, setups },
    ]),
    pattern: (p) => centers(p) || pat.firstTwo(p),
    pieces: (h) => h[1] === 0 && zeros(h) === 1,
  },
  {
    id: "yellow-cross", title: "Yellow cross",
    goal: "Make a yellow cross on the yellow face (edge colors on the sides do not matter yet), keeping the first two layers whole.",
    checks: [(s) => firstTwo(s) && yellowEdgesUp(s) === 4],
    macros: menu("y", [
      { text: "F R U R' U' F'", label: "F R U R' U' F'", setups },
      { text: "F U R U' R' F'", label: "F U R U' R' F'", setups },
    ]),
    pattern: (p, n) => centers(p) || pat.firstTwo(p) || (p[1] === -1 && zeros(p) === 1 && n[1] === -1),
    pieces: (h) => h[1] === -1 && zeros(h) === 1,
  },
  {
    id: "yellow-edges", title: "Yellow edges",
    goal: "Line up the yellow edges so each side color matches its center, keeping the first two layers whole.",
    checks: [(s) => firstTwo(s) && yellowEdgesSolved(s) === 4],
    macros: menu("e", [...U_TURNS, { text: "R U R' U R U2 R' U", label: "swap edges (R U R' U R U2 R' U)", views: ALL_VIEWS, setups }]),
    pattern: (p) => centers(p) || pat.firstTwo(p) || (p[1] === -1 && zeros(p) === 1),
    pieces: (h) => h[1] === -1 && zeros(h) === 1,
  },
  {
    id: "yellow-corners", title: "Place yellow corners",
    goal: "Move each yellow corner to the spot between the three centers whose colors it carries (it may still be twisted), keeping everything else whole.",
    checks: [(s) => firstTwo(s) && yellowEdgesSolved(s) === 4 && yellowCornersPlaced(s)],
    macros: menu("p", [
      { text: "U R U' L' U R' U' L", label: "cycle corners", views: ALL_VIEWS },
      { text: repeat("U R U' L' U R' U' L", 2), label: "cycle corners twice", views: ALL_VIEWS },
    ]),
    pattern: (p) => centers(p) || pat.firstTwo(p) || (p[1] === -1 && zeros(p) === 1),
    pieces: (h) => h[1] === -1 && zeros(h) === 0,
  },
  {
    id: "twist", title: "Twist yellow corners",
    goal: "Twist the yellow corners until the whole yellow face is yellow. The twist move scrambles the lower layers for a while; they come back once every corner is done. Finish with the cube solved.",
    checks: [
      ...[1, 2, 3, 4].map((k) => (s: Sticker[]) => yellowCornersUp(s) >= k),
      isSolvedCube,
    ],
    macros: menu("t", [
      ...U_TURNS,
      { text: repeat("R' D' R D", 2), label: "twist the corner (R' D' R D twice)" },
      { text: repeat("R' D' R D", 4), label: "twist the corner the other way (R' D' R D four times)" },
    ]),
    pattern: () => true,
    pieces: (h) => h[1] === -1 && zeros(h) === 0,
  },
];

export const stageById = (id: string) => STAGES.find((s) => s.id === id);
export const macroById = (stage: Stage, id: string) => stage.macros.find((m) => m.id === id);

/** Face strings with '.' where the stage does not care yet. */
export function stagePattern(stage: Stage): Record<string, string> {
  const masked = SOLVED_CUBE.map((s) => ({ ...s, keep: stage.pattern(s.pos, s.normal) }));
  const faces = serializeCube(SOLVED_CUBE);
  const out: Record<string, string> = {};
  for (const face of Object.keys(faces)) {
    const letters = faces[face as keyof typeof faces].split("");
    // serializeCube lists stickers row by row; rebuild the mask in the same order
    const grid = masked.filter((s) => faceForNormal(s.normal) === face);
    const byCell = new Map(grid.map((s) => [cellKey(s), s.keep]));
    out[face] = letters.map((ch, i) => (byCell.get(`${Math.floor(i / 3)},${i % 3}`) ? ch : ".")).join("");
  }
  return out;
}
function cellKey(s: Sticker) {
  const [x, y, z] = s.pos;
  switch (faceForNormal(s.normal)) {
    case "F": return `${1 - y},${x + 1}`;
    case "B": return `${1 - y},${1 - x}`;
    case "R": return `${1 - y},${1 - z}`;
    case "L": return `${1 - y},${z + 1}`;
    case "U": return `${z + 1},${x + 1}`;
    case "D": return `${1 - z},${x + 1}`;
  }
}

const slotName = (p: Vec3) => (p[1] ? (p[1] > 0 ? "U" : "D") : "") + (p[2] ? (p[2] > 0 ? "F" : "B") : "") + (p[0] ? (p[0] > 0 ? "R" : "L") : "");
const homeOf = new Map<string, Vec3>(SOLVED_CUBE.map((s) => [s.id, s.pos]));

/** Where each of the stage's pieces sits, e.g. "white-green edge at DF, white facing F". */
export function pieceSummary(stickers: Sticker[], stage: Stage): string {
  const map = pieces(stickers);
  const lines: string[] = [];
  for (const [key, list] of map) {
    if (list.length < 2) continue;
    const home = homeOf.get(list[0].id)!;
    if (!stage.pieces(home)) continue;
    const order = ["white", "yellow", "green", "blue", "red", "orange"];
    const sorted = [...list].sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color));
    const lead = sorted[0];
    const name = `${sorted.map((x) => x.color).join("-")} ${list.length === 2 ? "edge" : "corner"}`;
    lines.push(`${name} at ${slotName(key.split(",").map(Number) as Vec3)}, ${lead.color} facing ${faceForNormal(lead.normal)} (belongs at ${slotName(home)})`);
  }
  return lines.sort().join("; ");
}

export const inverseMoves = (moves: Move[]) => [...moves].reverse().map(invert);
