import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

async function sourceFiles() {
  const names = (await readdir(join(repoRoot, "src"))).filter((name) => name.endsWith(".js"));
  return Promise.all(names.map((name) => readFile(join(repoRoot, "src", name), "utf8")));
}

function visibleText(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("starter nudge has observe/try copy without modal or inert behavior", async () => {
  const html = await readFile(join(repoRoot, "index.html"), "utf8");
  assert.match(html, /id=["']starterNudge["']/);
  assert.match(html, /id=["']dismissNudge["']/);

  const start = html.indexOf("starterNudge");
  const tagStart = html.lastIndexOf("<", start);
  const tagEnd = html.indexOf(">", start);
  const nudgeOpenTag = html.slice(tagStart, tagEnd + 1);
  assert.match(nudgeOpenTag, /role=["']note["']/i);
  assert.doesNotMatch(nudgeOpenTag, /role=["']dialog["']|aria-modal|\binert\b/i);

  const main = await readFile(join(repoRoot, "src/main.js"), "utf8");
  assert.match(main, /["']observe["']/i);
  assert.match(main, /["']try["']/i);
  const guidance = [...main.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map((match) => match[2])
    .filter((text) => /observe|try|观察|尝试|试试/i.test(text));
  assert.ok(guidance.length >= 2, "observe/try guidance must have source text");
  assert.ok(guidance.some((text) => text.length > 4 && /observe|观察/i.test(text)), "observe guidance source missing");
  assert.ok(guidance.some((text) => text.length > 4 && /try|尝试|试试/i.test(text)), "try guidance source missing");
  assert.ok(guidance.every((text) => text.length <= 120), "nudge guidance should stay short");
  assert.match(main, /nudge-target/);
  assert.match(main, /nudge-target-control/);

  const visible = visibleText(html);
  assert.doesNotMatch(visible, /\b(?:CYBER(?:PUNK)?|NEON|RETRO|GLITCH|HACKER|MATRIX|TERMINAL|SYSTEM\s+ONLINE|BOOT\s+SEQUENCE)\b/i);
});

test("starter nudge exposes dismiss persistence and app-ready lifecycle hooks", async () => {
  const source = (await sourceFiles()).join("\n");
  assert.match(source, /starterNudge/);
  assert.match(source, /dismissNudge/);
  const hasNudgePersistenceHelper = /(?:read|load|get|is|has)[A-Za-z]*Nudge(?:Dismissed|Hidden|State)|(?:persist|save|set|write)[A-Za-z]*Nudge(?:Dismissed|Hidden|State)/i.test(source);
  const hasStorageBackend = /localStorage|sessionStorage/i.test(source);
  assert.ok(hasNudgePersistenceHelper || hasStorageBackend, "nudge needs persistence abstraction or storage backend");
  assert.match(source, /data-app-ready/);
  assert.match(source, /addEventListener\s*\(/);
});
