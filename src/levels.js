const clone = (value) => JSON.parse(JSON.stringify(value));

export const MAX_EVENTS = 64;

export const literal = (value) => ({ type: "literal", value });
export const memory = (name) => ({ type: "memory", name });
export const add = (left, right) => ({ type: "add", left, right });
export const subtract = (left, right) => ({ type: "subtract", left, right });

const instruction = (id, type, fields = {}) => ({ id, type, ...fields });
const move = (to, id = `move_${to}`) => instruction(id, "move", { to });
const charge = (amount = 3, id = "charge_station") => instruction(id, "charge", { amount });
const pickup = (item, at = item, id = `pickup_${item}`) => instruction(id, "pickup", { item, at });
const deliver = (to = "relay", id = `deliver_${to}`) => instruction(id, "deliver", { to });
const write = (name, value, id = `write_${name}`) => instruction(id, "write", { name, value });
const update = (name, value, id = `update_${name}`) => instruction(id, "update", { name, value });
const branch = (left, operator, right, pass, fail, id = "branch_gate") => instruction(id, "branch", { left, operator, right, pass, fail });

const scenes = {
  flow: {
    nodes: [
      { id: "dock", x: 0.12, y: 0.55, type: "dock", label: "小屋" },
      { id: "charge", x: 0.49, y: 0.55, type: "energy", label: "充电站" },
      { id: "relay", x: 0.86, y: 0.55, type: "relay", label: "中继站" },
    ],
    edges: [["dock", "charge"], ["charge", "relay"]],
  },
  relayCore: {
    nodes: [
      { id: "dock", x: 0.12, y: 0.55, type: "dock", label: "小屋" },
      { id: "relay_core", x: 0.49, y: 0.55, type: "core", label: "中继核心" },
      { id: "relay", x: 0.86, y: 0.55, type: "relay", label: "中继站" },
    ],
    edges: [["dock", "relay_core"], ["relay_core", "relay"]],
  },
  memory: {
    nodes: [
      { id: "dock", x: 0.12, y: 0.55, type: "dock", label: "小屋" },
      { id: "memory", x: 0.5, y: 0.55, type: "memory", label: "记忆盒" },
      { id: "relay", x: 0.87, y: 0.55, type: "relay", label: "中继站" },
    ],
    edges: [["dock", "memory"], ["memory", "relay"]],
  },
  choice: {
    branchNode: "gate",
    nodes: [
      { id: "dock", x: 0.08, y: 0.52, type: "dock", label: "小屋" },
      { id: "memory", x: 0.29, y: 0.52, type: "memory", label: "记忆盒" },
      { id: "gate", x: 0.54, y: 0.52, type: "gate", label: "判断门" },
      { id: "light", x: 0.75, y: 0.27, type: "accept", label: "亮路" },
      { id: "dark", x: 0.75, y: 0.77, type: "reject", label: "暗路" },
      { id: "relay", x: 0.93, y: 0.52, type: "relay", label: "中继站" },
    ],
    edges: [["dock", "memory"], ["memory", "gate"], ["gate", "light"], ["gate", "dark"], ["light", "relay"], ["dark", "relay"]],
  },
  dawn: {
    branchNode: "gate",
    nodes: [
      { id: "dock", x: 0.07, y: 0.52, type: "dock", label: "小屋" },
      { id: "memory", x: 0.26, y: 0.52, type: "memory", label: "记忆盒" },
      { id: "gate", x: 0.52, y: 0.52, type: "gate", label: "判断门" },
      { id: "dawn", x: 0.75, y: 0.26, type: "accept", label: "晨光路" },
      { id: "dark", x: 0.75, y: 0.78, type: "reject", label: "暗路" },
      { id: "relay", x: 0.94, y: 0.52, type: "relay", label: "中央塔" },
    ],
    edges: [["dock", "memory"], ["memory", "gate"], ["gate", "dawn"], ["gate", "dark"], ["dawn", "relay"], ["dark", "relay"]],
  },
};

const WORLD_LABELS = Object.freeze({
  dock: "小屋",
  charge: "充电站",
  memory: "记忆盒",
  gate: "判断门",
  relay: "中继站",
  relay_core: "中继核心",
  light: "亮路",
  dark: "暗路",
  dawn: "晨光路",
});

