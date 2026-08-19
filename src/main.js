import { cloneProgram, createProgram, getLevel, getLevels } from "./levels.js";
import { Runtime } from "./runtime.js";
import { CodePanel } from "./code-panel.js";
import { WorldView } from "./world.js";
import { IntroSequence } from "./intro.js";

const levels = getLevels();
const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("worldCanvas"),
  mirror: $("worldMirror"),
  zone: $("zoneLabel"),
  title: $("levelTitle"),
  story: $("storyLine"),
  goal: $("goalText"),
  levelNumber: $("levelNumber"),
  status: $("runStatus"),
  missionChip: document.querySelector(".mission-chip"),
  event: $("eventText"),
  lines: $("codeLines"),
  help: $("codeHelp"),
  lineState: $("lineState"),
  lineStateWrap: document.querySelector(".line-state"),
  message: $("runtimeMessage"),
  run: $("runButton"),
  pause: $("pauseButton"),
  step: $("stepButton"),
  reset: $("resetButton"),
  hint: $("hintButton"),
  next: $("nextButton"),
  dots: $("progressDots"),
  toast: $("toast"),
  app: $("app"),
  starterNudge: $("starterNudge"),
  dismissNudge: $("dismissNudge"),
  intro: $("introSequence"),
  introCanvas: $("introCanvas"),
  introCaption: $("introCaption"),
  introSignal: $("introSignal"),
  introButton: $("introButton"),
  sceneCaption: $("sceneCaption"),
  card: $("levelCard"),
  cardKicker: $("cardKicker"),
  cardTitle: $("cardTitle"),
  cardText: $("cardText"),
  cardNext: $("cardNextButton"),
};

let levelIndex = 0;
let level = getLevel(levelIndex);
let program = createProgram(level);
let displayProgram = program;
let runtime;
let lastState;
let toastTimer;
const NUDGE_STORAGE_KEY = "unit0-starter-nudge-dismissed";
let nudgeDismissed = readNudgeDismissed();
const seenLaws = new Set();
const hintIndexes = new Map();

function storageCandidates() {
  const stores = [];
  try { if (globalThis.localStorage) stores.push(globalThis.localStorage); } catch {}
  try { if (globalThis.sessionStorage) stores.push(globalThis.sessionStorage); } catch {}
  return stores;
}

function readNudgeDismissed() {
  return storageCandidates().some((storage) => {
    try { return storage.getItem(NUDGE_STORAGE_KEY) === "1"; } catch { return false; }
  });
}

function persistNudgeDismissed() {
  storageCandidates().some((storage) => {
    try { storage.setItem(NUDGE_STORAGE_KEY, "1"); return true; } catch { return false; }
  });
}

function setNudge(stage) {
  const visible = level.id === 1 && !nudgeDismissed && stage !== "hidden";
  if (!els.starterNudge) return;
  els.starterNudge.dataset.stage = visible ? stage : "hidden";
  els.starterNudge.hidden = !visible;
  els.starterNudge.querySelector(".nudge-illustration").textContent = stage === "try" ? "🛠️" : "👀";
  els.starterNudge.querySelector(".nudge-copy strong").textContent = stage === "try" ? "跟我做" : "先看一遍";
  els.starterNudge.querySelector(".nudge-message").textContent = stage === "try"
    ? "观察节点，再让 Unit-0 自己试一次。"
    : "Unit-0 刚醒。先看看哪一处还在发光。";
  els.app?.setAttribute("data-nudge-stage", visible ? stage : "hidden");
  updateNudgeTargets();
}

function updateNudgeTargets() {
  els.lines?.querySelectorAll(".nudge-target, .nudge-target-control").forEach((node) => {
    node.className = node.className
      .split(/\s+/)
      .filter((name) => name && name !== "nudge-target" && name !== "nudge-target-control")
      .join(" ");
  });
  if (!els.starterNudge || els.starterNudge.dataset.stage !== "try" || els.starterNudge.hidden) return;
  const chargeLine = els.lines?.querySelector('.code-line[data-instruction="charge"]');
  if (!chargeLine) return;
  chargeLine.className = `${chargeLine.className} nudge-target`.trim();
  const moveUp = chargeLine.querySelector('button[aria-label="Move line up"]');
  if (moveUp) moveUp.className = `${moveUp.className} nudge-target-control`.trim();
}

function hideNudge() {
  if (nudgeDismissed) return;
  nudgeDismissed = true;
  persistNudgeDismissed();
  setNudge("hidden");
}

const world = new WorldView(els.canvas, els.mirror);
const intro = new IntroSequence(els.intro, els.introCanvas, els.introCaption, els.introSignal, els.introButton, () => {
  els.app?.setAttribute("data-intro-complete", "true");
}, els.run);
const code = new CodePanel(els.lines, (nextProgram) => {
  if (!runtime?.canEdit()) return;
  const previousProgram = program;
  const next = cloneProgram(nextProgram);
  program = next;
  displayProgram = next;
  if (!runtime.setProgram(next)) {
    program = previousProgram;
    displayProgram = previousProgram;
    return;
  }
  hideNudge();
  closeCard();
  render(runtime.state);
});

