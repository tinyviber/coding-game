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
let uiLevel = level;
let program = createProgram(level);
let displayProgram = program;
let runtime;
let lastState;
let toastTimer;
let lawCaptionTimer;
let presentationLocked = true;
let firstLevelStarted = false;
const seenLaws = new Set();
const hintIndexes = new Map();

const TEXT_TRANSLATIONS = new Map([
  ["STATION ZERO", "零号车站"],
  ["MEMORY DEPOT", "记忆仓"],
  ["CENTRAL RELAY", "中央中继站"],
  ["Wake Signal", "唤醒信号"],
  ["Cargo Line", "货运轨道"],
  ["Name the Spark", "给火花命名"],
  ["Add One", "再加一点"],
  ["Light Route", "亮路"],
  ["Same Signal", "相同的信号"],
  ["Relay Reorder", "重排中继"],
  ["Make the Sun Rise", "让太阳升起"],
  ["The dead rail gives one weak blink. Unit-0 turns toward it.", "死寂的轨道闪了一下微光。零号车转向了它。"],
  ["A dormant carrier holds the last signal cell beside the rail.", "沉睡的运载车旁，还留着最后一枚信号电池。"],
  ["A dark memory box waits for a named spark.", "黑暗的记忆盒，正在等待一个有名字的火花。"],
  ["The box is awake. Its stored charge is one step short.", "记忆盒已经醒来，但里面的能量还差一点。"],
  ["Two districts wait beyond a gate. One still has a light in it.", "判断门后有两片区域，其中一片还亮着灯。"],
  ["A cargo gate rejects every label that is merely similar.", "货物闸门会拒绝那些只是看起来相似的标签。"],
  ["The depot lights return, but its relay instructions are scrambled.", "仓库的灯重新亮起，但中继指令被打乱了。"],
  ["Beyond the central relay, one broken instruction still glows: MAKE THE SUN RISE AGAIN.", "中央中继站后方，一条损坏的指令仍在发光：让太阳再次升起。"],
  ["Find what can still feed the rail.", "观察世界中还在回应零号车的地方，让轨道重新得到能量。"],
  ["Carry the cell to the silent relay.", "让信号电池跟着零号车抵达沉默的中继站。"],
  ["Make the relay remember enough charge.", "让记忆盒保存足够的能量，并让读取器成功读出它。"],
  ["Change the value already in Memory.", "让记忆盒里的能量发生变化，并让读取器读到变化后的值。"],
  ["Send the stored signal toward the living district.", "让能量值为 5 的信号通过判断门，进入仍然发光的那条路线。"],
  ["Make the gate recognise the signal.", "让判断门确认货物标签相同，并打开正确的出口。"],
  ["Restore one complete relay sequence.", "让能量先被保存和修改，再被读取、判断，最后沿亮路送往中继站。"],
  ["Carry one last living signal to the tower.", "修复整条信号链，让一份完整而有效的信号抵达中央塔。"],
  ["Watch which node still answers Unit-0.", "先观察哪个节点还在回应零号车。"],
  ["The world remembers where Unit-0 picked the cell up.", "留意世界是否记住了零号车带走的信号电池。"],
  ["A value that should survive needs a named box.", "需要留下来的值，必须进入一个有名字的记忆盒。"],
  ["Watch whether the token inside the box changes or stays still.", "观察记忆盒里的数据是否真的发生了变化。"],
  ["The gate will show its comparison before it chooses.", "判断门会先展示比较结果，再选择路线。"],
  ["The gate cares about what the two tokens actually say.", "判断门会认真比较两份标签，而不是只看它们像不像。"],
  ["Follow the token: box, change, read, gate, relay.", "跟着数据走过记忆盒、更新、读取器、判断门和中继站。"],
  ["The tower needs a complete chain, not one perfect line.", "中央塔需要一条完整的信号链，而不是某一行单独正确。"],
  ["The rail wakes only in order. First, a path. Then, power.", "轨道会按顺序醒来：先走到该去的地方，再送入能量。"],
  ["A number vanishes in open air. Memory Box keeps it by name.", "没有名字的数字会消失；记忆盒会把它留在自己的位置上。"],
  ["The gate reads a token, compares it, then opens one road.", "判断门会接收数据、完成比较，然后打开一条路线。"],
  ["The signal leaves before it has enough power.", "信号还没有得到足够能量，就已经离开了。"],
  ["Unit-0 needs to reach the only bright node first.", "先观察唯一还亮着的节点。"],
  ["Let the charge happen before the signal is delivered.", "让零号车先完成充电，再送出信号。"],
  ["The relay receives nothing when Unit-0 arrives empty-handed.", "零号车空手抵达时，中继站收不到任何信号。"],
  ["Look for the cell before the long rail begins.", "在长轨道开始前，先观察那枚信号电池。"],
  ["The cell must be picked up before the move and delivery.", "信号电池要先被带走，之后才会跟着零号车移动。"],
  ["The number disappears unless the box keeps it.", "如果记忆盒没有留下它，这个数字就会消失。"],
  ["Write a charge into Memory, then let the reader find it.", "先让记忆盒保存能量，再观察读取器是否找到它。"],
  ["The relay still needs a stronger stored charge than the starter value.", "中继站需要比现在更充足的能量。"],
  ["The box keeps its old value when the update adds nothing.", "更新没有带来变化时，记忆盒仍会保留原值。"],
  ["Update the stored token instead of writing a new box.", "观察已有的数据，并让它在记忆盒里完成更新。"],
  ["Try a small positive change, then read the result back.", "让记忆盒里的值发生一点变化，再让读取器读回结果。"],
  ["The bright road opens only when the gate says TRUE.", "只有判断门给出肯定结果时，亮路才会打开。"],
  ["Read the number carried by the token and compare it with the gate marker.", "观察数据携带的数值，再看它与门上标记的关系。"],
  ["Try the comparison that makes the current value pass the marker.", "调整比较方式，让当前值能够通过门上的标记。"],
  ["The gate rejects labels that are not the same kind of match.", "标签没有形成相同的匹配时，判断门会拒绝它。"],
  ["Look at both labels when the comparison appears.", "比较出现时，同时观察门收到的两份标签。"],
  ["Choose the comparison that means exactly the same.", "让比较表达两份标签完全相同。"],
  ["The gate is asking before the stored token is ready.", "判断门发问时，记忆盒里的数据还没有准备好。"],
  ["Trace the token from its first box to the final road.", "从数据进入记忆盒开始，一直观察它走到最后的路线。"],
  ["Reorder the actions so every world object receives its turn.", "调整动作顺序，让每个世界对象都按自己的时机收到数据。"],
  ["The tower stays dark when any link in the signal chain is missing.", "信号链少了任何一环，中央塔都会继续保持黑暗。"],
  ["Trace the charge from Memory through the reader and gate.", "观察能量从记忆盒经过读取器和判断门的完整过程。"],
  ["Make the stored signal cross the threshold and take the sun road.", "让保存好的信号通过判断门，走上通往晨光的路线。"],
  ["The rail leaves before it has power.", "轨道还没有能量，信号就先离开了。"],
  ["Unit-0 reaches rail empty. Nothing can be delivered.", "零号车空手抵达轨道，无法送出任何东西。"],
  ["Memory kept the number, but relay still lacks power.", "记忆盒留下了数字，但中继站仍然没有足够能量。"],
  ["Update ran, but stored energy did not change.", "更新执行了，但记忆盒里的能量没有变化。"],
  ["5 > 8 is false. Gate diverts to dark.", "当前比较结果为否定，判断门把信号引向暗路。"],
  ["Cargo labels are not ordered numbers. They must match.", "货物标签不是用大小排序的数字；它们需要彼此匹配。"],
  ["Choice asks memory before update and read complete.", "判断门在数据更新、读取完成之前就开始发问了。"],
  ["The tower stays dark. Every part of the program must agree.", "中央塔仍然黑暗，整条程序链必须彼此衔接。"],
  ["The sun answers.", "太阳回应了。"],
  ["The sun rises again. Unit-0 watches the city breathe.", "太阳再次越过地平线。零号车看着机械城重新呼吸。"],
  ["Signal restored.", "信号已恢复。"],
  ["One more piece of city wakes.", "城市又有一处重新醒来。"],
  ["THE SUN RISES AGAIN. Unit-0 watches the city breathe.", "太阳再次越过地平线。零号车看着机械城重新呼吸。"],
]);

