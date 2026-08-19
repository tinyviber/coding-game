const clone = (value) => JSON.parse(JSON.stringify(value));

export const MAX_EVENTS = 64;

export const literal = (value) => ({ type: "literal", value });
export const memory = (name) => ({ type: "memory", name });
export const add = (left, right) => ({ type: "add", left, right });
export const subtract = (left, right) => ({ type: "subtract", left, right });

const instruction = (id, type, fields = {}) => ({ id, type, ...fields });
const write = (name, value, id = `write_${name}`) => instruction(id, "write", { name, value });
const update = (name, value, id = `update_${name}`) => instruction(id, "update", { name, value });
const read = (name, id = `read_${name}`) => instruction(id, "read", { name });
const branch = (left, operator, right, pass, fail, id = "branch_gate") => instruction(id, "branch", { left, operator, right, pass, fail });
const move = (to, id = `move_${to}`) => instruction(id, "move", { to });
const charge = (amount = 3, id = "charge_station") => instruction(id, "charge", { amount });
const pickup = (item, at = "pickup", id = `pickup_${item}`) => instruction(id, "pickup", { item, at });
const deliver = (to = "exit", id = `deliver_${to}`) => instruction(id, "deliver", { to });

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
    branchNode: "gate",
    pathAliases: { open: "light", reject: "dark" },
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
    branchNode: "gate",
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

function pathOptions(level, branchInstruction) {
  const scene = level.scene || {};
  const branchNode = scene.branchNode;
  const outgoing = (scene.edges || [])
    .filter(([from]) => from === branchNode)
    .map(([, to]) => to);
  const aliases = scene.pathAliases || {};
  return [...new Set(outgoing.map((target) => {
    const alias = Object.entries(aliases).find(([, node]) => node === target)?.[0];
    const usesAlias = alias && [branchInstruction?.pass, branchInstruction?.fail].includes(alias);
    return usesAlias ? alias : target;
  }))];
}

function codeForInstruction(level, inst, index) {
  const line = index + 1;
  const base = { line, instructionId: inst.id, orderKey: "instructions", orderIndex: index, instructionType: inst.type };
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
      ? editable("select", inst.pass, passEdit, { ariaLabel: "true path", options: pathOptions(level, inst) })
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
  const key = level.legacyKey;
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
  if (["wake-signal", "cargo-line", "relay-reorder", "make-the-sun-rise"].includes(key)) values.actionOrder = instructions.map((item) => item.type);
  if (key === "same-signal") values.actionOrder = ["write", "gate", "read", "send"];
  return values;
}

function withLegacy(level, program) {
  return { ...program, ...legacyFields(level, program) };
}

