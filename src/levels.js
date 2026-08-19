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
      { id: "dock", x: 0.10, y: 0.54, type: "dock", label: "小屋" },
      { id: "pickup", x: 0.28, y: 0.54, type: "pickup", label: "货物" },
      { id: "charge", x: 0.49, y: 0.54, type: "energy", label: "充电" },
      { id: "exit", x: 0.86, y: 0.54, type: "exit", label: "信号台" },
    ],
    edges: [["dock", "pickup"], ["pickup", "charge"], ["charge", "exit"]],
  },
  memory: {
    nodes: [
      { id: "dock", x: 0.09, y: 0.54, type: "dock", label: "小屋" },
      { id: "pickup", x: 0.25, y: 0.54, type: "pickup", label: "输入台" },
      { id: "memory", x: 0.45, y: 0.54, type: "memory", label: "记忆盒" },
      { id: "reader", x: 0.66, y: 0.54, type: "reader", label: "读取器" },
      { id: "exit", x: 0.89, y: 0.54, type: "exit", label: "中继站" },
    ],
    edges: [["dock", "pickup"], ["pickup", "memory"], ["memory", "reader"], ["reader", "exit"]],
  },
  choice: {
    branchNode: "gate",
    nodes: [
      { id: "dock", x: 0.08, y: 0.52, type: "dock", label: "小屋" },
      { id: "memory", x: 0.28, y: 0.52, type: "memory", label: "记忆盒" },
      { id: "reader", x: 0.43, y: 0.52, type: "reader", label: "读取器" },
      { id: "gate", x: 0.59, y: 0.52, type: "gate", label: "判断门" },
      { id: "light", x: 0.78, y: 0.27, type: "accept", label: "亮路" },
      { id: "dark", x: 0.78, y: 0.77, type: "reject", label: "暗路" },
      { id: "exit", x: 0.94, y: 0.52, type: "exit", label: "中继站" },
    ],
    edges: [["dock", "memory"], ["memory", "reader"], ["reader", "gate"], ["gate", "light"], ["gate", "dark"], ["light", "exit"], ["dark", "exit"]],
  },
  final: {
    branchNode: "gate",
    nodes: [
      { id: "dock", x: 0.06, y: 0.52, type: "dock", label: "小屋" },
      { id: "memory", x: 0.23, y: 0.52, type: "memory", label: "记忆盒" },
      { id: "reader", x: 0.39, y: 0.52, type: "reader", label: "读取器" },
      { id: "gate", x: 0.55, y: 0.52, type: "gate", label: "判断门" },
      { id: "dawn", x: 0.75, y: 0.25, type: "accept", label: "晨光路" },
      { id: "dark", x: 0.75, y: 0.79, type: "reject", label: "暗路" },
      { id: "exit", x: 0.94, y: 0.52, type: "exit", label: "中央塔" },
    ],
    edges: [["dock", "memory"], ["memory", "reader"], ["reader", "gate"], ["gate", "dawn"], ["gate", "dark"], ["dawn", "exit"], ["dark", "exit"]],
  },
};

