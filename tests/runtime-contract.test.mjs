import test from "node:test";
import assert from "node:assert/strict";
import { createProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import {
  clone,
  cursorOf,
  eventsOf,
  finishResult,
  instructionsOf,
  pauseAfterRun,
  phaseOf,
  runDemoToIdle,
  runToTerminal,
  setInstructions,
  stepOne,
  stateOf,
} from "./helpers/canonical-contract.mjs";

const levels = getLevels();

function starterOf(level) {
  return level.starterProgram ?? createProgram(level);
}

function solutionOf(level) {
  return typeof level.solution === "function" ? level.solution(starterOf(level)) : level.solution;
}

function makeRuntime(level, program) {
  return new Runtime(level, clone(program));
}

test("all eight authored solutions reach success and starters produce visible failure", async () => {
  for (const level of levels) {
    const solved = makeRuntime(level, solutionOf(level));
    const solvedResult = await runToTerminal(solved);
    assert.equal(solvedResult.ok, true, `level ${level.id} solution should succeed`);
    assert.match(String(phaseOf(solved)), /success|complete/);
    assert.ok(eventsOf(solved).length > 0, `level ${level.id} should emit events`);
    assert.ok(eventsOf(solved).length <= 64, `level ${level.id} exceeds event budget`);

    const starter = makeRuntime(level, starterOf(level));
    const starterResult = await runToTerminal(starter);
    assert.equal(starterResult.ok, false, `level ${level.id} starter should fail`);
    assert.match(String(phaseOf(starter)), /error|failed/);
    const errorText = stateOf(starter)?.error ?? stateOf(starter)?.message ?? starterResult.text;
    assert.ok(String(errorText).length > 0, `level ${level.id} must explain failure`);
  }
});

test("demo executes isolated demoProgram and returns idle without replacing starter", async () => {
  for (const level of levels) {
    const starter = starterOf(level);
    const runtime = makeRuntime(level, starter);
    await runDemoToIdle(runtime, level.demoProgram);
    assert.match(String(phaseOf(runtime)), /idle|ready/);
    assert.equal(cursorOf(runtime), 0);
    assert.deepEqual(runtime.program ?? runtime.currentProgram, starter, `level ${level.id} demo must not replace starter`);
    const state = stateOf(runtime) ?? {};
    assert.deepEqual(state.vars ?? state.memory ?? {}, {});
    assert.equal(state.error ?? "", "");
  }
});

test("events are deterministic, line-addressable, typed, and cursor bounded", async () => {
  const level = levels[7];
  const first = makeRuntime(level, solutionOf(level));
  const second = makeRuntime(level, solutionOf(level));
  await runToTerminal(first);
  await runToTerminal(second);
  assert.deepEqual(eventsOf(first), eventsOf(second));
  assert.equal(cursorOf(first), eventsOf(first).length);
  for (const event of eventsOf(first)) {
    assert.ok(event && typeof event === "object");
    assert.ok(event.type ?? event.kind ?? event.eventType, "event needs type");
    assert.ok(Number.isInteger(event.line) || Number.isInteger(event.instructionIndex), "event needs source line");
  }
});

test("Step advances one event, Pause preserves cursor, and Reset restores full world", async () => {
  const level = levels[5];
  const runtime = makeRuntime(level, solutionOf(level));
  assert.match(String(phaseOf(runtime)), /idle|ready/);
  assert.equal(cursorOf(runtime), 0);

  await stepOne(runtime);
  assert.equal(cursorOf(runtime), 1);
  assert.match(String(phaseOf(runtime)), /paused|idle|running/);
  const afterStep = clone(stateOf(runtime));

  const paused = await pauseAfterRun(runtime);
  assert.equal(paused.after, paused.before, "Pause must not move event cursor");
  assert.ok(stateOf(runtime));
  assert.deepEqual(stateOf(runtime)?.vars ?? stateOf(runtime)?.memory, afterStep.vars ?? afterStep.memory);

  runtime.reset();
  assert.match(String(phaseOf(runtime)), /idle|ready/);
  assert.equal(cursorOf(runtime), 0);
  const reset = stateOf(runtime) ?? {};
  assert.deepEqual(reset.vars ?? reset.memory ?? {}, {});
  assert.equal(reset.activeLine ?? reset.line ?? 0, 0);
  assert.equal(reset.error ?? "", "");
});

test("Run snapshots program, repeated Run is idempotent, and source mutation cannot alter execution", async () => {
  const level = levels[7];
  const source = clone(solutionOf(level));
  const runtime = makeRuntime(level, source);
  const before = clone(source);
  const firstResult = await runToTerminal(runtime);
  const firstEvents = clone(eventsOf(runtime));
  assert.equal(firstResult.ok, true);

  const instructions = instructionsOf(source);
  if (instructions.length > 0) {
    const firstInstruction = instructions[0];
    if ("type" in firstInstruction) firstInstruction.type = "eval";
    else if ("kind" in firstInstruction) firstInstruction.kind = "eval";
    else firstInstruction.op = "eval";
  }
  assert.notDeepEqual(source, before);
  runtime.run();
  assert.equal(finishResult(runtime).ok, true);
  assert.deepEqual(eventsOf(runtime), firstEvents);
});

test("runtime rejects event expansion above 64 and malformed ValueExpr", () => {
  const level = levels[0];
  const solution = solutionOf(level);
  const instructions = instructionsOf(solution);
  const tooMany = [];
  while (tooMany.length <= 64) tooMany.push(...instructions);
  assert.throws(() => new Runtime(level, setInstructions(solution, tooMany.slice(0, 65))), /64|max|event|limit/i);

  const malformed = setInstructions(solution, [{
    type: "write",
    target: "energy",
    value: { type: "multiply", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
  }]);
  assert.throws(() => new Runtime(level, malformed), /value|expr|invalid|type/i);
});

test("runtime rejects undeclared branch paths and preserves the source line", () => {
  const level = levels[5];
  for (const invalidPath of ["missing-scene-path", "memory"]) {
    const program = structuredClone(solutionOf(level));
    const branch = program.instructions.find((item) => item.type === "branch");
    branch.pass = invalidPath;
    assert.throws(() => new Runtime(level, program), /line 3.*declared|declared.*line 3/i);
  }
});
