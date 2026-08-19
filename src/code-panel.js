import { applyEdit, cloneProgram, reorderProgram } from "./levels.js";

const LOCKED_PHASES = new Set(["demo", "running", "paused", "success"]);
const EDITABLE_PHASES = new Set(["idle", "error"]);

function nodeText(text, tone = "") {
  const span = document.createElement("span");
  span.textContent = text;
  if (tone) span.className = "code-" + tone;
  return span;
}

export class CodePanel {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.level = null;
    this.program = null;
    this.state = null;
    this.locked = false;
  }

  render(level, program, state) {
    this.level = level;
    // Keep an editor-owned snapshot. Runtime execution always uses its own frozen snapshot.
    this.program = cloneProgram(program);
    this.state = state;
    this.locked = LOCKED_PHASES.has(state.phase);
    this.root.replaceChildren();
    this.root.dataset.locked = String(this.locked);
    this.root.setAttribute("aria-readonly", String(this.locked));
    level.code(program).forEach((line) => this.renderLine(line));
    this.root.querySelectorAll("input, select, button").forEach((control) => {
      if (this.locked) control.disabled = true;
    });
  }

  renderLine(line) {
    const row = document.createElement("div");
    row.className = "code-line";
    row.dataset.line = String(line.line);
    row.dataset.instruction = line.instructionType || "";
    row.dataset.instructionId = line.instructionId || "";
    if (this.state.activeLine === line.line && ["demo", "running", "paused"].includes(this.state.phase)) row.classList.add("current");
    if (this.state.activeLine > line.line && !["idle", "demo"].includes(this.state.phase)) row.classList.add("completed");

    const number = document.createElement("span");
    number.className = "line-no";
    number.textContent = String(line.line).padStart(2, "0");
    row.append(number);

    const text = document.createElement("span");
    text.className = "code-text";
    text.style.paddingLeft = (line.indent || 0) * 18 + "px";
    (line.parts || [{ text: line.text || "", tone: line.tone || "" }]).forEach((part) => text.append(this.renderPart(part)));
    row.append(text);

    if (line.orderKey === "instructions") {
      const controls = document.createElement("span");
      controls.className = "order-controls";
      const index = line.orderIndex;
      controls.append(this.moveButton("↑", this.locked || index === 0, () => this.commit(reorderProgram(this.level, this.program, index, -1))));
      controls.append(this.moveButton("↓", this.locked || index === this.program.instructions.length - 1, () => this.commit(reorderProgram(this.level, this.program, index, 1))));
      row.append(controls);
    }
    this.root.append(row);
  }

  renderPart(part) {
    if (!part.type) return nodeText(part.text || "", part.tone || "");
    if (part.type === "number") {
      const input = document.createElement("input");
      input.className = "code-input number";
      input.type = "number";
      input.min = String(part.min ?? 0);
      input.max = String(part.max ?? 9);
      input.value = String(part.value);
      input.disabled = this.locked;
      input.readOnly = this.locked;
      input.setAttribute("aria-readonly", String(this.locked));
      input.setAttribute("aria-label", part.ariaLabel || "number");
      const commitNumber = () => {
        if (this.locked) return;
        this.commit(applyEdit(this.level, this.program, part.edit, input.value));
      };
      input.addEventListener("input", commitNumber);
      input.addEventListener("change", commitNumber);
      return input;
    }
    if (part.type === "select") {
      const select = document.createElement("select");
      select.className = "code-select";
      select.disabled = this.locked;
      select.setAttribute("aria-readonly", String(this.locked));
      select.setAttribute("aria-label", part.ariaLabel || "choice");
      part.options.forEach((option) => {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        item.selected = option === part.value;
        select.append(item);
      });
      select.addEventListener("change", () => {
        if (this.locked) return;
        this.commit(applyEdit(this.level, this.program, part.edit, select.value));
      });
      return select;
    }
    return nodeText(part.text || "", part.tone || "");
  }

  commit(nextProgram) {
    if (this.locked || !EDITABLE_PHASES.has(this.state?.phase)) return false;
    this.onChange?.(cloneProgram(nextProgram));
    return true;
  }

  moveButton(label, disabled, onClick) {
    const button = document.createElement("button");
    button.className = "move-button";
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    button.setAttribute("aria-label", label === "↑" ? "Move line up" : "Move line down");
    button.addEventListener("click", onClick);
    return button;
  }
}