const NODE_TEXT = { dock: "小屋", pickup: "输入台", charge: "充电站", exit: "中继站", memory: "记忆盒", reader: "读取器", gate: "判断门", light: "亮路", dark: "暗路", dawn: "晨光路" };
const ARIA_TEXT = { "energy value": "能量数值", "energy update": "更新幅度", "update amount": "更新量", operator: "比较符号", threshold: "比较标记", "true path": "成立后的路线", number: "数字", choice: "选择" };

function translate(value) {
  return TEXT_TRANSLATIONS.get(value) || value;
}

function translateRuntimeText(value) {
  if (!value) return "世界正在等待。";
  const exact = new Map([
    ["Awaiting input.", "等待操作。"],
    ["World is listening.", "世界正在等待。"],
    ["The charge node is not reached yet.", "还没到充电站。"],
    ["Unit-0 has not reached the input rail.", "零号车还没到输入台。"],
    ["READ found empty memory. Write before read.", "读取器没有找到数据。先让记忆盒保存一个值。"],
    ["The gate has no data token. Read a value before choosing.", "判断门还没有收到数据。先让读取器送出一个值。"],
    ["Choice could not read both sides.", "判断门无法读出两侧的值。"],
    ["The gate received a different data token.", "判断门收到的不是它等待的那份数据。"],
    ["Deliver has no chosen path. Branch first.", "还没有选定路线。先让判断门作出选择。"],
    ["Only numbers can be updated.", "只有数字可以被更新。"],
    ["Unsupported instruction.", "这条指令暂时无法执行。"],
    ["Program stopped.", "程序已停止。"],
    ["Program has no instructions.", "程序还没有指令。"],
  ]);
  if (exact.has(value)) return exact.get(value);
  const move = value.match(/^MOVE → (.+)$/);
  if (move) return `移动 → ${NODE_TEXT[move[1]] || move[1]}`;
  const action = value.match(/^(CHARGE|PICKUP|WRITE|UPDATE|READ|BRANCH|PATH|DELIVER)\s+(.*)$/);
  if (action) {
    const labels = { CHARGE: "充电", PICKUP: "取走", WRITE: "写入", UPDATE: "更新", READ: "读取", BRANCH: "判断", PATH: "路线", DELIVER: "发送" };
    return `${labels[action[1]]}  ${action[2]}`.replace("relay received", "中继站已收到信号").replace("TRUE", "成立").replace("FALSE", "不成立");
  }
  return value
    .replace(/Update failed\. /, "更新失败：")
    .replace(/Memory ([\w-]+) is empty\./, "记忆盒 $1 还是空的。")
    .replace(/Unknown memory name\./, "找不到这个记忆名称。")
    .replace(/Branch paths must be named\./, "判断门的路线需要名称。")
    .replace(/Branch path is not declared by this scene\./, "这条路线不在当前场景中。")
    .replace(/TRUE →/g, "成立 →")
    .replace(/FALSE →/g, "不成立 →")
    .replace(/relay received/g, "中继站已收到信号");
}

