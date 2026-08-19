const clone = (value) => JSON.parse(JSON.stringify(value));

export const MAX_EVENTS = 64;

export const literal = (value) => ({ type: "literal", value });
export const memory = (name) => ({ type: "memory", name });
export const add = (left, right) => ({ type: "add", left, right });
export const subtract = (left, right) => ({ type: "subtract", left, right });

const instruction = (type, fields = {}) => ({ type, ...fields });
const write = (name, value) => instruction("write", { name, value });
const update = (name, value) => instruction("update", { name, value });
const read = (name) => instruction("read", { name });
const branch = (left, operator, right, pass, fail) => instruction("branch", { left, operator, right, pass, fail });
const move = (to) => instruction("move", { to });
const charge = (amount = 3) => instruction("charge", { amount });
const pickup = (item, at = "pickup") => instruction("pickup", { item, at });
const deliver = (to = "exit") => instruction("deliver", { to });

const scenes = {
  flow: {
    nodes: [
      { id: "dock", x: 0.10, y: 0.54, type: "dock", label: "DOCK" },
      { id: "pickup", x: 0.28, y: 0.54, type: "pickup", label: "CARGO" },
      { id: "charge", x: 0.49, y: 0.54, type: "energy", label: "CHARGE" },
      { id: "exit", x: 0.86, y: 0.54, type: "exit", label: "SIGNAL" },
    ],
    edges: [["dock", "pickup"], ["pickup", "charge"], ["charge", "exit"]],
  },
  memory: {
    nodes: [
      { id: "dock", x: 0.09, y: 0.54, type: "dock", label: "DOCK" },
      { id: "pickup", x: 0.25, y: 0.54, type: "pickup", label: "INPUT" },
      { id: "memory", x: 0.45, y: 0.54, type: "memory", label: "MEMORY" },
      { id: "reader", x: 0.66, y: 0.54, type: "reader", label: "READER" },
      { id: "exit", x: 0.89, y: 0.54, type: "exit", label: "RELAY" },
    ],
    edges: [["dock", "pickup"], ["pickup", "memory"], ["memory", "reader"], ["reader", "exit"]],
  },
  choice: {
    nodes: [
      { id: "dock", x: 0.08, y: 0.52, type: "dock", label: "DOCK" },
      { id: "memory", x: 0.28, y: 0.52, type: "memory", label: "MEMORY" },
      { id: "reader", x: 0.43, y: 0.52, type: "reader", label: "READ" },
      { id: "gate", x: 0.59, y: 0.52, type: "gate", label: "CHOICE" },
      { id: "light", x: 0.78, y: 0.27, type: "accept", label: "LIGHT" },
      { id: "dark", x: 0.78, y: 0.77, type: "reject", label: "DARK" },
      { id: "exit", x: 0.94, y: 0.52, type: "exit", label: "RELAY" },
    ],
    edges: [["dock", "memory"], ["memory", "reader"], ["reader", "gate"], ["gate", "light"], ["gate", "dark"], ["light", "exit"], ["dark", "exit"]],
  },
  final: {
    nodes: [
      { id: "dock", x: 0.06, y: 0.52, type: "dock", label: "DOCK" },
      { id: "memory", x: 0.23, y: 0.52, type: "memory", label: "MEMORY" },
      { id: "reader", x: 0.39, y: 0.52, type: "reader", label: "READ" },
      { id: "gate", x: 0.55, y: 0.52, type: "gate", label: "CHOICE" },
      { id: "sun", x: 0.75, y: 0.25, type: "accept", label: "SUN" },
      { id: "dark", x: 0.75, y: 0.79, type: "reject", label: "DARK" },
      { id: "exit", x: 0.94, y: 0.52, type: "exit", label: "TOWER" },
    ],
    edges: [["dock", "memory"], ["memory", "reader"], ["reader", "gate"], ["gate", "sun"], ["gate", "dark"], ["sun", "exit"], ["dark", "exit"]],
  },
};

const codeText = (text, tone = "") => ({ text, tone });
const editable = (type, value, edit, extra = {}) => ({ type, value, edit, ...extra });
const isEditable = (level, inst, path) => level.editableSlots.some((slot) => slot.instruction === inst.type && slot.path === path);

