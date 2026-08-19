import { getScene } from "./levels.js";

const palette = {
  ink: "#3f5360",
  sky: "#bfe8f2",
  skyLight: "#eaf8f7",
  sun: "#ffd36e",
  cloud: "#fffaf0",
  route: "#f1d39e",
  routeActive: "#eea27e",
  cyan: "#82cddd",
  amber: "#f2bf68",
  violet: "#b9a9e5",
  rose: "#ef9b8d",
  green: "#8bcfb6",
  white: "#fffaf0",
  muted: "#6b7e80",
  ground: "#a9d993",
  groundDeep: "#78bd7d",
  line: "rgba(86, 119, 111, .2)",
};

const now = () => globalThis.performance?.now?.() ?? Date.now();

export class WorldView {
  constructor(canvas, mirror) {
    this.canvas = canvas;
    this.mirror = mirror;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (typeof globalThis.ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width || 640);
    this.height = Math.max(260, rect.height || 448);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = "10px system-ui";
  }

  render(level, state) {
    if (!this.width) this.resize();
    this.updateMirror(state);
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const scene = getScene(level);
    ctx.clearRect(0, 0, w, h);
    this.drawBackdrop(ctx, w, h, level.id);
    this.drawEdges(ctx, scene, state);
    scene.nodes.forEach((node) => this.drawNode(ctx, node, state, w, h));
    this.drawMemoryReadout(ctx, state, w, h);
    this.drawUnit(ctx, state, w, h);
    if (state.phase === "error") this.drawFault(ctx, state, w, h);
    if (state.phase === "success") this.drawSuccess(ctx, w, h);
  }

  updateMirror(state) {
    if (!this.mirror) return;
    const memory = Object.entries(state.vars || {}).map(([key, value]) => key + "=" + value).join(" ");
    const placeNames = { dock: "小屋", pickup: "货物", charge: "充电站", exit: "信号台", memory: "记忆盒", reader: "阅读台", gate: "选择门", light: "亮路", dark: "暗路", open: "开放", reject: "拒绝", sun: "太阳" };
    const unitName = placeNames[state.unitNode || "dock"] || state.unitNode || "小屋";
    const pathName = placeNames[state.path || "none"] || state.path || "无";
    this.mirror.dataset.unit = state.unitNode || "dock";
    this.mirror.dataset.memory = memory || "empty";
    this.mirror.dataset.read = state.readValue === null || state.readValue === undefined ? "none" : String(state.readValue);
    this.mirror.dataset.gate = state.gateOpen ? "open" : "closed";
    this.mirror.dataset.path = state.path || "none";
    this.mirror.dataset.error = state.phase === "error" ? "true" : "";
    this.mirror.dataset.success = state.phase === "success" ? "true" : "";
    this.mirror.dataset.phase = state.phase || "idle";
    this.mirror.dataset.eventCursor = String(state.eventCursor ?? 0);
    const mirrorText = "Unit-0 · " + unitName
      + "  ·  记忆 " + (memory || "—")
      + "  ·  读到 " + this.mirror.dataset.read
      + "  ·  路径 " + pathName;
    if (this.mirror.textContent !== mirrorText) this.mirror.textContent = mirrorText;
  }

  point(node, w, h) { return { x: node.x * w, y: node.y * h }; }