const codeText = (text, tone = "") => ({ text, tone });
const editable = (type, value, edit, extra = {}) => ({ type, value, edit, ...extra });
const isEditable = (level, inst, path) => level.editableSlots.some((slot) => {
  if (slot.path !== path) return false;
  return Boolean(slot.instructionId) && slot.instructionId === inst.id;
});

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
  return outgoing;
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
    const edit = isEditable(level, inst, "value.value") ? { instructionId: inst.id, path: "value.value" } : null;
    return { ...base, parts: [codeText(inst.name + " = "), ...valueParts(level, inst.value, edit, inst.name + " value")] };
  }
  if (inst.type === "update") {
    const edit = isEditable(level, inst, "value.right.value") ? { instructionId: inst.id, path: "value.right.value" } : null;
    const value = inst.value.type === "add" || inst.value.type === "subtract" ? inst.value.right : inst.value;
    const op = inst.value.type === "subtract" ? " - " : " + ";
    return { ...base, parts: [codeText(inst.name + " = " + inst.name + op), ...valueParts(level, value, edit, inst.name + " update")] };
  }
  if (inst.type === "branch") {
    const operatorEdit = isEditable(level, inst, "operator") ? { instructionId: inst.id, path: "operator" } : null;
    const rightEdit = isEditable(level, inst, "right.value") ? { instructionId: inst.id, path: "right.value" } : null;
    const passEdit = isEditable(level, inst, "pass") ? { instructionId: inst.id, path: "pass" } : null;
    const operator = operatorEdit
      ? editable("select", inst.operator, operatorEdit, { ariaLabel: "比较方式", options: [">", "<", "=="] })
      : codeText(inst.operator, "keyword");
    const right = valueParts(level, inst.right, rightEdit, "比较值");
    const pass = passEdit
      ? editable("select", inst.pass, passEdit, { ariaLabel: "成立路线", options: pathOptions(level, inst) })
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
    id: 1, legacyKey: "wake-signal", zone: "零号车站 · Flow", title: "唤醒信号",
    story: "死寂的轨道只闪了一下微光。Unit-0 转身望向它。",
    goal: "轨道已经通向信号塔，但信号没有能量。让 Unit-0 在送出信号前完成充电。",
    help: "先看看哪一个世界节点还在回应 Unit-0。",
    hintSteps: ["信号离开得太早，出发时还没有足够能量。", "观察充电节点：它必须先收到 Unit-0。", "让充电发生在送出信号之前。"],
    law: "Flow",
    lawBeat: { type: "flow", caption: "轨道只按顺序醒来：先走到那里，再让能量流入。" },
    dawnProgress: 0.02,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy", deliver: [{ type: "memoryMin", name: "energy", value: 3 }] },
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), deliver("exit"), charge(3)] },
    solution: { instructions: [move("charge"), charge(3), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "指令顺序" }],
    successInvariant: { type: "flow", order: ["move", "charge", "deliver"], energy: 3, terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["move", "charge", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 3 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "charge after deliver", message: "信号已经先出发了，轨道还没有能量。" }],
    successTitle: "轨道醒了。",
    successText: "一束光穿过零号车站，重新接通信号。",
  },
  {
    id: 2, legacyKey: "cargo-line", zone: "零号车站 · Flow", title: "带上信号电池",
    story: "沉睡的运载台旁，还放着最后一块信号电池。",
    goal: "信号电池还留在起点。让 Unit-0 带着它抵达终点，而不是空手离开。",
    help: "留意 Unit-0 什么时候真正带上了电池。",
    hintSteps: ["Unit-0 到达终点时，手里什么也没有。", "观察起点旁的电池，再看轨道从哪里开始。", "让电池先被带上，再沿轨道前进并送达。"],
    dawnProgress: 0.05,
    memoryNames: ["energy", "signal"],
    worldRules: { chargeMemory: "energy", deliver: [{ type: "carried", value: "signal" }] },
    scene: scenes.flow,
    starterProgram: { instructions: [move("charge"), pickup("signal"), deliver("exit")] },
    solution: { instructions: [pickup("signal"), move("charge"), deliver("exit")] },
    editableSlots: [{ id: "order", type: "order", label: "指令顺序" }],
    successInvariant: { type: "flow", order: ["pickup", "move", "deliver"], carried: "signal", terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["pickup", "move", "deliver"] },
      { type: "carried", value: "signal" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "move before pickup", message: "Unit-0 空手抵达轨道，终点没有可送达的信号。" }],
  },
  {
    id: 3, legacyKey: "name-the-spark", zone: "记忆仓 · Memory", title: "给火花命名",
    story: "黑暗的记忆盒正在等待一个有名字的能量值。",
    goal: "中继需要 5 点能量。把这个数值留在记忆盒里，并让读取器确认它。",
    help: "想想看：什么值能在 Unit-0 离开后仍留在世界里？",
    hintSteps: ["能量没有留在盒子里，读取器只能读到空白。", "观察记忆盒：它应该接住一个带名字的值。", "让记忆盒保存足够的 energy，再让读取器读到它。"],
    law: "Memory",
    lawBeat: { type: "memory", caption: "数字会在空气里消失；记忆盒会按名字把它留下。" },
    dawnProgress: 0.16,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(2)), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "energy", instructionId: "write_energy", path: "value.value", type: "number", label: "energy 数值", min: 0, max: 9 }],
    successInvariant: { type: "memory", read: { name: "energy", value: 5 }, terminal: "exit" },
    successRules: [
      { type: "readEquals", name: "energy", value: 5 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "energy below 5", message: "记忆盒留下了数值，但中继仍然没有足够能量。" }],
  },
  {
    id: 4, legacyKey: "add-one", zone: "记忆仓 · Memory", title: "让记忆增长",
    story: "记忆盒已经醒来，但里面保存的能量还差一点。",
    goal: "记忆盒里现在只有 1 点能量。修改已经保存的值，让读取器最后读到 2。",
    help: "观察记忆盒里的 token：它应该发生变化，而不是被忽略。",
    hintSteps: ["记忆盒接到的还是原来的数值。", "盯住盒中的 token，看看更新是否真的改变了它。", "让旧值经过一次小幅变化，再把结果交给读取器。"],
    dawnProgress: 0.28,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.memory,
    starterProgram: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(0))), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    editableSlots: [{ id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新幅度", min: 0, max: 9 }],
    successInvariant: { type: "memory-update", read: { name: "energy", value: 2 }, terminal: "exit" },
    successRules: [
      { type: "readEquals", name: "energy", value: 2 },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "update amount is 0", message: "更新已经执行，但记忆盒里的能量没有变化。" }],
  },
  {
    id: 5, legacyKey: "light-route", zone: "判断门 · Choice", title: "点亮正确路线",
    story: "判断门后有两条路，只有一条仍通向有光的区域。",
    goal: "判断门前的能量是 5，两条路中只有亮路还能工作。让信号进入亮路。",
    help: "先观察判断门收到 token 后会显示什么。",
    hintSteps: ["现在的判断结果让信号走进了暗路。", "观察判断门上显示的两个值，以及哪条路回应了它。", "让比较结果为 TRUE，并沿亮路继续前进。"],
    law: "Choice",
    lawBeat: { type: "choice", caption: "判断门先接住 token，再比较，最后只打开一条路。" },
    dawnProgress: 0.42,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), ">", literal(8), "light", "dark"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(5)), read("energy"), branch(memory("energy"), "<", literal(8), "light", "dark"), deliver("exit")] },
    editableSlots: [{ id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较方式", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "<", path: "light", terminal: "exit" },
    successRules: [
      { type: "branchTaken", value: "light" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "operator is >", message: "这次比较没有通过，判断门把信号送进了暗路。" }],
  },
  {
    id: 6, legacyKey: "same-signal", zone: "判断门 · Choice", title: "识别同一个标签",
    story: "货物判断门会拒绝那些看起来相似、却没有真正相同的标签。",
    goal: "货物标签和门上的目标标签都是 blue。让判断门识别它们是同一个标签，并打开正确出口。",
    help: "观察判断门比较的两边：它们传来的是什么类型的值？",
    hintSteps: ["判断门把两个标签当成了不适合排序的东西。", "观察比较画面里的两个 blue，以及门给出的结果。", "让判断表达“两个标签相同”，再沿亮路送出货物。"],
    dawnProgress: 0.52,
    memoryNames: ["cargo"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.choice,
    starterProgram: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), ">", literal("blue"), "light", "dark"), deliver("exit")] },
    solution: { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), "==", literal("blue"), "light", "dark"), deliver("exit")] },
    editableSlots: [{ id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较方式", options: [">", "<", "=="] }],
    successInvariant: { type: "choice", operator: "==", path: "light", terminal: "exit" },
    successRules: [
      { type: "branchTaken", value: "light" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "operator is not ==", message: "这两个货物标签不是可排序的数字，判断门需要确认它们是否相同。" }],
  },
  {
    id: 7, legacyKey: "relay-reorder", zone: "判断门 · Choice", title: "整理中继链",
    story: "仓库的灯重新亮起，但中继指令被打乱了。",
    goal: "中继步骤被打乱了。让能量先保存和修改，再被读取、判断，最后沿亮路送往中继站。",
    help: "沿着 token 观察：它接下来应该去哪个世界对象？",
    hintSteps: ["判断门正在询问一个还没有准备好的值。", "跟着 token 从记忆盒一路看到判断门和路线。", "整理指令，让每个世界对象按自己的时机接到数据。"],
    dawnProgress: 0.68,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.choice,
    starterProgram: { instructions: [write("energy", literal(1)), branch(memory("energy"), ">", literal(3), "dark", "light"), update("energy", add(memory("energy"), literal(1))), read("energy"), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(3))), read("energy"), branch(memory("energy"), ">", literal(3), "light", "dark"), deliver("exit")] },
    editableSlots: [
      { id: "order", type: "order", label: "指令顺序" },
      { id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新幅度", min: 0, max: 9 },
      { id: "path", instructionId: "branch_gate", path: "pass", type: "select", label: "成立路线", options: ["light", "dark"] },
    ],
    successInvariant: { type: "combined", order: ["write", "update", "read", "branch", "deliver"], energy: 4, path: "light", terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["write", "update", "read", "branch", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 4 },
      { type: "branchTaken", value: "light" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "branch before read", message: "判断门在能量更新和读取完成前就开始询问了。" }],
  },
  {
    id: 8, legacyKey: "make-the-sun-rise", zone: "中央中继 · Choice", title: "让晨光回来",
    story: "中央中继旁，一句损坏的请求还在微弱发光：MAKE THE SUN RISE AGAIN。",
    goal: "中央塔只接受完整信号：能量先保存并增强，再被读取和判断，最后进入正确路线，让城市重新启动。",
    help: "中央塔需要一条完整链路；先观察记忆盒，再观察判断门。",
    hintSteps: ["中央塔在某个环节收到空白或过早的信号。", "跟着能量从记忆盒、读取器到判断门，观察每一站的反馈。", "让保存、增强、读取、判断和最终路线连成一条可见的链。"],
    dawnProgress: 0.82,
    memoryNames: ["energy"],
    worldRules: { chargeMemory: "energy" },
    scene: scenes.final,
    starterProgram: { instructions: [branch(memory("energy"), "<", literal(9), "dark", "dawn"), write("energy", literal(1)), read("energy"), update("energy", add(memory("energy"), literal(1))), deliver("exit")] },
    solution: { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(4))), read("energy"), branch(memory("energy"), ">", literal(3), "dawn", "dark"), deliver("exit")] },
    editableSlots: [
      { id: "order", type: "order", label: "指令顺序" },
      { id: "delta", instructionId: "update_energy", path: "value.right.value", type: "number", label: "更新幅度", min: 0, max: 9 },
      { id: "operator", instructionId: "branch_gate", path: "operator", type: "select", label: "比较方式", options: [">", "<", "=="] },
      { id: "threshold", instructionId: "branch_gate", path: "right.value", type: "number", label: "比较值", min: 0, max: 9 },
      { id: "path", instructionId: "branch_gate", path: "pass", type: "select", label: "成立路线", options: ["dawn", "dark"] },
    ],
    successInvariant: { type: "final", order: ["write", "update", "read", "branch", "deliver"], energy: 5, operator: ">", path: "dawn", terminal: "exit" },
    successRules: [
      { type: "executedInOrder", value: ["write", "update", "read", "branch", "deliver"] },
      { type: "memoryEquals", name: "energy", value: 5 },
      { type: "branchTaken", value: "dawn" },
      { type: "atNode", value: "exit" },
    ],
    failureCases: [{ when: "wrong path or value", message: "中央塔仍然沉默；每一段信号都必须彼此衔接。" }],
    successTitle: "晨光越过地平线。",
    successText: "太阳重新升起，Unit-0 看着整座城市恢复呼吸。",
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
  if (key === "same-signal") return { instructions: [write("cargo", literal("blue")), read("cargo"), branch(memory("cargo"), p.compare || ">", literal("blue"), "light", "dark"), deliver("exit")] };
  if (key === "relay-reorder") return { instructions: [write("energy", literal(1)), update("energy", add(memory("energy"), literal(p.update ?? 3))), read("energy"), branch(memory("energy"), ">", literal(p.threshold ?? 3), p.target || "dark", "dark"), deliver("exit")] };
  return { instructions: [write("energy", value("energy", 2)), update("energy", add(memory("energy"), literal(p.update ?? 4))), read("energy"), branch(memory("energy"), p.compare || "<", literal(p.threshold ?? 5), "dawn", "dark"), deliver("exit")] };
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
  if (key === "add-one") return p.compare === "==" || Number(p.update ?? 0) >= 1;
  if (key === "light-route") return p.compare === "<" || (p.compare === ">" && Number(p.threshold) < 7);
  if (key === "same-signal") return p.compare === "==" || ((p.actionOrder || []).join(",") === "write,read,gate,send" && Number(p.energy) >= 5 && p.compare === ">");
  if (key === "relay-reorder") return Number(p.update ?? 0) >= 3;
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
  if (key === "same-signal") return path === "light" && state.unitNode === "exit";
  if (key === "relay-reorder") return order.join(",") === "write,update,read,branch,deliver" && state.energy >= 4 && path === "light" && state.unitNode === "exit";
  return order.join(",") === "write,update,read,branch,deliver" && state.energy >= 5 && path === "dawn" && state.unitNode === "exit";
}

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) cursor = cursor[keys[i]];
  cursor[keys.at(-1)] = value;
}

