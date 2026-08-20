import { MAX_EVENTS, cloneProgram, evaluateSuccess, formatWorldText, getDisplayLines, getScene, getWorldItemLabel, getWorldLabel, normalizeProgram } from "./levels.js";
import { edgeControlPoints, pointOnEdge } from "./geometry.js";
import { findEdgePath, isAuthoredEdge } from "./scene-graph.js";

const OPERATORS = new Set([">", "<", "=="]);
const INSTRUCTION_TYPES = new Set(["move", "charge", "pickup", "deliver", "write", "update", "branch"]);
const MAX_INSTRUCTIONS = MAX_EVENTS;
const MAX_WORLD_EVENTS = 256;
const clone = (value) => JSON.parse(JSON.stringify(value));

const fail = (message, line = 0) => ({ ok: false, message, line });

function memoryNamesFor(level) { return new Set(level.memoryNames || []); }

function validateValueExpr(level, expr, depth = 0) {
  if (!expr || typeof expr !== "object" || depth > 8) return fail("数值表达式无效。");
  if (expr.type === "literal") {
    const valid = (typeof expr.value === "number" && Number.isFinite(expr.value))
      || (typeof expr.value === "string" && expr.value.length > 0);
    return valid ? { ok: true } : fail("字面值必须是有限数字或非空文本。");
  }
  if (expr.type === "memory") return memoryNamesFor(level).has(expr.name) ? { ok: true } : fail("记忆名称不存在。");
  if (expr.type === "add" || expr.type === "subtract") {
    const left = validateValueExpr(level, expr.left, depth + 1);
    if (!left.ok) return left;
    return validateValueExpr(level, expr.right, depth + 1);
  }
  return fail("不认识这种数值表达式。");
}

function validateInstruction(level, item, index) {
  const line = index + 1;
  if (!item || typeof item !== "object" || !INSTRUCTION_TYPES.has(item.type)) return fail("不认识这条指令。", line);
  if (typeof item.id !== "string" || !item.id) return fail("每条指令都需要稳定的 id。", line);
  const scene = getScene(level);
  const nodes = new Set(scene.nodes.map((node) => node.id));
  if (item.type === "move") return nodes.has(item.to) ? { ok: true } : fail("移动目标不在这张轨道图上。", line);
  if (item.type === "charge") return Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= 9 ? { ok: true } : fail("充电数值必须是 0 到 9 的整数。", line);
  if (item.type === "pickup") return typeof item.item === "string" && nodes.has(item.at || item.item) ? { ok: true } : fail("取物目标无效。", line);
  if (item.type === "deliver") return nodes.has(item.to || "relay") ? { ok: true } : fail("交付目标不在这张轨道图上。", line);
  if (item.type === "write" || item.type === "update") {
    if (!memoryNamesFor(level).has(item.name)) return fail(`${item.type === "write" ? "写入" : "更新"}引用了不存在的记忆。`, line);
    const value = validateValueExpr(level, item.value);
    return value.ok ? value : { ...value, line };
  }
  if (!OPERATORS.has(item.operator)) return fail("判断方式无效。", line);
  if (item.left?.type !== "memory") return fail("判断门需要从记忆盒接收一个值。", line);
  const left = validateValueExpr(level, item.left);
  if (!left.ok) return { ...left, line };
  const right = validateValueExpr(level, item.right);
  if (!right.ok) return { ...right, line };
  if (typeof item.pass !== "string" || typeof item.fail !== "string") return fail("判断路线必须有名称。", line);
  const outgoing = new Set((scene.edges || []).filter(([from]) => from === scene.branchNode).map(([, to]) => to));
  if (!outgoing.has(item.pass) || !outgoing.has(item.fail)) return fail("判断路线不是当前场景声明的真实轨道。", line);
  return { ok: true };
}

