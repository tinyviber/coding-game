import { MAX_EVENTS, cloneProgram, evaluateSuccess, getScene, normalizeProgram } from "./levels.js";
import { edgeControlPoints, pointOnEdge } from "./geometry.js";

const OPERATORS = new Set([">", "<", "=="]);
const INSTRUCTION_TYPES = new Set(["move", "charge", "pickup", "deliver", "read", "write", "update", "branch"]);

const clone = (value) => JSON.parse(JSON.stringify(value));

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function fail(message, line = 0) {
  return { ok: false, message, line };
}

function memoryNamesFor(level) {
  return new Set(level.memoryNames || []);
}

function validateValueExpr(level, expr, depth = 0) {
  if (!expr || typeof expr !== "object" || depth > 8) return fail("Invalid value expression.");
  if (expr.type === "literal") {
    const valid = (typeof expr.value === "number" && Number.isFinite(expr.value))
      || (typeof expr.value === "string" && expr.value.length > 0);
    return valid ? { ok: true } : fail("Literal must be finite number or non-empty text.");
  }
  if (expr.type === "memory") return memoryNamesFor(level).has(expr.name) ? { ok: true } : fail("Unknown memory name.");
  if (expr.type === "add" || expr.type === "subtract") {
    const left = validateValueExpr(level, expr.left, depth + 1);
    if (!left.ok) return left;
    return validateValueExpr(level, expr.right, depth + 1);
  }
  return fail("Unknown value expression.");
}

function validateInstruction(level, item, index) {
  const line = index + 1;
  if (!item || typeof item !== "object" || !INSTRUCTION_TYPES.has(item.type)) return fail("Unknown instruction type.", line);
  const scene = getScene(level);
  const nodes = new Set(scene.nodes.map((node) => node.id));
  if (item.type === "move") return nodes.has(item.to) ? { ok: true } : fail("Move target is not on this rail.", line);
  if (item.type === "charge") return Number.isInteger(item.amount) && item.amount >= 0 && item.amount <= 9 ? { ok: true } : fail("Charge amount must be an integer from 0 to 9.", line);
  if (item.type === "pickup") return typeof item.item === "string" && nodes.has(item.at || "pickup") ? { ok: true } : fail("Pickup target is invalid.", line);
  if (item.type === "deliver") return nodes.has(item.to || "exit") ? { ok: true } : fail("Deliver target is not on this rail.", line);
  if (item.type === "read") return memoryNamesFor(level).has(item.name) ? { ok: true } : fail("Read references unknown memory.", line);
  if (item.type === "write") {
    if (!memoryNamesFor(level).has(item.name)) return fail("Write references unknown memory.", line);
    return validateValueExpr(level, item.value);
  }
  if (item.type === "update") {
    if (!memoryNamesFor(level).has(item.name)) return fail("Update references unknown memory.", line);
    return validateValueExpr(level, item.value);
  }
  if (!OPERATORS.has(item.operator)) return fail("Branch operator is invalid.", line);
  const left = validateValueExpr(level, item.left);
  if (!left.ok) return { ...left, line };
  const right = validateValueExpr(level, item.right);
  if (!right.ok) return { ...right, line };
  if (typeof item.pass !== "string" || typeof item.fail !== "string") return fail("Branch paths must be named.", line);
  const outgoing = new Set(scene.branchNode
    ? (scene.edges || []).filter(([from]) => from === scene.branchNode).map(([, to]) => to)
    : []);
  const aliases = Object.entries(scene.pathAliases || {})
    .filter(([, target]) => outgoing.has(target))
    .map(([alias]) => alias);
  const paths = new Set([...outgoing, ...aliases]);
  if (!paths.has(item.pass) || !paths.has(item.fail)) return fail("Branch path is not declared by this scene.", line);
  return { ok: true };
}

export function validateProgram(level, rawProgram) {
  const program = normalizeProgram(level, rawProgram);
  if (!Array.isArray(program.instructions) || program.instructions.length === 0) return fail("Program has no instructions.");
  if (program.instructions.length > MAX_EVENTS) return fail("Program exceeds 64 events.");
  for (let index = 0; index < program.instructions.length; index += 1) {
    const result = validateInstruction(level, program.instructions[index], index);
    if (!result.ok) return result;
  }
  return { ok: true, program };
}