const levelDefinitions = [
  {
    id: 1, legacyKey: "wake-signal", zone: "STATION ZERO", title: "Wake Signal",
    story: "The dead rail gives one weak blink. Unit-0 turns toward it.",
    goal: "Find what can still feed the rail.",
    help: "Watch which node still answers Unit-0.",
    hintSteps: ["The signal leaves before it has enough power.", "Unit-0 needs to reach the only bright node first.", "Let the charge happen before the signal is delivered."],
    law: "Flow",
    lawBeat: { type: "flow", caption: "The rail wakes only in order. First, a path. Then, power." },
    dawnProgress: 0.03,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy", deliver: [{ type: "memoryMin", name: "energy", value: 3 }] },
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), deliver("exit"), charge(3)] },
    demoProgram: { instructions: [move("charge"), charge(3), deliver("exit")] },
    solution: { instructions: [move("charge"), charge(3), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "instruction order" }],
    successInvariant: { type: "flow", order: ["move", "charge", "deliver"], energy: 3, terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["move", "charge", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 3 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "charge after deliver", message: "The rail leaves before it has power." }],
    successTitle: "The rail wakes.",
    successText: "One line of light cuts through Station Zero.",
  },
  {
    id: 2, legacyKey: "cargo-line", zone: "STATION ZERO", title: "Cargo Line",
    story: "A dormant carrier holds the last signal cell beside the rail.",
    goal: "Carry the cell to the silent relay.",
    help: "The world remembers where Unit-0 picked the cell up.",
    hintSteps: ["The relay receives nothing when Unit-0 arrives empty-handed.", "Look for the cell before the long rail begins.", "The cell must be picked up before the move and delivery."],
    dawnProgress: 0.12,
    memoryNames: ["energy", "signal"],
    worldRules: { chargeMemory: "energy", deliver: [{ type: "carried", value: "signal" }] },
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), pickup("signal"), deliver("exit")] },
    demoProgram: { instructions: [pickup("signal"), move("charge"), deliver("exit")] },
    solution: { instructions: [pickup("signal"), move("charge"), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "instruction order" }],
    successInvariant: { type: "flow", order: ["pickup", "move", "deliver"], carried: "signal", terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["pickup", "move", "deliver"] },
      { type: "carried", value: "signal" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "move before pickup", message: "Unit-0 reaches rail empty. Nothing can be delivered." }],
  },
  {
    id: 3, legacyKey: "name-the-spark", zone: "MEMORY DEPOT", title: "Name the Spark",
    story: "A dark memory box waits for a named spark.",
    goal: "Make the relay remember enough charge.",
    help: "A value that should survive needs a named box.",
    hintSteps: ["The number disappears unless the box keeps it.", "Write a charge into Memory, then let the reader find it.", "The relay still needs a stronger stored charge than the starter value."],
    law: "Memory",
    lawBeat: { type: "memory", caption: "A number vanishes in open air. Memory Box keeps it by name." },
    dawnProgress: 0.27,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(2)), read("energy"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(5)), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "energy", instruction: "write", path: "value.value", type: "number", label: "energy", min: 0, max: 9 }],
    successInvariant: { type: "memory", read: { name: "energy", value: 5 }, terminal: "exit" },
    successRules: [
      { type: "readEquals", name: "energy", value: 5 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "energy below 5", message: "Memory kept the number, but relay still lacks power." }],
  },
  {
    id: 4, legacyKey: "add-one", zone: "MEMORY DEPOT", title: "Add One",
    story: "The box is awake. Its stored charge is one step short.",
    goal: "Change the value already in Memory.",
    help: "Watch whether the token inside the box changes or stays still.",
    hintSteps: ["The box keeps its old value when the update adds nothing.", "Update the stored token instead of writing a new box.", "Try a small positive change, then read the result back."],
    dawnProgress: 0.39,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(0))), read("energy"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "delta", instruction: "update", path: "value.right.value", type: "number", label: "update amount", min: 0, max: 9 }],
    successInvariant: { type: "memory-update", read: { name: "energy", value: 2 }, terminal: "exit" },
    successRules: [
      { type: "readEquals", name: "energy", value: 2 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "update amount is 0", message: "Update ran, but stored energy did not change." }],
  },
  {
    id: 5, legacyKey: "light-route", zone: "MEMORY DEPOT", title: "Light Route",
    story: "Two districts wait beyond a gate. One still has a light in it.",
    goal: "Send the stored signal toward the living district.",
    help: "The gate will show its comparison before it chooses.",
    hintSteps: ["The bright road opens only when the gate says TRUE.", "Read the number carried by the token and compare it with the gate marker.", "Try the comparison that makes the current value pass the marker."],
    law: "Choice",
    lawBeat: { type: "choice", caption: "The gate reads a token, compares it, then opens one road." },
    dawnProgress: 0.53,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), ">", literal(8), "light", "dark"), deliver("exit")] },
    demoProgram: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("exit")] },
    editableSlots: [{ id: "operator", instruction: "branch", path: "operator", type: "select", label: "operator", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "<", path: "light", terminal: "exit" },
    successRules: [
      { type: "branchTaken", value: "light" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "operator is >", message: "5 > 8 is false. Gate diverts to dark." }],
  },
  {
    id: 6, legacyKey: "same-signal", zone: "MEMORY DEPOT", title: "Same Signal",
    story: "A cargo gate rejects every label that is merely similar.",
    goal: "Make the gate recognise the signal.",
    help: "The gate cares about what the two tokens actually say.",
    hintSteps: ["The gate rejects labels that are not the same kind of match.", "Look at both labels when the comparison appears.", "Choose the comparison that means exactly the same."],
    dawnProgress: 0.64,
    memoryNames: ["cargo"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.choice,
    starterProgram: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), ">", literal("blue"), "open", "reject"), deliver("exit")] },
    demoProgram: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), "==", literal("blue"), "open", "reject"), deliver("exit")] },
    solution: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), "==", literal("blue"), "open", "reject"), deliver("exit")] },
    editableSlots: [{ id: "operator", instruction: "branch", path: "operator", type: "select", label: "operator", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "==", path: "open", terminal: "exit" },
    successRules: [
      { type: "branchTaken", value: "open" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "operator is not ==", message: "Cargo labels are not ordered numbers. They must match." }],
  },
  {
    id: 7, legacyKey: "relay-reorder", zone: "MEMORY DEPOT", title: "Relay Reorder",
    story: "The depot lights return, but its relay instructions are scrambled.",
    goal: "Restore one complete relay sequence.",
    help: "Follow the token: box, change, read, gate, relay.",
    hintSteps: ["The gate is asking before the stored token is ready.", "Trace the token from its first box to the final road.", "Reorder the actions so every world object receives its turn."],
    dawnProgress: 0.78,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
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
    successRules: [
      { type: "executedInOrder", value: ["write", "update", "read", "branch", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 4 },
      { type: "branchTaken", value: "light" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "branch before read", message: "Choice asks memory before update and read complete." }],
  },
  {
    id: 8, legacyKey: "make-the-sun-rise", zone: "CENTRAL RELAY", title: "Make the Sun Rise",
    story: "Beyond the central relay, one broken instruction still glows: MAKE THE SUN RISE AGAIN.",
    goal: "Carry one last living signal to the tower.",
    help: "The tower needs a complete chain, not one perfect line.",
    hintSteps: ["The tower stays dark when any link in the signal chain is missing.", "Trace the charge from Memory through the reader and gate.", "Make the stored signal cross the threshold and take the sun road."],
    dawnProgress: 0.92,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
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
    successRules: [
      { type: "executedInOrder", value: ["write", "update", "read", "branch", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 5 },
      { type: "branchTaken", value: "sun" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "wrong path or value", message: "The tower stays dark. Every part of the program must agree." }],
    successTitle: "The sun answers.",
    successText: "THE SUN RISES AGAIN. Unit-0 watches the city breathe.",
  },
];

function legacyToProgram(level, raw) {
  const p = raw || {};
  const key = level.legacyKey;
  if (Array.isArray(p.instructions)) return clone(p);
  const value = (name, fallback) => literal(p[name] ?? fallback);
  if (key === "wake-signal") {
    const order = p.actionOrder || ["move", "charge", "deliver"];
    if (order.join(",") === "charge,move,signal") return { instructions: [move("charge"), charge(3), deliver("exit")] };
    return { instructions: order.map((type) => type === "move" ? move("charge") : type === "charge" ? charge(3) : deliver("exit")) };
  }
  if (key === "cargo-line") {
    const order = p.actionOrder || ["pickup", "move", "deliver"];
    return { instructions: order.map((type) => type === "pickup" ? pickup("signal") : type === "move" ? move("charge") : deliver("exit")) };
  }
  if (key === "name-the-spark") return { instructions: [write("energy", value("energy", 2)), read("energy"), deliver("exit")] };
  if (key === "add-one") return { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(p.delta ?? 1))), read("energy"), deliver("exit")] };
  if (key === "light-route") return { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), p.compare || ">", literal(p.threshold ?? 8), "light", "dark"), deliver("exit")] };
  if (key === "same-signal") return { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), p.compare || ">", literal("blue"), "open", "reject"), deliver("exit")] };
  if (key === "relay-reorder") return { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(p.update ?? 3))), read("energy"), branch(memory("energy"), ">", literal(p.threshold ?? 3), p.target === "blue" ? "light" : "dark", "dark"), deliver("exit")] };
  return { instructions: [write("energy", value("energy", 2)), update("energy", add(memory("energy"), literal(p.update ?? 4))), read("energy"), branch(memory("energy"), p.compare || "<", literal(p.threshold ?? 5), "sun", "dark"), deliver("exit")] };
}