const MEMORY_LABELS = Object.freeze({ cargo: "标签", energy: "energy" });

const WORLD_TOKEN_PATTERN = /\b(?:relay_core|dock|charge|memory|gate|relay|light|dark|dawn)\b/g;
const CODE_WORD_PATTERN = /\b(?:move|charge|pickup|deliver|write|update|branch)\b/g;

export function getWorldLabel(level, id) {
  const node = level?.scene?.nodes?.find((item) => item.id === id);
  return node?.label && node.label !== id ? node.label : WORLD_LABELS[id] || id;
}

export function getWorldItemLabel(level, id) {
  return id === "relay_core" ? WORLD_LABELS.relay_core : getWorldLabel(level, id);
}

export function getMemoryLabel(name, { prose = false } = {}) {
  if (name === "cargo") return MEMORY_LABELS.cargo;
  if (name === "energy") return prose ? "能量" : MEMORY_LABELS.energy;
  return name;
}

export function formatWorldText(level, text, { preserveCodeWords = false } = {}) {
  if (typeof text !== "string") return text;
  const protectedParts = [];
  const protectCode = (value) => {
    protectedParts.push(value);
    return `\u0000${protectedParts.length - 1}\u0000`;
  };
  const source = preserveCodeWords ? text.replace(CODE_WORD_PATTERN, protectCode) : text;
  const formatted = source.replace(WORLD_TOKEN_PATTERN, (id) => getWorldItemLabel(level, id));
  return formatted.replace(/\u0000(\d+)\u0000/g, (_, index) => protectedParts[Number(index)]);
}

const codeText = (text, tone = "") => ({ text, tone });
const editable = (type, value, edit, extra = {}) => ({ type, value, edit, ...extra });

const isEditable = (level, inst, path) => (level.editableSlots || []).some((slot) => (
  slot.path === path && slot.instructionId === inst.id
));

function formatValue(expr) {
  if (!expr) return "?";
  if (expr.type === "memory") return expr.name;
  if (expr.type === "literal") return typeof expr.value === "string" ? `"${expr.value}"` : String(expr.value);
  const operator = expr.type === "add" ? "+" : "-";
  return `${formatValue(expr.left)} ${operator} ${formatValue(expr.right)}`;
}

function valueParts(level, expr, edit, label) {
  if (expr?.type === "memory") return [codeText(expr.name, "string")];
  if (expr?.type !== "literal") return [codeText(formatValue(expr), "string")];
  if (!edit) return [codeText(formatValue(expr), typeof expr.value === "string" ? "string" : "number")];
  if (typeof expr.value === "number") return [editable("number", expr.value, edit, { ariaLabel: label, min: 0, max: 9 })];
  return [editable("select", expr.value, edit, { ariaLabel: label, options: ["blue", "red", "cargo"] })];
}

function pathOptions(level) {
  const branchNode = level.scene?.branchNode;
  return (level.scene?.edges || [])
    .filter(([from]) => from === branchNode)
    .map(([, to]) => to);
}

function instructionBase(inst, sourceLine, displayLine, index) {
  return {
    line: displayLine,
    displayLine,
    sourceLine,
    instructionId: inst.id,
    orderKey: "instructions",
    orderIndex: index,
    instructionType: inst.type,
  };
}

