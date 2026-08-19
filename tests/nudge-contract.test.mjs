import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

test("旧 starter nudge 不再属于产品流程", async () => {
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  const main = await readFile(join(repoRoot, "src/main.js"), "utf8");
  assert.doesNotMatch(html, /starterNudge|dismissNudge/);
  assert.doesNotMatch(main, /starterNudge|dismissNudge|nudge-target|demoProgram/);
});

test("Hint 按点击次数渐进且初始不泄露第一条提示", async () => {
  const main = await readFile(join(repoRoot, "src/main.js"), "utf8");
  assert.match(main, /hintIndexes/);
  assert.match(main, /hintSteps/);
  assert.match(main, /nextIndex/);
  assert.match(main, /data-app-ready/);
});