function stateHasRuntimeData(state) {
  return Boolean(state && (state.eventCursor !== undefined || state.unitNode || state.signalSent || state.delivered));
}

function programTypes(program) {
  return (program?.instructions || []).map((item) => item.type);
}

function branchInstructions(program) {
  return (program?.instructions || []).filter((item) => item.type === "branch");
}

function matchesSuccessRule(rule, program, state) {
  if (!rule) return true;
  if (rule.type === "all") return (rule.rules || []).every((item) => matchesSuccessRule(item, program, state));
  if (rule.type === "executedInOrder") return programTypes(program).join(",") === (rule.value || []).join(",");
  if (rule.type === "atNode") return state.unitNode === rule.value;
  if (rule.type === "memoryEquals") return state.vars?.[rule.name] === rule.value;
  if (rule.type === "readEquals") return state.readName === rule.name && state.readValue === rule.value;
  if (rule.type === "branchTaken") return state.path === rule.value;
  if (rule.type === "carried") return state.carried === rule.value;
  if (rule.type === "branchOperator") return branchInstructions(program).some((item) => item.operator === rule.value);
  return false;
}

function legacyCheck(level, raw) {
  const p = raw || {};
  const key = level.legacyKey;
  if (key === "wake-signal") return (p.actionOrder || []).join(",") === "charge,move,signal" || (p.actionOrder || []).join(",") === "move,charge,deliver";
  if (key === "cargo-line") return (p.actionOrder || []).join(",") === "pickup,move,deliver" || Number(p.energy) >= 5;
  if (key === "name-the-spark") return Number(p.energy) >= 5;
  if (key === "add-one") return (p.target === "blue" && p.compare === "==") || Number(p.update ?? 0) >= 1;
  if (key === "light-route") return p.compare === "<" || (p.compare === ">" && Number(p.threshold) < 7);
  if (key === "same-signal") return p.compare === "==" || ((p.actionOrder || []).join(",") === "write,read,gate,send" && Number(p.energy) >= 5 && p.compare === ">");
  if (key === "relay-reorder") return (Number(p.update ?? 0) >= 3) || (Number(p.energy) >= 8 && p.target === "blue");
  return Number(p.energy) + Number(p.update ?? 0) >= 5 && p.compare === ">";
}

