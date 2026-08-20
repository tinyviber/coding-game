import assert from "node:assert/strict";

export const INSTRUCTION_TYPES = new Set([
  "move",
  "charge",
  "pickup",
  "deliver",
  "write",
  "update",
  "branch",
]);

export const VALUE_EXPR_TYPES = new Set(["literal", "memory", "add", "subtract"]);

export function instructionsOf(program) {
  if (!program || typeof program !== "object" || !Array.isArray(program.instructions)) {
    throw new TypeError("Program must expose an instructions array");
  }
  return program.instructions;
}

export function opOf(instruction) {
  return instruction?.type;
}

export function clone(value) {
  return structuredClone(value);
}

export function programWithInstructions(program, instructions) {
  return { ...program, instructions };
}

export function stateOf(runtime) {
  if (typeof runtime.snapshotState === "function") return runtime.snapshotState();
  if (typeof runtime.getState === "function") return runtime.getState();
  return runtime.state;
}

export function phaseOf(runtime) {
  return stateOf(runtime)?.phase;
}

export function cursorOf(runtime) {
  return stateOf(runtime)?.eventCursor ?? 0;
}

export function eventsOf(runtime) {
  if (typeof runtime.getEvents === "function") return runtime.getEvents();
  return runtime.events || [];
}

export function terminal(phase) {
  return phase === "success" || phase === "error";
}

export function finishResult(runtime) {
  const state = stateOf(runtime) || {};
  if (state.result && typeof state.result.ok === "boolean") return state.result;
  if (typeof runtime.result?.ok === "boolean") return runtime.result;
  return { ok: phaseOf(runtime) === "success", text: state.error || state.event || "" };
}

export async function runToTerminal(runtime) {
  const action = runtime.runToEnd || runtime.run;
  assert.equal(typeof action, "function", "runtime needs a run method");
  const result = await action.call(runtime);
  if (terminal(phaseOf(runtime))) return finishResult(runtime);
  if (result && typeof result.ok === "boolean") return result;
  throw new Error(`runtime did not reach a terminal phase: ${phaseOf(runtime)}`);
}

export function assertProgramShape(program, label) {
  const instructions = instructionsOf(program);
  assert.ok(instructions.length > 0, `${label} must contain instructions`);
  assert.ok(instructions.length <= 64, `${label} exceeds instruction safety budget`);
  const ids = new Set();
  for (const [index, instruction] of instructions.entries()) {
    assert.ok(INSTRUCTION_TYPES.has(opOf(instruction)), `${label} instruction ${index} has invalid type`);
    assert.equal(typeof instruction.id, "string", `${label} instruction ${index} needs an id`);
    assert.ok(instruction.id.length > 0, `${label} instruction ${index} needs a non-empty id`);
    assert.equal(ids.has(instruction.id), false, `${label} instruction ids must be unique`);
    ids.add(instruction.id);
  }
}

export function collectValueExprTypes(value, found = new Set()) {
  if (!value || typeof value !== "object") return found;
  if (typeof value.type === "string" && VALUE_EXPR_TYPES.has(value.type)) found.add(value.type);
  if (Array.isArray(value)) value.forEach((item) => collectValueExprTypes(item, found));
  else Object.values(value).forEach((item) => collectValueExprTypes(item, found));
  return found;
}

export function setInstructions(program, instructions) {
  return programWithInstructions(clone(program), instructions);
}

export function semanticEventKey(event) {
  const payload = event.payload || {};
  return JSON.stringify({
    instructionId: event.instructionId,
    kind: event.kind || event.type,
    stage: payload.stage || "",
    from: payload.from || "",
    to: payload.to || "",
    target: payload.target || "",
  });
}

export function eventPayload(event) {
  return {
    id: event.id,
    instructionId: event.instructionId,
    kind: event.kind || event.type,
    sourceLine: event.sourceLine,
    displayLine: event.displayLine,
    payload: clone(event.payload || {}),
  };
}
