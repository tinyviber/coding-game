import { cloneProgram, createProgram, getLevelById, getLevels, getNextLevelId } from "./levels.js";
import { levelRoute, parseLevelRoute, routeForLevel } from "./navigation.js";
import { loadProgress, saveProgress } from "./progress.js";
import { Runtime } from "./runtime.js";
import { CodePanel } from "./code-panel.js";
import { WorldView } from "./world.js";
import { IntroSequence } from "./intro.js";

const levels = getLevels();
const levelIds = levels.map((item) => item.id);
const firstLevelId = levelIds[0] || 1;
const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("worldCanvas"), mirror: $("worldMirror"), zone: $("zoneLabel"), title: $("levelTitle"), story: $("storyLine"), goal: $("goalText"), levelNumber: $("levelNumber"),
  status: $("runStatus"), missionChip: document.querySelector(".mission-chip"), event: $("eventText"), lines: $("codeLines"), help: $("codeHelp"), lineState: $("lineState"), lineStateWrap: document.querySelector(".line-state"), message: $("runtimeMessage"),
  run: $("runButton"), pause: $("pauseButton"), step: $("stepButton"), reset: $("resetButton"), hint: $("hintButton"), next: $("nextButton"), dots: $("progressDots"), toast: $("toast"), app: $("app"),
  intro: $("introSequence"), introCanvas: $("introCanvas"), introCaption: $("introCaption"), introPromise: $("introPromise"), introButton: $("introButton"), sceneCaption: $("sceneCaption"), card: $("levelCard"), cardKicker: $("cardKicker"), cardTitle: $("cardTitle"), cardText: $("cardText"), cardNext: $("cardNextButton"),
  mapButton: $("mapButton"), mapDialog: $("levelMapDialog"), mapCloseButton: $("mapCloseButton"), mapLevels: [...document.querySelectorAll("[data-level-id]")],
};

let progress = loadProgress(undefined, levelIds);
let levelId = firstLevelId;
let level = getLevelById(levelId) || levels[0];
let program = createProgram(level);
let displayProgram = program;
let runtime;
let lastState;
let toastTimer;
let presentationLocked = true;
let mountGeneration = 0;
let pendingLevelId = level.id;
let introActive = false;
let mapTrigger = null;
const seenLaws = new Set();
const hintIndexes = new Map();

const world = new WorldView(els.canvas, els.mirror);

function validLevelId(value) { return Number.isInteger(value) && Boolean(getLevelById(value)); }

function replaceWithCanonicalRoute(id) {
  const route = levelRoute(id);
  if (!route || window.location.hash === route) return;
  try { window.history.replaceState(window.history.state, "", route); } catch {
    try { window.location.hash = route; } catch {}
  }
}

function savedFallbackLevelId() {
  return validLevelId(progress.lastPlayedLevelId) ? progress.lastPlayedLevelId : firstLevelId;
}

function writeProgress(next) {
  const candidate = {
    version: 1,
    completedLevelIds: [...new Set((next.completedLevelIds || []).filter(validLevelId))],
    lastPlayedLevelId: validLevelId(next.lastPlayedLevelId) ? next.lastPlayedLevelId : null,
    introSeen: Boolean(next.introSeen),
  };
  progress = candidate;
  saveProgress(candidate, undefined, levelIds);
}

