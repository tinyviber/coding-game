import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, createProgram, getLevels } from "../src/levels.js";

const levels = getLevels();

const solvedProgram = (level) => {
  const program = createProgram(level);
  if (level.id === 1) program.actionOrder = ["charge", "move", "signal"];
  if (level.id === 2) program.energy = 5;
  if (level.id === 3) program.energy = 7;
  if (level.id === 4) { program.target = "blue"; program.compare = "=="; }
  if (level.id === 5) { program.compare = ">"; program.threshold = 6; }
  if (level.id === 6) {
    program.actionOrder = ["write", "read", "gate", "send"];
    program.energy = 5;
    program.compare = ">";
    program.threshold = 3;
  }
  if (level.id === 7) { program.energy = 8; program.threshold = 6; program.target = "blue"; }
  if (level.id === 8) { program.energy = 8; program.compare = ">"; program.threshold = 5; }
  return program;
};

const stateFor = (level, success) => {
  if (level.id === 1) return {};
  if (level.id === 2) return { vars: { energy: success ? 5 : 2 } };
  if (level.id === 3) return { readValue: success ? 7 : 4 };
  return { gateBranch: success ? "accept" : "reject" };
};

test("real app exposes eight short levels across the story route", () => {
  assert.equal(levels.length, 8);
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(levels[0].zone, "STATION ZERO");
  assert.equal(levels.at(-1).zone, "CENTRAL RELAY");
  for (const level of levels) {
    assert.ok(level.story);
    assert.ok(level.goal);
    assert.ok(level.help);
    assert.ok(level.code(createProgram(level)).length >= 3);
  }
});

test("each level has a solvable configuration and default failure signal", () => {
  for (const level of levels) {
    const solved = solvedProgram(level);
    assert.equal(level.check(solved, stateFor(level, true)).ok, true, `level ${level.id} should solve`);
    assert.equal(level.check(createProgram(level), stateFor(level, false)).ok, false, `level ${level.id} should fail by default`);
  }
});

test("code steps stay mapped to visible code lines", () => {
  for (const level of levels) {
    const program = solvedProgram(level);
    const lineCount = level.code(program).length;
    for (const step of level.steps(program)) {
      assert.ok(step.line >= 1 && step.line <= lineCount, `level ${level.id} line ${step.line}`);
    }
  }
});

test("selected values appear in generated snippets", () => {
  const fork = levels[4];
  const code = fork.code(solvedProgram(fork)).flatMap((line) => line.parts ?? [{ text: line.text }]);
  const renderedParts = code.map((part) => part.text ?? part.value ?? "").join(" ");
  assert.match(renderedParts, />/);
  assert.match(renderedParts, /6/);
});

test("program cloning does not mutate level defaults", () => {
  const level = levels[5];
  const original = createProgram(level);
  const copy = cloneProgram(original);
  copy.actionOrder.reverse();
  assert.notDeepEqual(copy.actionOrder, original.actionOrder);
  assert.deepEqual(createProgram(level).actionOrder, ["write", "gate", "read", "send"]);
});

