import test from "node:test";
import assert from "node:assert/strict";
import { getLevels, createProgram, cloneProgram } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";

const solvedPrograms = [
  { actionOrder: ["charge", "move", "signal"] },
  { energy: 5 },
  { energy: 7 },
  { target: "blue", compare: "==" },
  { compare: ">", threshold: 5 },
  { actionOrder: ["write", "read", "gate", "send"], energy: 5, compare: ">", threshold: 3 },
  { energy: 8, target: "blue", threshold: 4 },
  { energy: 8, compare: ">", threshold: 5 },
];

const solvedStates = [
  {},
  { vars: { energy: 5 } },
  { readValue: 7 },
  { gateBranch: "accept" },
  { gateBranch: "accept" },
  { gateBranch: "accept" },
  { gateBranch: "accept" },
  { gateBranch: "accept" },
];

test("vertical slice exposes eight data-driven levels", () => {
  const levels = getLevels();
  assert.equal(levels.length, 8);
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(levels.every((level) => level.scene && level.code && level.steps && level.check));
});

test("solved program configurations satisfy every level goal", () => {
  getLevels().forEach((level, index) => {
    const program = { ...createProgram(level), ...solvedPrograms[index] };
    const result = level.check(program, solvedStates[index]);
    assert.equal(result.ok, true, `level ${level.id} should accept solved config`);
  });
});

test("default puzzle configurations are not already solved", () => {
  getLevels().forEach((level) => {
    const program = createProgram(level);
    const result = level.check(program, { vars: {}, gateBranch: null, readValue: null });
    assert.equal(result.ok, false, `level ${level.id} should require player input`);
  });
});

test("runtime reaches success with solved first-level flow", async () => {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now() + 20), 0);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
  const level = getLevels()[0];
  const program = cloneProgram(solvedPrograms[0]);
  const result = await new Promise((resolve) => {
    const runtime = new Runtime(level, program, undefined, resolve);
    runtime.steps.forEach((item) => { item.duration = 1; });
    runtime.run();
  });
  assert.equal(result.ok, true);
});