function eventTarget(item) {
  if (item.type === "move") return item.to;
  if (item.type === "charge") return "charge";
  if (item.type === "pickup") return item.at || "pickup";
  if (item.type === "write" || item.type === "update") return "memory";
  if (item.type === "read") return "reader";
  if (item.type === "branch") return "gate";
  return item.to || "exit";
}

export function compileProgram(level, rawProgram) {
  const validation = validateProgram(level, rawProgram);
  if (!validation.ok) return validation;
  const program = cloneProgram(validation.program);
  const events = [];
  program.instructions.forEach((item, index) => {
    const base = { id: events.length, instructionId: item.id, sourceLine: index + 1, line: index + 1, kind: item.type, instruction: clone(item), duration: 240 };
    if (item.type === "deliver" && getScene(level).branchNode) {
      events.push({ ...base, stage: "path", target: "path" });
      events.push({ ...base, id: events.length, stage: "exit", target: item.to || "exit", duration: 260 });
    } else {
      events.push({ ...base, target: eventTarget(item) });
    }
  });
  if (events.length > MAX_EVENTS) return fail("Program exceeds 64 events.");
  return { ok: true, program: freezeDeep(program), events };
}

export function evaluateValue(expr, state) {
  if (expr.type === "literal") return { ok: true, value: expr.value };
  if (expr.type === "memory") {
    if (!Object.prototype.hasOwnProperty.call(state.vars, expr.name)) return fail("Memory " + expr.name + " is empty.");
    return { ok: true, value: state.vars[expr.name] };
  }
  const left = evaluateValue(expr.left, state);
  if (!left.ok) return left;
  const right = evaluateValue(expr.right, state);
  if (!right.ok) return right;
  if (typeof left.value !== "number" || typeof right.value !== "number") return fail("Only numbers can be updated.");
  return { ok: true, value: expr.type === "add" ? left.value + right.value : left.value - right.value };
}

export function compareValues(left, operator, right) {
  if (operator === "==") return typeof left === typeof right && left === right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  return operator === ">" ? left > right : left < right;
}

const sceneNode = (level, id) => getScene(level).nodes.find((node) => node.id === id);
const pathNode = (level, path) => {
  const scene = getScene(level);
  const resolved = scene.pathAliases?.[path] || path;
  return sceneNode(level, resolved);
};

function initialState(level) {
  const first = getScene(level).nodes[0];
  return {
    phase: "idle",
    eventCursor: 0,
    pc: 0,
    activeLine: 0,
    activeInstructionId: "",
    activeEdge: null,
    vars: {},
    energy: 0,
    memoryKey: "",
    readName: "",
    readValue: null,
    dataToken: null,
    comparison: null,
    carried: null,
    path: "",
    gateBranch: null,
    gateOpen: false,
    unitNode: first.id,
    unit: { x: first.x, y: first.y },
    delivered: false,
    signalSent: false,
    anim: null,
    event: "Awaiting input.",
    eventType: "idle",
    mood: "idle",
    eventLog: [],
    error: "",
    errorLine: 0,
    success: false,
    demo: false,
  };
}

function routeTarget(level, event, state) {
  if (event.stage === "path") return pathNode(level, state.path)?.id || event.target;
  return event.target;
}

function errorState(state, message, line) {
  return {
    ...state,
    phase: "error",
    eventType: "error",
    mood: "error",
    error: message,
    errorLine: line,
    event: message,
    eventLog: [...state.eventLog, "ERROR: " + message],
  };
}

function requirementMessage(requirement) {
  if (requirement.type === "memoryMin") return "The relay needs more stored power.";
  if (requirement.type === "carried") return "Unit-0 reaches the relay without the required signal.";
  return "The world is not ready for this action.";
}

function checkRequirements(level, state, requirements = []) {
  for (const requirement of requirements) {
    if (requirement.type === "memoryMin" && Number(state.vars?.[requirement.name] ?? 0) < Number(requirement.value)) return requirementMessage(requirement);
    if (requirement.type === "carried" && state.carried !== requirement.value) return requirementMessage(requirement);
    if (requirement.type === "memoryExists" && !Object.prototype.hasOwnProperty.call(state.vars || {}, requirement.name)) return `Memory ${requirement.name} is empty.`;
  }
  return "";
}

