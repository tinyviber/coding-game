import test from "node:test";
import assert from "node:assert/strict";
import * as levelsApi from "../src/levels.js";
import {
  LEVEL_ROUTE_PREFIX,
  isLevelRoute,
  levelRoute,
  parseLevelRoute,
  routeForLevel,
} from "../src/navigation.js";

const { getLevels, getLevelById, getNextLevelId } = levelsApi;

function requireFunction(name, value) {
  assert.equal(typeof value, "function", `${name} must be a public helper`);
}

test("canonical levels expose stable numeric IDs and lookup is not index-based", () => {
  requireFunction("getLevels", getLevels);
  requireFunction("getLevelById", getLevelById);

  const levels = getLevels();
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(levels.map((level) => level.id)).size, 8);

  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const level = getLevelById(id);
    assert.equal(level?.id, id, `lookup for level ${id} must return its numeric ID`);
  }
});

test("navigation accepts only canonical hash routes and never treats clean paths as level routes", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(LEVEL_ROUTE_PREFIX, "#/level/");
  assert.equal(levelRoute(3), "#/level/3");
  assert.equal(routeForLevel(8), "#/level/8");
  assert.equal(parseLevelRoute("#/level/3", ids), 3);
  assert.equal(isLevelRoute("#/level/8", ids), true);

  for (const hash of ["", "#", "#/", "#/level/0", "#/level/9", "#/level/03", "#/level/1/", "/level/3", "/index.html/level/3"]) {
    assert.equal(parseLevelRoute(hash, ids), null, `must reject ${hash || "empty hash"}`);
    assert.equal(isLevelRoute(hash, ids), false, `must reject ${hash || "empty hash"}`);
  }
});

test("next-level progression is a pure circular numeric mapping", () => {
  requireFunction("getNextLevelId", getNextLevelId);

  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((id) => getNextLevelId(id)),
    [2, 3, 4, 5, 6, 7, 8, 1],
  );
  assert.equal(getNextLevelId(8), 1, "level 8 must wrap to level 1");
});

test("canonical levels retain the accepted Flow/Memory/Choice groups", () => {
  requireFunction("getLevels", getLevels);

  const groupOf = (level) => level.group || level.zone?.split(" · ").at(-1);
  const grouped = new Map();
  for (const level of getLevels()) {
    const group = groupOf(level);
    assert.ok(group, `level ${level.id} needs a map group`);
    const ids = grouped.get(group) || [];
    ids.push(level.id);
    grouped.set(group, ids);
  }

  assert.deepEqual(grouped.get("Flow"), [1, 2]);
  assert.deepEqual(grouped.get("Memory"), [3, 4]);
  assert.deepEqual(grouped.get("Choice"), [5, 6, 7, 8]);
  assert.deepEqual([...grouped.keys()], ["Flow", "Memory", "Choice"]);
});

test("level 6 keeps label as its canonical memory identity", () => {
  requireFunction("getLevelById", getLevelById);
  const level = getLevelById(6);
  assert.deepEqual(level.memoryNames, ["label"]);
  assert.doesNotMatch(JSON.stringify(level), /\bcargo\b/i);
});