export function validateProgram(level, rawProgram) {
  let program;
  try {
    program = normalizeProgram(level, rawProgram);
  } catch (error) {
    return fail(error.message || "程序格式无效。", error.line || 0);
  }
  if (!Array.isArray(program.instructions) || program.instructions.length === 0) return fail("程序还没有指令。");
  if (program.instructions.length > MAX_INSTRUCTIONS) return fail(`程序不能超过 ${MAX_INSTRUCTIONS} 条指令。`);
  const seenIds = new Set();
  for (let index = 0; index < program.instructions.length; index += 1) {
    const item = program.instructions[index];
    if (typeof item?.id === "string" && item.id) {
      if (seenIds.has(item.id)) return fail(`指令 id 重复：${item.id}；每条指令的 id 必须唯一。`, index + 1);
      seenIds.add(item.id);
    }
    const result = validateInstruction(level, item, index);
    if (!result.ok) return result;
  }
  return { ok: true, program };
}

function sceneNode(level, id) { return getScene(level).nodes.find((node) => node.id === id); }

function eventTarget(item) {
  if (item.type === "move") return item.to;
  if (item.type === "charge") return "charge";
  if (item.type === "pickup") return item.at || item.item;
  if (item.type === "write" || item.type === "update") return "memory";
  return item.to || "relay";
}

class EventAllocator {
  constructor() { this.occurrences = new Map(); }

  allocate(instructionId, kind) {
    const key = `${instructionId}:${kind}`;
    const occurrence = this.occurrences.get(key) || 0;
    this.occurrences.set(key, occurrence + 1);
    return { id: `${instructionId}:${kind}:${occurrence}`, occurrence };
  }
}

function makeEvent(allocator, item, sourceLine, displayLine, kind, payload = {}) {
  const identity = allocator.allocate(item.id, kind);
  return {
    id: identity.id,
    instructionId: item.id,
    sourceLine,
    displayLine,
    kind,
    occurrence: identity.occurrence,
    instruction: clone(item),
    payload: clone(payload),
  };
}

function staticValue(expr, memory) {
  if (expr?.type === "literal") return expr.value;
  if (expr?.type === "memory") return memory.has(expr.name) ? memory.get(expr.name) : null;
  if (expr?.type === "add" || expr?.type === "subtract") {
    const left = staticValue(expr.left, memory);
    const right = staticValue(expr.right, memory);
    if (typeof left !== "number" || typeof right !== "number") return null;
    return expr.type === "add" ? left + right : left - right;
  }
  return null;
}

function staticCalculation(item, memory) {
  const oldValue = memory.has(item.name) ? memory.get(item.name) : null;
  if (item.value?.type === "add" || item.value?.type === "subtract") {
    const leftValue = staticValue(item.value.left, memory);
    const rightValue = staticValue(item.value.right, memory);
    const operator = item.value.type === "add" ? "+" : "-";
    const newValue = typeof leftValue === "number" && typeof rightValue === "number"
      ? (operator === "+" ? leftValue + rightValue : leftValue - rightValue)
      : null;
    return { oldValue, leftValue, operator, rightValue, newValue };
  }
  const rightValue = staticValue(item.value, memory);
  const newValue = typeof oldValue === "number" && typeof rightValue === "number" ? oldValue + rightValue : null;
  return { oldValue, leftValue: oldValue, operator: "+", rightValue, newValue };
}

function compareValues(left, operator, right) {
  if (operator === "==") return typeof left === typeof right && left === right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  return operator === ">" ? left > right : left < right;
}

function displayLineFor(displayLines, item, role = "condition") {
  return displayLines.get(item.id)?.[role] || displayLines.get(item.id)?.condition || 1;
}

function addRoute(level, allocator, events, from, to, item, sourceLine, displayLine) {
  const route = findEdgePath(getScene(level), from, to);
  if (!route) {
    events.push(makeEvent(allocator, item, sourceLine, displayLine, "unreachable", { actor: "unit", from, to }));
    return false;
  }
  for (const edge of route.edges) {
    events.push(makeEvent(allocator, item, sourceLine, displayLine, "traverse", { actor: "unit", from: edge.from, to: edge.to }));
  }
  return true;
}

function addStoreEvents(allocator, events, item, sourceLine, displayLine, oldValue, newValue) {
  events.push(makeEvent(allocator, item, sourceLine, displayLine, "store-memory", { stage: "receive", name: item.name, newValue }));
  events.push(makeEvent(allocator, item, sourceLine, displayLine, "store-memory", { stage: "commit", name: item.name, oldValue, newValue }));
}

