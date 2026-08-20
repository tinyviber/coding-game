import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, createProgram, getLevels, normalizeProgram } from "../src/levels.js";
import { INSTRUCTION_TYPES, instructionsOf } from "../tests/helpers/canonical-contract.mjs";

const levels = getLevels();

function types(program) {
  return instructionsOf(program).map((instruction) => instruction.type);
}

test("the authored campaign is exactly eight Flow, Memory, and Choice levels", () => {
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  const laws = levels.map((level) => level.law || level.zone.split(" · ").at(-1));
  assert.deepEqual(new Set(laws), new Set(["Flow", "Memory", "Choice"]));
  assert.equal(levels.some((level) => /Cycle|Function|Collection/i.test(`${level.zone} ${level.law} ${level.title}`)), false);
  for (const level of levels) {
    assert.ok(level.scene && level.code && level.steps && level.check, `level ${level.id} needs public level contracts`);
    assert.ok(level.starterProgram && level.solution, `level ${level.id} needs starter and solution`);
    assert.ok(Array.isArray(level.editableSlots), `level ${level.id} needs editable slots`);
  }
});

test("authored programs contain no read instruction, Reader node, or retired instruction family", () => {
  for (const level of levels) {
    for (const [name, program] of [["starter", level.starterProgram], ["solution", level.solution]]) {
      assert.ok(types(program).every((type) => INSTRUCTION_TYPES.has(type)), `level ${level.id} ${name} has an unknown instruction`);
      assert.equal(types(program).includes("read"), false, `level ${level.id} ${name} must not read explicitly`);
      if (level.id === 2) assert.ok(instructionsOf(program).some((instruction) => instruction.id === "pickup_relay_core"));
    }
    assert.equal(level.scene.nodes.some((node) => node.id === "reader" || node.type === "reader"), false, `level ${level.id} still exposes Reader`);
    assert.equal(JSON.stringify(level.successRules).includes("readEquals"), false, `level ${level.id} still uses readEquals`);
    assert.equal(JSON.stringify(level).includes("legacy"), false, `level ${level.id} still exposes legacy data`);
  }
});

test("Level 2 keeps the exact empty-handed starter and carried relay_core solution", () => {
  const level = levels[1];
  const expectedStarter = {
    instructions: [
      { id: "move_relay", type: "move", to: "relay" },
      { id: "deliver_relay", type: "deliver", to: "relay" },
      { id: "pickup_relay_core", type: "pickup", item: "relay_core", at: "relay_core" },
    ],
  };
  const expectedSolution = {
    instructions: [
      { id: "pickup_relay_core", type: "pickup", item: "relay_core", at: "relay_core" },
      { id: "move_relay", type: "move", to: "relay" },
      { id: "deliver_relay", type: "deliver", to: "relay" },
    ],
  };
  assert.deepEqual(level.starterProgram, expectedStarter);
  assert.deepEqual(level.solution, expectedSolution);
  assert.deepEqual(level.worldRules, { relayCore: "relay_core" });
  assert.deepEqual(level.successInvariant, { type: "relay-core", order: ["pickup", "move", "deliver"], terminal: "relay" });
});

test("starter and solution programs are independent typed snapshots", () => {
  for (const level of levels) {
    const starter = createProgram(level);
    const solution = cloneProgram(level.solution);
    assert.notStrictEqual(starter, level.starterProgram);
    assert.notStrictEqual(solution, level.solution);
    assert.notDeepEqual(starter, solution, `level ${level.id} starter must need player input`);
    assert.ok(instructionsOf(starter).every((item) => typeof item.id === "string" && INSTRUCTION_TYPES.has(item.type)));
    assert.ok(instructionsOf(solution).every((item) => typeof item.id === "string" && INSTRUCTION_TYPES.has(item.type)));
  }
});

test("code rows expose sourceLine/displayLine and source instruction identity", () => {
  for (const level of levels) {
    const rows = level.code(cloneProgram(level.solution));
    assert.ok(rows.length >= instructionsOf(level.solution).length, `level ${level.id} needs code rows`);
    assert.deepEqual(rows.map((row) => row.displayLine), rows.map((_, index) => index + 1));
    for (const row of rows) {
      assert.ok(Number.isInteger(row.sourceLine) && row.sourceLine >= 1, `level ${level.id} row needs sourceLine`);
      assert.ok(Number.isInteger(row.displayLine) && row.displayLine >= 1, `level ${level.id} row needs displayLine`);
      assert.ok(row.sourceLine <= instructionsOf(level.solution).length, `level ${level.id} row points past source`);
    }
    const sourceRows = rows.filter((row) => !row.displayOnly && row.instructionId);
    assert.equal(sourceRows.length, instructionsOf(level.solution).length, `level ${level.id} source rows must be one per instruction`);
    assert.deepEqual(sourceRows.map((row) => row.instructionId), instructionsOf(level.solution).map((item) => item.id));
  }
});

test("normalizeProgram accepts only the canonical instructions shape", () => {
  const level = levels[0];
  assert.doesNotThrow(() => normalizeProgram(level, cloneProgram(level.solution)));
  for (const legacy of [
    { actionOrder: ["move", "charge", "deliver"] },
    { energy: 5, compare: "==", threshold: 8 },
    { steps: [{ type: "move", to: "charge" }] },
    { ops: [{ type: "move", to: "charge" }] },
    [{ type: "move", to: "charge" }],
  ]) {
    assert.throws(() => normalizeProgram(level, legacy), /指令|legacy|canonical|程序|instructions|program/i);
  }
});
