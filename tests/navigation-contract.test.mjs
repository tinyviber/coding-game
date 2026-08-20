import test from "node:test";
import assert from "node:assert/strict";
import * as levelsApi from "../src/levels.js";
import { LEVEL_IDS, groupLevelsByMapGroup } from "../src/levels.js";
import {
  LEVEL_ROUTE_PREFIX,
  isLevelRoute,
  levelRoute,
  parseLevelRoute,
  resolveLevelRoute,
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
  const metadataIds = levels.map((level) => level.id);
  assert.equal(Object.isFrozen(LEVEL_IDS), true, "LEVEL_IDS must be immutable");
  assert.deepEqual(LEVEL_IDS, metadataIds, "LEVEL_IDS must derive from level metadata");
  assert.deepEqual(metadataIds, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(metadataIds).size, metadataIds.length);

  for (const id of LEVEL_IDS) {
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

test("route resolver prefers explicit routes and canonicalizes invalid or root routes", () => {
  requireFunction("resolveLevelRoute", resolveLevelRoute);
  const ids = [1, 3, 5];

  assert.deepEqual(resolveLevelRoute("#/level/3", 5, ids), {
    levelId: 3,
    route: "#/level/3",
    explicit: true,
    needsCanonicalize: false,
  });
  assert.deepEqual(resolveLevelRoute("#/level/999", 5, ids), {
    levelId: 5,
    route: "#/level/5",
    explicit: false,
    needsCanonicalize: true,
  });
  assert.deepEqual(resolveLevelRoute("", 5, ids), {
    levelId: 5,
    route: "#/level/5",
    explicit: false,
    needsCanonicalize: true,
  });
  assert.deepEqual(resolveLevelRoute("#", 5, ids), {
    levelId: 5,
    route: "#/level/5",
    explicit: false,
    needsCanonicalize: true,
  });
  assert.deepEqual(resolveLevelRoute("#/level/999", 99, ids), {
    levelId: 1,
    route: "#/level/1",
    explicit: false,
    needsCanonicalize: true,
  });
});

test("next-level progression is a pure circular numeric mapping", () => {
  requireFunction("getNextLevelId", getNextLevelId);

  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((id) => getNextLevelId(id)),
    [2, 3, 4, 5, 6, 7, 8, 1],
  );
  assert.equal(getNextLevelId(8), 1, "level 8 must wrap to level 1");
});

test("canonical levels retain the accepted Flow/Memory/Choice map groups", () => {
  requireFunction("getLevels", getLevels);
  requireFunction("groupLevelsByMapGroup", groupLevelsByMapGroup);
  assert.deepEqual(
    groupLevelsByMapGroup(getLevels()).map((group) => [group.key, group.levels.map((level) => level.id)]),
    [["flow", [1, 2]], ["memory", [3, 4]], ["choice", [5, 6, 7, 8]]],
  );
});

test("level 6 keeps label as its canonical memory identity", () => {
  requireFunction("getLevelById", getLevelById);
  const level = getLevelById(6);
  assert.deepEqual(level.memoryNames, ["label"]);
  assert.doesNotMatch(JSON.stringify(level), /\bcargo\b/i);
});