function formatValue(expr) {
  if (!expr) return "?";
  if (expr.type === "memory") return expr.name;
  if (expr.type === "literal") return typeof expr.value === "string" ? "\"" + expr.value + "\"" : String(expr.value);
  const operator = expr.type === "add" ? "+" : "-";
  return formatValue(expr.left) + " " + operator + " " + formatValue(expr.right);
}

function valueParts(level, expr, edit, label) {
  if (expr?.type === "memory") return [codeText(expr.name, "string")];
  if (expr?.type !== "literal") return [codeText(formatValue(expr), "string")];
  if (!edit) return [codeText(formatValue(expr), typeof expr.value === "string" ? "string" : "number")];
  if (typeof expr.value === "number") return [editable("number", expr.value, edit, { ariaLabel: label, min: 0, max: 9 })];
  return [editable("select", expr.value, edit, { ariaLabel: label, options: ["blue", "red", "light", "dark"] })];
}

function codeForInstruction(level, inst, index) {
  const line = index + 1;
  const base = { line, orderKey: "instructions", orderIndex: index, instructionType: inst.type };
  if (inst.type === "move") return { ...base, parts: [codeText("move_to(\"" + inst.to + "\")", "fn")] };
  if (inst.type === "charge") return { ...base, parts: [codeText("charge(", "fn"), codeText(String(inst.amount)), codeText(")", "fn")] };
  if (inst.type === "pickup") return { ...base, parts: [codeText("pickup(", "fn"), codeText("\"" + inst.item + "\"", "string"), codeText(")", "fn")] };
  if (inst.type === "deliver") return { ...base, parts: [codeText("deliver(", "fn"), codeText("\"" + inst.to + "\"", "string"), codeText(")", "fn")] };
  if (inst.type === "read") return { ...base, parts: [codeText("read(", "fn"), codeText("\"" + inst.name + "\"", "string"), codeText(")", "fn")] };
  if (inst.type === "write") {
    const edit = isEditable(level, inst, "value.value") ? { index, path: "value.value" } : null;
    return { ...base, parts: [codeText(inst.name + " = "), ...valueParts(level, inst.value, edit, inst.name + " value")] };
  }
  if (inst.type === "update") {
    const edit = isEditable(level, inst, "value.right.value") ? { index, path: "value.right.value" } : null;
    const value = inst.value.type === "add" || inst.value.type === "subtract" ? inst.value.right : inst.value;
    const op = inst.value.type === "subtract" ? " - " : " + ";
    return { ...base, parts: [codeText(inst.name + " = " + inst.name + op), ...valueParts(level, value, edit, inst.name + " update")] };
  }
  if (inst.type === "branch") {
    const operatorEdit = isEditable(level, inst, "operator") ? { index, path: "operator" } : null;
    const rightEdit = isEditable(level, inst, "right.value") ? { index, path: "right.value" } : null;
    const passEdit = isEditable(level, inst, "pass") ? { index, path: "pass" } : null;
    const operator = operatorEdit
      ? editable("select", inst.operator, operatorEdit, { ariaLabel: "operator", options: [">", "<", "=="] })
      : codeText(inst.operator, "keyword");
    const right = valueParts(level, inst.right, rightEdit, "threshold");
    const pass = passEdit
      ? editable("select", inst.pass, passEdit, { ariaLabel: "true path", options: ["light", "sun", "dark", "open", "reject"] })
      : codeText(inst.pass, "string");
    return { ...base, parts: [codeText("if "), ...valueParts(level, inst.left), codeText(" "), operator, codeText(" "), ...right, codeText(":  # true → "), pass] };
  }
  return { ...base, parts: [codeText(inst.type, "fn")] };
}

function renderCode(level, program) {
  return program.instructions.map((inst, index) => codeForInstruction(level, inst, index));
}

function targetForInstruction(inst) {
  if (inst.type === "move") return inst.to;
  if (inst.type === "charge") return "charge";
  if (inst.type === "pickup") return inst.at || "pickup";
  if (inst.type === "write" || inst.type === "update") return "memory";
  if (inst.type === "read") return "reader";
  if (inst.type === "branch") return "gate";
  return inst.to || "exit";
}