function addBranchEvents(level, allocator, events, item, sourceLine, displayLines, memoryModel) {
  const displayLine = displayLineFor(displayLines, item);
  const value = staticValue(item.left, memoryModel);
  const right = staticValue(item.right, memoryModel);
  const result = compareValues(value, item.operator, right);
  events.push(makeEvent(allocator, item, sourceLine, displayLine, "load-memory", { name: item.left.name, value }));
  if (!isAuthoredEdge(getScene(level), "memory", "gate")) {
    events.push(makeEvent(allocator, item, sourceLine, displayLine, "unreachable", { actor: "token", from: "memory", to: "gate" }));
    return;
  }
  events.push(makeEvent(allocator, item, sourceLine, displayLineFor(displayLines, item, "pass"), "token-traverse", { actor: "token", from: "memory", to: "gate", name: item.left.name, value }));
  events.push(makeEvent(allocator, item, sourceLine, displayLine, "gate-receive", { name: item.left.name, value }));
  events.push(makeEvent(allocator, item, sourceLine, displayLine, "gate-compare", { left: value, operator: item.operator, right, result }));
  events.push(makeEvent(allocator, item, sourceLine, displayLineFor(displayLines, item, result ? "pass" : "fail"), "gate-route", { path: result ? item.pass : item.fail, result }));
  events.push(makeEvent(allocator, item, sourceLine, displayLineFor(displayLines, item, result ? "pass" : "fail"), "gate-consume", { name: item.left.name, value }));
}

export function compileProgram(level, rawProgram) {
  const validation = validateProgram(level, rawProgram);
  if (!validation.ok) return validation;
  const program = cloneProgram(validation.program);
  const events = [];
  const allocator = new EventAllocator();
  const displayLines = getDisplayLines(level, program);
  const memoryModel = new Map();
  let cursor = getScene(level).nodes[0]?.id;

  for (const [index, item] of program.instructions.entries()) {
    const sourceLine = index + 1;
    const displayLine = displayLineFor(displayLines, item);
    if (item.type === "branch") {
      addBranchEvents(level, allocator, events, item, sourceLine, displayLines, memoryModel);
      continue;
    }

    const target = eventTarget(item);
    if (item.type === "deliver" && getScene(level).branchNode) {
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "deliver", { stage: "dynamic", to: target }));
      continue;
    }

    const reached = ["move", "charge", "pickup", "write", "update", "deliver"].includes(item.type)
      ? addRoute(level, allocator, events, cursor, target, item, sourceLine, displayLine)
      : true;
    if (reached) cursor = target;

    if (item.type === "charge") {
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "charge", { amount: item.amount }));
    } else if (item.type === "pickup") {
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "pickup", { item: item.item, at: target }));
    } else if (item.type === "write") {
      const oldValue = memoryModel.has(item.name) ? memoryModel.get(item.name) : null;
      const newValue = staticValue(item.value, memoryModel);
      addStoreEvents(allocator, events, item, sourceLine, displayLine, oldValue, newValue);
      memoryModel.set(item.name, newValue);
    } else if (item.type === "update") {
      const calculation = staticCalculation(item, memoryModel);
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "load-memory", { name: item.name, value: calculation.oldValue }));
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "calculate", {
        name: item.name,
        leftValue: calculation.leftValue,
        operator: calculation.operator,
        rightValue: calculation.rightValue,
        newValue: calculation.newValue,
      }));
      addStoreEvents(allocator, events, item, sourceLine, displayLine, calculation.oldValue, calculation.newValue);
      memoryModel.set(item.name, calculation.newValue);
    } else if (item.type === "deliver") {
      events.push(makeEvent(allocator, item, sourceLine, displayLine, "deliver", { to: target }));
    }
  }

  if (events.length > MAX_WORLD_EVENTS) return fail(`程序展开后超过 ${MAX_WORLD_EVENTS} 个世界事件。`);
  return { ok: true, program, events, allocator };
}

