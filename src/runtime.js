import { MAX_EVENTS, cloneProgram, evaluateSuccess, getScene, normalizeProgram } from "./levels.js";
import { edgeControlPoints, pointOnEdge } from "./geometry.js";
import { findEdgePath } from "./scene-graph.js";

const OPERATORS = new Set([">", "<", "=="]);
const INSTRUCTION_TYPES = new Set(["move", "charge", "pickup", "deliver", "read", "write", "update", "branch"]);
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
  const scene = getScene(level);
  const nodes = new Set(scene.nodes.map((node) => node.id));
  if (item.type === "move") return nodes.has(item.to) ? { ok: true } : fail("移动目标不在这张轨道图上。", line);
  if (item.type === "charge") return Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= 9 ? { ok: true } : fail("充电数值必须是 0 到 9 的整数。", line);
  if (item.type === "pickup") return typeof item.item === "string" && nodes.has(item.at || "pickup") ? { ok: true } : fail("取物目标无效。", line);
  if (item.type === "deliver") return nodes.has(item.to || "exit") ? { ok: true } : fail("发送目标不在这张轨道图上。", line);
  if (item.type === "read") return memoryNamesFor(level).has(item.name) ? { ok: true } : fail("读取引用了不存在的记忆。", line);
  if (item.type === "write" || item.type === "update") {
    if (!memoryNamesFor(level).has(item.name)) return fail(`${item.type === "write" ? "写入" : "更新"}引用了不存在的记忆。`, line);
    return validateValueExpr(level, item.value);
  }
  if (!OPERATORS.has(item.operator)) return fail("判断方式无效。", line);
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
  const program = normalizeProgram(level, rawProgram);
  if (!Array.isArray(program.instructions) || program.instructions.length === 0) return fail("程序还没有指令。");
  if (program.instructions.length > MAX_INSTRUCTIONS) return fail(`程序不能超过 ${MAX_INSTRUCTIONS} 条指令。`);
  for (let index = 0; index < program.instructions.length; index += 1) {
    const result = validateInstruction(level, program.instructions[index], index);
    if (!result.ok) return result;
  }
  return { ok: true, program };
}

function sceneNode(level, id) { return getScene(level).nodes.find((node) => node.id === id); }
function eventTarget(item) {
  if (item.type === "move") return item.to;
  if (item.type === "charge") return "charge";
  if (item.type === "pickup") return item.at || "pickup";
  if (item.type === "write" || item.type === "update") return "memory";
  if (item.type === "read") return "reader";
  if (item.type === "branch") return "gate";
  return item.to || "exit";
}

function baseEvent(item, line, kind, id) {
  return { id, instructionId: item.id, sourceLine: line, line, kind, instruction: clone(item), duration: kind === "traverse" ? 330 : 220 };
}

function routeEvents(level, from, to, item, line, events) {
  const route = findEdgePath(getScene(level), from, to);
  if (!route) {
    events.push({ ...baseEvent(item, line, "unreachable", events.length), from, to, target: to });
    return false;
  }
  for (const edge of route.edges) events.push({ ...baseEvent(item, line, "traverse", events.length), from: edge.from, to: edge.to, target: edge.to });
  return true;
}

export function compileProgram(level, rawProgram) {
  const validation = validateProgram(level, rawProgram);
  if (!validation.ok) return validation;
  const program = cloneProgram(validation.program);
  const events = [];
  let cursor = getScene(level).nodes[0]?.id;
  for (const [index, item] of program.instructions.entries()) {
    const line = index + 1;
    const target = eventTarget(item);
    if (item.type === "deliver" && getScene(level).branchNode) {
      events.push({ ...baseEvent(item, line, "dynamic-deliver", events.length), stage: "path", target: "path" });
      cursor = item.to || "exit";
      continue;
    }
    const reached = item.type === "move" || item.type === "charge" || item.type === "pickup" || item.type === "write" || item.type === "update" || item.type === "read" || item.type === "branch" || item.type === "deliver"
      ? routeEvents(level, cursor, target, item, line, events)
      : true;
    if (reached) cursor = target;
    if (item.type !== "move") {
      if (item.type === "write") {
        events.push({ ...baseEvent(item, line, "write-receive", events.length), target });
        events.push({ ...baseEvent(item, line, "write-commit", events.length), target });
      } else if (item.type === "update") {
        events.push({ ...baseEvent(item, line, "update-read", events.length), target });
        events.push({ ...baseEvent(item, line, "update-write", events.length), target });
      } else if (item.type === "branch") {
        events.push({ ...baseEvent(item, line, "branch-receive", events.length), target });
        events.push({ ...baseEvent(item, line, "branch-compare", events.length), target });
        events.push({ ...baseEvent(item, line, "branch-route", events.length), target });
        events.push({ ...baseEvent(item, line, "consume", events.length), target: "gate", duration: 180 });
      } else events.push({ ...baseEvent(item, line, item.type, events.length), target });
    }
  }
  if (events.length > MAX_WORLD_EVENTS) return fail(`程序展开后超过 ${MAX_WORLD_EVENTS} 个世界事件。`);
  return { ok: true, program, events };
}

