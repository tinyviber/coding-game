import test from "node:test";
import assert from "node:assert/strict";
import * as levelsApi from "../src/levels.js";
import { cloneProgram, getLevels, normalizeProgram, reorderProgram } from "../src/levels.js";
import * as runtimeApi from "../src/runtime.js";
import { Runtime, compileProgram, validateProgram } from "../src/runtime.js";
import {
  clone,
  eventPayload,
  eventsOf,
  instructionsOf,
  runToTerminal,
  semanticEventKey,
  stateOf,
} from "./helpers/canonical-contract.mjs";

const levels = getLevels();

const WORLD_EVENT_FIELDS = [
  "id",
  "instructionId",
  "sourceLine",
  "displayLine",
  "kind",
  "occurrence",
  "instruction",
  "payload",
];

function eventSemanticIdentity(event) {
  const payload = event.payload || {};
  return JSON.stringify({
    instructionId: event.instructionId,
    kind: event.kind,
    stage: payload.stage || "",
    occurrence: event.occurrence,
  });
}

function reorder(program, first, second) {
  const next = cloneProgram(program);
  [next.instructions[first], next.instructions[second]] = [next.instructions[second], next.instructions[first]];
  return next;
}

test("WorldEvent exposes exactly eight top-level fields and an object payload", async () => {
  const runtime = new Runtime(levels[4], cloneProgram(levels[4].solution));
  await runToTerminal(runtime);

  assert.ok(runtime.events.length > 0);
  for (const event of runtime.events) {
    assert.deepEqual(Object.keys(event).sort(), [...WORLD_EVENT_FIELDS].sort());
    assert.ok(event.payload && typeof event.payload === "object" && !Array.isArray(event.payload));
  }
});

test("event IDs are semantic, deterministic, unique, and independent of event-array position", async () => {
  const level = levels[7];
  const first = new Runtime(level, cloneProgram(level.solution));
  const second = new Runtime(level, cloneProgram(level.solution));
  await runToTerminal(first);
  await runToTerminal(second);
  assert.deepEqual(eventsOf(first), eventsOf(second));

  const ids = eventsOf(first).map((event) => event.id);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => !/^\d+$/.test(id)), "event IDs must not be array cursors");
  assert.ok(eventsOf(first).filter((event) => event.kind === "traverse").length > 1, "contract must cover repeated event kinds");

  const reordered = new Runtime(level, reorder(level.solution, 0, 1));
  const originalBySemantic = new Map(eventsOf(first).map((event) => [eventSemanticIdentity(event), event.id]));
  const reorderedEvents = eventsOf(reordered);
  const shared = reorderedEvents.filter((event) => originalBySemantic.has(eventSemanticIdentity(event)));
  assert.ok(shared.length > 0);
  for (const event of shared) assert.equal(event.id, originalBySemantic.get(eventSemanticIdentity(event)));
});

test("dynamic delivery expansion also gets stable semantic IDs on reruns", async () => {
  const level = levels[4];
  const first = new Runtime(level, cloneProgram(level.solution));
  const second = new Runtime(level, cloneProgram(level.solution));
  await runToTerminal(first);
  await runToTerminal(second);
  const firstEvents = eventsOf(first);
  const secondEvents = eventsOf(second);
  assert.deepEqual(firstEvents, secondEvents);
  assert.equal(firstEvents.some((event) => event.kind === "deliver" && event.payload?.stage === "dynamic"), false);
  assert.ok(firstEvents.some((event) => event.kind === "deliver" && event.payload?.to === "relay"));
  const deliveryRoute = firstEvents
    .filter((event) => event.instructionId === "deliver_relay" && event.kind === "traverse")
    .map((event) => [event.payload.from, event.payload.to]);
  assert.deepEqual(deliveryRoute, [["memory", "gate"], ["gate", "light"], ["light", "relay"]]);
  assert.ok(firstEvents.every((event) => typeof event.id === "string"));
  assert.equal(new Set(firstEvents.map((event) => event.id)).size, firstEvents.length);
});