function legacyFields(level, program) {
  const instructions = program.instructions || [];
  const values = {};
  const writeEnergy = instructions.find((item) => item.type === "write" && item.name === "energy");
  const updateEnergy = instructions.find((item) => item.type === "update" && item.name === "energy");
  const condition = instructions.find((item) => item.type === "branch");
  if (writeEnergy?.value?.type === "literal") values.energy = writeEnergy.value.value;
  if (updateEnergy?.value?.right?.type === "literal") values.update = updateEnergy.value.right.value;
  if (condition) {
    values.compare = condition.operator;
    values.threshold = condition.right?.value;
    values.target = condition.pass;
  }
  if ([1, 2, 7, 8].includes(level.id)) values.actionOrder = instructions.map((item) => item.type);
  if (level.id === 6) values.actionOrder = ["write", "gate", "read", "send"];
  return values;
}

function withLegacy(level, program) {
  return { ...program, ...legacyFields(level, program) };
}

const levelDefinitions = [
  {
    id: 1, zone: "STATION ZERO", title: "Wake Signal",
    story: "A small light blinks beneath the dead rail.",
    goal: "Reach the charge rail, then wake the signal.",
    help: "Flow matters. Put charge before deliver.",
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), deliver("exit"), charge(3)] },
    demoProgram: { instructions: [move("charge"), charge(3), deliver("exit")] },
    solution: { instructions: [move("charge"), charge(3), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "instruction order" }],
    successInvariant: { type: "flow", order: ["move", "charge", "deliver"], energy: 3, terminal: "exit" },
    failureCases: [{ when: "charge after deliver", message: "The rail leaves before it has power." }],
    successTitle: "The rail wakes.",
    successText: "One line of light cuts through Station Zero.",
  },
  {
    id: 2, zone: "STATION ZERO", title: "Cargo Line",
    story: "A dormant carrier waits beside a single unpowered rail.",
    goal: "Pick up the signal cell, move it, deliver it.",
    help: "Read the world top to bottom. Pickup must happen first.",
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), pickup("signal"), deliver("exit")] },
    demoProgram: { instructions: [pickup("signal"), move("charge"), deliver("exit")] },
    solution: { instructions: [pickup("signal"), move("charge"), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "instruction order" }],
    successInvariant: { type: "flow", order: ["pickup", "move", "deliver"], carried: "signal", terminal: "exit" },
    failureCases: [{ when: "move before pickup", message: "Unit-0 reaches rail empty. Nothing can be delivered." }],
  },
  {
    id: 3, zone: "MEMORY DEPOT", title: "Name the Spark",
    story: "A memory box holds whatever number Unit-0 gives it.",
    goal: "Write energy = 5, read it back, deliver the charge.",
    help: "Change amber number 2 to 5. Memory makes value survive.",
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(2)), read("energy"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(5)), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "energy", instruction: "write", path: "value.value", type: "number", label: "energy", min: 0, max: 9 }],
    successInvariant: { type: "memory", read: { name: "energy", value: 5 }, terminal: "exit" },
    failureCases: [{ when: "energy below 5", message: "Memory kept the number, but relay still lacks power." }],
  },
  {
    id: 4, zone: "MEMORY DEPOT", title: "Add One",
    story: "The depot can update a stored value without throwing it away.",
    goal: "Turn energy = 1 into energy = 2.",
    help: "Change update amount 0 to 1. Watch memory change in place.",
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(0))), read("energy"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "delta", instruction: "update", path: "value.right.value", type: "number", label: "update amount", min: 0, max: 9 }],
    successInvariant: { type: "memory-update", read: { name: "energy", value: 2 }, terminal: "exit" },
    failureCases: [{ when: "update amount is 0", message: "Update ran, but stored energy did not change." }],
  },
  {
    id: 5, zone: "MEMORY DEPOT", title: "Light Route",
    story: "A gate sends small signals toward the last lit district.",
    goal: "Use < to send energy 5 through LIGHT.",
    help: "The gate compares energy with 8. Choose the symbol that makes light.",
    scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), ">", literal(8), "light", "dark"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("exit")] },
    editableSlots: [{ id: "operator", instruction: "branch", path: "operator", type: "select", label: "operator", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "<", path: "light", terminal: "exit" },
    failureCases: [{ when: "operator is >", message: "5 > 8 is false. Gate diverts to dark." }],
  },
  {
    id: 6, zone: "MEMORY DEPOT", title: "Same Signal",
    story: "The cargo gate only opens when two labels match exactly.",
    goal: "Use == to send blue cargo through OPEN.",
    help: "Equality is literal. Read cargo, then choose ==.",
    scene: scenes.choice,
    starterProgram: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), ">", literal("blue"), "open", "reject"), deliver("exit")] },
    demoProgram: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), "==", literal("blue"), "open", "reject"), deliver("exit")] },
    solution: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), "==", literal("blue"), "open", "reject"), deliver("exit")] },
    editableSlots: [{ id: "operator", instruction: "branch", path: "operator", type: "select", label: "operator", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "==", path: "open", terminal: "exit" },
    failureCases: [{ when: "operator is not ==", message: "Cargo labels are not ordered numbers. They must match." }],
  },
  {
    id: 7, zone: "MEMORY DEPOT", title: "Relay Reorder",
    story: "Power and choice are ready, but the relay sequence is scrambled.",
    goal: "Write, update, read, then open the LIGHT path.",
    help: "Reorder first. Then set update to 3 and keep > 3.",
    scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(1)), branch(memory("energy"), ">", literal(3), "dark", "light"), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(3))), read("energy"), branch(memory("energy"), ">", literal(3), "light", "dark"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(3))), read("energy"), branch(memory("energy"), ">", literal(3), "light", "dark"), deliver("exit")] },
    editableSlots: [
      { id: "order", type: "order", label: "instruction order" },
      { id: "delta", instruction: "update", path: "value.right.value", type: "number", label: "update amount", min: 0, max: 9 },
      { id: "path", instruction: "branch", path: "pass", type: "select", label: "true path", options: ["light", "dark"] },
    ],
    successInvariant: { type: "combined", order: ["write", "update", "read", "branch", "deliver"], energy: 4, path: "light", terminal: "exit" },
    failureCases: [{ when: "branch before read", message: "Choice asks memory before update and read complete." }],
  },
  {
    id: 8, zone: "CENTRAL RELAY", title: "Make the Sun Rise",
    story: "The last command still glows: MAKE THE SUN RISE AGAIN.",
    goal: "Rebuild memory, choose SUN, send the final signal.",
    help: "Order write → update → read → branch → deliver. Set +4 and > 3.",
    scene: scenes.final,
    starterProgram: { instructions: [branch(memory("energy"), "<", literal(9), "dark", "sun"), write("energy", literal(1)), read("energy"), update("energy", add(memory("energy"), literal(1))), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(4))), read("energy"), branch(memory("energy"), ">", literal(3), "sun", "dark"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(4))), read("energy"), branch(memory("energy"), ">", literal(3), "sun", "dark"), deliver("exit")] },
    editableSlots: [
      { id: "order", type: "order", label: "instruction order" },
      { id: "delta", instruction: "update", path: "value.right.value", type: "number", label: "update amount", min: 0, max: 9 },
      { id: "operator", instruction: "branch", path: "operator", type: "select", label: "operator", options: [">", "<", "=="] },
      { id: "threshold", instruction: "branch", path: "right.value", type: "number", label: "threshold", min: 0, max: 9 },
      { id: "path", instruction: "branch", path: "pass", type: "select", label: "true path", options: ["sun", "dark"] },
    ],
    successInvariant: { type: "final", order: ["write", "update", "read", "branch", "deliver"], energy: 5, operator: ">", path: "sun", terminal: "exit" },
    failureCases: [{ when: "wrong path or value", message: "The tower stays dark. Every part of the program must agree." }],
    successTitle: "The sun answers.",
    successText: "THE SUN RISES AGAIN. Unit-0 watches the city breathe.",
  },
];