export function evaluateValue(expr, state) {
  if (expr.type === "literal") return { ok: true, value: expr.value };
  if (expr.type === "memory") {
    if (!Object.prototype.hasOwnProperty.call(state.vars, expr.name)) return fail("记忆盒里的 " + expr.name + " 还是空的。");
    return { ok: true, value: state.vars[expr.name] };
  }
  const left = evaluateValue(expr.left, state);
  if (!left.ok) return left;
  const right = evaluateValue(expr.right, state);
  if (!right.ok) return right;
  if (typeof left.value !== "number" || typeof right.value !== "number") return fail("只有数字可以参与更新。");
  return { ok: true, value: expr.type === "add" ? left.value + right.value : left.value - right.value };
}

export function compareValues(left, operator, right) {
  if (operator === "==") return typeof left === typeof right && left === right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  return operator === ">" ? left > right : left < right;
}

function initialState(level) {
  const first = getScene(level).nodes[0];
  return {
    phase: "idle", eventCursor: 0, pc: 0, activeLine: 0, activeInstructionId: "", activeEdge: null,
    vars: {}, energy: 0, memoryKey: "", readName: "", readValue: null, readPending: null,
    dataToken: null, pendingWrite: null, pendingUpdate: null, tokenTransfer: { phase: "none", id: 0, name: "", value: null, edge: null }, tokenAnimation: null,
    comparison: null, carried: null, path: "", gateBranch: null, gateOpen: false,
    unitNode: first.id, unit: { x: first.x, y: first.y }, delivered: false, signalSent: false,
    anim: null, event: "等待操作。", eventType: "idle", mood: "idle", eventLog: [], error: "", errorLine: 0, success: false,
  };
}

function errorState(state, message, line) {
  return { ...state, phase: "error", eventType: "error", mood: "error", error: message, errorLine: line, event: message, anim: null, activeEdge: null, eventLog: [...state.eventLog, "错误 // 第 " + line + " 行"] };
}

function checkRequirements(level, state, requirements = []) {
  for (const requirement of requirements) {
    if (requirement.type === "memoryMin" && Number(state.vars?.[requirement.name] ?? 0) < Number(requirement.value)) return "中继站收到的能量还不够。";
    if (requirement.type === "carried" && state.carried !== requirement.value) return "零号车到达中继站时没有带着需要的信号。";
    if (requirement.type === "memoryExists" && !Object.prototype.hasOwnProperty.call(state.vars || {}, requirement.name)) return `记忆盒里的 ${requirement.name} 还是空的。`;
  }
  return "";
}

function actionRequirements(level, item) { return item.type === "deliver" ? level.worldRules?.deliver || [] : []; }