function codeRowsForInstruction(level, inst, index, displayLine) {
  const sourceLine = index + 1;
  const base = instructionBase(inst, sourceLine, displayLine, index);
  if (inst.type === "move") return { rows: [{ ...base, parts: [codeText(`move("${inst.to}")`, "fn")] }], next: displayLine + 1 };
  if (inst.type === "charge") return { rows: [{ ...base, parts: [codeText("charge(", "fn"), codeText(String(inst.amount)), codeText(")", "fn")] }], next: displayLine + 1 };
  if (inst.type === "pickup") return { rows: [{ ...base, parts: [codeText("pickup(", "fn"), codeText(`"${inst.item}"`, "string"), codeText(")", "fn")] }], next: displayLine + 1 };
  if (inst.type === "deliver") return { rows: [{ ...base, parts: [codeText("deliver(", "fn"), codeText(`"${inst.to}"`, "string"), codeText(")", "fn")] }], next: displayLine + 1 };
  if (inst.type === "write") {
    const edit = isEditable(level, inst, "value.value") ? { instructionId: inst.id, path: "value.value" } : null;
    return {
      rows: [{ ...base, parts: [codeText(`${inst.name} = `), ...valueParts(level, inst.value, edit, `${inst.name} 数值`)] }],
      next: displayLine + 1,
    };
  }
  if (inst.type === "update") {
    const edit = isEditable(level, inst, "value.right.value") ? { instructionId: inst.id, path: "value.right.value" } : null;
    const value = inst.value.type === "add" || inst.value.type === "subtract" ? inst.value.right : inst.value;
    const operator = inst.value.type === "subtract" ? " - " : " + ";
    return {
      rows: [{ ...base, parts: [codeText(`${inst.name} = ${inst.name}${operator}`), ...valueParts(level, value, edit, `${inst.name} 更新量`)] }],
      next: displayLine + 1,
    };
  }
  if (inst.type === "branch") {
    const operatorEdit = isEditable(level, inst, "operator") ? { instructionId: inst.id, path: "operator" } : null;
    const rightEdit = isEditable(level, inst, "right.value") ? { instructionId: inst.id, path: "right.value" } : null;
    const passEdit = isEditable(level, inst, "pass") ? { instructionId: inst.id, path: "pass" } : null;
    const operator = operatorEdit
      ? editable("select", inst.operator, operatorEdit, { ariaLabel: "比较符号", options: [">", "<", "=="] })
      : codeText(inst.operator, "keyword");
    const right = valueParts(level, inst.right, rightEdit, "比较数值");
    const passControl = passEdit
      ? editable("select", inst.pass, passEdit, { ariaLabel: "成立路线", options: pathOptions(level) })
      : codeText(`"${inst.pass}"`, "string");
    const failEdit = isEditable(level, inst, "fail") ? { instructionId: inst.id, path: "fail" } : null;
    const failControl = failEdit
      ? editable("select", inst.fail, failEdit, { ariaLabel: "不成立路线", options: pathOptions(level) })
      : codeText(`"${inst.fail}"`, "string");
    const passText = codeText(`"${inst.pass}"`, "string");
    const failText = codeText(`"${inst.fail}"`, "string");
    const rows = [
      { ...base, displayRole: "condition", parts: [codeText("if ", "keyword"), ...valueParts(level, inst.left), codeText(" "), operator, codeText(" "), ...right, codeText(":  # 成立 → "), passControl, codeText("；不成立 → "), failControl] },
      { line: displayLine + 1, displayLine: displayLine + 1, sourceLine, instructionId: inst.id, instructionType: inst.type, displayOnly: true, indent: 1, displayRole: "pass", parts: [codeText("go(", "fn"), passText, codeText(")", "fn")] },
      { line: displayLine + 2, displayLine: displayLine + 2, sourceLine, instructionId: inst.id, instructionType: inst.type, displayOnly: true, displayRole: "else", parts: [codeText("else", "keyword"), codeText(":")] },
      { line: displayLine + 3, displayLine: displayLine + 3, sourceLine, instructionId: inst.id, instructionType: inst.type, displayOnly: true, indent: 1, displayRole: "fail", parts: [codeText("go(", "fn"), failText, codeText(")", "fn")] },
    ];
    return { rows, next: displayLine + 4 };
  }
  return { rows: [{ ...base, parts: [codeText(inst.type, "fn")] }], next: displayLine + 1 };
}

function renderCode(level, program) {
  const rows = [];
  let displayLine = 1;
  program.instructions.forEach((inst, index) => {
    const result = codeRowsForInstruction(level, inst, index, displayLine);
    rows.push(...result.rows);
    displayLine = result.next;
  });
  return rows;
}

function targetForInstruction(inst) {
  if (inst.type === "move") return inst.to;
  if (inst.type === "charge") return "charge";
  if (inst.type === "pickup") return inst.at || inst.item;
  if (inst.type === "write" || inst.type === "update") return "memory";
  if (inst.type === "branch") return "gate";
  return inst.to || "relay";
}