function showLevel(index) {
  els.app?.setAttribute("data-app-ready", "false");
  levelIndex = index;
  level = getLevel(index);
  setNudge(index === 0 ? "observe" : "hidden");
  hintIndexes.set(level.id, 0);
  program = createProgram(level);
  displayProgram = program;
  runtime?.stopLoop();
  runtime = new Runtime(level, program, (state) => render(state), (result) => handleFinish(result));
  els.zone.textContent = level.zone;
  els.title.textContent = level.title;
  els.story.textContent = level.story;
  els.goal.textContent = level.goal;
  els.levelNumber.textContent = String(level.id).padStart(2, "0");
  els.help.textContent = level.hintSteps?.[0] || level.help;
  els.next.classList.remove("visible");
  closeCard();
  render(runtime.state);
  els.app?.setAttribute("data-app-ready", "true");
  if (level.law && !seenLaws.has(level.law)) {
    seenLaws.add(level.law);
    world.playBeat(level, level.lawBeat);
    if (els.sceneCaption && level.lawBeat) {
      els.sceneCaption.textContent = level.lawBeat.caption;
      els.sceneCaption.classList.add("visible");
      setTimeout(() => els.sceneCaption?.classList.remove("visible"), 2600);
    }
  }
}

function resetLevel() {
  closeCard();
  runtime.reset();
}

function render(state) {
  lastState = state;
  world.render(level, state);
  code.render(level, displayProgram, state);
  updateNudgeTargets();
  els.event.textContent = state.event || "Awaiting input.";
  els.message.textContent = state.error || state.event || "World is listening.";
  els.message.className = "runtime-message";
  if (state.phase === "error") els.message.classList.add("error");
  if (state.phase === "success") els.message.classList.add("success");
  els.status.textContent = ({ idle: "准备", demo: "演示中", running: "运行中", paused: "已暂停", error: "需要重置", success: "完成" })[state.phase] || state.phase;
  els.missionChip.dataset.state = state.phase;
  els.lineState.textContent = "第 " + String(state.activeLine || 0).padStart(2, "0") + " 行 · " + (({ idle: "准备", demo: "演示中", running: "运行中", paused: "已暂停", error: "需要重置", success: "完成" })[state.phase] || state.phase);
  els.lineStateWrap.className = "line-state " + state.phase;
  const locked = ["demo", "running", "paused", "success"].includes(state.phase);
  els.pause.disabled = state.phase !== "running";
  els.run.disabled = ["demo", "running", "success", "error"].includes(state.phase);
  els.step.disabled = locked || state.phase === "error";
  els.reset.disabled = state.phase === "demo";
  updateDots();
}

function updateDots() {
  els.dots.replaceChildren();
  levels.forEach((item, index) => {
    const dot = document.createElement("span");
    dot.className = "progress-dot";
    if (index === levelIndex) dot.classList.add("current");
    if (index < levelIndex) dot.classList.add("done");
    dot.title = item.title;
    els.dots.append(dot);
  });
}

function handleFinish(result) {
  if (!result.ok) {
    showToast(result.text || "Program stopped. Reset and try again.");
    return;
  }
  els.toast.classList.remove("show");
  els.toast.textContent = "";
  els.next.classList.add("visible");
  els.cardKicker.textContent = levelIndex === levels.length - 1 ? "CITY SIGNAL RESTORED" : "SIGNAL RESTORED";
  els.cardTitle.textContent = level.successTitle;
  els.cardText.textContent = level.successText;
  els.cardNext.textContent = levelIndex === levels.length - 1 ? "再修一次  ↺" : "继续  →";
  els.card.classList.remove("hidden");
  els.cardNext.focus();
}

function closeCard() {
  els.card.classList.add("hidden");
}

function nextLevel() {
  if (levelIndex >= levels.length - 1) showLevel(0);
  else showLevel(levelIndex + 1);
  els.title.focus();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

els.run.addEventListener("click", () => { hideNudge(); runtime.run(); });
els.pause.addEventListener("click", () => runtime.pause());
els.step.addEventListener("click", () => { hideNudge(); runtime.stepOnce(); });
els.reset.addEventListener("click", resetLevel);
els.hint.addEventListener("click", () => {
  const steps = level.hintSteps || [level.help];
  const nextIndex = Math.min((hintIndexes.get(level.id) || 0) + 1, steps.length - 1);
  hintIndexes.set(level.id, nextIndex);
  els.help.textContent = steps[nextIndex];
  showToast(steps[nextIndex]);
});
els.next.addEventListener("click", nextLevel);
els.cardNext.addEventListener("click", nextLevel);
els.dismissNudge?.addEventListener("click", hideNudge);

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select")) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (lastState.phase === "running") runtime.pause();
    else if (lastState.phase === "paused") { hideNudge(); runtime.run(); }
    else if (lastState.phase === "idle") { hideNudge(); runtime.run(); }
  }
  if (event.key.toLowerCase() === "s") { hideNudge(); runtime.stepOnce(); }
  if (event.key.toLowerCase() === "r" && lastState.phase !== "demo") resetLevel();
});

showLevel(0);
if (!intro.show()) els.app?.setAttribute("data-intro-complete", "true");