function localizeCodeLine(line) {
  const parts = (line.parts || []).map((part) => {
    const next = { ...part };
    if (next.ariaLabel) next.ariaLabel = ARIA_TEXT[next.ariaLabel] || next.ariaLabel;
    return next;
  });
  return { ...line, parts };
}

function localizeLevel(source) {
  const display = { ...source };
  ["zone", "title", "story", "goal", "help", "successTitle", "successText"].forEach((key) => {
    display[key] = translate(source[key]);
  });
  display.hintSteps = (source.hintSteps || []).map(translate);
  display.failureCases = (source.failureCases || []).map((item) => ({ ...item, message: translate(item.message) }));
  if (source.lawBeat) display.lawBeat = { ...source.lawBeat, caption: translate(source.lawBeat.caption) };
  display.code = (nextProgram) => source.code(nextProgram).map(localizeCodeLine);
  return display;
}

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
  if (!level.law || seenLaws.has(level.law) || !uiLevel.lawBeat) {
    finishPresentation();
    return;
  }
  seenLaws.add(level.law);
  const beat = uiLevel.lawBeat;
  els.sceneCaption.textContent = beat.caption;
  els.sceneCaption.classList.add("visible");
  clearTimeout(lawCaptionTimer);
  world.playBeat(uiLevel, beat, () => {
    els.sceneCaption?.classList.remove("visible");
    finishPresentation();
  });
}

