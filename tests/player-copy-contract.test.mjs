import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneProgram, getLevels } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const levels = getLevels();

const PLAYER_COPY_FIELDS = [
  ["title", (level) => [level.title]],
  ["story", (level) => [level.story]],
  ["goal", (level) => [level.goal]],
  ["help", (level) => [level.help]],
  ["hintSteps", (level) => level.hintSteps || []],
  ["failureCases.message", (level) => (level.failureCases || []).map((failure) => failure.message)],
  ["successTitle", (level) => [level.successTitle]],
  ["successText", (level) => [level.successText]],
  ["lawBeat.caption", (level) => [level.lawBeat?.caption || ""]],
];

const FORBIDDEN_PLAYER_COPY = [
  /送出\s*energy/i,
  /写进\s*energy/i,
  /送进暗路/,
  /写进去的数值/,
  /原子交付/,
  /完成一次交付/,
  /原子操作/,
  /消费数据/,
  /数据消费/,
  /直连轨道/,
  /真实含义/,
  /Choice 链/,
  /完整链路/,
  /数据载荷/,
  /当前状态满足要求/,
  /动作发生的时机/,
  /正在询问一个值/,
  /接收这份数据/,
  /完成一次 update/i,
  /执行 (?:branch|write)/i,
  /\bpayload\b/i,
  /\bcargo\b/i,
  /\bupdate\b/i,
  /\brelay_core\b/i,
  /\broute\b/i,
  /\b(?:relay|dawn|light)\b/i,
  /\b(?:move|pickup|deliver|update|branch|write)\b/i,
];

const FORBIDDEN_RUNTIME_COPY = [
  ...FORBIDDEN_PLAYER_COPY,
  /\b(?:relay_core|cargo|update)\b/i,
];

function authoredPlayerCopy(level) {
  return PLAYER_COPY_FIELDS.flatMap(([field, read]) => read(level).map((text, index) => ({
    field: index === 0 ? field : `${field}[${index}]`,
    text,
  })));
}

test("all eight levels keep authored player copy free of implementation vocabulary", () => {
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);

  for (const level of levels) {
    for (const { field, text } of authoredPlayerCopy(level)) {
      assert.equal(typeof text, "string", `level ${level.id} ${field} must be text`);
      for (const forbidden of FORBIDDEN_PLAYER_COPY) {
        assert.doesNotMatch(text, forbidden, `level ${level.id} ${field} contains forbidden player copy: ${text}`);
      }
    }
  }
});

test("player-render paths do not format authored copy through world-token replacement", async () => {
  const [main, runtime] = await Promise.all([
    readFile(join(repoRoot, "src", "main.js"), "utf8"),
    readFile(join(repoRoot, "src", "runtime.js"), "utf8"),
  ]);

  for (const [name, source] of [["main", main], ["runtime", runtime]]) {
    assert.doesNotMatch(source, /\bformatWorldText\s*\(/, `${name} must not format player-rendered copy`);
  }
});

test("Choice transfer events carry semantics without an authored event-copy field", () => {
  const runtime = new Runtime(levels[4], cloneProgram(levels[4].solution));

  for (const kind of ["token-traverse", "gate-consume"]) {
    const event = runtime.events.find((candidate) => candidate.kind === kind);
    assert.ok(event, `Choice solution should emit ${kind}`);
    assert.equal(Object.hasOwn(event, "copy"), false, `${kind} must not require authored copy`);
    assert.equal(Object.hasOwn(event, "text"), false, `${kind} must not require authored copy`);
  }
});

function runStepwise(runtime) {
  const observations = [];
  while (!["success", "error"].includes(runtime.state.phase)) {
    const event = runtime.events[runtime.state.eventCursor];
    assert.ok(event, "runtime must expose the next event before stepping");
    assert.equal(runtime.stepOnce(), true, `event ${event.kind} should be step-able`);
    observations.push({ kind: event.kind, event: runtime.state.event, error: runtime.state.error });
  }
  return observations;
}

function assertNaturalRuntimeCopy(text, label) {
  assert.equal(typeof text, "string", `${label} must be text`);
  for (const forbidden of FORBIDDEN_RUNTIME_COPY) {
    assert.doesNotMatch(text, forbidden, `${label} contains forbidden runtime copy: ${text}`);
  }
}

test("solution runtime events and errors do not expose implementation vocabulary", () => {
  for (const level of levels) {
    const runtime = new Runtime(level, cloneProgram(level.solution));
    const observations = runStepwise(runtime);

    for (const [index, observation] of observations.entries()) {
      assertNaturalRuntimeCopy(observation.event, `level ${level.id} event ${index}`);
      assertNaturalRuntimeCopy(observation.error, `level ${level.id} error ${index}`);
      if (["token-traverse", "gate-consume"].includes(observation.kind)) {
        assert.equal(observation.event, "", `level ${level.id} ${observation.kind} should be silent`);
      }
    }
    assert.equal(runtime.state.phase, "success", `level ${level.id} solution should succeed`);
    assert.equal(runtime.state.error, "", `level ${level.id} solution should not expose an error`);
  }
});

test("Level 4 keeps the calculation event human-facing and its failure copy free of update", () => {
  const successRuntime = new Runtime(levels[3], cloneProgram(levels[3].solution));
  const observations = runStepwise(successRuntime);
  const calculation = observations.find(({ kind }) => kind === "calculate");
  assert.ok(calculation, "Level 4 solution should expose a calculation event");
  assert.equal(calculation.event, "energy 从 1 变成 2");
  assert.doesNotMatch(calculation.event, /\bupdate\b/i);

  const failureRuntime = new Runtime(levels[3], cloneProgram(levels[3].starterProgram));
  const failureState = failureRuntime.runToEnd();
  assert.equal(failureState.phase, "error");
  assert.match(failureState.error, /energy|能量/);
  assert.doesNotMatch(failureState.error, /\bupdate\b/i);
  assertNaturalRuntimeCopy(failureState.event, "level 4 failure event");
});

test("Level 6 keeps labels natural on success and on an empty-memory failure", () => {
  const level = levels[5];
  const successRuntime = new Runtime(level, cloneProgram(level.solution));
  const successState = successRuntime.runToEnd();
  assert.equal(successState.phase, "success");
  assert.match(successState.event, /标签|亮路/);
  assertNaturalRuntimeCopy(successState.event, "level 6 success event");

  const emptyMemoryRuntime = new Runtime(level, {
    instructions: [
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
  });
  const failureState = emptyMemoryRuntime.runToEnd();
  assert.equal(failureState.phase, "error");
  assert.match(failureState.error, /空|没有/);
  assertNaturalRuntimeCopy(failureState.error, "level 6 empty-memory error");
  assertNaturalRuntimeCopy(failureState.event, "level 6 empty-memory event");
});
