import test from "node:test";
import assert from "node:assert/strict";
import { edgeControlPoints, pointOnEdge } from "../src/geometry.js";
import { applyEdit, cloneProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import { eventPayload, instructionsOf, runToTerminal, stateOf } from "./helpers/canonical-contract.mjs";

const levels = getLevels();

function payloadWithoutId(event) {
  const payload = eventPayload(event);
  delete payload.id;
  return payload;
}

function eventsFor(runtime, instructionId) {
  return runtime.events.filter((event) => event.instructionId === instructionId);
}

function stepUntilEvent(runtime, eventId) {
  while (runtime.state.eventCursor < runtime.events.length && runtime.events[runtime.state.eventCursor]?.id !== eventId) runtime.step();
  return runtime.events.find((event) => event.id === eventId);
}

test("Flow event expansion is implicit and retains exact authored payloads", () => {
  const level = levels[0];
  const runtime = new Runtime(level, cloneProgram(level.solution));
  const expected = [
    { instructionId: "move_charge", kind: "traverse", sourceLine: 1, displayLine: 1, payload: { actor: "unit", from: "dock", to: "charge" } },
    { instructionId: "charge_station", kind: "charge", sourceLine: 2, displayLine: 2, payload: { amount: 3 } },
    { instructionId: "deliver_relay", kind: "traverse", sourceLine: 3, displayLine: 3, payload: { actor: "unit", from: "charge", to: "relay" } },
    { instructionId: "deliver_relay", kind: "deliver", sourceLine: 3, displayLine: 3, payload: { to: "relay" } },
  ];
  assert.deepEqual(runtime.events.map(payloadWithoutId), expected);
});

test("Level 2 event sequence carries relay_core before delivery", () => {
  const level = levels[1];
  const runtime = new Runtime(level, cloneProgram(level.solution));
  assert.deepEqual(runtime.events.map(payloadWithoutId), [
    { instructionId: "pickup_relay_core", kind: "traverse", sourceLine: 1, displayLine: 1, payload: { actor: "unit", from: "dock", to: "relay_core" } },
    { instructionId: "pickup_relay_core", kind: "pickup", sourceLine: 1, displayLine: 1, payload: { item: "relay_core", at: "relay_core" } },
    { instructionId: "move_relay", kind: "traverse", sourceLine: 2, displayLine: 2, payload: { actor: "unit", from: "relay_core", to: "relay" } },
    { instructionId: "deliver_relay", kind: "deliver", sourceLine: 3, displayLine: 3, payload: { to: "relay" } },
  ]);
});

test("Choice emits a direct Memory→Gate token flow without the retired reader surface", () => {
  const level = levels[4];
  assert.equal(level.scene.nodes.some((node) => node.id === "reader"), false);
  assert.ok(level.scene.edges.some(([from, to]) => from === "memory" && to === "gate"));
  const runtime = new Runtime(level, cloneProgram(level.solution));
  const branchEvents = eventsFor(runtime, "branch_gate");
  assert.deepEqual(branchEvents.map((event) => event.kind), ["load-memory", "token-traverse", "gate-receive", "gate-compare", "gate-route", "gate-consume"]);
  assert.ok(branchEvents.some((event) => event.kind === "token-traverse" && event.payload.from === "memory" && event.payload.to === "gate"));
  assert.ok(branchEvents.every((event) => !/reader/i.test(JSON.stringify(event.payload))));
});

test("Unit and token positions remain separate during direct Memory→Gate transfer", () => {
  const level = levels[4];
  const runtime = new Runtime(level, cloneProgram(level.solution));
  const transfer = runtime.events.find((event) => event.kind === "token-traverse" && event.payload.from === "memory" && event.payload.to === "gate");
  assert.ok(transfer);
  const transferId = transfer.id;
  const currentTransfer = stepUntilEvent(runtime, transferId);
  assert.ok(currentTransfer);
  const before = stateOf(runtime);
  runtime.beginEvent(currentTransfer);
  const state = stateOf(runtime);
  assert.ok(state.unit && state.tokenPosition, "state must expose separate Unit and token positions");
  assert.equal(state.unitNode, before.unitNode, "token transfer must not move Unit-0");
  assert.notEqual(state.unitNode, state.tokenPosition);
  assert.deepEqual(state.tokenEdge, { from: "memory", to: "gate" });
  assert.equal(state.tokenTransfer.phase, "memory-to-gate");
});

test("write and update commit at Memory, while branch reads the stored token implicitly", () => {
  const memoryLevel = levels[3];
  const runtime = new Runtime(memoryLevel, cloneProgram(memoryLevel.solution));
  const writeReceive = runtime.events.find((event) => event.kind === "store-memory" && event.payload.stage === "receive");
  assert.ok(writeReceive);
  const writeReceiveId = writeReceive.id;
  const currentWriteReceive = stepUntilEvent(runtime, writeReceiveId);
  assert.ok(currentWriteReceive);
  assert.deepEqual(stateOf(runtime).vars, {});
  runtime.step();
  assert.deepEqual(stateOf(runtime).vars, {});
  runtime.step();
  assert.equal(stateOf(runtime).vars.energy, 1);

  const choiceRuntime = new Runtime(levels[4], cloneProgram(levels[4].solution));
  const branch = choiceRuntime.events.find((event) => event.kind === "gate-receive");
  assert.ok(branch);
  const currentBranch = stepUntilEvent(choiceRuntime, branch.id);
  assert.ok(currentBranch);
  choiceRuntime.step();
  assert.equal(stateOf(choiceRuntime).tokenTransfer.phase, "gate");
  assert.equal(stateOf(choiceRuntime).dataToken.value, 5);
});

test("editable controls address instruction IDs rather than duplicate instruction types", () => {
  const level = { ...levels[2] };
  level.editableSlots = [
    { id: "first", instructionId: "write_first", path: "value.value", type: "number" },
    { id: "second", instructionId: "write_second", path: "value.value", type: "number" },
  ];
  const program = { instructions: [
    { id: "write_first", type: "write", name: "energy", value: { type: "literal", value: 1 } },
    { id: "write_second", type: "write", name: "energy", value: { type: "literal", value: 2 } },
  ] };
  const next = applyEdit(level, program, { instructionId: "write_second", path: "value.value" }, 7);
  assert.equal(next.instructions[0].value.value, 1);
  assert.equal(next.instructions[1].value.value, 7);
  const ignored = applyEdit(level, program, { index: 0, path: "value.value" }, 9);
  assert.equal(ignored.instructions[0].value.value, 1);
});

test("geometry uses the authored cubic curve for Unit and token motion", () => {
  const edge = edgeControlPoints({ x: 0, y: 0 }, { x: 1, y: 1 });
  assert.equal(edge.curved, true);
  const point = pointOnEdge(edge, 0.25);
  assert.ok(Math.abs(point.x - 0.2828125) < 1e-12);
  assert.ok(Math.abs(point.y - 0.15625) < 1e-12);
  assert.notEqual(point.y, 0.25);
  assert.deepEqual(pointOnEdge(edge, 0), edge.from);
  assert.deepEqual(pointOnEdge(edge, 1), edge.to);
});

test("all solutions still finish after implicit Choice transfer", async () => {
  for (const level of levels) {
    const runtime = new Runtime(level, cloneProgram(level.solution));
    assert.equal((await runToTerminal(runtime)).ok, true, `level ${level.id} should complete`);
  }
});
