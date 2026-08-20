import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

test("entry document exposes playable controls and story surfaces", async () => {
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  for (const id of [
    "worldCanvas",
    "worldMirror",
    "codeLines",
    "runButton",
    "pauseButton",
    "stepButton",
    "resetButton",
    "hintButton",
    "nextButton",
    "levelCard",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} missing`);
  }
  assert.match(html, /<script[^>]+src=["']\.\/src\/main\.js["']/);
  assert.match(html, /data-app-ready=["']false["']/);
});

test("execution source has no explicit read/Reader instruction surface or arbitrary code execution", async () => {
  const names = ["levels.js", "runtime.js", "world.js", "code-panel.js"];
  const source = await Promise.all(names.map((name) => readFile(join(repoRoot, "src", name), "utf8")));
  const joined = source.join("\n");
  assert.doesNotMatch(joined, /(?:type|kind|op)\s*:\s*["']read["']/);
  assert.doesNotMatch(joined, /(?:id|type|kind|target|to)\s*:\s*["']reader["']/i);
  assert.doesNotMatch(joined, /\.type\s*===?\s*["']read(?:er)?["']/i);
  assert.doesNotMatch(joined, /\beval\s*\(/);
  assert.doesNotMatch(joined, /\bnew\s+Function\s*\(/);
  assert.doesNotMatch(joined, /\bFunction\s*\(/);
  assert.doesNotMatch(joined, /\b(?:Cycle|Collection)\b/);
  assert.doesNotMatch(joined, /\blegacy\b/i);
});

test("production source does not auto-run a demo or expose retired compatibility names", async () => {
  const names = (await readdir(join(repoRoot, "src"))).filter((name) => name.endsWith(".js"));
  const source = await Promise.all(names.map((name) => readFile(join(repoRoot, "src", name), "utf8")));
  const joined = source.join("\n");
  assert.doesNotMatch(joined, /demoProgram|runDemo|playDemo/);
  assert.doesNotMatch(joined, /pickup_signal|readEquals/);
});
