import test from "node:test";
import assert from "node:assert/strict";
import { LEVEL_IDS } from "../src/levels.js";

const progressApi = await import("../src/progress.js");
const { loadProgress, saveProgress } = progressApi;

const DEFAULT_PROGRESS = Object.freeze({
  version: 1,
  completedLevelIds: [],
  lastPlayedLevelId: null,
  introSeen: false,
});

function makeStorage(raw = null, { readError = false, writeError = false } = {}) {
  const calls = [];
  return {
    calls,
    getItem(key) {
      calls.push(["getItem", key]);
      if (readError) throw new Error("read failed");
      return raw;
    },
    setItem(key, value) {
      calls.push(["setItem", key, value]);
      if (writeError) throw new Error("write failed");
      this.raw = value;
    },
    clear() {
      calls.push(["clear"]);
      throw new Error("clear must not be used");
    },
    removeItem(key) {
      calls.push(["removeItem", key]);
      throw new Error("removeItem must not be used");
    },
    raw,
  };
}

function assertDefault(progress) {
  assert.deepEqual(progress, DEFAULT_PROGRESS);
}

function read(storage) {
  return loadProgress(storage, LEVEL_IDS);
}

function write(progress, storage) {
  return saveProgress(progress, storage, LEVEL_IDS);
}

function assertProgressApi() {
  assert.equal(typeof loadProgress, "function", "progress.js must export loadProgress");
  assert.equal(typeof saveProgress, "function", "progress.js must export saveProgress");
}

test("loadProgress is pure and returns the v1 default without storage writes", () => {
  assertProgressApi();
  const storage = makeStorage();
  assertDefault(read(storage));
  assert.deepEqual(storage.calls.map(([method]) => method), ["getItem"]);
});

test("valid progress round-trips only the v1 progress schema", () => {
  assertProgressApi();
  const source = {
    version: 1,
    completedLevelIds: [1, 4, 8],
    lastPlayedLevelId: 4,
    introSeen: true,
  };
  const storage = makeStorage();
  assert.doesNotThrow(() => write(source, storage));
  assert.equal(storage.calls.filter(([method]) => method === "setItem").length, 1);

  const [method, key, serialized] = storage.calls.find(([name]) => name === "setItem");
  assert.equal(method, "setItem");
  assert.ok(key, "saveProgress must use a stable storage key");
  const persisted = JSON.parse(serialized);
  assert.deepEqual(persisted, source);
  assert.equal("code" in persisted, false);
  assert.equal("runtime" in persisted, false);

  const reloaded = read(makeStorage(serialized));
  assert.deepEqual(reloaded, source);
});

test("malformed, old, and structurally invalid data falls back without clearing storage", () => {
  assertProgressApi();
  const invalidValues = [
    "not-json",
    JSON.stringify({ version: 0, completedLevelIds: [1], lastPlayedLevelId: 1, introSeen: true }),
    JSON.stringify({ version: 1, completedLevelIds: [1, 1, 9], lastPlayedLevelId: 9, introSeen: true }),
    JSON.stringify({ version: 1, completedLevelIds: "1", lastPlayedLevelId: 1, introSeen: true }),
    JSON.stringify({ version: 1, completedLevelIds: [1], lastPlayedLevelId: 1, introSeen: "yes" }),
  ];

  for (const raw of invalidValues) {
    const storage = makeStorage(raw);
    assertDefault(read(storage));
    assert.deepEqual(storage.calls.map(([method]) => method), ["getItem"]);
  }
});

test("storage read and write failures are contained and never invoke clear/removeItem", () => {
  assertProgressApi();
  const unreadable = makeStorage(null, { readError: true });
  assert.doesNotThrow(() => assertDefault(read(unreadable)));
  assert.deepEqual(unreadable.calls.map(([method]) => method), ["getItem"]);

  const unwritable = makeStorage(null, { writeError: true });
  assert.doesNotThrow(() => write(DEFAULT_PROGRESS, unwritable));
  assert.deepEqual(unwritable.calls.map(([method]) => method), ["setItem"]);
});