function applyEvent(level, state, event) {
  const item = event.instruction;
  let next = {
    ...state, vars: { ...state.vars }, activeLine: event.line, activeInstructionId: event.instructionId || item.id || "",
    eventType: event.kind, mood: event.kind.startsWith("branch") ? "thinking" : ["read", "write-receive", "write-commit", "update-read", "update-write", "consume"].includes(event.kind) ? "transfer" : "move",
    eventLog: [...state.eventLog, event.kind + " // 第 " + event.line + " 行"], error: "", errorLine: 0,
  };
  if (event.kind === "traverse") {
    if ((item.type === "write" || item.type === "update") && !state.pendingWrite && event.from === state.unitNode) {
      const result = evaluateValue(item.value, state);
      if (!result.ok) return errorState(state, result.message, event.line);
      const oldValue = item.type === "update" ? state.vars[item.name] : undefined;
      next.pendingWrite = { name: item.name, value: result.value, oldValue };
      next.dataToken = { name: item.name, value: item.type === "update" && oldValue !== undefined ? oldValue : result.value };
      next.tokenTransfer = { phase: "to-memory", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value: result.value, edge: { from: event.from, to: event.to } };
      next.tokenAnimation = { phase: "to-memory", edge: { from: event.from, to: event.to }, progress: 0 };
    }
    if (item.type === "read" && event.from === "memory" && !state.readPending) {
      if (!Object.prototype.hasOwnProperty.call(state.vars, item.name)) return errorState(state, `记忆盒里的 ${item.name} 还是空的。`, event.line);
      const value = state.vars[item.name];
      next.dataToken = { name: item.name, value };
      next.readPending = { name: item.name, value, node: "memory" };
      next.tokenTransfer = { phase: "memory-to-reader", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value, edge: { from: event.from, to: event.to } };
      next.tokenAnimation = { phase: "memory-to-reader", edge: { from: event.from, to: event.to }, progress: 0 };
    }
    if (state.readPending && state.unitNode === event.from && event.to === "gate") {
      next.tokenTransfer = { ...state.tokenTransfer, phase: "reader-to-gate", edge: { from: event.from, to: event.to } };
      next.tokenAnimation = { phase: "reader-to-gate", edge: { from: event.from, to: event.to }, progress: 0 };
    }
    next.event = `零号车沿轨道前往 ${event.to}`;
    return next;
  }
  if (event.kind === "unreachable") return errorState(state, `${event.from} 和 ${event.to} 之间没有已绘制的轨道。`, event.line);
  if (event.kind === "consume") {
    next.dataToken = null;
    next.readPending = null;
    next.tokenAnimation = null;
    next.tokenTransfer = { ...state.tokenTransfer, phase: "consumed", edge: null };
    next.event = "数据已被判断门消耗";
    return next;
  }
  if (event.kind === "dynamic-deliver") return next;
  if (item.type === "charge") {
    const chargeNode = level.worldRules?.chargeNode || "charge";
    if (state.unitNode !== chargeNode) return errorState(state, "零号车还没有到充电站。", event.line);
    const memoryName = level.worldRules?.chargeMemory || "energy";
    next.energy = (state.energy || 0) + item.amount;
    next.vars[memoryName] = next.energy;
    next.memoryKey = memoryName;
    next.event = `充电完成  ${memoryName} = ${next.energy}`;
    return next;
  }
  if (item.type === "pickup") {
    if (state.unitNode !== (item.at || "pickup")) return errorState(state, "零号车还没有到输入台。", event.line);
    next.carried = item.item;
    next.event = `取走信号  ${item.item}`;
    return next;
  }
  if (event.kind === "write-receive") {
    const result = state.pendingWrite?.name === item.name ? { ok: true, value: state.pendingWrite.value } : evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, result.message, event.line);
    next.pendingWrite = state.pendingWrite || { name: item.name, value: result.value, oldValue: undefined };
    next.dataToken = { name: item.name, value: result.value };
    next.tokenTransfer = { phase: "memory-received", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value: result.value, edge: null };
    next.tokenAnimation = { phase: "memory-received", edge: null, progress: 1 };
    next.event = `记忆盒收到 ${item.name} = ${result.value}`;
    return next;
  }
  if (event.kind === "write-commit") {
    const result = state.pendingWrite?.name === item.name ? { ok: true, value: state.pendingWrite.value } : evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, result.message, event.line);
    next.vars[item.name] = result.value;
    if (item.name === (level.worldRules?.chargeMemory || "energy")) next.energy = Number(result.value) || 0;
    next.memoryKey = item.name; next.dataToken = { name: item.name, value: result.value }; next.pendingWrite = null; next.pendingUpdate = null;
    next.readName = ""; next.readValue = null; next.comparison = null;
    next.tokenTransfer = { phase: "memory", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value: result.value, edge: null };
    next.tokenAnimation = null;
    next.event = `记忆盒保存 ${item.name} = ${result.value}`;
    return next;
  }
  if (event.kind === "update-read") {
    if (!Object.prototype.hasOwnProperty.call(state.vars, item.name)) return errorState(state, `记忆盒里的 ${item.name} 还是空的。`, event.line);
    const result = state.pendingWrite?.name === item.name ? { ok: true, value: state.pendingWrite.value } : evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, result.message, event.line);
    const oldValue = state.vars[item.name];
    next.pendingUpdate = { name: item.name, oldValue, value: result.value };
    next.dataToken = { name: item.name, value: oldValue };
    next.tokenTransfer = { phase: "update-read", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value: oldValue, edge: null };
    next.tokenAnimation = { phase: "update-read", edge: null, progress: 1 };
    next.event = `记忆盒读出 ${item.name} = ${oldValue}`;
    return next;
  }
  if (event.kind === "update-write") {
    const result = state.pendingUpdate?.name === item.name
      ? { ok: true, value: state.pendingUpdate.value }
      : state.pendingWrite?.name === item.name ? { ok: true, value: state.pendingWrite.value } : evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, result.message, event.line);
    next.vars[item.name] = result.value;
    if (item.name === (level.worldRules?.chargeMemory || "energy")) next.energy = Number(result.value) || 0;
    next.memoryKey = item.name; next.dataToken = { name: item.name, value: result.value }; next.pendingWrite = null; next.pendingUpdate = null;
    next.readName = ""; next.readValue = null; next.comparison = null;
    next.tokenTransfer = { phase: "memory", id: (state.tokenTransfer?.id || 0) + 1, name: item.name, value: result.value, edge: null };
    next.tokenAnimation = null;
    next.event = `记忆盒写回 ${item.name} = ${result.value}`;
    return next;
  }
  if (item.type === "read") {
    if (!Object.prototype.hasOwnProperty.call(state.vars, item.name)) return errorState(state, `记忆盒里的 ${item.name} 还是空的。`, event.line);
    const value = state.vars[item.name];
    next.readName = item.name; next.readValue = value;
    next.readPending = { name: item.name, value, node: "reader" };
    next.dataToken = next.dataToken || { name: item.name, value };
    next.tokenTransfer = { ...state.tokenTransfer, phase: "reader-pending", name: item.name, value, edge: null };
    next.tokenAnimation = { phase: "reader-pending", edge: null, progress: 1 };
    next.memoryKey = item.name;
    next.event = `读取器收到 ${item.name} = ${value}`;
    return next;
  }
  if (event.kind === "branch-receive") {
    if (!state.readPending || !state.dataToken) return errorState(state, "判断门还没有收到数据。先让读取器送出一个值。", event.line);
    next.tokenTransfer = { ...state.tokenTransfer, phase: "gate-received", edge: null };
    next.tokenAnimation = { phase: "gate-received", edge: null, progress: 1 };
    next.event = `判断门收到数据 ${state.dataToken.value}`;
    return next;
  }
  if (event.kind === "branch-compare") {
    if (!state.readPending || !state.dataToken) return errorState(state, "判断门还没有收到数据。先让读取器送出一个值。", event.line);
    const left = evaluateValue(item.left, state); const right = evaluateValue(item.right, state);
    if (!left.ok || !right.ok) return errorState(state, "判断门无法读出比较两侧的值。", event.line);
    if (item.left?.type === "memory" && state.readPending.name !== item.left.name) return errorState(state, "判断门收到的不是它等待的那份数据。", event.line);
    const passed = compareValues(left.value, item.operator, right.value);
    next.comparison = { left: left.value, operator: item.operator, right: right.value, result: passed, path: "" };
    next.tokenTransfer = { ...state.tokenTransfer, phase: "gate-received", edge: null };
    next.tokenAnimation = { phase: "gate-received", edge: null, progress: 1 };
    next.event = `判断门比较 ${String(left.value)} ${item.operator} ${String(right.value)} · ${passed ? "成立" : "不成立"}`;
    return next;
  }
  if (event.kind === "branch-route") {
    if (!state.comparison) return errorState(state, "判断门还没有完成比较。", event.line);
    const passed = state.comparison.result;
    next.path = passed ? item.pass : item.fail;
    next.gateBranch = passed ? "accept" : "reject"; next.gateOpen = true;
    next.comparison = { ...state.comparison, path: next.path };
    next.tokenTransfer = { ...state.tokenTransfer, phase: "route-selected", edge: null };
    next.tokenAnimation = { phase: "route-selected", edge: null, progress: 1 };
    next.event = `判断门${passed ? "打开" : "关闭"} ${next.path} 路`;
    return next;
  }
  if (item.type === "deliver") {
    const requirementError = checkRequirements(level, state, actionRequirements(level, item));
    if (requirementError) return errorState(state, requirementError, event.line);
    next.delivered = true; next.signalSent = true; next.event = "中继站收到信号";
    return next;
  }
  return errorState(state, "暂不支持这条指令。", event.line);
}

