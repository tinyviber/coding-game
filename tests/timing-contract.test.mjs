import test from "node:test";
import assert from "node:assert/strict";
import { getLevels, cloneProgram, reorderProgram } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";
import { WorldView } from "../src/world.js";

function fakeCanvas() {
  const context = { font: "", setTransform() {} };
  return {
    getContext() { return context; },
    getBoundingClientRect() { return { width: 640, height: 448 }; },
  };
}

test("WorldView cancels the prior beat and ignores its stale completion callback", () => {
  const originalPerformance = globalThis.performance;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let time = 0;
  let nextFrame = 0;
  const callbacks = new Map();
  const cancelled = [];

  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => time } });
  globalThis.requestAnimationFrame = (callback) => {
    nextFrame += 1;
    callbacks.set(nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (frame) => {
    cancelled.push(frame);
  };

  try {
    const world = new WorldView(fakeCanvas(), null);
    world.render = () => {};
    const level = getLevels()[0];
    let staleDone = 0;
    let currentDone = 0;

    world.playBeat(level, { type: "flow", caption: "old", duration: 5 }, () => { staleDone += 1; });
    const staleFrame = world.beatFrame;
    world.playBeat(level, { type: "flow", caption: "new", duration: 5 }, () => { currentDone += 1; });
    const currentFrame = world.beatFrame;

    assert.notEqual(staleFrame, currentFrame);
    assert.deepEqual(cancelled, [staleFrame]);
    callbacks.get(staleFrame)?.(10);
    assert.equal(staleDone, 0);

    time = 10;
    callbacks.get(currentFrame)?.(time);
    assert.equal(currentDone, 1);
    assert.equal(world.beat, null);
    assert.equal(world.beatFrame, 0);
  } finally {
    Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance });
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("Runtime reset returns to an idle zero-cursor state while preserving editor edits", () => {
  const level = getLevels()[0];
  const starter = cloneProgram(level.starterProgram);
  const edited = reorderProgram(level, starter, 2, -1);
  const runtime = new Runtime(level, starter);

  assert.equal(runtime.setProgram(edited), true);
  assert.equal(runtime.stepOnce(), true);
  assert.notEqual(runtime.eventCursor, 0);

  runtime.reset();
  assert.equal(runtime.getState().phase, "idle");
  assert.equal(runtime.eventCursor, 0);
  assert.deepEqual(runtime.getProgram(), edited);
  assert.equal(runtime.getState().activeLine, 0);
});
