import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, getLevels, reorderProgram } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import { runToTerminal } from "./helpers/canonical-contract.mjs";

const levels = getLevels();

function eventShape(event) {
  const payload = event.payload || {};
  return {
    instructionId: event.instructionId,
    kind: event.kind,
    payload,
    id: event.id,
  };
}

function instructionEvents(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = `${event.instructionId}:${event.kind}:${event.payload?.stage || ""}`;
    const values = grouped.get(key) || [];
    values.push(event.id);
    grouped.set(key, values);
  }
  return grouped;
}

test("event IDs are semantic, unique, and deterministic across compilation and rerun", async () => {
  const level = levels[7];
  const program = cloneProgram(level.solution);
  const first = new Runtime(level, program);
  const second = new Runtime(level, program);
  assert.deepEqual(first.events.map(eventShape), second.events.map(eventShape));
  assert.equal(new Set(first.events.map((event) => event.id)).size, first.events.length);
  assert.ok(first.events.every((event) => typeof event.id === "string" && !/^\d+$/.test(event.id)));

  await runToTerminal(first);
  const completed = first.events.map(eventShape);
  first.reset();
  await runToTerminal(first);
  assert.deepEqual(first.events.map(eventShape), completed, "reset and rerun must preserve event identity");
});

test("reordering display rows does not renumber semantic events", () => {
  const level = levels[0];
  const program = {
    instructions: [
      { id: "move_charge", type: "move", to: "charge" },
      { id: "charge_a", type: "charge", amount: 1 },
      { id: "charge_b", type: "charge", amount: 2 },
      { id: "deliver_relay", type: "deliver", to: "relay" },
    ],
  };
  const original = new Runtime(level, cloneProgram(program));
  const reordered = new Runtime(level, reorderProgram(level, cloneProgram(program), 1, 1));
  const originalByInstruction = instructionEvents(original.events);
  const reorderedByInstruction = instructionEvents(reordered.events);

  for (const [key, ids] of originalByInstruction) {
    if (!reorderedByInstruction.has(key)) continue;
    assert.deepEqual(reorderedByInstruction.get(key), ids, `${key} changed when its display row moved`);
  }
  const moved = reordered.events.find((event) => event.instructionId === "charge_a");
  assert.equal(moved.sourceLine, 3, "sourceLine follows the current typed instruction row");
  assert.equal(moved.displayLine, 3, "displayLine follows the reordered visible row");
});

test("dynamic path expansion keeps semantic IDs stable across repeated runs", async () => {
  const level = levels[4];
  const first = new Runtime(level, cloneProgram(level.solution));
  const second = new Runtime(level, cloneProgram(level.solution));
  await runToTerminal(first);
  await runToTerminal(second);
  assert.deepEqual(first.events.map(eventShape), second.events.map(eventShape));

  const dynamic = first.events.filter((event) => event.instructionId === "deliver_relay");
  assert.deepEqual(dynamic.map((event) => event.kind), ["traverse", "traverse", "traverse", "deliver"]);
  assert.deepEqual(dynamic.slice(0, 3).map((event) => [event.payload.from, event.payload.to]), [
    ["memory", "gate"],
    ["gate", "light"],
    ["light", "relay"],
  ]);
  assert.ok(dynamic.every((event) => typeof event.id === "string" && !/^\d+$/.test(event.id)));
  assert.equal(new Set(first.events.map((event) => event.id)).size, first.events.length);
});
