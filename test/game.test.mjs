import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import { runToTerminal, stateOf } from "../tests/helpers/canonical-contract.mjs";

const levels = getLevels();

test("every authored solution succeeds and every starter exposes a visible failure", async () => {
  for (const level of levels) {
    const solved = new Runtime(level, cloneProgram(level.solution));
    assert.equal((await runToTerminal(solved)).ok, true, `level ${level.id} solution should succeed`);

    const starter = new Runtime(level, cloneProgram(level.starterProgram));
    const result = await runToTerminal(starter);
    assert.equal(result.ok, false, `level ${level.id} starter should fail`);
    assert.equal(stateOf(starter).phase, "error");
    assert.ok(stateOf(starter).error, `level ${level.id} failure should explain what stopped the relay`);
  }
});

test("Level 2 distinguishes empty-handed relay failure from carried relay_core installation", async () => {
  const level = levels[1];
  const empty = new Runtime(level, cloneProgram(level.starterProgram));
  const emptyResult = await runToTerminal(empty);
  assert.equal(emptyResult.ok, false);
  assert.equal(stateOf(empty).unitNode, "relay");
  assert.equal(stateOf(empty).relaySocket, "empty");
  assert.equal(stateOf(empty).relayInstalled, false);
  assert.equal(stateOf(empty).mood, "puzzled");
  assert.notEqual(stateOf(empty).coreLocation, "relay");
  assert.equal(stateOf(empty).delivered, false);
    assert.match(String(stateOf(empty).error), /空手|没有|插槽|relay|物件|empty/i);

  const carried = new Runtime(level, cloneProgram(level.solution));
  const carriedResult = await runToTerminal(carried);
  assert.equal(carriedResult.ok, true);
  assert.equal(stateOf(carried).relayInstalled, true);
  assert.equal(stateOf(carried).coreLocation, "relay");
  assert.equal(stateOf(carried).delivered, true);
  assert.equal(stateOf(carried).unitNode, "relay");
});

test("runtime events carry authored source identity and stay on authored edges", () => {
  for (const level of levels) {
    const runtime = new Runtime(level, cloneProgram(level.solution));
    const edges = new Set(level.scene.edges.map((edge) => edge.join("→")));
    assert.ok(runtime.events.length > 0, `level ${level.id} should emit events`);
    for (const event of runtime.events) {
      assert.equal(typeof event.instructionId, "string");
      assert.ok(Number.isInteger(event.sourceLine) && event.sourceLine >= 1);
      assert.ok(Number.isInteger(event.displayLine) && event.displayLine >= 1);
      if (event.kind === "traverse") {
        const { from, to } = event.payload || {};
        assert.ok(edges.has(`${from}→${to}`));
      }
    }
  }
});
