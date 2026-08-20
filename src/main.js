import { cloneProgram, createProgram, getLevel, getLevels } from "./levels.js";
import { Runtime } from "./runtime.js";
import { CodePanel } from "./code-panel.js";
import { WorldView } from "./world.js";
import { IntroSequence } from "./intro.js";

const levels = getLevels();
const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("worldCanvas"), mirror: $("worldMirror"), zone: $("zoneLabel"), title: $("levelTitle"), story: $("storyLine"), goal: $("goalText"), levelNumber: $("levelNumber"),
  status: $("runStatus"), missionChip: document.querySelector(".mission-chip"), event: $("eventText"), lines: $("codeLines"), help: $("codeHelp"), lineState: $("lineState"), lineStateWrap: document.querySelector(".line-state"), message: $("runtimeMessage"),
  run: $("runButton"), pause: $("pauseButton"), step: $("stepButton"), reset: $("resetButton"), hint: $("hintButton"), next: $("nextButton"), dots: $("progressDots"), toast: $("toast"), app: $("app"),
  intro: $("introSequence"), introCanvas: $("introCanvas"), introCaption: $("introCaption"), introPromise: $("introPromise"), introButton: $("introButton"), sceneCaption: $("sceneCaption"), card: $("levelCard"), cardKicker: $("cardKicker"), cardTitle: $("cardTitle"), cardText: $("cardText"), cardNext: $("cardNextButton"),
};

let levelIndex = 0;
let level = getLevel(levelIndex);
let program = createProgram(level);
let displayProgram = program;
let runtime;
let lastState;
let toastTimer;
let presentationLocked = true;
let firstLevelStarted = false;
const seenLaws = new Set();
const hintIndexes = new Map();

const world = new WorldView(els.canvas, els.mirror);

function applyControlState(state) {
  const runtimeLocked = ["demo", "running", "paused", "success"].includes(state?.phase);
  els.pause.disabled = presentationLocked || state?.phase !== "running";
  els.run.disabled = presentationLocked || ["demo", "running", "success", "error"].includes(state?.phase);
  els.step.disabled = presentationLocked || runtimeLocked || state?.phase === "error";
  els.reset.disabled = presentationLocked || state?.phase === "demo";
  els.hint.disabled = presentationLocked || state?.phase === "success";
  els.next.disabled = presentationLocked;
  els.cardNext.disabled = presentationLocked;
}

function setPresentationLock(locked) {
  presentationLocked = Boolean(locked);
  els.app?.setAttribute("data-app-ready", String(!presentationLocked));
  els.app?.setAttribute("data-presentation-locked", String(presentationLocked));
  els.app?.setAttribute("aria-busy", String(presentationLocked));
  applyControlState(lastState || { phase: "idle" });
  if (els.lines) els.lines.dataset.presentationLocked = String(presentationLocked);
}

function finishPresentation() {
  setPresentationLock(false);
  if (runtime) render(runtime.state);
  els.run?.focus();
}

function playLawBeat() {
  if (!level.law || seenLaws.has(level.law) || !level.lawBeat) { finishPresentation(); return; }
  seenLaws.add(level.law);
  els.sceneCaption.textContent = level.lawBeat.caption;
  els.sceneCaption.classList.add("visible");
  world.playBeat(level, level.lawBeat, () => { els.sceneCaption?.classList.remove("visible"); finishPresentation(); });
}

function startFirstLevel() {
  if (firstLevelStarted) return;
  firstLevelStarted = true;
  els.app?.setAttribute("data-intro-active", "false");
  els.app?.setAttribute("data-intro-complete", "true");
  showLevel(0);
}

const intro = new IntroSequence(els.intro, els.introCanvas, els.introCaption, els.introPromise, els.introButton, startFirstLevel, els.run);
const code = new CodePanel(els.lines, (nextProgram) => {
  if (presentationLocked || !runtime?.canEdit()) return;
  const next = cloneProgram(nextProgram);
  if (!runtime.setProgram(next)) return;
  program = next;
  displayProgram = next;
  closeCard();
  render(runtime.state);
});

