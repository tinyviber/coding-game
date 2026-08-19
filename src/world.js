import { getScene } from "./levels.js";
import { edgeControlPoints, pointOnEdge } from "./geometry.js";

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
  night: "#111c35",
  nightMid: "#213459",
  dawn: "#e99b79",
};

const now = () => globalThis.performance?.now?.() ?? Date.now();

function mixColor(a, b, amount) {
  const parse = (value) => value.match(/\w\w/g).map((part) => Number.parseInt(part, 16));
  const left = parse(a);
  const right = parse(b);
  const t = Math.max(0, Math.min(1, amount));
  return "#" + left.map((value, index) => Math.round(value + (right[index] - value) * t).toString(16).padStart(2, "0")).join("");
}

export class WorldView {
  constructor(canvas, mirror) {
    this.canvas = canvas;
    this.mirror = mirror;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.lastLevel = null;
    this.lastState = null;
    this.beat = null;
    this.beatFrame = 0;
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
    this.lastLevel = level;
    this.lastState = state;
    this.updateMirror(state);
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const scene = getScene(level);
    ctx.clearRect(0, 0, w, h);
    this.drawBackdrop(ctx, w, h, level, state);
    this.drawEdges(ctx, scene, state);
    scene.nodes.forEach((node) => this.drawNode(ctx, node, state, w, h));
    this.drawDataToken(ctx, state, w, h);
    this.drawUnit(ctx, state, w, h);
    if (this.beat) this.drawBeat(ctx, level, this.beat, w, h);
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
    this.mirror.dataset.comparison = state.comparison ? `${state.comparison.left} ${state.comparison.operator} ${state.comparison.right}` : "none";
    this.mirror.dataset.mood = state.mood || "idle";
    this.mirror.dataset.error = state.phase === "error" ? "true" : "";
    this.mirror.dataset.success = state.phase === "success" ? "true" : "";
    this.mirror.dataset.phase = state.phase || "idle";
    this.mirror.dataset.eventCursor = String(state.eventCursor ?? 0);
    const mirrorText = "Unit-0 · " + unitName
      + "  ·  记忆 " + (memory || "—")
      + "  ·  读到 " + this.mirror.dataset.read
      + "  ·  路径 " + pathName
      + (this.mirror.dataset.comparison !== "none" ? "  ·  比较 " + this.mirror.dataset.comparison : "");
    if (this.mirror.textContent !== mirrorText) this.mirror.textContent = mirrorText;
  }

  point(node, w, h) { return { x: node.x * w, y: node.y * h }; }