export function evaluateValue(expr, state) {
  if (expr?.type === "literal") return { ok: true, value: expr.value };
  if (expr?.type === "memory") {
    if (!Object.prototype.hasOwnProperty.call(state.vars || {}, expr.name)) return fail(`记忆盒里的 ${expr.name} 还是空的。`);
    return { ok: true, value: state.vars[expr.name] };
  }
  if (expr?.type !== "add" && expr?.type !== "subtract") return fail("数值表达式无效。");
  const left = evaluateValue(expr.left, state);
  if (!left.ok) return left;
  const right = evaluateValue(expr.right, state);
  if (!right.ok) return right;
  if (typeof left.value !== "number" || typeof right.value !== "number") return fail("只有数字可以参与 update。");
  return { ok: true, value: expr.type === "add" ? left.value + right.value : left.value - right.value };
}

function initialState(level) {
  const first = getScene(level).nodes[0];
  return {
    phase: "idle", eventCursor: 0, pc: 0, activeLine: 0, activeInstructionId: "", activeEdge: null,
    vars: {}, energy: 0, memoryKey: "", dataToken: null, tokenPosition: null,
    pendingStore: null, pendingCalculation: null, pendingBranch: null,
    tokenTransfer: { phase: "none", id: 0, name: "", value: null, edge: null }, tokenAnimation: null, tokenEdge: null,
    comparison: null, carried: null, path: "", gateBranch: null, gateOpen: false,
    relayInstalled: false, coreLocation: level.worldRules?.relayCore ? "dock" : "无", relaySocket: level.worldRules?.relayCore ? "empty" : "none",
    unitNode: first.id, unit: { x: first.x, y: first.y }, delivered: false, unitMoved: false,
    anim: null, event: "等待操作。", eventType: "idle", mood: "idle", eventLog: [], error: "", errorLine: 0, success: false,
  };
}

function errorState(state, message, line) {
  const displayMessage = formatWorldText(null, message);
  return {
    ...state,
    phase: "error",
    eventType: "error",
    mood: displayMessage.includes("插槽") ? "puzzled" : "error",
    error: displayMessage,
    errorLine: line,
    event: displayMessage,
    anim: null,
    activeEdge: null,
    tokenEdge: null,
    eventLog: [...state.eventLog, `错误 // 第 ${line} 行`],
  };
}

function checkRequirements(level, state, requirements = []) {
  for (const requirement of requirements) {
    if (requirement.type === "memoryMin" && Number(state.vars?.[requirement.name] ?? 0) < Number(requirement.value)) return "中继站收到的 energy 还不够。";
    if (requirement.type === "carried" && state.carried !== requirement.value) return "Unit-0 到达中继站时没有带着需要的物件。";
    if (requirement.type === "memoryExists" && !Object.prototype.hasOwnProperty.call(state.vars || {}, requirement.name)) return `记忆盒里的 ${requirement.name} 还是空的。`;
  }
  return "";
}

function calculationPayload(item, state) {
  const oldValue = state.vars[item.name];
  if (item.value?.type === "add" || item.value?.type === "subtract") {
    const left = evaluateValue(item.value.left, state);
    const right = evaluateValue(item.value.right, state);
    if (!left.ok || !right.ok) return { ok: false, message: left.ok ? right.message : left.message };
    return {
      ok: true,
      payload: {
        name: item.name,
        leftValue: left.value,
        operator: item.value.type === "add" ? "+" : "-",
        rightValue: right.value,
        newValue: item.value.type === "add" ? left.value + right.value : left.value - right.value,
      },
      oldValue,
    };
  }
  const right = evaluateValue(item.value, state);
  if (!right.ok || typeof oldValue !== "number" || typeof right.value !== "number") return { ok: false, message: "update 需要两个数字。" };
  return { ok: true, payload: { name: item.name, leftValue: oldValue, operator: "+", rightValue: right.value, newValue: oldValue + right.value }, oldValue };
}