function startFirstLevel() {
  if (firstLevelStarted) return;
  firstLevelStarted = true;
  els.app?.setAttribute("data-intro-active", "false");
  els.app?.setAttribute("data-intro-complete", "true");
  showLevel(0);
}

const intro = new IntroSequence(els.intro, els.introCanvas, els.introCaption, els.introSignal, els.introButton, startFirstLevel, els.run);
const code = new CodePanel(els.lines, (nextProgram) => {
  if (presentationLocked || !runtime?.canEdit()) return;
  const previousProgram = program;
  const next = cloneProgram(nextProgram);
  program = next;
  displayProgram = next;
  if (!runtime.setProgram(next)) {
    program = previousProgram;
    displayProgram = previousProgram;
    return;
  }
  closeCard();
  render(runtime.state);
});

function showLevel(index) {
  setPresentationLock(true);
  levelIndex = index;
  level = getLevel(index);
  uiLevel = localizeLevel(level);
  hintIndexes.set(level.id, -1);
  program = createProgram(level);
  displayProgram = program;
  runtime?.stopLoop();
  runtime = new Runtime(level, program, (state) => render(state), (result) => handleFinish(result));
  els.zone.textContent = uiLevel.zone;
  els.title.textContent = uiLevel.title;
  els.story.textContent = uiLevel.story;
  els.goal.textContent = uiLevel.goal;
  els.levelNumber.textContent = String(level.id).padStart(2, "0");
  els.help.textContent = uiLevel.help || "先观察世界正在回应什么。";
  els.next.classList.remove("visible");
  els.next.disabled = true;
  els.sceneCaption.textContent = "";
  els.sceneCaption.classList.remove("visible");
  closeCard();
  render(runtime.state);
  playLawBeat();
}

function resetLevel() {
  closeCard();
  runtime.reset();
}

function render(state) {
  lastState = state;
  world.render(uiLevel, state);
  code.render(uiLevel, displayProgram, presentationLocked ? { ...state, phase: "demo" } : state);
  els.event.textContent = translateRuntimeText(state.event);
  els.message.textContent = translateRuntimeText(state.error || state.event);
  els.message.className = "runtime-message";
  if (state.phase === "error") els.message.classList.add("error");
  if (state.phase === "success") els.message.classList.add("success");
  const phaseLabels = { idle: "准备", demo: "世界演示中", running: "运行中", paused: "已暂停", error: "需要重置", success: "完成" };
  els.status.textContent = presentationLocked && state.phase === "idle" ? "正在展示" : (phaseLabels[state.phase] || "准备");
  els.missionChip.dataset.state = state.phase;
  els.lineState.textContent = "第 " + String(state.activeLine || 0).padStart(2, "0") + " 行 · " + (presentationLocked && state.phase === "idle" ? "展示中" : (phaseLabels[state.phase] || "准备"));
  els.lineStateWrap.className = "line-state " + state.phase;
  applyControlState(state);
  els.lines?.querySelectorAll(".move-button").forEach((button) => {
    button.setAttribute("aria-label", button.textContent === "↑" ? "上移这一行" : "下移这一行");
  });
  updateDots();
}

function updateDots() {
  els.dots.replaceChildren();
  levels.forEach((item, index) => {
    const dot = document.createElement("span");
    dot.className = "progress-dot";
    if (index === levelIndex) dot.classList.add("current");
    if (index < levelIndex) dot.classList.add("done");
    dot.title = translate(item.title);
    els.dots.append(dot);
  });
}

function handleFinish(result) {
  if (!result.ok) {
    showToast(result.text || "程序已停止，请重置后再试。");
    return;
  }
  els.toast.classList.remove("show");
  els.toast.textContent = "";
  els.next.classList.add("visible");
  els.cardKicker.textContent = levelIndex === levels.length - 1 ? "城市信号已恢复" : "信号已恢复";
  els.cardTitle.textContent = uiLevel.successTitle;
  els.cardText.textContent = uiLevel.successText;
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
  els.toast.textContent = translateRuntimeText(translate(message));
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
  const steps = uiLevel.hintSteps || [];
  if (!steps.length) return;
  const nextIndex = Math.min((hintIndexes.get(level.id) ?? -1) + 1, steps.length - 1);
  hintIndexes.set(level.id, nextIndex);
  els.help.textContent = steps[nextIndex];
  showToast(steps[nextIndex]);
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