function actionRequirements(level, item) {
  if (item.type === "deliver") return level.worldRules?.deliver || [];
  return [];
}

function applyEvent(level, state, event) {
  const item = event.instruction;
  let next = {
    ...state,
    vars: { ...state.vars },
    activeLine: event.line,
    activeInstructionId: event.instructionId || item.id || "",
    eventType: event.kind,
    mood: event.kind === "branch" ? "thinking" : event.kind === "read" || event.kind === "write" || event.kind === "update" ? "transfer" : "move",
    eventLog: [...state.eventLog, event.kind.toUpperCase() + " // line " + event.line],
    error: "",
  };
  if (item.type === "move") {
    next.event = "MOVE → " + item.to;
    return next;
  }
  if (item.type === "charge") {
    const chargeNode = level.worldRules?.chargeNode || "charge";
    if (state.unitNode !== chargeNode) return errorState(state, "The charge node is not reached yet.", event.line);
    const memoryName = level.worldRules?.chargeMemory || "energy";
    next.energy = (state.energy || 0) + item.amount;
    next.vars[memoryName] = next.energy;
    next.memoryKey = memoryName;
    next.event = "CHARGE  " + memoryName + " = " + next.energy;
    return next;
  }
  if (item.type === "pickup") {
    if (state.unitNode !== "dock" && state.unitNode !== (item.at || "pickup")) return errorState(state, "Unit-0 has not reached the input rail.", event.line);
    next.carried = item.item;
    next.event = "PICKUP  " + item.item;
    return next;
  }
  if (item.type === "write") {
    const result = evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, result.message, event.line);
    next.vars[item.name] = result.value;
    if (item.name === (level.worldRules?.chargeMemory || "energy")) next.energy = Number(result.value) || 0;
    next.memoryKey = item.name;
    next.dataToken = null;
    next.readName = "";
    next.readValue = null;
    next.comparison = null;
    next.event = "WRITE  " + item.name + " = " + result.value;
    return next;
  }
  if (item.type === "update") {
    const result = evaluateValue(item.value, state);
    if (!result.ok) return errorState(state, "Update failed. " + result.message, event.line);
    next.vars[item.name] = result.value;
    if (item.name === (level.worldRules?.chargeMemory || "energy")) next.energy = Number(result.value) || 0;
    next.memoryKey = item.name;
    next.dataToken = null;
    next.readName = "";
    next.readValue = null;
    next.comparison = null;
    next.event = "UPDATE  " + item.name + " = " + result.value;
    return next;
  }
  if (item.type === "read") {
    if (!Object.prototype.hasOwnProperty.call(state.vars, item.name)) return errorState(state, "READ found empty memory. Write before read.", event.line);
    next.readName = item.name;
    next.readValue = state.vars[item.name];
    next.dataToken = { name: item.name, value: state.vars[item.name] };
    next.memoryKey = item.name;
    next.event = "READ  " + item.name + " → token " + next.readValue;
    return next;
  }
  if (item.type === "branch") {
    if (!state.dataToken) return errorState(state, "The gate has no data token. Read a value before choosing.", event.line);
    const left = evaluateValue(item.left, state);
    const right = evaluateValue(item.right, state);
    if (!left.ok || !right.ok) return errorState(state, "Choice could not read both sides.", event.line);
    if (item.left?.type === "memory" && state.dataToken.name !== item.left.name) return errorState(state, "The gate received a different data token.", event.line);
    const passed = compareValues(left.value, item.operator, right.value);
    next.path = passed ? item.pass : item.fail;
    next.gateBranch = passed ? "accept" : "reject";
    next.gateOpen = passed;
    next.dataToken = null;
    next.comparison = { left: left.value, operator: item.operator, right: right.value, result: passed, path: next.path };
    next.event = "BRANCH  " + String(left.value) + " " + item.operator + " " + String(right.value) + (passed ? "  TRUE → " : "  FALSE → ") + next.path;
    return next;
  }
  if (item.type === "deliver") {
    if (event.stage === "path") {
      if (!state.path) return errorState(state, "Deliver has no chosen path. Branch first.", event.line);
      next.event = "PATH  " + state.path;
      return next;
    }
    const requirementError = checkRequirements(level, state, actionRequirements(level, item));
    if (requirementError) return errorState(state, requirementError, event.line);
    next.delivered = true;
    next.signalSent = true;
    next.event = "DELIVER  relay received";
    return next;
  }
  return errorState(state, "Unsupported instruction.", event.line);
}