function applyEvent(level, state, event) {
  const item = event.instruction;
  let next = {
    ...state,
    vars: { ...state.vars },
    activeLine: event.displayLine,
    activeInstructionId: event.instructionId || item.id || "",
    eventType: event.kind,
    mood: ["gate-receive", "gate-compare", "gate-route", "gate-consume"].includes(event.kind) ? "thinking" : ["store-memory", "load-memory", "calculate", "token-traverse"].includes(event.kind) ? "transfer" : "move",
    eventLog: [...state.eventLog, `${event.kind} // 第 ${event.sourceLine} 行`],
    error: "",
    errorLine: 0,
  };

  if (event.kind === "traverse") {
    next.event = `Unit-0 沿轨道前往 ${getWorldLabel(level, event.payload.to)}`;
    next.unitMoved = true;
    return next;
  }
  if (event.kind === "unreachable") return errorState(state, `${getWorldLabel(level, event.payload.from)} 和 ${getWorldLabel(level, event.payload.to)} 之间没有已绘制的轨道。`, event.sourceLine);

  if (event.kind === "store-memory") {
    const { stage, name, newValue, oldValue = null } = event.payload;
    if (stage === "receive") {
      let value = newValue;
      if (value === null) {
        const result = evaluateValue(item.value, state);
        if (!result.ok) return errorState(state, result.message, event.sourceLine);
        value = result.value;
      }
      next.pendingStore = { name, oldValue: state.vars[name] ?? null, newValue: value };
      next.dataToken = { name, value };
      next.tokenPosition = "memory";
      next.tokenTransfer = { phase: "memory", id: state.tokenTransfer.id + 1, name, value, edge: null };
      next.event = `记忆盒接收 ${name} = ${value}`;
      return next;
    }
    if (stage === "commit") {
      const value = next.pendingStore?.name === name ? next.pendingStore.newValue : newValue;
      next.vars[name] = value;
      if (name === (level.worldRules?.chargeMemory || "energy")) next.energy = Number(value) || 0;
      next.memoryKey = name;
      next.dataToken = { name, value };
      next.tokenPosition = "memory";
      next.pendingStore = null;
      next.pendingCalculation = null;
      next.event = `记忆盒保存 ${name} = ${value}`;
      return next;
    }
  }

  if (event.kind === "load-memory") {
    const { name } = event.payload;
    if (!Object.prototype.hasOwnProperty.call(state.vars, name)) return errorState(state, `记忆盒里的 ${name} 还是空的。`, event.sourceLine);
    const value = state.vars[name];
    next.dataToken = { name, value };
    next.tokenPosition = "memory";
    next.memoryKey = name;
    if (item.type === "update") next.pendingCalculation = { name, oldValue: value };
    if (item.type === "branch") next.pendingBranch = { name, value };
    next.tokenTransfer = { phase: "memory", id: state.tokenTransfer.id + 1, name, value, edge: null };
    next.event = `加载 ${name} = ${value}`;
    return next;
  }

  if (event.kind === "calculate") {
    const calculation = calculationPayload(item, state);
    if (!calculation.ok) return errorState(state, calculation.message, event.sourceLine);
    next.pendingStore = { name: item.name, oldValue: calculation.oldValue, newValue: calculation.payload.newValue };
    next.pendingCalculation = null;
    next.dataToken = { name: item.name, value: calculation.payload.newValue };
    next.tokenPosition = "memory";
    next.event = `计算 ${item.name}：${calculation.payload.leftValue} ${calculation.payload.operator} ${calculation.payload.rightValue} = ${calculation.payload.newValue}`;
    return next;
  }

  if (event.kind === "token-traverse") {
    next.tokenPosition = event.payload.to;
    next.tokenEdge = { from: event.payload.from, to: event.payload.to };
    next.tokenTransfer = { phase: "memory-to-gate", id: state.tokenTransfer.id + 1, name: event.payload.name, value: event.payload.value, edge: next.tokenEdge };
    next.tokenAnimation = { phase: "memory-to-gate", edge: next.tokenEdge, progress: 0 };
    next.event = `数据沿直连轨道前往 ${getWorldLabel(level, event.payload.to)}`;
    return next;
  }

  if (event.kind === "gate-receive") {
    if (!state.pendingBranch || state.tokenPosition !== "gate") return errorState(state, "判断门还没有收到记忆盒里的值。", event.sourceLine);
    next.event = `判断门收到 ${event.payload.name} = ${event.payload.value}`;
    next.tokenTransfer = { ...state.tokenTransfer, phase: "gate", edge: null };
    next.tokenAnimation = { phase: "gate", edge: null, progress: 1 };
    return next;
  }

  if (event.kind === "gate-compare") {
    if (!state.pendingBranch || state.tokenPosition !== "gate") return errorState(state, "判断门还没有准备好。", event.sourceLine);
    const left = evaluateValue(item.left, state);
    const right = evaluateValue(item.right, state);
    if (!left.ok || !right.ok) return errorState(state, "判断门无法完成比较。", event.sourceLine);
    const result = compareValues(left.value, item.operator, right.value);
    next.comparison = { left: left.value, operator: item.operator, right: right.value, result, path: "" };
    next.event = `判断 ${left.value} ${item.operator} ${right.value} · ${result ? "成立" : "不成立"}`;
    return next;
  }

  if (event.kind === "gate-route") {
    if (!state.comparison) return errorState(state, "判断门还没有完成比较。", event.sourceLine);
    next.path = event.payload.path;
    next.gateBranch = event.payload.result ? "accept" : "reject";
    next.gateOpen = true;
    next.comparison = { ...state.comparison, path: next.path };
    next.event = `判断门打开 ${getWorldLabel(level, next.path)}`;
    return next;
  }

  if (event.kind === "gate-consume") {
    next.dataToken = null;
    next.tokenPosition = null;
    next.pendingBranch = null;
    next.tokenAnimation = null;
    next.tokenEdge = null;
    next.tokenTransfer = { ...state.tokenTransfer, phase: "consumed", edge: null };
    next.event = "判断门已消费这份数据";
    return next;
  }

  if (event.kind === "charge") {
    if (state.unitNode !== "charge") return errorState(state, "Unit-0 还没有到充电站。", event.sourceLine);
    const name = level.worldRules?.chargeMemory || "energy";
    next.energy = (state.energy || 0) + event.payload.amount;
    next.vars[name] = next.energy;
    next.memoryKey = name;
    next.dataToken = { name, value: next.energy };
    next.tokenPosition = "memory";
    next.event = `充电完成  ${name} = ${next.energy}`;
    return next;
  }

  if (event.kind === "pickup") {
    if (state.unitNode !== event.payload.at) return errorState(state, "Unit-0 还没有到取物点。", event.sourceLine);
    next.carried = event.payload.item;
    if (event.payload.item === "relay_core") next.coreLocation = "carried";
    next.event = `取走 ${getWorldItemLabel(level, event.payload.item)}`;
    return next;
  }

  if (event.kind === "deliver") {
    const target = event.payload.to || item.to || "relay";
    const requirementError = checkRequirements(level, state, level.worldRules?.deliver || []);
    if (requirementError) return errorState(state, requirementError, event.sourceLine);
    if (level.worldRules?.relayCore && state.carried !== level.worldRules.relayCore) {
      next.relaySocket = "empty";
      next.mood = "puzzled";
      return errorState(next, `${getWorldLabel(level, target)} 的插槽是空的，Unit-0 有点困惑：先把 ${getWorldItemLabel(level, level.worldRules.relayCore)} 带来。`, event.sourceLine);
    }
    if (level.worldRules?.relayCore) {
      next.relayInstalled = true;
      next.coreLocation = target;
      next.carried = null;
      next.relaySocket = "sealed";
    }
    next.delivered = true;
    next.event = `${getWorldLabel(level, target)} 已收到交付`;
    return next;
  }

  return errorState(state, "暂不支持这条指令。", event.sourceLine);
}