export function evaluateSuccess(level, rawProgram, state = {}) {
  if (Array.isArray(level.successRules) && stateHasRuntimeData(state)) {
    const program = normalizeProgram(level, rawProgram);
    return level.successRules.every((rule) => matchesSuccessRule(rule, program, state));
  }
  if (!stateHasRuntimeData(state)) return legacyCheck(level, rawProgram);
  const key = level.legacyKey;
  const order = (rawProgram.instructions || []).map((item) => item.type);
  const path = state.path;
  if (key === "wake-signal") return order.join(",") === "move,charge,deliver" && state.energy >= 3 && state.unitNode === "exit";
  if (key === "cargo-line") return order.join(",") === "pickup,move,deliver" && state.carried === "signal" && state.unitNode === "exit";
  if (key === "name-the-spark") return state.readValue === 5 && state.unitNode === "exit";
  if (key === "add-one") return state.readValue === 2 && state.unitNode === "exit";
  if (key === "light-route") return path === "light" && state.unitNode === "exit";
  if (key === "same-signal") return path === "open" && state.unitNode === "exit";
  if (key === "relay-reorder") return order.join(",") === "write,update,read,branch,deliver" && state.energy >= 4 && path === "light" && state.unitNode === "exit";
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
  else if (edit.path === "pass" && pathOptions(level, inst).includes(String(value))) inst.pass = String(value);
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
    level.steps = (program) => normalizeProgram(level, program).instructions.map((item, index) => ({ ...clone(item), op: item.type, instructionId: item.id, line: index + 1, sourceLine: index + 1, target: targetForInstruction(item) }));
    level.check = (program, state) => {
      const ok = evaluateSuccess(level, program, state);
      return { ok, text: ok ? level.successText : (level.failureCases?.[0]?.message || "Program stopped.") };
    };
    level.successTitle ||= level.legacyKey === "make-the-sun-rise" ? "The sun answers." : "Signal restored.";
    level.successText ||= level.legacyKey === "make-the-sun-rise" ? "THE SUN RISES AGAIN." : "One more piece of city wakes.";
    return level;
  });
}