const levelDefinitions = [
  {
    id: 1, zone: "零号车站 · Flow", title: "唤醒轨道",
    story: "中继站已经断电，只有轨道旁的充电站还亮着。",
    goal: "先给 Unit-0 充好电，再启动中继站。",
    help: "先让 Unit-0 到充电站，再让它前往中继站。",
    hintSteps: ["中继站来得太早，Unit-0 还没充好电。", "先让 Unit-0 到充电站。", "先充好电，再让 Unit-0 前往中继站。"],
    law: "Flow", lawBeat: { type: "flow", caption: "先到充电站，拿到能量，中继站才会亮。" }, dawnProgress: 0.02,
    memoryNames: ["energy"], worldRules: { chargeMemory: "energy", deliver: [{ type: "memoryMin", name: "energy", value: 3 }] }, scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), deliver("relay"), charge(3)] },
    solution: { instructions: [move("charge"), charge(3), deliver("relay")] },
    editableSlots: [{ id: "order", type: "order", label: "指令顺序" }],
    successInvariant: { type: "flow", order: ["move", "charge", "deliver"], energy: 3, terminal: "relay" },
    successRules: [{ type: "executedInOrder", value: ["move", "charge", "deliver"] }, { type: "memoryEquals", name: "energy", value: 3 }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "deliver before charge", message: "中继站还没亮，Unit-0 还没有充好电。" }],
    successTitle: "中继站重新亮了起来。", successText: "轨道重新运转了。",
  },
  {
    id: 2, zone: "零号车站 · Flow", title: "遗失的核心",
    story: "中继站中央缺了一块核心。它就掉在前面的轨道旁。",
    goal: "捡起中继核心，把它装回中继站的空插槽。",
    help: "先在轨道旁捡起核心，再把它带回中继站。",
    hintSteps: ["空手到中继站时，插槽不会自己填满。", "先走到前面的轨道旁，捡起中继核心。", "带着核心回到中继站，装进空插槽。"],
    dawnProgress: 0.05, memoryNames: [], worldRules: { relayCore: "relay_core" }, scene: scenes.relayCore,
    starterProgram: { instructions: [move("relay"), deliver("relay"), pickup("relay_core", "relay_core")] },
    solution: { instructions: [pickup("relay_core", "relay_core"), move("relay"), deliver("relay")] },
    editableSlots: [{ id: "order", type: "order", label: "指令顺序" }],
    successInvariant: { type: "relay-core", order: ["pickup", "move", "deliver"], terminal: "relay" },
    successRules: [{ type: "executedInOrder", value: ["pickup", "move", "deliver"] }, { type: "relayInstalled", value: true }, { type: "coreLocation", value: "relay" }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "deliver empty relay", message: "插槽还是空的。核心还在后面。" }],
    successTitle: "核心归位。", successText: "咔哒——核心装回去了。",
  },
  {
    id: 3, zone: "记忆仓 · Memory", title: "记住能量",
    story: "中继站需要 5 点能量，但记忆盒里保存的数值不够。",
    goal: "让记忆盒中的 energy 变成 5。",
    help: "把代码里的 energy 改成 5，让记忆盒记住这个数值。",
    hintSteps: ["记忆盒里的数字还不够。", "找到代码里的 energy，把它改成 5。", "再运行程序，看看中继站会不会亮起来。"],
    law: "Memory", lawBeat: { type: "memory", caption: "记忆盒会留下你设定的数值。" }, dawnProgress: 0.16,
    memoryNames: ["energy"], worldRules: { deliver: [{ type: "memoryMin", name: "energy", value: 5 }] }, scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(2)), deliver("relay")] },
    solution: { instructions: [write("energy", literal(5)), deliver("relay")] },
    editableSlots: [{ id: "energy", instructionId: "write_energy", path: "value.value", type: "number", label: "energy 数值", min: 0, max: 9 }],
    successInvariant: { type: "memory", energy: 5, terminal: "relay" },
    successRules: [{ type: "memoryEquals", name: "energy", value: 5 }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "energy below 5", message: "记忆盒里的能量还不够 5 点，中继站还没有恢复供电。" }],
    successTitle: "记忆盒记住了 5 点能量。", successText: "中继站恢复供电。",
  },
  {
    id: 4, zone: "记忆仓 · Memory", title: "增加能量",
    story: "记忆盒里现在只有 1 点能量。",
    goal: "修改程序，让 energy 最后变成 2。",
    help: "看看 energy 现在是多少，再把它增加一点。",
    hintSteps: ["现在只增加 0，energy 不会变化。", "找到 energy = energy + 这一行。", "把加号后面的数字改成 1。"],
    dawnProgress: 0.28, memoryNames: ["energy"], worldRules: { deliver: [{ type: "memoryMin", name: "energy", value: 2 }] }, scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(0))), deliver("relay")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), deliver("relay")] },
    editableSlots: [{ id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新量", min: 0, max: 9 }],
    successInvariant: { type: "memory-update", energy: 2, terminal: "relay" },
    successRules: [{ type: "memoryEquals", name: "energy", value: 2 }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "update amount is 0", message: "energy 还是 1，记忆盒里的数值没有变。" }],
    successTitle: "能量增加了。", successText: "energy 从 1 变成了 2。",
  },
  {
    id: 5, zone: "判断门 · Choice", title: "打开亮路",
    story: "判断门后有两条路，只有上面的亮路还能通行。",
    goal: "调整判断条件，让 Unit-0 走上亮路。",
    help: "先看记忆盒里的 energy，再选择合适的比较符号。",
    hintSteps: ["现在的判断会让 Unit-0 走进暗路。", "记忆盒里的 energy 是 5，门上的数字是 8。", "试试能让 5 小于 8 成立的符号。"],
    law: "Choice", lawBeat: { type: "choice", caption: "判断门会先看数字，再打开一条路。" }, dawnProgress: 0.42,
    memoryNames: ["energy"], worldRules: { deliver: [{ type: "memoryMin", name: "energy", value: 5 }] }, scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(5)), branch(memory("energy"), ">", literal(8), "light", "dark"), deliver("relay")] },
    solution: { instructions: [write("energy", literal(5)), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("relay")] },
    editableSlots: [{ id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较符号", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "<", path: "light", terminal: "relay" },
    successRules: [{ type: "branchTaken", value: "light" }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "dark route", message: "判断门打开了暗路，Unit-0 走错了方向。" }],
    successTitle: "亮路打开了。", successText: "Unit-0 沿着亮路抵达中继站。",
  },
  {
    id: 6, zone: "判断门 · Choice", title: "匹配标签",
    story: "货物标签是 blue，判断门上的标签也是 blue。",
    goal: "让判断门认出这两个标签相同。",
    help: "这里比较的是标签内容，不是数字大小。",
    hintSteps: ["blue 是文字，不是数字。", "让两边都显示 blue。", "选择表示“相同”的比较符号。"],
    dawnProgress: 0.52, memoryNames: ["cargo"], worldRules: {}, scene: scenes.choice,
    starterProgram: { instructions: [write("cargo", literal("blue")), branch(memory("cargo"), ">", literal("blue"), "light", "dark"), deliver("relay")] },
    solution: { instructions: [write("cargo", literal("blue")), branch(memory("cargo"), "==", literal("blue"), "light", "dark"), deliver("relay")] },
    editableSlots: [{ id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较符号", options: [">", "<", "=="] }],
    successInvariant: { type: "choice-cargo", operator: "==", path: "light", terminal: "relay" },
    successRules: [{ type: "branchTaken", value: "light" }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "cargo mismatch", message: "这是文字标签，不能比较谁大谁小。" }],
    successTitle: "标签匹配。", successText: "标签匹配，亮路打开了。",
  },
  {
    id: 7, zone: "判断门 · Choice", title: "修好控制程序",
    story: "中继站的控制程序被打乱了，判断发生得太早。",
    goal: "重新排列代码，让 energy 先准备好，再由判断门选择路线。",
    help: "先让 energy 变成需要的数值，再让判断门选择路线。",
    hintSteps: ["判断门看到了还没准备好的 energy。", "把增加 energy 的代码放到判断门前面。", "让 energy 从 1 变成 4，再让成立的一边通往亮路。"],
    dawnProgress: 0.68, memoryNames: ["energy"], worldRules: { deliver: [{ type: "memoryMin", name: "energy", value: 4 }] }, scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(1)), branch(memory("energy"), ">", literal(3), "dark", "light"), update("energy", add(memory("energy"), literal(1))), deliver("relay")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(3))), branch(memory("energy"), ">", literal(3), "light", "dark"), deliver("relay")] },
    editableSlots: [
      { id: "order", type: "order", label: "指令顺序" },
      { id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新量", min: 0, max: 9 },
      { id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较符号", options: [">", "<", "=="] },
      { id: "path", instructionId: "branch_gate", path: "pass", type: "select", label: "成立路线", options: ["light", "dark"] },
    ],
    successInvariant: { type: "combined", order: ["write", "update", "branch", "deliver"], energy: 4, path: "light", terminal: "relay" },
    successRules: [{ type: "executedInOrder", value: ["write", "update", "branch", "deliver"] }, { type: "memoryEquals", name: "energy", value: 4 }, { type: "branchTaken", value: "light" }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "branch before update", message: "判断门来得太早，energy 还没有准备好。" }],
    successTitle: "程序恢复正常。", successText: "程序恢复正常，Unit-0 顺利通过了判断门。",
  },
  {
    id: 8, zone: "中央中继 · Choice", title: "唤醒中央塔",
    story: "中央塔还在黑暗中。屏幕上只剩一句话：MAKE THE SUN RISE AGAIN。",
    goal: "修好最后一段程序，让启动信号沿晨光路抵达中央塔。",
    help: "先让 energy 准备好，再让判断门选择晨光路。",
    hintSteps: ["中央塔在 energy 准备好以前就被问到了。", "让 1 点 energy 增加 4 点。", "让大于 3 的结果走向晨光路。"],
    dawnProgress: 0.82, memoryNames: ["energy"], worldRules: { deliver: [{ type: "memoryMin", name: "energy", value: 5 }] }, scene: scenes.dawn,
    starterProgram: { instructions: [branch(memory("energy"), "<", literal(9), "dark", "dawn"), write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), deliver("relay")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(4))), branch(memory("energy"), ">", literal(3), "dawn", "dark"), deliver("relay")] },
    editableSlots: [
      { id: "order", type: "order", label: "指令顺序" },
      { id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新量", min: 0, max: 9 },
      { id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较符号", options: [">", "<", "=="] },
      { id: "threshold", instructionId: "branch_gate", path: "right.value", type: "number", label: "比较数值", min: 0, max: 9 },
      { id: "path", instructionId: "branch_gate", path: "pass", type: "select", label: "成立路线", options: ["dawn", "dark"] },
    ],
    successInvariant: { type: "final", order: ["write", "update", "branch", "deliver"], energy: 5, operator: ">", path: "dawn", terminal: "relay" },
    successRules: [{ type: "executedInOrder", value: ["write", "update", "branch", "deliver"] }, { type: "memoryEquals", name: "energy", value: 5 }, { type: "branchTaken", value: "dawn" }, { type: "atNode", value: "relay" }, { type: "delivered", value: true }],
    failureCases: [{ when: "broken chain", message: "中央塔还没有收到启动信号，请先把 energy 准备好，再走晨光路。" }],
    successTitle: "中央塔重新启动。", successText: "机械城恢复呼吸。", ending: "太阳重新升起。",
  },
];