test("event payloads retain sourceLine and stable instruction identity through expansion", () => {
  const level = levels[4];
  const runtime = new Runtime(level, cloneProgram(level.solution));
  for (const event of eventsOf(runtime)) {
    assert.equal(typeof event.instructionId, "string");
    assert.ok(Number.isInteger(event.sourceLine) && event.sourceLine >= 1);
    assert.ok(event.instruction && event.instruction.id === event.instructionId);
    assert.equal(semanticEventKey(event), semanticEventKey({ ...event }));
    assert.equal(eventPayload(event).instructionId, event.instructionId);
    assert.deepEqual(eventPayload(event).payload, event.payload);
  }
});

test("validateProgram and Runtime reject malformed or unsafe instructions before execution", () => {
  const level = levels[0];
  const valid = cloneProgram(level.solution);
  assert.equal(validateProgram(level, valid).ok, true);
  assert.doesNotThrow(() => new Runtime(level, valid));

  for (const invalid of [
    { instructions: [] },
    { instructions: [{ id: "bad", type: "eval", source: "1 + 1" }] },
    { instructions: [{ id: "bad", type: "write", name: "energy", value: { type: "multiply", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } } }] },
    { instructions: [{ id: "bad", type: "charge", amount: 1.5 }] },
    { instructions: [{ id: "bad", type: "write", name: "not_declared", value: { type: "literal", value: 1 } }] },
  ]) {
    assert.throws(() => new Runtime(level, invalid), /invalid|instruction|type|program|记忆|数值/i);
  }
});

test("Level 6 rejects the legacy cargo memory program", () => {
  const level = levels[5];
  const legacy = {
    instructions: [
      { id: "write_cargo", type: "write", name: "cargo", value: { type: "literal", value: "blue" } },
      {
        id: "branch_gate",
        type: "branch",
        left: { type: "memory", name: "cargo" },
        operator: "==",
        right: { type: "literal", value: "blue" },
        pass: "light",
        fail: "dark",
      },
      { id: "deliver_relay", type: "deliver", to: "relay" },
    ],
  };

  const validation = validateProgram(level, legacy);
  assert.equal(validation.ok, false);
  assert.throws(() => new Runtime(level, legacy), /memory|记忆|不存在|声明|invalid/i);
});

test("duplicate instruction ids are rejected before execution", () => {
  const level = levels[0];
  const duplicate = cloneProgram(level.solution);
  duplicate.instructions[1].id = duplicate.instructions[0].id;

  const validation = validateProgram(level, duplicate);
  assert.equal(validation.ok, false);
  assert.match(validation.message, /id|唯一|重复|duplicate/i);
  assert.throws(() => new Runtime(level, duplicate), /id|唯一|重复|duplicate/i);
});

test("value expression validation rejects excessive depth without evaluating arbitrary objects", () => {
  const level = levels[3];
  let expression = { type: "literal", value: 1 };
  for (let index = 0; index < 12; index += 1) expression = { type: "add", left: expression, right: { type: "literal", value: 1 } };
  assert.throws(() => new Runtime(level, {
    instructions: [{ id: "deep_write", type: "write", name: "energy", value: expression }],
  }), /depth|expression|数值|无效|invalid/i);
});

test("instruction and world-event budgets reject expansion attacks", () => {
  const level = levels[0];
  const tooMany = { instructions: Array.from({ length: 65 }, (_, index) => ({ id: `move_${index}`, type: "move", to: "charge" })) };
  assert.throws(() => new Runtime(level, tooMany), /64|max|event|limit|指令/i);

  const repeated = { instructions: Array.from({ length: 64 }, (_, index) => ({
    id: `branch_${index}`,
    type: "branch",
    left: { type: "memory", name: "energy" },
    operator: ">",
    right: { type: "literal", value: 0 },
    pass: "light",
    fail: "dark",
  })) };
  const compiled = compileProgram(levels[4], repeated);
  assert.equal(compiled.ok, false, "event expansion must have a finite safety budget");
  assert.match(compiled.message, /event|limit|超过|程序/i);
});

