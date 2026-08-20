import { LEVEL_IDS, cloneProgram, createProgram, getLevelById, getLevels, getNextLevelId, groupLevelsByMapGroup } from "./levels.js";
import { resolveLevelRoute, routeForLevel } from "./navigation.js";
import { loadProgress, saveProgress } from "./progress.js";
import { Runtime } from "./runtime.js";
import { CodePanel } from "./code-panel.js";
import { WorldView } from "./world.js";
import { IntroSequence } from "./intro.js";

const levels = getLevels();
const levelIds = LEVEL_IDS;
const firstLevelId = levelIds[0] || 1;
const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("worldCanvas"), mirror: $("worldMirror"), zone: $("zoneLabel"), title: $("levelTitle"), story: $("storyLine"), goal: $("goalText"), levelNumber: $("levelNumber"),
  status: $("runStatus"), missionChip: document.querySelector(".mission-chip"), event: $("eventText"), lines: $("codeLines"), help: $("codeHelp"), lineState: $("lineState"), lineStateWrap: document.querySelector(".line-state"), message: $("runtimeMessage"),
  run: $("runButton"), pause: $("pauseButton"), step: $("stepButton"), reset: $("resetButton"), hint: $("hintButton"), next: $("nextButton"), dots: $("progressDots"), toast: $("toast"), app: $("app"),
  intro: $("introSequence"), introCanvas: $("introCanvas"), introCaption: $("introCaption"), introPromise: $("introPromise"), introButton: $("introButton"), sceneCaption: $("sceneCaption"), card: $("levelCard"), cardKicker: $("cardKicker"), cardTitle: $("cardTitle"), cardText: $("cardText"), cardNext: $("cardNextButton"),
  mapButton: $("mapButton"), mapDialog: $("levelMapDialog"), mapCloseButton: $("mapCloseButton"), mapGroups: $("mapGroups"), mapLevels: [], levelTotal: $("levelTotal"),
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
let mapRestoreFocus = true;
let cardRestoreFocus = null;
let lastHandledRoute = null;
const seenLaws = new Set();
const hintIndexes = new Map();

const world = new WorldView(els.canvas, els.mirror);

function validLevelId(value) { return Number.isInteger(value) && Boolean(getLevelById(value)); }

function replaceWithCanonicalRoute(route) {
  if (!route || window.location.hash === route) return false;
  window.history.replaceState(window.history.state, "", route);
  return true;
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

function handleCardClose() {
  const target = cardRestoreFocus;
  cardRestoreFocus = null;
  if (target && typeof target.focus === "function") target.focus();
}

function closeCard({ restoreFocus = false } = {}) {
  if (!els.card) return;
  cardRestoreFocus = restoreFocus ? els.title : null;
  if (els.card.open) els.card.close();
  else cardRestoreFocus = null;
}

function closeDialogsBeforeMount() {
  closeMap(false);
  closeCard();
}

function renderMap() {
  const groups = groupLevelsByMapGroup(levels);
  els.mapGroups.replaceChildren();
  groups.forEach(({ key, label, levels: groupLevels }) => {
    const headingId = `map-group-${key}-title`;
    const section = document.createElement("section");
    section.className = "map-group";
    section.setAttribute("role", "group");
    section.setAttribute("aria-labelledby", headingId);
    const heading = document.createElement("h3");
    heading.id = headingId;
    heading.textContent = label;
    section.append(heading);
    const list = document.createElement("div");
    list.className = "map-level-list";
    groupLevels.forEach((item) => {
      const button = document.createElement("button");
      button.className = "map-level-button";
      button.type = "button";
      button.dataset.levelId = String(item.id);
      const title = document.createElement("span");
      title.textContent = `${String(item.id).padStart(2, "0")} · ${item.title}`;
      const status = document.createElement("span");
      status.className = "map-status";
      status.dataset.mapStatus = "";
      button.append(title, status);
      list.append(button);
    });
    section.append(list);
    els.mapGroups.append(section);
  });
  els.mapLevels = [...els.mapGroups.querySelectorAll("[data-level-id]")];
  els.levelTotal.textContent = String(levelIds.length).padStart(2, "0");
}

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
  if (!els.card.open) els.card.showModal();
  els.cardNext.focus();
}

function mountLevel(nextLevelId, { playBeat = true } = {}) {
  const nextLevel = getLevelById(nextLevelId);
  if (!nextLevel) return false;
  const generation = ++mountGeneration;
  closeDialogsBeforeMount();
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
  handleRouteChange();
  if (level.id !== pendingLevelId) mountLevel(pendingLevelId, { playBeat: false });
  setPresentationLock(true);
  playLawBeat(mountGeneration);
}

function navigateToLevel(nextLevelId) {
  if (!validLevelId(nextLevelId)) return;
  pendingLevelId = nextLevelId;
  const route = routeForLevel(nextLevelId);
  if (!route) return;
  if (window.location.hash === route) {
    closeMap(false);
    els.title?.focus();
    return;
  }
  window.location.hash = route;
}

function handleRouteChange() {
  const resolved = resolveLevelRoute(window.location.hash, savedFallbackLevelId(), levelIds);
  if (!resolved.route) return;
  if (resolved.needsCanonicalize) replaceWithCanonicalRoute(resolved.route);
  pendingLevelId = resolved.levelId;
  const shouldMount = resolved.needsCanonicalize || lastHandledRoute !== resolved.route || levelId !== resolved.levelId;
  lastHandledRoute = resolved.route;
  if (!shouldMount) return;
  mountLevel(resolved.levelId, { playBeat: !introActive });
}

function resetLevel() { closeCard(); runtime?.reset(); }

function nextLevel() { navigateToLevel(getNextLevelId(level.id)); }

function openMap() {
  if (introActive || !els.mapDialog) return;
  mapTrigger = document.activeElement;
  mapRestoreFocus = true;
  if (!els.mapDialog.open) els.mapDialog.showModal();
  els.mapCloseButton?.focus();
}

function handleMapClose() {
  const trigger = mapTrigger;
  const restoreFocus = mapRestoreFocus;
  mapTrigger = null;
  mapRestoreFocus = true;
  if (restoreFocus && trigger && typeof trigger.focus === "function") trigger.focus();
}

function closeMap(restoreFocus = true) {
  if (!els.mapDialog?.open) return;
  mapRestoreFocus = restoreFocus;
  els.mapDialog.close();
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

renderMap();

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
els.cardNext.addEventListener("click", () => {
  closeCard();
  nextLevel();
});
els.mapButton?.addEventListener("click", openMap);
els.mapCloseButton?.addEventListener("click", () => closeMap());
els.mapDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMap();
});
els.mapDialog?.addEventListener("close", handleMapClose);
els.card?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCard({ restoreFocus: true });
});
els.card?.addEventListener("close", handleCardClose);
els.mapGroups?.addEventListener("click", (event) => {
  const button = event.target.closest?.("button[data-level-id]");
  if (!button || !els.mapGroups.contains(button)) return;
  const target = Number(button.dataset.levelId);
  closeMap(false);
  navigateToLevel(target);
});

window.addEventListener("hashchange", handleRouteChange);
window.addEventListener("popstate", handleRouteChange);
window.addEventListener("keydown", (event) => {
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

setPresentationLock(true);
introActive = !progress.introSeen;
els.app?.setAttribute("data-intro-active", String(introActive));
handleRouteChange();
if (introActive) {
  const shown = intro.show({ seen: false });
  introActive = shown;
  if (!shown) { introActive = true; startRequestedLevel(); }
}
