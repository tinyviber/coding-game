import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_IDS,
  assertUniqueLevelIds,
  cloneProgram,
  createProgram,
  getLevels,
  getMemoryPresentation,
  groupLevelsByMapGroup,
} from "../src/levels.js";
import {
  INSTRUCTION_TYPES,
  VALUE_EXPR_TYPES,
  assertProgramShape,
  collectValueExprTypes,
  instructionsOf,
} from "./helpers/canonical-contract.mjs";

const levels = getLevels();

function solutionOf(level) {
  return cloneProgram(level.solution);
}

function editableParts(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (value.edit) result.push(value);
  if (Array.isArray(value)) value.forEach((item) => editableParts(item, result));
  else Object.values(value).forEach((item) => editableParts(item, result));
  return result;
}

function renderedCode(level, program) {
  return level.code(program)
    .map((row) => row.parts.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.value !== "undefined") return String(part.value);
      return "";
    }).join(""))
    .join("\n");
}

test("canonical content is data-driven, exactly eight levels, and excludes future laws", () => {
  assert.equal(Object.isFrozen(LEVEL_IDS), true);
  assert.deepEqual(LEVEL_IDS, levels.map((level) => level.id));
  assert.deepEqual(levels.map((level) => level.mapGroup.label), ["Flow", "Flow", "Memory", "Memory", "Choice", "Choice", "Choice", "Choice"]);
  for (const level of levels) {
    assert.ok(level.zone && level.title && level.story && level.goal, `level ${level.id} needs story metadata`);
    assert.equal(typeof level.mapGroup?.key, "string", `level ${level.id} needs mapGroup.key metadata`);
    assert.equal(typeof level.mapGroup?.label, "string", `level ${level.id} needs mapGroup.label metadata`);
    assert.equal(typeof level.mapGroup?.order, "number", `level ${level.id} needs mapGroup.order metadata`);
    assert.ok(level.starterProgram && level.solution, `level ${level.id} needs canonical programs`);
    assert.ok(Array.isArray(level.editableSlots), `level ${level.id} needs editable slots`);
    assert.ok(Array.isArray(level.failureCases) && level.failureCases.length > 0, `level ${level.id} needs failure cases`);
    assert.doesNotMatch(`${level.zone} ${level.title} ${JSON.stringify(level)}`, /Cycle|Function|Collection/);
    assertProgramShape(level.starterProgram, `level ${level.id} starter`);
    assertProgramShape(level.solution, `level ${level.id} solution`);
  }
});

test("level registry validates unique IDs and groups only from explicit map metadata", () => {
  assert.throws(
    () => assertUniqueLevelIds([{ id: 4 }, { id: 4 }]),
    /duplicate level id.*4/i,
  );

  const summarize = (groups) => groups.map((group) => ({
    key: group.key,
    label: group.label,
    order: group.order,
    levelIds: group.levels.map((level) => level.id),
  }));

  const baseline = summarize(groupLevelsByMapGroup(levels));
  assert.deepEqual(baseline, [
    { key: "flow", label: "Flow", order: 1, levelIds: [1, 2] },
    { key: "memory", label: "Memory", order: 2, levelIds: [3, 4] },
    { key: "choice", label: "Choice", order: 3, levelIds: [5, 6, 7, 8] },
  ]);

  const changedZones = levels.map((level) => ({
    ...level,
    zone: `arbitrary display text for ${level.id}`,
    mapGroup: { ...level.mapGroup },
  }));
  assert.deepEqual(summarize(groupLevelsByMapGroup(changedZones)), baseline);

  const extended = [
    ...changedZones,
    { id: 99, title: "临时任务", zone: "unrelated", mapGroup: { key: "night", label: "Night", order: 0 } },
  ];
  assert.deepEqual(summarize(groupLevelsByMapGroup(extended))[0], {
    key: "night",
    label: "Night",
    order: 0,
    levelIds: [99],
  });
});

test("canonical programs use only typed instructions and typed ValueExpr nodes", () => {
  const expressionTypes = new Set();
  for (const level of levels) {
    for (const program of [level.starterProgram, level.solution]) {
      for (const instruction of instructionsOf(program)) {
        assert.ok(INSTRUCTION_TYPES.has(instruction.type));
        assert.notEqual(instruction.type, "read");
        collectValueExprTypes(instruction, expressionTypes);
      }
    }
  }
  assert.ok(expressionTypes.size > 0);
  assert.ok([...expressionTypes].every((type) => VALUE_EXPR_TYPES.has(type)));
});