test("invalid paths and unreachable authored routes are rejected", () => {
  const choice = cloneProgram(levels[4].solution);
  const branch = choice.instructions.find((instruction) => instruction.type === "branch");
  branch.pass = "missing-path";
  assert.throws(() => new Runtime(levels[4], choice), /path|route|声明|invalid|路线/i);

  const move = cloneProgram(levels[0].solution);
  move.instructions[0].to = "not-a-node";
  assert.throws(() => new Runtime(levels[0], move), /node|path|target|轨道|目标/i);

  const unreachable = {
    instructions: [
      { id: "move_charge", type: "move", to: "charge" },
      { id: "move_back", type: "move", to: "dock" },
      { id: "deliver_relay", type: "deliver", to: "relay" },
    ],
  };
  const result = new Runtime(levels[0], unreachable);
  assert.equal(result.events.some((event) => event.kind === "unreachable"), true);
});

test("Runtime snapshots and execution programs are isolated from caller mutation", async () => {
  const level = levels[7];
  const source = cloneProgram(level.solution);
  const runtime = new Runtime(level, source);
  const before = runtime.getProgram();
  source.instructions[0].type = "eval";
  source.instructions[0].value = { type: "literal", value: 999 };
  assert.deepEqual(runtime.getProgram(), before);

  const snapshot = stateOf(runtime);
  snapshot.vars.energy = 999;
  snapshot.unit.x = 999;
  assert.notEqual(stateOf(runtime).vars.energy, 999);
  assert.notEqual(stateOf(runtime).unit.x, 999);

  const first = await runToTerminal(runtime);
  const eventSnapshot = clone(eventsOf(runtime));
  runtime.run();
  assert.equal(first.ok, true);
  assert.deepEqual(eventsOf(runtime), eventSnapshot);
});

test("pause, stepOnce, and reset preserve basic runtime control behavior without waiting for timers", () => {
  const level = levels[0];
  const runtime = new Runtime(level, cloneProgram(level.solution));

  assert.equal(stateOf(runtime).phase, "idle");
  assert.equal(runtime.eventCursor, 0);
  assert.equal(runtime.run(), true);
  assert.equal(stateOf(runtime).phase, "running");
  assert.equal(runtime.pause(), true);
  assert.equal(stateOf(runtime).phase, "paused");
  assert.equal(runtime.eventCursor, 0);
  assert.equal(runtime.pause(), false);

  assert.equal(runtime.stepOnce(), true);
  assert.equal(stateOf(runtime).phase, "paused");
  assert.equal(runtime.eventCursor, 1);

  runtime.reset();
  assert.equal(stateOf(runtime).phase, "idle");
  assert.equal(runtime.eventCursor, 0);
  assert.deepEqual(stateOf(runtime).vars, {});
  assert.equal(stateOf(runtime).activeLine, 0);
  assert.equal(stateOf(runtime).error, "");
  assert.equal(runtime.stepOnce(), true);
  assert.equal(stateOf(runtime).phase, "paused");
  assert.equal(runtime.eventCursor, 1);
});

test("public runtime and level APIs remain explicit and contain no retired compatibility API", () => {
  for (const name of ["getLevels", "getLevel", "getScene", "createProgram", "cloneProgram", "normalizeProgram", "getDisplayLines", "applyEdit", "reorderProgram"]) {
    assert.equal(typeof levelsApi[name], "function", `${name} is public`);
  }
  for (const name of ["read", "Reader", "legacyToProgram", "legacyCheck"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(levelsApi, name), false, `${name} must not be public`);
  }
  for (const name of ["Runtime", "validateProgram", "compileProgram"]) {
    assert.equal(typeof runtimeApi[name], "function", `${name} is public`);
  }
  for (const name of ["run", "pause", "stepOnce", "reset", "setProgram", "getProgram", "snapshotState", "canEdit"]) {
    assert.equal(typeof Runtime.prototype[name], "function", `Runtime.${name} is public`);
  }
});

test("normalizeProgram does not mutate canonical input and rejects legacy-shaped program data", () => {
  const level = levels[0];
  const program = cloneProgram(level.solution);
  const before = clone(program);
  const normalized = normalizeProgram(level, program);
  assert.deepEqual(program, before);
  assert.deepEqual(normalized.instructions, before.instructions);
  for (const legacy of [
    { actionOrder: ["move", "charge", "deliver"] },
    { energy: 5, update: 1, compare: ">", threshold: 3 },
    { instructions: before.instructions, actionOrder: ["charge", "move", "deliver"] },
  ]) {
    assert.throws(() => normalizeProgram(level, legacy), /指令|legacy|canonical|程序|instructions|program/i);
  }
});
