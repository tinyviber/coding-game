import assert from "node:assert/strict";

export const INSTRUCTION_TYPES = new Set([
  "move",
  "charge",
  "pickup",
  "deliver",
  "read",
  "write",
  "update",
  "branch",
]);

export const VALUE_EXPR_TYPES = new Set(["literal", "memory", "add", "subtract"]);

export function instructionsOf(program) {
  if (Array.isArray(program)) return program;
  if (Array.isArray(program?.instructions)) return program.instructions;
  if (Array.isArray(program?.steps)) return program.steps;
  if (Array.isArray(program?.ops)) return program.ops;
  throw new TypeError("Program must expose an instructions array");
}

export function opOf(instruction) {
  return instruction?.type ?? instruction?.kind ?? instruction?.op;
}

export function slotKind(slot) {
  return [slot?.kind, slot?.type, slot?.control, slot?.key, slot?.id, slot?.instruction, slot?.path, slot?.label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function programWithInstructions(program, instructions) {
  if (Array.isArray(program)) return instructions;
  return { ...program, instructions };
}

export function clone(value) {
  return structuredClone(value);
}

export function stateOf(runtime) {
  if (typeof runtime.getState === "function") return runtime.getState();
  if (typeof runtime.snapshot === "function") return runtime.snapshot();
  return runtime.state;
}

export function phaseOf(runtime) {
  const state = stateOf(runtime) ?? {};
  return state.phase ?? state.status;
}

export function cursorOf(runtime) {
  const state = stateOf(runtime) ?? {};
  return state.eventCursor ?? state.cursor ?? state.pc ?? runtime.eventCursor ?? runtime.pc ?? 0;
}

export function eventsOf(runtime) {
  if (typeof runtime.getEvents === "function") return runtime.getEvents();
  if (Array.isArray(runtime.events)) return runtime.events;
  if (Array.isArray(runtime.eventLog)) return runtime.eventLog;
  if (Array.isArray(runtime.eventQueue)) return runtime.eventQueue;
  return [];
}

export function terminal(phase) {
  return phase === "success" || phase === "error" || phase === "complete" || phase === "failed";
}

export function installControlledAsync({ frameMs = 16 } = {}) {
  const original = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  let now = globalThis.performance?.now?.() ?? 0;
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();

  const scheduleId = () => nextId++;
  globalThis.requestAnimationFrame = (callback) => {
    const id = scheduleId();
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const id = scheduleId();
    const duration = Number.isFinite(Number(delay)) ? Math.max(0, Number(delay)) : 0;
    timers.set(id, { due: now + duration, callback, args });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);

  return {
    get now() { return now; },
    hasPending() { return frames.size > 0 || timers.size > 0; },
    async pump() {
      now += frameMs;
      const dueTimers = [...timers.entries()].filter(([, timer]) => timer.due <= now);
      for (const [id, timer] of dueTimers) {
        timers.delete(id);
        timer.callback(...timer.args);
      }
      const dueFrames = [...frames.entries()];
      frames.clear();
      for (const [, callback] of dueFrames) callback(now);
      await Promise.resolve();
    },
    restore() {
      globalThis.requestAnimationFrame = original.requestAnimationFrame;
      globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
    },
  };
}

export function finishResult(runtime) {
  const state = stateOf(runtime) ?? {};
  if (state.result && typeof state.result.ok === "boolean") return state.result;
  if (typeof runtime.result?.ok === "boolean") return runtime.result;
  if (phaseOf(runtime) === "success" || phaseOf(runtime) === "complete") return { ok: true };
  return { ok: false, text: state.error ?? state.message ?? "runtime did not succeed" };
}

async function driveAsyncAction(runtime, action, done, limit = 2_000) {
  const clock = installControlledAsync();
  let settled = false;
  let failure;
  try {
    const returned = action();
    const completion = Promise.resolve(returned).then(
      () => { settled = true; },
      (error) => { failure = error; settled = true; },
    );
    for (let index = 0; index < limit && !done(); index += 1) {
      await clock.pump();
      if (done()) break;
      if (!clock.hasPending() && phaseOf(runtime) === "paused" && typeof runtime.run === "function") runtime.run();
      if (!clock.hasPending() && phaseOf(runtime) === "running" && typeof runtime.step === "function") runtime.step();
      await Promise.resolve();
    }
    if (!done()) await completion;
    else await Promise.resolve();
    if (failure) throw failure;
    assert.ok(done(), `async runtime action did not settle; phase=${phaseOf(runtime)}`);
  } finally {
    clock.restore();
  }
}

export async function stepOne(runtime, limit = 2_000) {
  const before = cursorOf(runtime);
  const action = runtime.step ?? runtime.stepOnce;
  assert.equal(typeof action, "function", "runtime needs Step method");
  await driveAsyncAction(runtime, () => action.call(runtime), () => cursorOf(runtime) > before || terminal(phaseOf(runtime)), limit);
  return stateOf(runtime);
}

export async function pauseAfterRun(runtime, limit = 2_000) {
  assert.equal(typeof runtime.run, "function", "runtime needs Run method");
  assert.equal(typeof runtime.pause, "function", "runtime needs Pause method");
  const clock = installControlledAsync();
  try {
    const returned = runtime.run();
    Promise.resolve(returned).catch(() => {});
    for (let index = 0; index < limit && !terminal(phaseOf(runtime)) && phaseOf(runtime) !== "running"; index += 1) {
      await clock.pump();
    }
    await Promise.resolve();
    const before = cursorOf(runtime);
    await runtime.pause();
    return { before, after: cursorOf(runtime), state: stateOf(runtime) };
  } finally {
    clock.restore();
  }
}

export async function runToTerminal(runtime, limit = 2_000) {
  const action = runtime.runToEnd ?? runtime.run;
  assert.equal(typeof action, "function", "runtime needs Run method");
  await driveAsyncAction(runtime, () => action.call(runtime), () => terminal(phaseOf(runtime)), limit);
  return finishResult(runtime);
}

export async function runDemoToIdle(runtime, demoProgram, limit = 2_000) {
  const action = runtime.runDemo ?? runtime.demo ?? runtime.playDemo;
  assert.equal(typeof action, "function", "runtime needs isolated demo method");
  await driveAsyncAction(runtime, () => action.call(runtime, demoProgram), () => /idle|ready/.test(String(phaseOf(runtime))) && cursorOf(runtime) === 0, limit);
  return stateOf(runtime);
}

export function assertProgramShape(program, label) {
  const instructions = instructionsOf(program);
  assert.ok(instructions.length > 0, `${label} must contain instructions`);
  assert.ok(instructions.length <= 64, `${label} exceeds event safety budget`);
  for (const [index, instruction] of instructions.entries()) {
    const type = opOf(instruction);
    assert.ok(INSTRUCTION_TYPES.has(type), `${label} instruction ${index} has invalid type ${type}`);
  }
}

export function collectValueExprTypes(value, found = new Set()) {
  if (!value || typeof value !== "object") return found;
  if (typeof value.type === "string" && VALUE_EXPR_TYPES.has(value.type)) found.add(value.type);
  if (Array.isArray(value)) {
    value.forEach((item) => collectValueExprTypes(item, found));
  } else {
    Object.values(value).forEach((item) => collectValueExprTypes(item, found));
  }
  return found;
}

export function setInstructions(program, instructions) {
  return programWithInstructions(clone(program), instructions);
}