  drawBackdrop(ctx, w, h, level, state) {
    const progress = Math.max(0, Math.min(1, Number(level.dawnProgress || 0) + (state.phase === "success" ? 0.08 : 0)));
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    const top = mixColor(palette.night, progress > 0.72 ? "#c87c83" : palette.nightMid, Math.min(1, progress * 1.65));
    const bottom = mixColor("#1a2944", progress > 0.52 ? "#f2c28f" : "#263d5d", Math.min(1, progress * 1.45));
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    const night = progress < 0.58;
    if (night) {
      ctx.fillStyle = "rgba(246, 236, 190, .88)";
      ctx.shadowColor = "rgba(246, 236, 190, .22)";
      ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(w * .84, h * .16, Math.min(18, w * .04), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(17, 28, 53, .75)";
      ctx.beginPath(); ctx.arc(w * .85, h * .15, Math.min(17, w * .038), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      for (let i = 0; i < 18; i += 1) {
        const x = (i * 83 + level.id * 31) % w;
        const y = 24 + ((i * 47) % Math.max(50, h * .36));
        ctx.fillStyle = `rgba(255, 235, 168, ${0.3 + (i % 3) * .16})`;
        ctx.beginPath(); ctx.arc(x, y, i % 4 === 0 ? 1.8 : 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (progress >= 0.55) {
      const sun = Math.min(1, (progress - 0.45) * 2.1);
      ctx.globalAlpha = sun;
      ctx.fillStyle = palette.sun;
      ctx.shadowColor = "rgba(241, 174, 77, .38)";
      ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(w * (.84 - progress * .1), h * (.26 - progress * .12), Math.min(31, w * .065), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = progress > 0.55 ? "rgba(31, 51, 66, .6)" : "rgba(8, 16, 32, .62)";
    for (let i = 0; i < 9; i += 1) {
      const bx = i * w / 8 - 20;
      const bh = 28 + (i % 4) * 19;
      ctx.fillRect(bx, h * .55 - bh, 48 + (i % 3) * 14, bh);
      if (progress > 0.14 + i * .05) {
        ctx.fillStyle = "rgba(255, 220, 125, .68)";
        ctx.fillRect(bx + 12, h * .55 - bh + 12, 5, 7);
        ctx.fillRect(bx + 27, h * .55 - bh + 24, 5, 7);
        ctx.fillStyle = progress > 0.55 ? "rgba(31, 51, 66, .6)" : "rgba(8, 16, 32, .62)";
      }
    }
    ctx.fillStyle = progress > 0.5 ? "#557d6e" : "#1c3150";
    ctx.beginPath(); ctx.moveTo(0, h * .69); ctx.quadraticCurveTo(w * .2, h * .49, w * .42, h * .69); ctx.quadraticCurveTo(w * .66, h * .47, w, h * .68); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = progress > 0.5 ? "#7cac78" : "#294667";
    ctx.beginPath(); ctx.moveTo(0, h * .78); ctx.quadraticCurveTo(w * .22, h * .61, w * .48, h * .79); ctx.quadraticCurveTo(w * .73, h * .63, w, h * .76); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = progress > 0.5 ? palette.groundDeep : "#172c4b";
    ctx.fillRect(0, h * .91, w, h * .09);
    ctx.fillStyle = progress > 0.5 ? "rgba(255, 250, 240, .75)" : "rgba(151, 181, 201, .26)";
    for (let i = 0; i < 9; i += 1) {
      const x = (i * 91 + level.id * 23) % w;
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
      const geometry = edgeControlPoints(from, to);
      const active = this.edgeIsActive(fromId, toId, state);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = active ? 17 : 13;
      ctx.strokeStyle = active ? (state.phase === "error" ? palette.rose : palette.routeActive) : palette.route;
      ctx.shadowColor = active ? "rgba(220, 131, 103, .24)" : "rgba(91, 119, 103, .14)";
      ctx.shadowBlur = active ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (geometry.curved) ctx.bezierCurveTo(geometry.c1.x, geometry.c1.y, geometry.c2.x, geometry.c2.y, to.x, to.y);
      else ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (active && (state.phase === "running" || state.phase === "demo")) {
        const pulse = state.anim ? state.anim.progress : (now() / 500) % 1;
        const point = pointOnEdge(geometry, pulse);
        ctx.fillStyle = palette.sun;
        ctx.beginPath(); ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.lineCap = "butt";
  }

  edgeIsActive(fromId, toId, state) {
    if (state.activeEdge) return state.activeEdge.from === fromId && state.activeEdge.to === toId;
    if (state.phase === "idle" && !state.anim) return fromId === "dock";
    if (state.path && (fromId === state.path || toId === state.path)) return true;
    return false;
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
      ctx.fillStyle = palette.ink; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center";
      if (state.comparison) {
        const compare = `${state.comparison.left} ${state.comparison.operator} ${state.comparison.right}`;
        ctx.fillText(compare, 0, -35);
        ctx.font = "900 10px system-ui";
        ctx.fillStyle = state.comparison.result ? palette.green : palette.rose;
        ctx.fillText(state.comparison.result ? "TRUE" : "FALSE", 0, 40);
      } else ctx.fillText("?", 0, 5);
    } else if (node.type === "memory" || node.type === "reader") {
      ctx.roundRect(-12, -3, 24, 6, 3); ctx.fill();
      ctx.roundRect(-7, -10, 14, 5, 2); ctx.fill();
      ctx.fillStyle = palette.ink;
      ctx.beginPath(); ctx.arc(-7, 8, 2, 0, Math.PI * 2); ctx.arc(0, 8, 2, 0, Math.PI * 2); ctx.arc(7, 8, 2, 0, Math.PI * 2); ctx.fill();
      if (node.type === "reader") { ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(0, 17); ctx.stroke(); }
      const storedKey = state.memoryKey || Object.keys(state.vars || {})[0];
      const stored = node.type === "memory" && storedKey ? [storedKey, state.vars[storedKey]] : null;
      const token = node.type === "reader" ? state.dataToken : stored;
      if (token) {
        ctx.fillStyle = palette.ink;
        ctx.font = "900 10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`${token[0] || token.name}: ${token[1] ?? token.value}`, 0, -23);
      }
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

  drawDataToken(ctx, state, w, h) {
    if (!state.dataToken || !state.anim) return;
    const x = state.unit.x * w;
    const y = state.unit.y * h - 25;
    ctx.save();
    ctx.fillStyle = "rgba(255, 239, 157, .95)";
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(255, 211, 110, .42)"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = palette.ink; ctx.font = "900 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText(String(state.dataToken.value), x, y + 3);
    ctx.restore();
  }

  drawBeat(ctx, level, beat, w, h) {
    const progress = Math.max(0, Math.min(1, (now() - beat.started) / beat.duration));
    const scene = getScene(level);
    const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]));
    const point = (id) => this.point(nodeMap.get(id) || scene.nodes[0], w, h);
    ctx.save();
    ctx.fillStyle = "rgba(10, 18, 35, .6)";
    ctx.roundRect(18, 18, Math.min(w - 36, 360), 46, 18); ctx.fill();
    ctx.fillStyle = "#fff5cb"; ctx.font = "800 11px system-ui"; ctx.textAlign = "left";
    ctx.fillText(beat.caption, 32, 46);
    if (beat.type === "memory") {
      const from = point("memory");
      const to = point("reader");
      const token = pointOnEdge(edgeControlPoints(from, to), Math.min(1, progress * 1.35));
      ctx.fillStyle = "#ffe49a"; ctx.strokeStyle = palette.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(token.x, token.y - 30, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = palette.ink; ctx.font = "900 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("3", token.x, token.y - 27);
    }
    if (beat.type === "choice") {
      const gate = point("gate");
      ctx.fillStyle = "#ffe49a"; ctx.font = "900 17px system-ui"; ctx.textAlign = "center";
      ctx.fillText("5  >  3", gate.x, gate.y - 43);
      ctx.fillStyle = progress > .55 ? "#9ce0bd" : "#ffe49a";
      ctx.font = "900 11px system-ui"; ctx.fillText(progress > .55 ? "TRUE → LIGHT" : "?", gate.x, gate.y + 43);
    }
    if (beat.type === "flow") {
      const charge = point("charge");
      ctx.fillStyle = progress > .45 ? "#ffd36e" : "#ef9b8d";
      ctx.beginPath(); ctx.arc(charge.x, charge.y - 31, 8 + progress * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff5cb"; ctx.font = "900 10px system-ui"; ctx.fillText(progress > .45 ? "POWER" : "NO POWER", charge.x, charge.y - 50);
    }
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
    const moodColor = state.mood === "error" ? palette.rose : state.mood === "thinking" ? palette.violet : state.mood === "transfer" ? palette.sun : palette.ink;
    const eyeY = state.mood === "error" ? -2 : -4;
    ctx.fillStyle = moodColor; ctx.beginPath(); ctx.arc(-5, eyeY, 2.7, 0, Math.PI * 2); ctx.arc(5, eyeY, 2.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-4, -5, .9, 0, Math.PI * 2); ctx.arc(6, -5, .9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ee9a91"; ctx.beginPath(); ctx.arc(-11, 3, 3.2, 0, Math.PI * 2); ctx.arc(11, 3, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = moodColor; ctx.lineWidth = 1.5; ctx.beginPath();
    if (state.mood === "error") ctx.moveTo(-5, 4), ctx.lineTo(5, 1);
    else ctx.arc(0, 1, 5, .15, Math.PI - .15);
    ctx.stroke();
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(0, -27); ctx.stroke();
    ctx.fillStyle = moodColor; ctx.beginPath(); ctx.arc(0, -29, 4 + (state.mood === "thinking" ? 2 : 0), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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

  playBeat(level, beat) {
    if (!beat) return;
    this.beat = { ...beat, started: now(), duration: beat.duration || 2200 };
    const beatRef = this.beat;
    const tick = () => {
      if (!this.beat || this.beat !== beatRef) return;
      if (now() - this.beat.started >= this.beat.duration) {
        this.beat = null;
        this.beatFrame = 0;
        this.render(level, this.lastState || {});
        return;
      }
      this.render(level, this.lastState || {});
      this.beatFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(tick) : setTimeout(tick, 32);
    };
    if (this.beatFrame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.beatFrame);
      else clearTimeout(this.beatFrame);
    }
    tick();
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