  drawBackdrop(ctx, w, h, levelId) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, palette.skyLight);
    gradient.addColorStop(1, palette.sky);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.fillStyle = palette.sun;
    ctx.shadowColor = "rgba(241, 174, 77, .28)";
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(w * .84, h * .16, Math.min(31, w * .065), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(238, 164, 85, .48)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      const x1 = w * .84 + Math.cos(angle) * 39;
      const y1 = h * .16 + Math.sin(angle) * 39;
      const x2 = w * .84 + Math.cos(angle) * 47;
      const y2 = h * .16 + Math.sin(angle) * 47;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    this.drawCloud(ctx, w * .17, h * .18, 1.05);
    this.drawCloud(ctx, w * .55, h * .10, .72);
    ctx.fillStyle = "#96cfa0";
    ctx.beginPath(); ctx.moveTo(0, h * .69); ctx.quadraticCurveTo(w * .2, h * .49, w * .42, h * .69); ctx.quadraticCurveTo(w * .66, h * .47, w, h * .68); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = palette.ground;
    ctx.beginPath(); ctx.moveTo(0, h * .78); ctx.quadraticCurveTo(w * .22, h * .61, w * .48, h * .79); ctx.quadraticCurveTo(w * .73, h * .63, w, h * .76); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = palette.groundDeep;
    ctx.fillRect(0, h * .91, w, h * .09);
    ctx.fillStyle = "rgba(255, 250, 240, .75)";
    for (let i = 0; i < 9; i += 1) {
      const x = (i * 91 + levelId * 23) % w;
      const y = h * .83 + (i % 3) * 19;
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(238, 141, 120, .8)";
      ctx.beginPath(); ctx.arc(x + 3, y - 2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255, 250, 240, .75)";
    }
    ctx.restore();
  }

  drawCloud(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255, 250, 240, .86)";
    ctx.beginPath();
    ctx.arc(-25, 5, 15, 0, Math.PI * 2);
    ctx.arc(-7, -5, 20, 0, Math.PI * 2);
    ctx.arc(14, 3, 16, 0, Math.PI * 2);
    ctx.roundRect(-39, 2, 69, 20, 10);
    ctx.fill();
    ctx.restore();
  }

  drawEdges(ctx, scene, state) {
    const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
    scene.edges.forEach(([fromId, toId]) => {
      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) return;
      const from = this.point(fromNode, this.width, this.height);
      const to = this.point(toNode, this.width, this.height);
      const active = this.edgeIsActive(fromId, toId, state);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = active ? 17 : 13;
      ctx.strokeStyle = active ? (state.phase === "error" ? palette.rose : palette.routeActive) : palette.route;
      ctx.shadowColor = active ? "rgba(220, 131, 103, .24)" : "rgba(91, 119, 103, .14)";
      ctx.shadowBlur = active ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (Math.abs(to.y - from.y) > 50) ctx.bezierCurveTo(from.x + (to.x - from.x) * .45, from.y, from.x + (to.x - from.x) * .55, to.y, to.x, to.y);
      else ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (active && (state.phase === "running" || state.phase === "demo")) {
        const pulse = (now() / 500) % 1;
        const px = from.x + (to.x - from.x) * pulse;
        const py = from.y + (to.y - from.y) * pulse;
        ctx.fillStyle = palette.sun;
        ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.lineCap = "butt";
  }

  edgeIsActive(fromId, toId, state) {
    if (state.phase === "idle" && !state.anim) return fromId === "dock";
    if (state.path && (fromId === state.path || toId === state.path)) return true;
    if (state.gateBranch === "accept" && (toId === "light" || toId === "open" || toId === "sun")) return true;
    if (state.gateBranch === "reject" && (toId === "dark" || toId === "reject")) return true;
    return state.eventType !== "error" && Boolean(state.anim);
  }

  drawNode(ctx, node, state, w, h) {
    const { x, y } = this.point(node, w, h);
    const active = this.nodeIsActive(node, state);
    const colors = {
      dock: palette.cyan, pickup: "#f6c29a", energy: palette.sun, memory: palette.sun,
      reader: palette.sun, gate: palette.violet, accept: palette.green, reject: palette.rose, exit: palette.cyan,
    };
    const color = colors[node.type] || palette.cyan;
    const pulse = active ? 1 + Math.sin(now() / 180) * .08 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = active ? "rgba(218, 127, 105, .3)" : "rgba(87, 107, 96, .15)";
    ctx.shadowBlur = active ? 16 : 8;
    ctx.strokeStyle = "rgba(63, 83, 96, .46)";
    ctx.fillStyle = node.type === "reject" ? "#ffe0d6" : node.type === "accept" ? "#dff4dd" : "#fff7df";
    ctx.lineWidth = 3;
    const size = node.type === "gate" ? 27 : 21;
    ctx.beginPath();
    if (node.type === "gate") ctx.roundRect(-size, -size * .82, size * 2, size * 1.64, 15);
    else if (node.type === "memory" || node.type === "reader") ctx.roundRect(-size, -size * .78, size * 2, size * 1.55, 12);
    else ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 2;
    if (node.type === "gate") {
      const open = state.gateOpen ? 8 : 0;
      ctx.roundRect(-11 - open, -14, 8, 28, 4); ctx.fill();
      ctx.roundRect(3 + open, -14, 8, 28, 4); ctx.fill();
      ctx.fillStyle = palette.ink; ctx.font = "bold 15px system-ui"; ctx.textAlign = "center"; ctx.fillText("?", 0, 5);
    } else if (node.type === "memory" || node.type === "reader") {
      ctx.roundRect(-12, -3, 24, 6, 3); ctx.fill();
      ctx.roundRect(-7, -10, 14, 5, 2); ctx.fill();
      ctx.fillStyle = palette.ink;
      ctx.beginPath(); ctx.arc(-7, 8, 2, 0, Math.PI * 2); ctx.arc(0, 8, 2, 0, Math.PI * 2); ctx.arc(7, 8, 2, 0, Math.PI * 2); ctx.fill();
      if (node.type === "reader") { ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(0, 17); ctx.stroke(); }
    } else if (node.type === "exit") {
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke();
    } else if (node.type === "pickup") {
      ctx.roundRect(-10, -8, 20, 16, 4); ctx.fill();
      ctx.strokeStyle = palette.ink; ctx.strokeRect(-5, -4, 10, 8);
    } else if (node.type === "energy") {
      ctx.beginPath(); ctx.moveTo(3, -13); ctx.lineTo(-7, 1); ctx.lineTo(0, 1); ctx.lineTo(-3, 13); ctx.lineTo(8, -3); ctx.lineTo(1, -3); ctx.closePath(); ctx.fill();
    } else {
      ctx.roundRect(-9, -4, 18, 8, 4); ctx.fill();
      ctx.fillStyle = palette.ink; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.font = "800 10px system-ui";
    ctx.textAlign = "center";
    const labels = { DOCK: "小屋", CARGO: "货物", CHARGE: "充电", SIGNAL: "信号", INPUT: "输入", MEMORY: "记忆", READER: "阅读", READ: "读取", CHOICE: "选择", LIGHT: "亮路", DARK: "暗路", RELAY: "中继", SUN: "太阳", TOWER: "塔台" };
    const label = labels[node.label] || node.label;
    const labelWidth = ctx.measureText(label).width + 14;
    ctx.fillStyle = "rgba(255, 250, 240, .82)";
    ctx.roundRect(x - labelWidth / 2, y + 29, labelWidth, 18, 9); ctx.fill();
    ctx.fillStyle = active ? palette.ink : palette.muted;
    ctx.fillText(label, x, y + 41);
  }

  nodeIsActive(node, state) {
    if (state.anim) return Math.abs(state.unit.x - node.x) < .035 && Math.abs(state.unit.y - node.y) < .06;
    return state.unitNode === node.id;
  }

  drawMemoryReadout(ctx, state, w, h) {
    const x = 18;
    const y = h - 30;
    const memory = Object.entries(state.vars || {}).map(([key, value]) => key + ": " + value).join("  ") || "empty";
    const width = Math.min(290, w - 36);
    ctx.save();
    ctx.shadowColor = "rgba(87, 107, 96, .14)"; ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255, 250, 240, .9)";
    ctx.roundRect(x, y - 22, width, 31, 15); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = state.memoryKey ? "#bd7c40" : palette.muted; ctx.font = "800 9px system-ui"; ctx.textAlign = "left"; ctx.fillText("记忆", x + 11, y - 5);
    ctx.fillStyle = palette.ink; ctx.font = "11px system-ui"; ctx.fillText(memory, x + 69, y - 5);
    ctx.restore();
  }

  drawUnit(ctx, state, w, h) {
    const x = state.unit.x * w;
    const y = state.unit.y * h;
    ctx.save(); ctx.translate(x, y - 35);
    ctx.fillStyle = "rgba(87, 107, 96, .17)"; ctx.beginPath(); ctx.ellipse(0, 25, 25, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9fc7cf"; ctx.strokeStyle = palette.ink; ctx.lineWidth = 2.5;
    ctx.roundRect(16, -8, 12, 23, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#f9cf9f"; ctx.roundRect(-19, -19, 38, 39, 16); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fffaf0"; ctx.beginPath(); ctx.arc(0, -2, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.ink; ctx.beginPath(); ctx.arc(-5, -4, 2.7, 0, Math.PI * 2); ctx.arc(5, -4, 2.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-4, -5, .9, 0, Math.PI * 2); ctx.arc(6, -5, .9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ee9a91"; ctx.beginPath(); ctx.arc(-11, 3, 3.2, 0, Math.PI * 2); ctx.arc(11, 3, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 1, 5, .15, Math.PI - .15); ctx.stroke();
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(0, -27); ctx.stroke();
    ctx.fillStyle = palette.sun; ctx.beginPath(); ctx.arc(0, -29, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#82b6c2"; ctx.strokeStyle = palette.ink; ctx.roundRect(-20, 17, 12, 6, 3); ctx.fill(); ctx.stroke(); ctx.roundRect(8, 17, 12, 6, 3); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawFault(ctx, state, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(239, 155, 141, .13)"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff0e7"; ctx.strokeStyle = "rgba(202, 110, 99, .45)"; ctx.lineWidth = 2;
    ctx.roundRect(16, h - 53, w - 32, 34, 17); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#a95450"; ctx.font = "800 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("Oops! 轻轻重置，再试一次", w / 2, h - 31);
    ctx.restore();
  }

  drawSuccess(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(139, 207, 182, .12)"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e4f4dd"; ctx.strokeStyle = "rgba(78, 150, 117, .38)"; ctx.lineWidth = 2;
    ctx.roundRect(16, h - 53, w - 32, 34, 17); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#34745f"; ctx.font = "800 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("太棒了！ SIGNAL RECEIVED", w / 2, h - 31);
    ctx.restore();
  }
}