const levels = finishLevels();

export function getLevels() { return levels; }
export function getLevel(index) { return levels[index]; }
export function getScene(level) { return level.scene; }
export function createProgram(level) { return clone(level.starterProgram); }
export function cloneProgram(program) { return clone(program); }

function ensureInstructionIds(program) {
  const seen = new Map();
  const instructions = (program.instructions || []).map((item) => {
    const base = typeof item.id === "string" && item.id ? item.id : item.type || "instruction";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return { ...item, id: count ? `${base}_${count + 1}` : base };
  });
  return { ...program, instructions };
}

function syncLegacyOverrides(level, raw) {
  const next = clone(raw);
  const key = level.legacyKey;
  const branchInstruction = next.instructions.find((item) => item.type === "branch");
  const updateInstruction = next.instructions.find((item) => item.type === "update" && item.name === "energy");
  const writeInstruction = next.instructions.find((item) => item.type === "write" && item.name === "energy");
  const typedOrder = next.instructions.map((item) => item.type);
  const legacyOrder = Array.isArray(next.actionOrder) ? next.actionOrder : null;
  if (legacyOrder && key !== "same-signal" && legacyOrder.join(",") !== typedOrder.join(",")) return legacyToProgram(level, next);
  if (key === "name-the-spark" && writeInstruction && next.energy !== undefined && Number(next.energy) !== Number(writeInstruction.value.value)) writeInstruction.value.value = Number(next.energy);
  if (key === "light-route" && branchInstruction) {
    if (next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
    if (next.threshold !== undefined && Number(next.threshold) !== Number(branchInstruction.right.value)) branchInstruction.right.value = Number(next.threshold);
  }
  if (key === "same-signal" && branchInstruction && next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
  if (["relay-reorder", "make-the-sun-rise"].includes(key) && writeInstruction && next.energy !== undefined && Number(next.energy) !== Number(writeInstruction.value.value)) writeInstruction.value.value = Number(next.energy);
  if (["relay-reorder", "make-the-sun-rise"].includes(key) && updateInstruction && next.update !== undefined && Number(next.update) !== Number(updateInstruction.value.right.value)) updateInstruction.value.right.value = Number(next.update);
  if (["relay-reorder", "make-the-sun-rise"].includes(key) && branchInstruction) {
    if (next.compare && next.compare !== branchInstruction.operator) branchInstruction.operator = next.compare;
    if (next.threshold !== undefined && Number(next.threshold) !== Number(branchInstruction.right.value)) branchInstruction.right.value = Number(next.threshold);
    if (next.target === "blue" && key === "relay-reorder") branchInstruction.pass = "light";
  }
  return next;
}

export function normalizeProgram(level, program) {
  const raw = program || {};
  if (!Array.isArray(raw.instructions)) return withLegacy(level, ensureInstructionIds(legacyToProgram(level, raw)));
  return withLegacy(level, ensureInstructionIds(syncLegacyOverrides(level, raw)));
}
