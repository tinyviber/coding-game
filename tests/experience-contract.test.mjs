import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { edgeControlPoints, pointOnEdge } from "../src/geometry.js";
import { getLevels, normalizeProgram } from "../src/levels.js";
import { Runtime } from "../src/runtime.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const levels = getLevels();

const authoredPrograms = (level) => [
  ["starterProgram", level.starterProgram],
  ["solution", typeof level.solution === "function" ? level.solution(level.starterProgram) : level.solution],
];

const instructionsOf = (program) => program.instructions;

async function source(path) {
  return readFile(join(repoRoot, path), "utf8");
}

test("authored instructions and runtime events have stable source identity", () => {
  for (const level of levels) {
    for (const [programName, program] of authoredPrograms(level)) {
      const authoredIds = instructionsOf(program).map((instruction) => instruction.id);
      assert.ok(authoredIds.every((id) => typeof id === "string" && id.length > 0), `level ${level.id} ${programName} authored instructions need ids`);
      assert.equal(new Set(authoredIds).size, authoredIds.length, `level ${level.id} ${programName} authored ids must be unique`);
      const first = normalizeProgram(level, structuredClone(program));
      const second = normalizeProgram(level, structuredClone(program));
      const firstIds = instructionsOf(first).map((instruction) => instruction.id);
      const secondIds = instructionsOf(second).map((instruction) => instruction.id);

      assert.ok(firstIds.length > 0, `level ${level.id} ${programName} needs instructions`);
      assert.ok(firstIds.every((id) => typeof id === "string" && id.length > 0), `level ${level.id} ${programName} needs instruction ids`);
      assert.equal(new Set(firstIds).size, firstIds.length, `level ${level.id} ${programName} ids must be unique`);
      assert.deepEqual(secondIds, firstIds, `level ${level.id} ${programName} ids must be stable`);

      const runtime = new Runtime(level, first);
      for (const event of runtime.events) {
        assert.equal(typeof event.instructionId, "string", `level ${level.id} event needs instructionId`);
        assert.ok(Number.isInteger(event.sourceLine) && event.sourceLine >= 1, `level ${level.id} event needs sourceLine`);
        assert.equal(event.instructionId, first.instructions[event.sourceLine - 1].id);
      }
    }
  }
});

test("each level exposes generic rules, named memory, and non-answer-leading hints", () => {
  const genericRuleTypes = new Set([
    "all",
    "atNode",
    "branchOperator",
    "branchTaken",
    "carried",
    "executedInOrder",
    "memoryEquals",
    "readEquals",
  ]);
  const directAnswerPatterns = [
    /==|[<>]/,
    /\b(?:correct|solution|answer|答案|正确答案)\b/i,
    /\b(?:set|use|choose|选择|设置)\b[^.。!?！?]{0,24}\b(?:\d+|==|[<>])\b/i,
  ];

  for (const level of levels) {
    assert.ok(Array.isArray(level.successRules) && level.successRules.length > 0, `level ${level.id} needs successRules`);
    const visitRules = (rules) => {
      for (const rule of rules) {
        assert.ok(genericRuleTypes.has(rule.type), `level ${level.id} has non-generic rule ${rule.type}`);
        if (rule.type === "all") visitRules(rule.rules || []);
      }
    };
    visitRules(level.successRules);

    assert.ok(Array.isArray(level.memoryNames) && level.memoryNames.length > 0, `level ${level.id} needs memoryNames`);
    assert.ok(Array.isArray(level.hintSteps) && level.hintSteps.length > 0, `level ${level.id} needs hintSteps`);
    for (const hint of level.hintSteps) {
      assert.equal(typeof hint, "string");
      assert.ok(hint.trim().length > 0, `level ${level.id} has an empty hint`);
      assert.ok(!directAnswerPatterns.some((pattern) => pattern.test(hint)), `level ${level.id} hint exposes a direct answer: ${hint}`);
    }
    assert.ok(Number.isFinite(level.dawnProgress), `level ${level.id} needs dawnProgress`);
    assert.ok(level.worldRules && typeof level.worldRules === "object", `level ${level.id} needs worldRules`);
    if (level.law) assert.ok(level.lawBeat, `level ${level.id} law needs lawBeat`);
  }
});

test("branch editor choices come from each scene's outgoing paths", () => {
  const branchOptions = (level) => {
    const line = level.code(level.starterProgram).find((item) => item.instructionType === "branch");
    return line.parts.find((part) => part.type === "select" && part.ariaLabel === "成立路线")?.options;
  };

  assert.deepEqual(branchOptions(levels[6]), ["light", "dark"]);
  assert.deepEqual(branchOptions(levels[7]), ["dawn", "dark"]);
});