export class Runtime {
  constructor(level, program, onUpdate, onFinish) {
    this.level = level;
    this.onUpdate = onUpdate;
    this.onFinish = onFinish;
    this.program = normalizeProgram(level, program);
    const validation = validateProgram(level, this.program);
    if (!validation.ok) throw new TypeError(`Invalid program${validation.line ? ` at line ${validation.line}` : ""}: ${validation.message}`);
    this.executionProgram = this.program;
    this.events = [];
    this.steps = this.events;
    this.state = initialState(level);
    this.task = null;
    this.frame = 0;
    this.lastTime = 0;
    this.singleStep = false;
    this.mode = "idle";
    this.demoCallback = null;
    this.reset();
  }

  canEdit() {
    return this.state.phase === "idle" || this.state.phase === "error";
  }

  setProgram(program) {
    if (!this.canEdit()) return false;
    this.program = normalizeProgram(this.level, program);
    this.reset();
    return true;
  }

  getProgram() {
    return cloneProgram(this.program);
  }

  reset() {
    this.stopLoop();
    this.demoCallback = null;
    const compiled = compileProgram(this.level, this.program);
    this.executionProgram = compiled.program || this.program;
    this.events = compiled.events || [];
    this.steps = this.events;
    this.task = null;
    this.lastTime = 0;
    this.singleStep = false;
    this.mode = "idle";
    this.state = initialState(this.level);
    if (!compiled.ok) this.state = errorState(this.state, compiled.message, compiled.line);
    this.notify();
  }

  demo(program, done) {
    return new Promise((resolve) => {
      if (this.state.phase !== "idle") { resolve(false); return; }
      const compiled = compileProgram(this.level, program);
      if (!compiled.ok) { resolve(false); return; }
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
      this.task = null;
      this.singleStep = false;
      this.mode = "demo";
      this.demoCallback = () => { done?.(); resolve(true); };
      this.state = { ...initialState(this.level), phase: "demo", demo: true };
      this.notify();
      if (typeof document === "undefined") {
        const callback = this.demoCallback;
        this.demoCallback = null;
        this.reset();
        callback?.();
      } else {
        this.startLoop();
      }
    });
  }