function legacyToProgram(level, raw) {
  const p = raw || {};
  if (Array.isArray(p.instructions)) return clone(p);
  const value = (name, fallback) => literal(p[name] ?? fallback);
  if (level.id === 1) {
    const order = p.actionOrder || ["move", "charge", "deliver"];
    if (order.join(",") === "charge,move,signal") return { instructions: [move("charge"), charge(3), deliver("exit")] };
    return { instructions: order.map((type) => type === "move" ? move("charge") : type === "charge" ? charge(3) : deliver("exit")) };
  }
  if (level.id === 2) {
    const order = p.actionOrder || ["pickup", "move", "deliver"];
    return { instructions: order.map((type) => type === "pickup" ? pickup("signal") : type === "move" ? move("charge") : deliver("exit")) };
  }
  if (level.id === 3) return { instructions: [write("energy", value("energy", 2)), read("energy"), deliver("exit")] };
  if (level.id === 4) return { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(p.delta ?? 1))), read("energy"), deliver("exit")] };
  if (level.id === 5) return { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), p.compare || ">", literal(p.threshold ?? 8), "light", "dark"), deliver("exit")] };
  if (level.id === 6) return { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), p.compare || ">", literal("blue"), "open", "reject"), deliver("exit")] };
  if (level.id === 7) return { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(p.update ?? 3))), read("energy"), branch(memory("energy"), ">", literal(p.threshold ?? 3), p.target === "blue" ? "light" : "dark", "dark"), deliver("exit")] };
  return { instructions: [write("energy", value("energy", 2)), update("energy", add(memory("energy"), literal(p.update ?? 4))), read("energy"), branch(memory("energy"), p.compare || "<", literal(p.threshold ?? 5), "sun", "dark"), deliver("exit")] };
}

