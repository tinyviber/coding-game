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
  /原子交付/,
  /原子操作/,
  /消费数据/,
  /数据消费/,
  /直连轨道/,
  /Choice 链/,
  /完整链路/,
  /当前状态满足要求/,
  /动作发生的时机/,
  /正在询问一个值/,
  /接收这份数据/,
  /完成一次 update/i,
  /执行 (?:branch|write)/i,
  /\bpayload\b/i,
  /\brelay_core\b/i,
  /\b(?:relay|dawn|light)\b/i,
  /\b(?:move|pickup|deliver|update|branch|write)\b/i,
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