export class Runtime {
  constructor(level, program, onUpdate, onFinish) {
    this.level = level;
    this.onUpdate = onUpdate;
    this.onFinish = onFinish;
    const validation = validateProgram(level, program);
    if (!validation.ok) throw new TypeError(`程序无效${validation.line ? `（第 ${validation.line} 行）` : ""}：${validation.message}`);
    this.program = validation.program;
    this.executionProgram = this.program;
    this.events = [];
    this.steps = this.events;
    this.task = null;
    this.frame = 0;
    this.lastTime = 0;
    this.singleStep = false;
    this.mode = "idle";
    this.allocator = null;
    this.reset();
  }

  get eventCursor() { return this.state.eventCursor; }
  canEdit() { return this.state.phase === "idle" || this.state.phase === "error"; }
  setProgram(program) {
    if (!this.canEdit()) return false;
    const validation = validateProgram(this.level, program);
    if (!validation.ok) return false;
    this.program = validation.program;
    this.reset();
    return true;
  }
  getProgram() { return cloneProgram(this.program); }
  getState() { return this.snapshotState(); }
  snapshot() { return this.snapshotState(); }
  getEvents() { return clone(this.events); }

  reset() {
    this.stopLoop();
    const compiled = compileProgram(this.level, this.program);
    this.executionProgram = compiled.program || this.program;
    this.events = compiled.events || [];
    this.steps = this.events;
    this.allocator = compiled.allocator || new EventAllocator();
    this.task = null;
    this.lastTime = 0;
    this.singleStep = false;
    this.mode = "idle";
    this.state = initialState(this.level);
    if (!compiled.ok) this.state = errorState(this.state, compiled.message, compiled.line);
    this.notify();
  }