test("Level 6 uses label as the canonical memory in code and runtime-facing data", () => {
  const level = levels[5];
  assert.deepEqual(level.memoryNames, ["label"]);

  for (const program of [level.starterProgram, level.solution]) {
    const source = JSON.stringify(program);
    assert.doesNotMatch(source, /\bcargo\b/i);
    assert.match(source, /"name":"label"/);
    assert.match(source, /"id":"write_label"/);
  }

  const code = renderedCode(level, solutionOf(level));
  assert.match(code, /label\s*=\s*"blue"/);
  assert.match(code, /label\s*==\s*"blue"/);
  assert.doesNotMatch(code, /\bcargo\b/i);
});

test("memory presentation exposes explicit code, world, and prose layers with a safe fallback", () => {
  assert.deepEqual(Object.keys(getMemoryPresentation("label")).sort(), ["code", "prose", "world"]);
  assert.deepEqual(getMemoryPresentation("energy"), {
    code: "energy",
    world: "energy",
    prose: "能量",
  });
  assert.deepEqual(getMemoryPresentation("label"), {
    code: "label",
    world: "标签",
    prose: "标签",
  });

  const unknown = getMemoryPresentation("count");
  assert.equal(unknown.code, "count");
  assert.equal(unknown.world, "记忆");
  assert.equal(unknown.prose, "这项记忆");
  assert.doesNotMatch(unknown.world, /\bcount\b/i);
  assert.doesNotMatch(unknown.prose, /\bcount\b/i);
});

test("progression keeps the complete Choice editing surface on levels 7 and 8", () => {
  for (const level of levels.slice(6)) {
    const slots = level.editableSlots;
    assert.ok(slots.some((slot) => slot.type === "order"), `level ${level.id} needs order control`);
    assert.ok(slots.some((slot) => slot.instructionId === "update_energy" && slot.path === "value.right.value"), `level ${level.id} needs update control`);
    assert.ok(slots.some((slot) => slot.instructionId === "branch_gate" && slot.path === "operator"), `level ${level.id} needs operator control`);
    assert.ok(slots.some((slot) => slot.instructionId === "branch_gate" && slot.path === "pass"), `level ${level.id} needs path control`);
    if (level.id === 8) assert.ok(slots.some((slot) => slot.instructionId === "branch_gate" && slot.path === "right.value"), "level 8 needs threshold control");
  }
});

test("Choice code derives display rows from one branch source row and keeps controls source-only", () => {
  for (const level of levels.slice(4)) {
    const program = solutionOf(level);
    const branch = instructionsOf(program).find((instruction) => instruction.type === "branch");
    const rows = level.code(program);
    const source = rows.find((row) => row.instructionId === branch.id && !row.displayOnly);
    const derived = rows.filter((row) => row.displayOnly === true);
    assert.ok(source, `level ${level.id} needs a source Choice row`);
    assert.ok(derived.length >= 2, `level ${level.id} needs derived Choice rows`);
    assert.ok(derived.every((row) => row.sourceLine === source.sourceLine), `level ${level.id} derived rows must map to branch sourceLine`);
    assert.ok(derived.every((row) => Number.isInteger(row.displayLine) && row.displayLine !== source.displayLine));
    assert.equal(editableParts(derived).length, 0, `level ${level.id} derived rows must not own controls`);
    assert.ok(editableParts(source).length > 0, `level ${level.id} source Choice row must own its controls`);
    assert.ok(rows.filter((row) => row.orderKey === "instructions").every((row) => !row.displayOnly));
  }
});

test("level helpers return fresh programs and source-addressable steps", () => {
  for (const level of levels) {
    const starter = createProgram(level);
    const solution = cloneProgram(level.solution);
    assert.notStrictEqual(starter, level.starterProgram);
    assert.notStrictEqual(solution, level.solution);
    const rows = level.code(solution);
    for (const step of level.steps(solution)) {
      assert.ok(Number.isInteger(step.sourceLine) && step.sourceLine >= 1 && step.sourceLine <= rows.at(-1).sourceLine);
      assert.ok(Number.isInteger(step.displayLine) && step.displayLine >= 1);
      assert.equal(step.instructionId, instructionsOf(solution)[step.sourceLine - 1].id);
    }
  }
});
