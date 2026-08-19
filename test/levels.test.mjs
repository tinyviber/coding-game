import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, createProgram, getLevels } from "../src/levels.js";

const levels = getLevels();

test("8 个关卡沿着同一条 Flow / Memory / Choice 故事线提供 typed program", () => {
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(levels[0].zone, /零号车站/);
  assert.match(levels.at(-1).zone, /中央中继/);
  for (const level of levels) {
    assert.ok(level.scene && level.code && level.steps && level.check);
    assert.ok(level.goal && level.help && level.hintSteps?.length >= 3);
    assert.ok(level.starterProgram && level.solution);
  }
});

test("starter 与 solution 都是独立的 typed instruction program", () => {
  for (const level of levels) {
    const starter = createProgram(level);
    const solution = cloneProgram(level.solution);
    assert.notDeepEqual(starter, solution, `level ${level.id} starter must need player input`);
    assert.ok(starter.instructions.every((item) => typeof item.id === "string" && item.type));
    assert.ok(solution.instructions.every((item) => typeof item.id === "string" && item.type));
  }
});

test("code steps stay mapped to visible source lines", () => {
  for (const level of levels) {
    const program = cloneProgram(level.solution);
    const lineCount = level.code(program).length;
    for (const step of level.steps(program)) assert.ok(step.line >= 1 && step.line <= lineCount);
  }
});

test("editable slot references use stable instruction IDs", () => {
  for (const level of levels) {
    for (const slot of level.editableSlots) {
      if (slot.path) assert.ok(slot.instructionId, `level ${level.id} slot ${slot.id} needs instructionId`);
    }
  }
});
