import test from "node:test";
import assert from "node:assert/strict";
import { cloneProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";

const levels = getLevels();

function run(runtime) {
  return runtime.runToEnd();
}

test("所有 solution 都能完成，starter 都会在真实世界规则上失败", async () => {
  for (const level of levels) {
    const solved = new Runtime(level, cloneProgram(level.solution));
    assert.equal((await run(solved)).success, true, `level ${level.id} solution should succeed`);
    const starter = new Runtime(level, cloneProgram(level.starterProgram));
    assert.equal((await run(starter)).success, false, `level ${level.id} starter should fail`);
  }
});

test("Runtime events carry stable source identity and authored edges", () => {
  for (const level of levels) {
    const runtime = new Runtime(level, cloneProgram(level.solution));
    const edges = new Set(level.scene.edges.map((edge) => edge.join("→")));
    assert.ok(runtime.events.length > 0);
    for (const event of runtime.events) {
      assert.equal(typeof event.instructionId, "string");
      assert.ok(Number.isInteger(event.sourceLine));
      if (event.kind === "traverse") assert.ok(edges.has(`${event.from}→${event.to}`));
    }
  }
});
