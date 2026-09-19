import assert from "node:assert/strict";
import test from "node:test";
import { MOVES, SOLVED_CUBE, applyMove, applyMoves, isSolved, moveGeometry, serializeCube } from "../app/cube.ts";
import { buildRingLayout, beltTravel, locKey } from "../app/ringView.ts";
import { demoScramble, solveWithJev, solveWithMethod } from "../app/solver.ts";
import { STAGES, alg, pieceSummary, progress } from "../app/method.ts";
import { stepRequest } from "../app/prompts.ts";

const solvedFaces = serializeCube(SOLVED_CUBE);

test("every move returns to solved after four applications", () => {
  for (const move of MOVES) {
    let state = SOLVED_CUBE;
    for (let turn = 0; turn < 4; turn += 1) state = applyMove(state, move);
    assert.deepEqual(serializeCube(state), solvedFaces, move);
  }
});

test("a sequence followed by its inverse returns to solved", () => {
  const prime = String.fromCharCode(39);
  const sequence = ["R", "U", `F${prime}`, "L2", "D"];
  const inverse = [`D${prime}`, "L2", "F", `U${prime}`, `R${prime}`];
  assert.equal(isSolved(applyMoves(applyMoves(SOLVED_CUBE, sequence), inverse)), true);
});

test("the animation angle of each move lands on the same state as applyMove", () => {
  const rotate = ([x, y, z], axis, a) => {
    const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    if (axis === 0) return [x, y * c - z * s, y * s + z * c];
    if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  };
  const start = applyMoves(SOLVED_CUBE, ["R", "U'", "F2", "L"]);
  for (const move of MOVES) {
    const { axis, layer, angle } = moveGeometry(move);
    const expected = applyMove(start, move);
    start.forEach((sticker, i) => {
      if (sticker.pos[axis] !== layer) return;
      assert.deepEqual(rotate(sticker.pos, axis, angle).map((v) => v + 0), expected[i].pos.map((v) => v + 0), move);
    });
  }
});

test("ring graph gives every sticker its own spot and slides each belt as one piece", () => {
  const layout = buildRingLayout();
  const keys = new Set(SOLVED_CUBE.map((s) => locKey(s.pos, s.normal)));
  assert.equal(keys.size, 54);
  const points = [...layout.slot.values()];
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
    assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) > 0.13);
  }
  for (const move of MOVES) {
    const travel = beltTravel(layout, SOLVED_CUBE, move);
    assert.equal(travel.length, 12, move);
    assert.equal(new Set(travel.map((t) => Math.sign(t.travel))).size, 1, `${move} belt moves one way`);
  }
});

test("demo scrambles never turn the same axis twice in a row", () => {
  const axis = (m) => "UDRLFB".indexOf(m[0]) >> 1;
  for (let i = 0; i < 200; i += 1) {
    const s = demoScramble(6);
    for (let k = 1; k < s.length; k += 1) assert.notEqual(axis(s[k]), axis(s[k - 1]));
  }
});

test("search follows the ranking, never revisits a position, and stops on solved", async () => {
  // Oracle ranking that prefers undoing the scramble; stands in for Jev.
  const scramble = ["R", "U'", "F2"];
  const inverse = ["F2", "U", "R'"];
  const start = applyMoves(SOLVED_CUBE, scramble);
  const seen = new Set();
  const ask = async (stickers, moves) => {
    const key = Object.values(serializeCube(stickers)).join("");
    assert.ok(!seen.has(key), "position asked about twice");
    seen.add(key);
    const depth = [0, 1, 2].find((d) => Object.values(serializeCube(applyMoves(start, inverse.slice(0, d)))).join("") === key);
    const want = depth === undefined ? null : inverse[depth];
    return { probabilities: Object.fromEntries(moves.map((m) => [m, m === want ? 0.9 : 0.1 / moves.length])), tokens: 10 };
  };
  const result = await solveWithJev(start, ask, { width: 3, maxDepth: 6 });
  assert.deepEqual(result.path?.map((s) => s.move), inverse);
  assert.ok(isSolved(applyMoves(start, result.path.map((s) => s.move))));
});

test("method menus fit Jev's 255-option limit and the algorithms keep finished layers", () => {
  for (const stage of STAGES) assert.ok(stage.macros.length >= 2 && stage.macros.length <= 255, stage.id);
  const rep = (t, n) => Array(n).fill(t).join(" ");
  for (const [text, keep] of [
    ["F R U R' U' F'", progress.firstTwo], ["R U R' U R U2 R' U", progress.firstTwo], ["U R U' L' U R' U' L", progress.firstTwo],
    ["U R U' R' U' F' U F", (s) => progress.whiteEdges(s) === 4 && progress.whiteCorners(s) === 4],
  ]) {
    for (const view of [0, 1, 2, 3]) assert.ok(keep(applyMoves(SOLVED_CUBE, alg(text, view))), `${text} view ${view}`);
  }
  assert.equal(isSolved(applyMoves(SOLVED_CUBE, alg(rep("R' D' R D", 6)))), true);
  assert.equal(isSolved(applyMoves(SOLVED_CUBE, alg(rep("R U R' U'", 6)))), true);
});

test("with a perfect picker, the method solves real scrambles through every stage", async () => {
  // Oracle stands in for Jev: it scores each option by the stage's own check, so this tests the menus and
  // the search plumbing, not Jev.
  for (let i = 0; i < 3; i += 1) {
    let x = 1234 + i;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const start = applyMoves(SOLVED_CUBE, demoScramble(20, rand));
    const ask = async (stickers, stage, macros) => {
      const k = stage.checks.findIndex((c) => !c(stickers));
      const score = (m) => (k >= 0 && stage.checks[k](applyMoves(stickers, m.moves)) ? 1 : 0.01 + Math.random() * 0.01);
      return { probabilities: Object.fromEntries(macros.map((m) => [m.id, score(m)])), tokens: 0 };
    };
    const result = await solveWithMethod(start, ask, { width: 6, maxDepth: 4 });
    assert.equal(result.solved, true, `scramble ${i} stuck at ${result.failedStage}`);
    assert.ok(isSolved(applyMoves(start, result.steps.flatMap((s) => s.macro.moves))));
  }
});

test("Jev's method prompt carries pieces, pattern, and one criterion per option, with no solver output", () => {
  const start = applyMoves(SOLVED_CUBE, ["R", "U", "F"]);
  const stage = STAGES[0];
  const req = stepRequest(start, stage, stage.macros);
  assert.equal(Object.keys(req.questions.step.criteria).length, stage.macros.length);
  assert.equal(req.state.current_pieces, pieceSummary(start, stage));
  assert.doesNotMatch(JSON.stringify(req), /distance|moves from solved|solved: true/i);
});

test("server renders the experiment shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Jev vs\. the Cube/);
  assert.match(html, /beginner&#x27;s method|beginner's method/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