export class Runtime {
  constructor(level, program, onUpdate, onFinish) {
    this.level = level; this.onUpdate = onUpdate; this.onFinish = onFinish;
    const normalized = normalizeProgram(level, program);
    const validation = validateProgram(level, normalized);
    if (!validation.ok) throw new TypeError(`程序无效${validation.line ? `（第 ${validation.line} 行）` : ""}：${validation.message}`);
    this.program = validation.program; this.executionProgram = this.program;
    this.events = []; this.steps = this.events; this.state = initialState(level); this.task = null; this.frame = 0; this.lastTime = 0; this.singleStep = false; this.mode = "idle";
    this.reset();
  }

  canEdit() { return this.state.phase === "idle" || this.state.phase === "error"; }
  setProgram(program) { if (!this.canEdit()) return false; this.program = normalizeProgram(this.level, program); this.reset(); return true; }
  getProgram() { return cloneProgram(this.program); }

  reset() {
    this.stopLoop(); const compiled = compileProgram(this.level, this.program);
    this.executionProgram = compiled.program || this.program; this.events = compiled.events || []; this.steps = this.events; this.task = null; this.lastTime = 0; this.singleStep = false; this.mode = "idle";
    this.state = initialState(this.level); if (!compiled.ok) this.state = errorState(this.state, compiled.message, compiled.line); this.notify();
  }

