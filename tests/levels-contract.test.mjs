import test from "node:test";
import assert from "node:assert/strict";
import { createProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import {
  INSTRUCTION_TYPES,
  VALUE_EXPR_TYPES,
  assertProgramShape,
  collectValueExprTypes,
  instructionsOf,
  opOf,
  slotKind,
} from "./helpers/canonical-contract.mjs";

const levels = getLevels();

function starterOf(level) {
  return level.starterProgram ?? createProgram(level);
}

function solutionOf(level) {
  return typeof level.solution === "function" ? level.solution(starterOf(level)) : level.solution;
}

function updateInstruction(program) {
  return instructionsOf(program).find((instruction) => opOf(instruction) === "update");
}

function valueExprOf(instruction) {
  return instruction?.valueExpr ?? instruction?.value ?? instruction?.expr ?? instruction?.amount ?? instruction?.delta;
}

function exprType(expr) {
  if (typeof expr === "number") return "literal";
  return expr?.type ?? expr?.kind;
}

function branchOperator(instruction) {
  return instruction?.operator
    ?? instruction?.compare
    ?? instruction?.condition?.operator
    ?? instruction?.condition?.compare
    ?? instruction?.condition?.op;
}

test("canonical content exposes eight data-driven levels", () => {
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const level of levels) {
    assert.ok(level.zone, `level ${level.id} needs zone`);
    assert.ok(level.title, `level ${level.id} needs title`);
    assert.ok(level.story, `level ${level.id} needs story`);
    assert.ok(level.goal, `level ${level.id} needs goal`);
    assert.ok(level.hint ?? level.help, `level ${level.id} needs hint`);
    assert.ok(level.starterProgram, `level ${level.id} needs starterProgram`);
    assert.ok(level.demoProgram, `level ${level.id} needs demoProgram`);
    assert.ok(level.solution, `level ${level.id} needs solution`);
    assert.ok(Array.isArray(level.editableSlots), `level ${level.id} needs editableSlots`);
    assert.ok(level.successInvariant, `level ${level.id} needs successInvariant`);
    assert.ok(Array.isArray(level.failureCases) && level.failureCases.length > 0, `level ${level.id} needs failureCases`);
    assertProgramShape(starterOf(level), `level ${level.id} starterProgram`);
    assertProgramShape(level.demoProgram, `level ${level.id} demoProgram`);
    assertProgramShape(solutionOf(level), `level ${level.id} solution`);
    assert.ok(level.editableSlots.every((slot) => slotKind(slot)), `level ${level.id} has unnamed editable slot`);
  }
});

test("programs use only typed instructions and typed value expressions", () => {
  const allPrograms = levels.flatMap((level) => [starterOf(level), level.demoProgram, solutionOf(level)]);
  const expressionTypes = new Set();
  for (const program of allPrograms) {
    for (const instruction of instructionsOf(program)) {
      assert.ok(INSTRUCTION_TYPES.has(opOf(instruction)));
      collectValueExprTypes(instruction, expressionTypes);
    }
  }
  assert.ok(expressionTypes.size > 0, "programs must expose typed ValueExpr nodes");
  assert.ok([...expressionTypes].every((type) => VALUE_EXPR_TYPES.has(type)));
});

test("each level has editable progression and non-solved starter", () => {
  for (const level of levels) {
    const starter = starterOf(level);
    const solution = solutionOf(level);
    assert.notDeepEqual(solution, starter, `level ${level.id} starter must need player input`);
    assert.notDeepEqual(JSON.stringify(solution), JSON.stringify(starter), `level ${level.id} solution must differ`);
  }

  assert.ok(levels[1].editableSlots.some((slot) => /order|sequence|move/.test(slotKind(slot))), "L2 teaches reorder");
  assert.ok(levels[2].editableSlots.some((slot) => /number|value|literal|write|energy/.test(slotKind(slot))), "L3 teaches 2 → 5");
  const l3StarterWrite = instructionsOf(starterOf(levels[2])).find((instruction) => opOf(instruction) === "write");
  const l3SolutionWrite = instructionsOf(solutionOf(levels[2])).find((instruction) => opOf(instruction) === "write");
  assert.ok(l3StarterWrite && l3SolutionWrite, "L3 must expose structured write instructions");
  assert.notDeepEqual(valueExprOf(l3StarterWrite), valueExprOf(l3SolutionWrite), "L3 number edit must change structured value");
  assert.ok(levels[3].editableSlots.some((slot) => /update|number|value|literal/.test(slotKind(slot))), "L4 teaches update");
  const starterUpdate = updateInstruction(starterOf(levels[3]));
  const solutionUpdate = updateInstruction(solutionOf(levels[3]));
  assert.ok(starterUpdate && solutionUpdate, "L4 must expose structured update instructions");
  assert.notDeepEqual(valueExprOf(starterUpdate), valueExprOf(solutionUpdate), "L4 update edit must change structured value expression");
  assert.ok(VALUE_EXPR_TYPES.has(exprType(valueExprOf(solutionUpdate))), "L4 update must use typed ValueExpr");
  assert.ok(solutionUpdate.target ?? solutionUpdate.name ?? solutionUpdate.key, "L4 update must identify memory target");
  assert.ok(instructionsOf(solutionOf(levels[4])).some((instruction) => opOf(instruction) === "branch" && branchOperator(instruction) === "<"), "L5 solution must use < light route");
  assert.ok(instructionsOf(solutionOf(levels[5])).some((instruction) => opOf(instruction) === "branch" && branchOperator(instruction) === "=="), "L6 solution must use ==");
  for (const level of levels.slice(6)) {
    const kinds = level.editableSlots.map(slotKind).join(" ");
    assert.match(kinds, /order|sequence|move/, `L${level.id} needs reorder edit`);
    assert.match(kinds, /update|number|value|literal|memory/, `L${level.id} needs memory update edit`);
    assert.match(kinds, /choice|branch|operator|path|compare/, `L${level.id} needs choice edit`);
  }
});

test("final story carries exact dawn instruction and ending", () => {
  const final = levels.at(-1);
  const story = `${final.story} ${final.successTitle ?? ""} ${final.successText ?? ""} ${final.ending ?? ""}`;
  assert.match(story, /MAKE THE SUN RISE AGAIN/);
  assert.match(story, /SUN RISES AGAIN/i);
});

test("canonical runtime validates before execution and rejects unsafe instructions", () => {
  assert.equal(typeof Runtime, "function");
  const valid = solutionOf(levels[0]);
  assert.doesNotThrow(() => new Runtime(levels[0], valid));

  const invalid = {
    ...valid,
    instructions: [{ type: "eval", source: "1 + 1" }],
  };
  assert.throws(() => new Runtime(levels[0], invalid), /invalid|instruction|type|program/i);
});