function stateHasRuntimeData(state) {
  return Boolean(state && (state.eventCursor !== undefined || state.unitNode || state.signalSent || state.delivered));
}

function legacyCheck(level, raw) {
  const p = raw || {};
  if (level.id === 1) return (p.actionOrder || []).join(",") === "charge,move,signal" || (p.actionOrder || []).join(",") === "move,charge,deliver";
  if (level.id === 2) return (p.actionOrder || []).join(",") === "pickup,move,deliver" || Number(p.energy) >= 5;
  if (level.id === 3) return Number(p.energy) >= 5;
  if (level.id === 4) return (p.target === "blue" && p.compare === "==") || Number(p.update ?? 0) >= 1;
  if (level.id === 5) return p.compare === "<" || (p.compare === ">" && Number(p.threshold) < 7);
  if (level.id === 6) return p.compare === "==" || ((p.actionOrder || []).join(",") === "write,read,gate,send" && Number(p.energy) >= 5 && p.compare === ">");
  if (level.id === 7) return (Number(p.update ?? 0) >= 3) || (Number(p.energy) >= 8 && p.target === "blue");
  return Number(p.energy) + Number(p.update ?? 0) >= 5 && p.compare === ">";
}

export function evaluateSuccess(level, rawProgram, state = {}) {
  if (!stateHasRuntimeData(state)) return legacyCheck(level, rawProgram);
  const order = (rawProgram.instructions || []).map((item) => item.type);
  const path = state.path;
  if (level.id === 1) return order.join(",") === "move,charge,deliver" && state.energy >= 3 && state.unitNode === "exit";
  if (level.id === 2) return order.join(",") === "pickup,move,deliver" && state.carried === "signal" && state.unitNode === "exit";
  if (level.id === 3) return state.readValue === 5 && state.unitNode === "exit";
  if (level.id === 4) return state.readValue === 2 && state.unitNode === "exit";
  if (level.id === 5) return path === "light" && state.unitNode === "exit";
  if (level.id === 6) return path === "open" && state.unitNode === "exit";
  if (level.id === 7) return order.join(",") === "write,update,read,branch,deliver" && state.energy >= 4 && path === "light" && state.unitNode === "exit";
  return order.join(",") === "write,update,read,branch,deliver" && state.energy >= 5 && path === "sun" && state.unitNode === "exit";
}

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) cursor = cursor[keys[i]];
  cursor[keys.at(-1)] = value;
}