function programTypes(program) { return (program.instructions || []).map((item) => item.type); }
function branchInstructions(program) { return (program.instructions || []).filter((item) => item.type === "branch"); }

function stateHasRuntimeData(state) {
  return Boolean(state && (state.eventCursor !== undefined || state.unitNode || state.delivered || state.relayInstalled));
}

function matchesSuccessRule(rule, program, state) {
  if (!rule) return true;
  if (rule.type === "all") return (rule.rules || []).every((item) => matchesSuccessRule(item, program, state));
  if (rule.type === "executedInOrder") return programTypes(program).join(",") === (rule.value || []).join(",");
  if (rule.type === "atNode") return state.unitNode === rule.value;
  if (rule.type === "memoryEquals") return state.vars?.[rule.name] === rule.value;
  if (rule.type === "branchTaken") return state.path === rule.value;
  if (rule.type === "carried") return state.carried === rule.value;
  if (rule.type === "relayInstalled") return state.relayInstalled === rule.value;
  if (rule.type === "coreLocation") return state.coreLocation === rule.value;
  if (rule.type === "delivered") return state.delivered === rule.value;
  if (rule.type === "branchOperator") return branchInstructions(program).some((item) => item.operator === rule.value);
  return false;
}

export function evaluateSuccess(level, rawProgram, state = {}) {
  const program = normalizeProgram(level, rawProgram);
  if (!stateHasRuntimeData(state)) return false;
  return (level.successRules || []).every((rule) => matchesSuccessRule(rule, program, state));
}

