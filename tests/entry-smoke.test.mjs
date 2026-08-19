import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const entryPath = join(repoRoot, "index.html");

test("entry document exposes playable controls and story surfaces", async () => {
  const html = await readFile(entryPath, "utf8");
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

  const appReadyMarkup = html.match(/\bdata-app-ready(?:\s*=\s*["'][^"']*["'])?/);
  if (appReadyMarkup) {
    assert.match(html, /data-app-ready=["']false["']/);
    const main = await readFile(join(repoRoot, "src/main.js"), "utf8");
    assert.match(main, /setAttribute\(["']data-app-ready["']\s*,\s*["']true["']\)/);
  }
});

test("production source contains no arbitrary string code execution", async () => {
  const files = ["src/levels.js", "src/runtime.js", "src/main.js", "src/world.js", "src/code-panel.js"];
  const source = await Promise.all(files.map((file) => readFile(join(repoRoot, file), "utf8")));
  const joined = source.join("\n");
  assert.doesNotMatch(joined, /\beval\s*\(/);
  assert.doesNotMatch(joined, /\bnew\s+Function\s*\(/);
  assert.doesNotMatch(joined, /\bFunction\s*\(/);
});