export function applyEdit(level, program, edit, value) {
  const next = cloneProgram(program);
  const inst = next.instructions[edit.index];
  if (!inst) return next;
  if (edit.path === "operator") inst.operator = [">", "<", "=="].includes(value) ? value : inst.operator;
  else if (edit.path === "pass") inst.pass = String(value);
  else if (edit.path.endsWith(".value")) setPath(inst, edit.path, Math.max(0, Math.min(9, Number(value) || 0)));
  else setPath(inst, edit.path, value);
  return withLegacy(level, next);
}

export function reorderProgram(level, program, index, delta) {
  const next = cloneProgram(program);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= next.instructions.length) return next;
  [next.instructions[index], next.instructions[nextIndex]] = [next.instructions[nextIndex], next.instructions[index]];
  return withLegacy(level, next);
}

function finishLevels() {
  return levelDefinitions.map((level) => {
    level.starterProgram = withLegacy(level, level.starterProgram);
    level.demoProgram = withLegacy(level, level.demoProgram);
    level.solution = withLegacy(level, level.solution);
    level.code = (program) => renderCode(level, normalizeProgram(level, program));
    level.steps = (program) => normalizeProgram(level, program).instructions.map((item, index) => ({ ...clone(item), op: item.type, line: index + 1, target: targetForInstruction(item) }));
    level.check = (program, state) => {
      const ok = evaluateSuccess(level, program, state);
      return { ok, text: ok ? level.successText : (level.failureCases?.[0]?.message || "Program stopped.") };
    };
    level.successTitle ||= level.id === 8 ? "The sun answers." : "Signal restored.";
    level.successText ||= level.id === 8 ? "THE SUN RISES AGAIN." : "One more piece of city wakes.";
    return level;
  });
}

const levels = finishLevels();

export function getLevels() { return levels; }
export function getLevel(index) { return levels[index]; }
export function getScene(level) { return level.scene; }
export function createProgram(level) { return clone(level.starterProgram); }
export function cloneProgram(program) { return clone(program); }

function syncLegacyOverrides(level, raw) {
  const next = clone(raw);
  const branchInstruction = next.instructions.find((item) => item.type === "branch");
  const updateInstruction = next.instructions.find((item) => item.type === "update" && item.name === "energy");
  const writeInstruction = next.instructions.find((item) => item.type === "write" && item.name === "energy");
  const typedOrder = next.instructions.map((item) => item.type);
  const legacyOrder = Array.isArray(next.actionOrder) ? next.actionOrder : null;
  if (legacyOrder && level.id !== 6 && legacyOrder.join(",") !== typedOrder.join(",")) return legacyToProgram(level, next);
  if (level.id === 3 && writeInstruction && next.energy !== undefined && Number(next.energy) !== Number(writeInstruction.value.value)) writeInstruction.value.value = Number(next.energy);
  if (level.id === 5 && branchInstruction) {
    if (next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
    if (next.threshold !== undefined && Number(next.threshold) !== Number(branchInstruction.right.value)) branchInstruction.right.value = Number(next.threshold);
  }
  if (level.id === 6 && branchInstruction && next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
  if ((level.id === 7 || level.id === 8) && writeInstruction && next.energy !== undefined && Number(next.energy) !== Number(writeInstruction.value.value)) writeInstruction.value.value = Number(next.energy);
  if ((level.id === 7 || level.id === 8) && updateInstruction && next.update !== undefined && Number(next.update) !== Number(updateInstruction.value.right.value)) updateInstruction.value.right.value = Number(next.update);
  if ((level.id === 7 || level.id === 8) && branchInstruction) {
    if (next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
    if (next.threshold !== undefined && Number(next.threshold) !== Number(branchInstruction.right.value)) branchInstruction.right.value = Number(next.threshold);
    if (next.target === "blue" && level.id === 7) branchInstruction.pass = "light";
  }
  return next;
}

export function normalizeProgram(level, program) {
  const raw = program || {};
  if (!Array.isArray(raw.instructions)) return withLegacy(level, legacyToProgram(level, raw));
  return withLegacy(level, syncLegacyOverrides(level, raw));
}