export function applyEdit(level, program, edit, value) {
  const next = cloneProgram(program);
  if (!edit?.instructionId) return next;
  const inst = next.instructions.find((item) => item.id === edit.instructionId);
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
    level.solution = withLegacy(level, level.solution);
    level.code = (program) => renderCode(level, normalizeProgram(level, program));
    level.steps = (program) => normalizeProgram(level, program).instructions.map((item, index) => ({ ...clone(item), op: item.type, instructionId: item.id, line: index + 1, sourceLine: index + 1, target: targetForInstruction(item) }));
    level.check = (program, state) => {
      const ok = evaluateSuccess(level, program, state);
      return { ok, text: ok ? level.successText : (level.failureCases?.[0]?.message || "程序已停止。") };
    };
    level.successTitle ||= level.legacyKey === "make-the-sun-rise" ? "晨光越过地平线。" : "信号已恢复。";
    level.successText ||= level.legacyKey === "make-the-sun-rise" ? "太阳重新升起。" : "城市又有一处重新运转。";
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
    if (key === "relay-reorder" && ["light", "dark"].includes(next.target)) branchInstruction.pass = next.target;
  }
  return next;
}

export function normalizeProgram(level, program) {
  const raw = program || {};
  if (!Array.isArray(raw.instructions)) return withLegacy(level, ensureInstructionIds(legacyToProgram(level, raw)));
  return withLegacy(level, ensureInstructionIds(syncLegacyOverrides(level, raw)));
}