  run() {
    if (["running", "success"].includes(this.state.phase) || this.state.phase === "error") return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) { this.state = errorState(this.state, compiled.message, compiled.line); this.notify(); return false; }
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
      this.allocator = compiled.allocator;
    }
    this.mode = "run";
    this.singleStep = false;
    this.state = { ...this.state, phase: "running" };
    this.notify();
    this.startLoop();
    return true;
  }

  pause() {
    if (this.state.phase !== "running") return false;
    this.state = { ...this.state, phase: "paused" };
    this.stopLoop();
    this.notify();
    return true;
  }

  stepOnce() {
    if (["success", "error"].includes(this.state.phase)) return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) { this.state = errorState(this.state, compiled.message, compiled.line); this.notify(); return false; }
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
      this.allocator = compiled.allocator;
    }
    if (this.state.phase === "running") return false;
    this.mode = "run";
    this.singleStep = true;
    this.state = { ...this.state, phase: "running" };
    this.notify();
    if (typeof document === "undefined") {
      this.beginEvent(this.events[this.state.eventCursor]);
      if (this.state.phase !== "error") this.completeEvent();
      if (this.state.phase === "running") this.state = { ...this.state, phase: "paused" };
      this.notify();
    } else this.startLoop();
    return true;
  }

  step() { return this.stepOnce(); }

  runToEnd() {
    if (["success", "error"].includes(this.state.phase)) return this.snapshotState();
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) throw new TypeError(compiled.message);
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
      this.allocator = compiled.allocator;
    }
    this.mode = "run";
    this.state = { ...this.state, phase: "running" };
    this.notify();
    while (this.state.phase === "running" && this.state.eventCursor < this.events.length) {
      this.beginEvent(this.events[this.state.eventCursor]);
      if (this.state.phase === "error") break;
      this.completeEvent();
    }
    if (this.state.phase === "running" && this.state.eventCursor >= this.events.length) this.finish();
    return this.snapshotState();
  }

  durationFor(kind) {
    if (kind === "traverse" || kind === "token-traverse") return 330;
    if (kind === "gate-consume") return 180;
    return 220;
  }

  startLoop() { this.stopLoop(); this.lastTime = globalThis.performance?.now?.() ?? Date.now(); this.frame = this.requestFrame((time) => this.tick(time)); }
  requestFrame(callback) { return typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(callback) : setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16); }
  cancelFrame(handle) { if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle); else clearTimeout(handle); }
  stopLoop() { if (this.frame) this.cancelFrame(this.frame); this.frame = 0; }

  expandDynamicDeliver(event) {
    const target = event.payload.to || event.instruction.to || "relay";
    const path = this.state.path;
    const first = findEdgePath(getScene(this.level), this.state.unitNode, path);
    const second = first ? findEdgePath(getScene(this.level), path, target) : null;
    if (!first || !second) {
      this.events.splice(this.state.eventCursor, 1, {
        ...event,
        kind: "unreachable",
        payload: { actor: "unit", from: this.state.unitNode, to: path || target },
      });
      this.steps = this.events;
      return;
    }
    const expanded = [];
    for (const edge of [...first.edges, ...second.edges]) {
      expanded.push(makeEvent(this.allocator, event.instruction, event.sourceLine, event.displayLine, "traverse", { actor: "unit", from: edge.from, to: edge.to }));
    }
    expanded.push({ ...event, payload: { to: target } });
    this.events.splice(this.state.eventCursor, 1, ...expanded);
    this.steps = this.events;
  }

  tick(time) {
    if (this.state.phase !== "running") return;
    const delta = Math.min(80, time - this.lastTime || 16);
    this.lastTime = time;
    if (!this.task) {
      if (this.state.eventCursor >= this.events.length) { this.finish(); return; }
      this.beginEvent(this.events[this.state.eventCursor]);
      if (this.state.phase === "error") return;
    }
    this.task.elapsed += delta;
    const progress = Math.min(1, this.task.elapsed / this.task.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const next = { ...this.state, anim: { from: this.task.from, to: this.task.to, progress: eased } };
    if (this.task.event.kind === "traverse") next.unit = pointOnEdge(edgeControlPoints(this.task.from, this.task.to), eased);
    if (this.task.event.kind === "token-traverse") next.tokenAnimation = { ...next.tokenAnimation, progress: eased };
    this.state = next;
    if (progress >= 1) this.completeEvent();
    this.notify();
    if (this.state.phase === "running") this.frame = this.requestFrame((nextTime) => this.tick(nextTime));
  }

  beginEvent(event) {
    if (!event) { this.finish(); return; }
    if (event.kind === "deliver" && event.payload.stage === "dynamic") {
      this.expandDynamicDeliver(event);
      event = this.events[this.state.eventCursor];
    }
    const target = event.kind === "traverse" ? event.payload.to : event.kind === "token-traverse" ? event.payload.to : event.kind === "unreachable" ? this.state.unitNode : this.state.unitNode;
    const node = sceneNode(this.level, target) || sceneNode(this.level, this.state.unitNode);
    if (!node) { this.state = errorState(this.state, "目标不在这张轨道图上。", event.sourceLine); this.notify(); return; }
    const fromNode = sceneNode(this.level, this.state.unitNode) || getScene(this.level).nodes[0];
    const from = { x: fromNode.x, y: fromNode.y };
    const to = { x: node.x, y: node.y };
    this.task = { event, from, to, elapsed: 0, duration: this.durationFor(event.kind) };
    this.state = applyEvent(this.level, this.state, event);
    this.state = {
      ...this.state,
      activeEdge: event.kind === "traverse" && event.payload.actor === "unit" ? { from: event.payload.from, to: event.payload.to } : null,
    };
    if (this.state.phase === "error") {
      this.stopLoop();
      this.task = null;
      this.notify();
      this.onFinish?.({ ok: false, text: this.state.error, state: this.snapshotState() });
    }
    this.notify();
  }

  completeEvent() {
    if (!this.task) return;
    const event = this.task.event;
    if (event.kind === "traverse") {
      const node = sceneNode(this.level, event.payload.to);
      if (node) this.state = { ...this.state, unitNode: node.id, unit: { x: node.x, y: node.y }, activeEdge: null };
    }
    if (event.kind === "token-traverse") this.state = { ...this.state, tokenPosition: event.payload.to, tokenAnimation: { phase: "gate", edge: null, progress: 1 }, tokenEdge: null };
    this.state = { ...this.state, anim: null, activeEdge: null, eventCursor: this.state.eventCursor + 1, pc: this.state.eventCursor + 1 };
    this.task = null;
    if (this.state.eventCursor >= this.events.length) { this.finish(); return; }
    if (this.singleStep) {
      this.singleStep = false;
      this.state = { ...this.state, phase: "paused" };
      this.stopLoop();
    }
  }

  finish() {
    this.stopLoop();
    this.task = null;
    const ok = evaluateSuccess(this.level, this.executionProgram, this.state);
    const text = ok ? this.level.successText : (this.state.error || this.level.failureCases?.[0]?.message || "程序没有完成，请重置后再试。");
    const displayText = formatWorldText(this.level, text);
    this.state = { ...this.state, phase: ok ? "success" : "error", success: ok, eventType: ok ? "success" : "error", event: displayText, error: ok ? "" : displayText, activeLine: ok ? 0 : this.state.activeLine };
    this.notify();
    this.onFinish?.({ ok, text: displayText, state: this.snapshotState() });
  }

  snapshotState() { return clone(this.state); }
  notify() { this.onUpdate?.(this.snapshotState()); }
}
