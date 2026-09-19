import assert from "node:assert/strict";
import test from "node:test";
import { MOVES, SOLVED_CUBE, applyMove, applyMoves, isSolved, serializeCube } from "../app/cube.ts";

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
  assert.match(html, /model that only chooses solve a cube/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