function setPath(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return;
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (!cursor[keys[index]] || typeof cursor[keys[index]] !== "object") cursor[keys[index]] = {};
    cursor = cursor[keys[index]];
  }
  cursor[keys.at(-1)] = value;
}

export function applyEdit(level, program, edit, value) {
  const next = cloneProgram(program);
  if (!edit?.instructionId) return next;
  const inst = next.instructions.find((item) => item.id === edit.instructionId);
  if (!inst) return next;
  if (edit.path === "operator") inst.operator = [">", "<", "=="].includes(value) ? value : inst.operator;
  else if ((edit.path === "pass" || edit.path === "fail") && pathOptions(level).includes(String(value))) inst[edit.path] = String(value);
  else if (edit.path.endsWith(".value") && /^-?\d+(\.\d+)?$/.test(String(value))) setPath(inst, edit.path, Math.max(0, Math.min(9, Number(value) || 0)));
  else setPath(inst, edit.path, value);
  return next;
}

export function reorderProgram(level, program, index, delta) {
  const next = cloneProgram(program);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= next.instructions.length) return next;
  [next.instructions[index], next.instructions[nextIndex]] = [next.instructions[nextIndex], next.instructions[index]];
  return next;
}

function displayLineMap(level, program) {
  const map = new Map();
  for (const row of renderCode(level, program)) {
    if (!map.has(row.instructionId)) map.set(row.instructionId, { condition: row.line, pass: row.line, fail: row.line });
    const entry = map.get(row.instructionId);
    if (row.displayRole === "pass") entry.pass = row.line;
    else if (row.displayRole === "fail") entry.fail = row.line;
    else if (row.displayRole === "condition") entry.condition = row.line;
  }
  return map;
}