  run() {
    if (["running", "success"].includes(this.state.phase) || this.state.phase === "error") return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program); if (!compiled.ok) { this.state = errorState(this.state, compiled.message, compiled.line); this.notify(); return false; }
      this.executionProgram = compiled.program; this.events = compiled.events; this.steps = this.events;
    }
    this.mode = "run"; this.singleStep = false; this.state = { ...this.state, phase: "running" }; this.notify(); this.startLoop(); return true;
  }

  pause() { if (this.state.phase !== "running") return false; this.state = { ...this.state, phase: "paused" }; this.stopLoop(); this.notify(); return true; }

  stepOnce() {
    if (["success", "error"].includes(this.state.phase)) return false;
    if (this.state.phase === "idle") { const compiled = compileProgram(this.level, this.program); if (!compiled.ok) { this.state = errorState(this.state, compiled.message, compiled.line); this.notify(); return false; } this.executionProgram = compiled.program; this.events = compiled.events; this.steps = this.events; }
    if (this.state.phase === "running") return false;
    this.mode = "run"; this.singleStep = true; this.state = { ...this.state, phase: "running" }; this.notify();
    if (typeof document === "undefined") { this.beginEvent(this.events[this.state.eventCursor]); if (this.state.phase !== "error") this.completeEvent(); if (this.state.phase === "running") this.state = { ...this.state, phase: "paused" }; this.notify(); }
    else this.startLoop();
    return true;
  }

  step() { return this.stepOnce(); }

  runToEnd() {
    if (["success", "error"].includes(this.state.phase)) return this.snapshotState();
    if (this.state.phase === "idle") { const compiled = compileProgram(this.level, this.program); if (!compiled.ok) throw new TypeError(compiled.message); this.executionProgram = compiled.program; this.events = compiled.events; this.steps = this.events; }
    this.mode = "run"; this.state = { ...this.state, phase: "running" }; this.notify();
    while (this.state.phase === "running" && this.state.eventCursor < this.events.length) { this.beginEvent(this.events[this.state.eventCursor]); if (this.state.phase === "error") break; this.completeEvent(); }
    if (this.state.phase === "running" && this.state.eventCursor >= this.events.length) this.finish();
    return this.snapshotState();
  }

  startLoop() { this.stopLoop(); this.lastTime = globalThis.performance?.now?.() ?? Date.now(); this.frame = this.requestFrame((time) => this.tick(time)); }
  requestFrame(callback) { return typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(callback) : setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16); }
  cancelFrame(handle) { if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle); else clearTimeout(handle); }
  stopLoop() { if (this.frame) this.cancelFrame(this.frame); this.frame = 0; }

  expandDynamicDeliver(event) {
    const scene = getScene(this.level); const target = this.state.path; const first = findEdgePath(scene, this.state.unitNode, target); const second = first ? findEdgePath(scene, target, event.instruction.to || "exit") : null;
    if (!first || !second) { this.events.splice(this.state.eventCursor, 1, { ...event, kind: "unreachable", from: this.state.unitNode, to: target || "path" }); this.steps = this.events; return; }
    const expanded = [...first.edges, ...second.edges].map((edge) => ({ ...baseEvent(event.instruction, event.line, "traverse", 0), from: edge.from, to: edge.to, target: edge.to }));
    expanded.push({ ...baseEvent(event.instruction, event.line, "deliver", 0), stage: "exit", target: event.instruction.to || "exit" });
    expanded.forEach((item, index) => { item.id = this.state.eventCursor + index; });
    this.events.splice(this.state.eventCursor, 1, ...expanded); this.steps = this.events;
  }

  tick(time) {
    if (this.state.phase !== "running") return;
    const delta = Math.min(80, time - this.lastTime || 16); this.lastTime = time;
    if (!this.task) { if (this.state.eventCursor >= this.events.length) { this.finish(); return; } this.beginEvent(this.events[this.state.eventCursor]); if (this.state.phase === "error") return; }
    this.task.elapsed += delta; const progress = Math.min(1, this.task.elapsed / this.task.duration); const eased = 1 - Math.pow(1 - progress, 3);
    const next = { ...this.state, anim: { from: this.task.from, to: this.task.to, progress: eased } };
    if (this.task.event.kind === "traverse") next.unit = pointOnEdge(edgeControlPoints(this.task.from, this.task.to), eased);
    if (["memory-to-reader", "reader-to-gate", "to-memory"].includes(next.tokenTransfer?.phase) && this.task.event.kind === "traverse") next.tokenAnimation = { phase: next.tokenTransfer.phase, edge: { from: this.task.event.from, to: this.task.event.to }, progress: eased };
    if (next.tokenTransfer?.phase === "memory-to-reader" && this.task.event.kind === "read") next.tokenAnimation = { phase: "memory-to-reader", edge: { from: "memory", to: "reader" }, progress: eased };
    this.state = next;
    if (progress >= 1) this.completeEvent();
    this.notify();
    if (this.state.phase === "running") this.frame = this.requestFrame((nextTime) => this.tick(nextTime));
  }

  beginEvent(event) {
    if (!event) { this.finish(); return; }
    if (event.kind === "dynamic-deliver") { this.expandDynamicDeliver(event); event = this.events[this.state.eventCursor]; }
    const target = event.kind === "traverse" ? event.to : event.kind === "unreachable" ? event.to : event.target;
    const node = sceneNode(this.level, target);
    if (!node) { this.state = errorState(this.state, "目标不在这张轨道图上。", event.line); this.notify(); return; }
    const fromNode = sceneNode(this.level, this.state.unitNode) || getScene(this.level).nodes[0];
    const from = { x: fromNode.x, y: fromNode.y }; const to = { x: node.x, y: node.y };
    this.task = { event, from, to, elapsed: 0, duration: event.duration || 240 };
    this.state = applyEvent(this.level, this.state, event);
    this.state = { ...this.state, activeEdge: event.kind === "traverse" ? { from: event.from, to: event.to } : null };
    if (this.state.phase === "error") { this.stopLoop(); this.task = null; this.notify(); this.onFinish?.({ ok: false, text: this.state.error, state: this.snapshotState() }); }
    this.notify();
  }

  completeEvent() {
    const event = this.task.event; const node = sceneNode(this.level, event.kind === "traverse" ? event.to : event.target);
    if (event.kind === "traverse" && node) this.state = { ...this.state, unitNode: node.id, unit: { x: node.x, y: node.y } };
    if (event.kind === "read") this.state = { ...this.state, tokenTransfer: { ...this.state.tokenTransfer, phase: "reader-pending", edge: null }, tokenAnimation: { phase: "reader-pending", edge: null, progress: 1 } };
    this.state = { ...this.state, anim: null, activeEdge: null, mood: "idle", eventCursor: this.state.eventCursor + 1, pc: this.state.eventCursor + 1 };
    this.task = null;
    if (this.state.eventCursor >= this.events.length) { this.finish(); return; }
    if (this.singleStep) { this.singleStep = false; this.state = { ...this.state, phase: "paused" }; this.stopLoop(); }
  }

  finish() {
    this.stopLoop(); this.task = null;
    const ok = evaluateSuccess(this.level, this.executionProgram, this.state);
    const text = ok ? this.level.successText : (this.state.error || this.level.failureCases?.[0]?.message || "程序已停止，请重置后再试。");
    this.state = { ...this.state, phase: ok ? "success" : "error", success: ok, eventType: ok ? "success" : "error", event: text, error: ok ? "" : text, activeLine: ok ? 0 : this.state.activeLine };
    this.notify(); this.onFinish?.({ ok, text, state: this.snapshotState() });
  }

  snapshotState() { return clone(this.state); }
  notify() { this.onUpdate?.(this.snapshotState()); }
}