test("main UI does not reference demoProgram or auto-run a demo", async () => {
  const main = await source("src/main.js");
  assert.doesNotMatch(main, /demoProgram/);
  assert.doesNotMatch(main, /\.(?:demo|runDemo|playDemo)\s*\(/);
});

test("read creates a data token and a matching branch consumes it", () => {
  const level = levels.find((item) => item.memoryNames.includes("cargo"));
  const program = {
    instructions: [
      { id: "write_token", type: "write", name: "cargo", value: { type: "literal", value: "token" } },
      { id: "read_token", type: "read", name: "cargo" },
      { id: "match_token", type: "branch", left: { type: "memory", name: "cargo" }, operator: "==", right: { type: "literal", value: "token" }, pass: "light", fail: "dark" },
    ],
  };
  const runtime = new Runtime(level, program);

  while (runtime.events[runtime.state.eventCursor]?.kind !== "read") runtime.step();
  runtime.step();
  assert.deepEqual(runtime.state.dataToken, { name: "cargo", value: "token" });
  while (runtime.events[runtime.state.eventCursor]?.kind !== "branch-receive") runtime.step();
  runtime.step();
  assert.deepEqual(runtime.state.dataToken, { name: "cargo", value: "token" }, "branch must not clear the token before Gate receives it");
  assert.equal(runtime.state.tokenTransfer.phase, "gate-received");
  runtime.step();
  assert.equal(runtime.state.comparison.path, "");
  assert.equal(runtime.state.tokenTransfer.phase, "gate-received");
  runtime.step();
  assert.deepEqual(runtime.state.comparison, { left: "token", operator: "==", right: "token", result: true, path: "light" });
  assert.equal(runtime.state.path, "light");
  assert.equal(runtime.state.tokenTransfer.phase, "route-selected");
  assert.deepEqual(runtime.state.readPending, { name: "cargo", value: "token", node: "reader" });
  runtime.step();
  assert.equal(runtime.state.tokenTransfer.phase, "consumed");
  assert.equal(runtime.state.readPending, null);
});

test("reset clears runtime dataToken and activeEdge", () => {
  const level = levels.find((item) => item.memoryNames.includes("cargo"));
  const program = {
    instructions: [
      { id: "write_token", type: "write", name: "cargo", value: { type: "literal", value: "token" } },
      { id: "read_token", type: "read", name: "cargo" },
    ],
  };
  const runtime = new Runtime(level, program);
  while (runtime.events[runtime.state.eventCursor]?.kind !== "traverse" || runtime.events[runtime.state.eventCursor]?.from !== "memory") runtime.step();
  runtime.beginEvent(runtime.events[runtime.state.eventCursor]);
  assert.deepEqual(runtime.state.dataToken, { name: "cargo", value: "token" });
  assert.deepEqual(runtime.state.activeEdge, { from: "memory", to: "reader" });

  runtime.reset();
  assert.equal(runtime.state.dataToken, null);
  assert.equal(runtime.state.activeEdge, null);
});

test("expanded traversal uses only authored directed edges and preserves one source line", () => {
  const level = levels[0];
  const runtime = new Runtime(level, level.starterProgram);
  const moveEvents = runtime.events.filter((event) => event.kind === "traverse" && event.instructionId === "move_charge");
  assert.deepEqual(moveEvents.map((event) => [event.from, event.to]), [["dock", "pickup"], ["pickup", "charge"]]);
  assert.ok(moveEvents.every((event) => event.sourceLine === 1 && event.line === 1));
  const authored = new Set(level.scene.edges.map((edge) => edge.join("→")));
  assert.ok(runtime.events.filter((event) => event.kind === "traverse").every((event) => authored.has(`${event.from}→${event.to}`)));
});

test("write/update commit at Memory action, not before the traversal", () => {
  const level = levels[3];
  const runtime = new Runtime(level, level.solution);
  while (runtime.events[runtime.state.eventCursor]?.kind !== "write-receive") runtime.step();
  assert.deepEqual(runtime.state.vars, {});
  runtime.step();
  assert.deepEqual(runtime.state.vars, {});
  assert.equal(runtime.state.tokenTransfer.phase, "memory-received");
  runtime.step();
  assert.equal(runtime.state.vars.energy, 1);
  while (runtime.events[runtime.state.eventCursor]?.kind !== "update-read") runtime.step();
  assert.equal(runtime.state.vars.energy, 1);
  runtime.step();
  assert.equal(runtime.state.tokenTransfer.phase, "update-read");
  assert.equal(runtime.state.dataToken.value, 1);
  runtime.step();
  assert.equal(runtime.state.vars.energy, 2);
  assert.equal(runtime.state.tokenTransfer.phase, "memory");
});

test("token animation edges are always authored scene edges", () => {
  for (const level of levels.filter((item) => item.scene.branchNode)) {
    const runtime = new Runtime(level, level.solution);
    const authored = new Set(level.scene.edges.map((edge) => edge.join("→")));
    while (runtime.state.eventCursor < runtime.events.length) {
      const event = runtime.events[runtime.state.eventCursor];
      runtime.beginEvent(event);
      const edge = runtime.state.tokenAnimation?.edge;
      if (edge) assert.ok(authored.has(`${edge.from}→${edge.to}`), `level ${level.id} token uses an unauthored edge`);
      if (runtime.state.phase === "error") break;
      runtime.completeEvent();
    }
  }
});

test("editable slots target stable instruction IDs, not duplicate instruction types", async () => {
  const level = { ...levels[2] };
  level.editableSlots = [
    { id: "first", instructionId: "write_first", path: "value.value", type: "number" },
    { id: "second", instructionId: "write_second", path: "value.value", type: "number" },
  ];
  const program = { instructions: [
    { id: "write_first", type: "write", name: "energy", value: { type: "literal", value: 1 } },
    { id: "write_second", type: "write", name: "energy", value: { type: "literal", value: 2 } },
  ] };
  const { applyEdit } = await import("../src/levels.js");
  const next = applyEdit(level, program, { instructionId: "write_second", path: "value.value" }, 7);
  assert.equal(next.instructions[0].value.value, 1);
  assert.equal(next.instructions[1].value.value, 7);
  const ignored = applyEdit(level, program, { index: 0, path: "value.value" }, 9);
  assert.equal(ignored.instructions[0].value.value, 1, "editable changes without instructionId must be ignored");
});

test("Choice legacy conversion does not translate an unrelated alias into a world path", async () => {
  const levelsSource = await source("src/levels.js");
  assert.doesNotMatch(levelsSource, /target\s*===\s*["']blue["']/);
  assert.doesNotMatch(levelsSource, /target\s*===\s*["']blue["'][^\n]*["']light["']/);
});

test("pointOnEdge follows the authored cubic curve", () => {
  const edge = edgeControlPoints({ x: 0, y: 0 }, { x: 1, y: 1 });
  assert.equal(edge.curved, true);
  const point = pointOnEdge(edge, 0.25);
  assert.ok(Math.abs(point.x - 0.2828125) < 1e-12);
  assert.ok(Math.abs(point.y - 0.15625) < 1e-12);
  assert.notEqual(point.y, 0.25, "a curved edge must not use straight-line interpolation");
  assert.deepEqual(pointOnEdge(edge, 0), edge.from);
  assert.deepEqual(pointOnEdge(edge, 1), edge.to);
});

test("intro cutscene hooks and accessible hidden world mirror are present", async () => {
  const html = await source("index.html");
  const main = await source("src/main.js");
  const intro = await source("src/intro.js");
  const styles = await source("styles.css");

  for (const id of ["introSequence", "introCanvas", "introCaption", "introSignal", "introButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} hook missing`);
  }
  assert.match(main, /new IntroSequence\s*\(/);
  assert.match(main, /intro\.show\(\)/);
  assert.match(main, /data-intro-complete/);
  assert.match(intro, /show\(\)/);
  assert.match(intro, /finish\(\)/);
  assert.match(intro, /sessionStorage/);

  const mirrorTag = html.match(/<[^>]*id=["']worldMirror["'][^>]*>/)?.[0] || "";
  assert.ok(mirrorTag, "worldMirror hook missing");
  assert.match(mirrorTag, /aria-live=["']polite["']/);
  assert.doesNotMatch(mirrorTag, /aria-hidden|\bhidden\b/);
  assert.match(styles, /\.world-mirror\s*\{[^}]*width:\s*1px[^}]*height:\s*1px[^}]*overflow:\s*hidden[^}]*clip:/s);
  assert.match(styles, /\.world-mirror\s*\{[^}]*clip-path:\s*inset\(50%\)/s);
});