  run() {
    if (this.state.phase === "running" || this.state.phase === "demo" || this.state.phase === "success") return false;
    if (this.state.phase === "error") return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) {
        this.state = errorState(this.state, compiled.message, compiled.line);
        this.notify();
        return false;
      }
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
    }
    this.mode = "run";
    this.state = { ...this.state, phase: "running", demo: false };
    this.singleStep = false;
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
    if (this.state.phase === "success" || this.state.phase === "error" || this.state.phase === "demo") return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) {
        this.state = errorState(this.state, compiled.message, compiled.line);
        this.notify();
        return false;
      }
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
    }
    if (this.state.phase === "running") return false;
    this.mode = "run";
    this.singleStep = true;
    this.state = { ...this.state, phase: "running", demo: false };
    this.notify();
    this.startLoop();
    return true;
  }

  step() {
    if (typeof document !== "undefined") return this.stepOnce();
    if (this.state.phase === "success" || this.state.phase === "error" || this.state.phase === "demo") return false;
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) throw new TypeError("Invalid program: " + compiled.message);
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
    }
    this.mode = "run";
    this.state = { ...this.state, phase: "running", demo: false };
    this.beginEvent(this.events[this.state.eventCursor]);
    if (this.state.phase !== "error") this.completeEvent();
    if (this.state.phase === "running") this.state = { ...this.state, phase: "paused" };
    this.notify();
    return true;
  }

  async runToEnd() {
    if (this.state.phase === "success" || this.state.phase === "error") return this.snapshotState();
    if (this.state.phase === "idle") {
      const compiled = compileProgram(this.level, this.program);
      if (!compiled.ok) throw new TypeError("Invalid program: " + compiled.message);
      this.executionProgram = compiled.program;
      this.events = compiled.events;
      this.steps = this.events;
    }
    this.mode = "run";
    this.singleStep = false;
    this.state = { ...this.state, phase: "running", demo: false };
    this.notify();
    while (this.state.phase === "running" && this.state.eventCursor < this.events.length) {
      this.beginEvent(this.events[this.state.eventCursor]);
      if (this.state.phase === "error") break;
      this.completeEvent();
    }
    if (this.state.phase === "running" && this.state.eventCursor >= this.events.length) this.finish();
    return this.snapshotState();
  }

  startLoop() {
    this.stopLoop();
    this.lastTime = globalThis.performance?.now?.() ?? Date.now();
    this.frame = this.requestFrame((time) => this.tick(time));
  }

  requestFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
    return setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
  }

  cancelFrame(handle) {
    if (!handle) return;
    if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
    else clearTimeout(handle);
  }

  stopLoop() {
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
  }

  tick(time) {
    if (this.state.phase !== "running" && this.state.phase !== "demo") return;
    const delta = Math.min(80, time - this.lastTime || 16);
    this.lastTime = time;
    if (!this.task) {
      if (this.state.eventCursor >= this.events.length) {
        this.finish();
        return;
      }
      this.beginEvent(this.events[this.state.eventCursor]);
      if (this.state.phase === "error") return;
    }
    this.task.elapsed += delta;
    const progress = Math.min(1, this.task.elapsed / this.task.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    this.state = {
      ...this.state,
      anim: { from: this.task.from, to: this.task.to, progress: eased },
    };
    this.state.unit = pointOnEdge(edgeControlPoints(this.task.from, this.task.to), eased);
    if (progress >= 1) this.completeEvent();
    this.notify();
    if (this.state.phase === "running" || this.state.phase === "demo") this.frame = this.requestFrame((next) => this.tick(next));
  }

  beginEvent(event) {
    const targetId = routeTarget(this.level, event, this.state);
    const node = sceneNode(this.level, targetId) || getScene(this.level).nodes[0];
    const from = { ...this.state.unit };
    const to = { x: node.x, y: node.y };
    this.task = { event, from, to, elapsed: 0, duration: event.duration || 240 };
    this.state = applyEvent(this.level, this.state, event);
    this.state = { ...this.state, activeEdge: { from: this.state.unitNode, to: node.id } };
    if (this.state.phase === "error") {
      this.stopLoop();
      this.task = null;
      this.notify();
      this.onFinish?.({ ok: false, text: this.state.error, state: this.snapshotState() });
    }
    this.notify();
  }

  completeEvent() {
    const event = this.task.event;
    const targetId = routeTarget(this.level, event, this.state);
    const node = sceneNode(this.level, targetId) || getScene(this.level).nodes[0];
    this.state = {
      ...this.state,
      unitNode: node.id,
      unit: { x: node.x, y: node.y },
      anim: null,
      activeEdge: null,
      mood: "idle",
      eventCursor: this.state.eventCursor + 1,
      pc: this.state.eventCursor + 1,
    };
    this.task = null;
    if (this.state.eventCursor >= this.events.length) {
      this.finish();
      return;
    }
    if (this.singleStep) {
      this.singleStep = false;
      this.state = { ...this.state, phase: "paused" };
      this.stopLoop();
    }
  }

  finish() {
    this.stopLoop();
    this.task = null;
    if (this.mode === "demo") {
      const done = this.demoCallback;
      this.demoCallback = null;
      this.reset();
      done?.();
      return;
    }
    const ok = evaluateSuccess(this.level, this.executionProgram, this.state);
    const text = ok
      ? this.level.successText
      : (this.state.error || this.level.failureCases?.[0]?.message || "Program stopped. Reset and try again.");
    this.state = {
      ...this.state,
      phase: ok ? "success" : "error",
      success: ok,
      eventType: ok ? "success" : "error",
      event: text,
      error: ok ? "" : text,
      activeLine: ok ? 0 : this.state.activeLine,
    };
    this.notify();
    this.onFinish?.({ ok, text, state: this.snapshotState() });
  }

  snapshotState() {
    return clone(this.state);
  }

  notify() {
    this.onUpdate?.(this.snapshotState());
  }
}