function finishLevels() {
  return levelDefinitions.map((level) => {
    level.code = (program) => renderCode(level, normalizeProgram(level, program));
    level.steps = (program) => {
      const normalized = normalizeProgram(level, program);
      const lines = displayLineMap(level, normalized);
      return normalized.instructions.map((item, index) => ({
        ...clone(item), op: item.type, instructionId: item.id, line: index + 1, sourceLine: index + 1,
        displayLine: lines.get(item.id)?.condition || index + 1, target: targetForInstruction(item),
      }));
    };
    level.check = (program, state) => {
      const ok = evaluateSuccess(level, program, state);
      return { ok, text: ok ? level.successText : (level.failureCases?.[0]?.message || "程序没有完成。") };
    };
    return level;
  });
}

const levels = finishLevels();

export function getLevels() { return levels; }
export function getLevel(index) { return levels[index]; }
export function getScene(level) { return level.scene; }
export function createProgram(level) { return clone(level.starterProgram); }
export function cloneProgram(program) { return clone(program); }

function duplicateInstructionId(instructions) {
  const firstSeen = new Map();
  for (let index = 0; index < instructions.length; index += 1) {
    const id = instructions[index]?.id;
    if (typeof id !== "string" || !id) continue;
    if (firstSeen.has(id)) return { id, firstLine: firstSeen.get(id) + 1, line: index + 1 };
    firstSeen.set(id, index);
  }
  return null;
}

export function normalizeProgram(level, program) {
  if (!program || typeof program !== "object" || Array.isArray(program) || !Array.isArray(program.instructions)) {
    throw new TypeError("程序需要一组可执行的内容。");
  }
  if (Object.keys(program).some((key) => key !== "instructions")) throw new TypeError("程序格式不对，请只保留程序内容。");
  const instructions = clone(program.instructions);
  const duplicate = duplicateInstructionId(instructions);
  if (duplicate) {
    const error = new TypeError(`第 ${duplicate.firstLine} 行和第 ${duplicate.line} 行的内容重复了，请保留一份。`);
    error.line = duplicate.line;
    throw error;
  }
  return { instructions };
}

export function getDisplayLines(level, program) {
  return displayLineMap(level, normalizeProgram(level, program));
}