function applyControlState(state) {
  const runtimeLocked = ["demo", "running", "paused", "success"].includes(state?.phase);
  els.pause.disabled = presentationLocked || state?.phase !== "running";
  els.run.disabled = presentationLocked || ["demo", "running", "success", "error"].includes(state?.phase);
  els.step.disabled = presentationLocked || runtimeLocked || state?.phase === "error";
  els.reset.disabled = presentationLocked || state?.phase === "demo";
  els.hint.disabled = presentationLocked || state?.phase === "success";
  els.next.disabled = presentationLocked || !els.next.classList.contains("visible");
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

function finishPresentation(generation) {
  if (generation !== undefined && generation !== mountGeneration) return;
  setPresentationLock(false);
  if (runtime) render(runtime.state);
  els.title?.focus();
}

function playLawBeat(generation) {
  if (generation !== mountGeneration) return;
  if (!level.law || seenLaws.has(level.law) || !level.lawBeat) {
    els.sceneCaption.hidden = true;
    finishPresentation(generation);
    return;
  }
  seenLaws.add(level.law);
  els.sceneCaption.textContent = level.lawBeat.caption;
  els.sceneCaption.hidden = false;
  els.sceneCaption.classList.add("visible");
  world.playBeat(level, level.lawBeat, () => {
    if (generation !== mountGeneration) return;
    els.sceneCaption?.classList.remove("visible");
    els.sceneCaption.hidden = true;
    finishPresentation(generation);
  });
}

function clearToast() {
  clearTimeout(toastTimer);
  toastTimer = undefined;
  els.toast?.classList.remove("show");
  if (els.toast) els.toast.textContent = "";
}

function closeCard() { els.card?.classList.add("hidden"); }

function updateMap() {
  const completed = new Set(progress.completedLevelIds);
  els.mapLevels.forEach((button) => {
    const id = Number(button.dataset.levelId);
    const done = completed.has(id);
    if (id === levelId) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.dataset.completed = String(done);
    const status = button.querySelector("[data-map-status]");
    if (status) status.textContent = done ? "（已修复）" : "";
  });
}

function updateDots() {
  const completed = new Set(progress.completedLevelIds);
  els.dots.replaceChildren();
  levels.forEach((item) => {
    const dot = document.createElement("span");
    dot.className = "progress-dot";
    if (item.id === levelId) dot.classList.add("current");
    if (completed.has(item.id)) dot.classList.add("done");
    dot.title = item.title;
    els.dots.append(dot);
  });
}

function render(state) {
  lastState = state;
  world.render(level, state);
  const codeState = presentationLocked ? { ...state, phase: "demo" } : state;
  if (introActive) codeState.suppressRows = true;
  code.render(level, displayProgram, codeState);
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
  updateMap();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function handleFinish(result, generation) {
  if (generation !== mountGeneration) return;
  if (!result.ok) { showToast(result.text || "程序已停止，请重置后再试。"); return; }
  writeProgress({ ...progress, lastPlayedLevelId: level.id, completedLevelIds: [...progress.completedLevelIds, level.id] });
  updateMap();
  els.toast.classList.remove("show");
  els.toast.textContent = "";
  els.next.classList.add("visible");
  applyControlState(result.state || lastState || {});
  els.cardKicker.textContent = level.id === levels.at(-1)?.id ? "城市重新呼吸" : "修复完成";
  els.cardTitle.textContent = level.successTitle;
  els.cardText.textContent = level.successText;
  els.cardNext.textContent = level.id === levels.at(-1)?.id ? "再修一次  ↺" : "继续  →";
  els.card.classList.remove("hidden");
  els.cardNext.focus();
}

function mountLevel(nextLevelId, { playBeat = true } = {}) {
  const nextLevel = getLevelById(nextLevelId);
  if (!nextLevel) return false;
  const generation = ++mountGeneration;
  pendingLevelId = nextLevel.id;
  levelId = nextLevel.id;
  level = nextLevel;
  setPresentationLock(true);
  world.stopBeat();
  runtime?.stopLoop();
  clearToast();
  closeCard();
  els.next.classList.remove("visible");
  els.next.disabled = true;
  els.sceneCaption.textContent = "";
  els.sceneCaption.classList.remove("visible");
  els.sceneCaption.hidden = true;
  hintIndexes.set(level.id, -1);
  program = createProgram(level);
  displayProgram = program;
  let nextRuntime;
  nextRuntime = new Runtime(
    level,
    program,
    (state) => { if (generation === mountGeneration && runtime === nextRuntime) render(state); },
    (result) => { if (generation === mountGeneration && runtime === nextRuntime) handleFinish(result, generation); },
  );
  runtime = nextRuntime;
  els.zone.textContent = level.zone;
  els.title.textContent = level.title;
  els.story.textContent = level.story;
  els.goal.textContent = level.goal;
  els.levelNumber.textContent = String(level.id).padStart(2, "0");
  els.help.textContent = level.help || "先观察世界正在回应什么。";
  writeProgress({ ...progress, lastPlayedLevelId: level.id });
  render(runtime.state);
  els.title.focus();
  if (playBeat) playLawBeat(generation);
  return true;
}

function startRequestedLevel() {
  if (!introActive) return;
  introActive = false;
  els.app?.setAttribute("data-intro-active", "false");
  els.app?.setAttribute("data-intro-complete", "true");
  writeProgress({ ...progress, introSeen: true });
  if (level.id !== pendingLevelId) mountLevel(pendingLevelId, { playBeat: false });
  setPresentationLock(true);
  playLawBeat(mountGeneration);
}

function navigateToLevel(nextLevelId) {
  if (!validLevelId(nextLevelId)) return;
  pendingLevelId = nextLevelId;
  const route = routeForLevel(nextLevelId);
  if (!route || window.location.hash === route) return;
  window.location.hash = route;
}

function handleRouteChange() {
  const routedId = parseLevelRoute(window.location.hash, levelIds);
  if (routedId === null) {
    const fallback = savedFallbackLevelId();
    pendingLevelId = fallback;
    replaceWithCanonicalRoute(fallback);
    return;
  }
  pendingLevelId = routedId;
  if (introActive) mountLevel(routedId, { playBeat: false });
  else mountLevel(routedId);
}

function resetLevel() { closeCard(); runtime?.reset(); }

function nextLevel() { navigateToLevel(getNextLevelId(level.id)); }

function openMap() {
  if (introActive || !els.mapDialog) return;
  mapTrigger = document.activeElement;
  els.mapDialog.hidden = false;
  els.mapDialog.setAttribute("aria-hidden", "false");
  els.mapCloseButton?.focus();
}

function closeMap(restoreFocus = true) {
  if (!els.mapDialog || els.mapDialog.hidden) return;
  els.mapDialog.hidden = true;
  els.mapDialog.setAttribute("aria-hidden", "true");
  const trigger = mapTrigger;
  mapTrigger = null;
  if (restoreFocus && trigger && typeof trigger.focus === "function") trigger.focus();
}

const intro = new IntroSequence(els.intro, els.introCanvas, els.introCaption, els.introPromise, els.introButton, startRequestedLevel, els.run);
const code = new CodePanel(els.lines, (nextProgram) => {
  if (presentationLocked || !runtime?.canEdit()) return;
  const next = cloneProgram(nextProgram);
  if (!runtime.setProgram(next)) return;
  program = next;
  displayProgram = next;
  closeCard();
  render(runtime.state);
});

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
els.mapButton?.addEventListener("click", openMap);
els.mapCloseButton?.addEventListener("click", () => closeMap());
els.mapLevels.forEach((button) => button.addEventListener("click", () => {
  const target = Number(button.dataset.levelId);
  closeMap(false);
  navigateToLevel(target);
}));

window.addEventListener("hashchange", handleRouteChange);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.mapDialog && !els.mapDialog.hidden) {
    event.preventDefault();
    closeMap();
    return;
  }
  if (event.target.matches?.("input, select, button")) return;
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

const explicitRouteId = parseLevelRoute(window.location.hash, levelIds);
const initialLevelId = explicitRouteId ?? savedFallbackLevelId();
pendingLevelId = initialLevelId;
if (explicitRouteId === null) replaceWithCanonicalRoute(initialLevelId);
setPresentationLock(true);
introActive = !progress.introSeen;
els.app?.setAttribute("data-intro-active", String(introActive));
if (introActive) {
  mountLevel(initialLevelId, { playBeat: false });
  const shown = intro.show({ seen: false });
  introActive = shown;
  if (!shown) { introActive = true; startRequestedLevel(); }
} else {
  mountLevel(initialLevelId);
}