function showLevel(index) {
  setPresentationLock(true);
  levelIndex = index;
  level = getLevel(index);
  hintIndexes.set(level.id, -1);
  program = createProgram(level);
  displayProgram = program;
  runtime?.stopLoop();
  runtime = new Runtime(level, program, (state) => render(state), (result) => handleFinish(result));
  els.zone.textContent = level.zone;
  els.title.textContent = level.title;
  els.story.textContent = level.story;
  els.goal.textContent = level.goal;
  els.levelNumber.textContent = String(level.id).padStart(2, "0");
  els.help.textContent = level.help || "先观察世界正在回应什么。";
  els.next.classList.remove("visible");
  els.next.disabled = true;
  els.sceneCaption.textContent = "";
  els.sceneCaption.classList.remove("visible");
  closeCard();
  render(runtime.state);
  playLawBeat();
}

function resetLevel() { closeCard(); runtime.reset(); }

function render(state) {
  lastState = state;
  world.render(level, state);
  code.render(level, displayProgram, presentationLocked ? { ...state, phase: "demo" } : state);
  els.event.textContent = state.event || "";
  els.message.textContent = state.error || state.event || "";
  els.message.className = "runtime-message";
  if (state.phase === "error") els.message.classList.add("error");
  if (state.phase === "success") els.message.classList.add("success");
  const phaseLabels = { idle: "准备", demo: "世界演示中", running: "运行中", paused: "已暂停", error: "需要重置", success: "完成" };
  els.status.textContent = presentationLocked && state.phase === "idle" ? "正在展示" : (phaseLabels[state.phase] || "准备");
  els.missionChip.dataset.state = state.phase;
  els.lineState.textContent = `第 ${String(state.activeLine || 0).padStart(2, "0")} 行 · ${presentationLocked && state.phase === "idle" ? "展示中" : (phaseLabels[state.phase] || "准备")}`;
  els.lineStateWrap.className = `line-state ${state.phase}`;
  applyControlState(state);
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
  if (!result.ok) { showToast(result.text || "程序已停止，请重置后再试。"); return; }
  els.toast.classList.remove("show");
  els.toast.textContent = "";
  els.next.classList.add("visible");
  els.cardKicker.textContent = levelIndex === levels.length - 1 ? "城市重新呼吸" : "修复完成";
  els.cardTitle.textContent = level.successTitle;
  els.cardText.textContent = level.successText;
  els.cardNext.textContent = levelIndex === levels.length - 1 ? "再修一次  ↺" : "继续  →";
  els.card.classList.remove("hidden");
  els.cardNext.focus();
}

function closeCard() { els.card.classList.add("hidden"); }

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

els.run.addEventListener("click", () => { if (!presentationLocked) runtime?.run(); });
els.pause.addEventListener("click", () => { if (!presentationLocked) runtime?.pause(); });
els.step.addEventListener("click", () => { if (!presentationLocked) runtime?.stepOnce(); });
els.reset.addEventListener("click", () => { if (!presentationLocked) resetLevel(); });
els.hint.addEventListener("click", () => {
  if (presentationLocked) return;
  const steps = level.hintSteps || [];
  if (!steps.length) return;
  const nextIndex = Math.min((hintIndexes.get(level.id) ?? -1) + 1, steps.length - 1);
  hintIndexes.set(level.id, nextIndex);
  const hint = steps[nextIndex];
  els.help.textContent = hint;
  showToast(hint);
});
els.next.addEventListener("click", nextLevel);
els.cardNext.addEventListener("click", nextLevel);

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select")) return;
  if (!lastState || presentationLocked) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (lastState.phase === "running") runtime.pause();
    else if (lastState.phase === "paused") runtime.run();
    else if (lastState.phase === "idle") runtime.run();
  }
  if (event.key.toLowerCase() === "s") runtime.stepOnce();
  if (event.key.toLowerCase() === "r" && lastState.phase !== "demo") resetLevel();
});

setPresentationLock(true);
els.app?.setAttribute("data-intro-active", "true");
if (!intro.show()) startFirstLevel();
