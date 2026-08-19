const clock = () => globalThis.performance?.now?.() ?? Date.now();

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

export class IntroSequence {
  constructor(overlay, canvas, caption, signal, button, onDone, focusTarget) {
    this.overlay = overlay;
    this.canvas = canvas;
    this.caption = caption;
    this.signal = signal;
    this.button = button;
    this.onDone = onDone;
    this.focusTarget = focusTarget;
    this.frame = 0;
    this.started = 0;
    this.finished = false;
    button?.addEventListener("click", () => this.finish());
  }

  show() {
    let seen = false;
    try { seen = globalThis.sessionStorage?.getItem("unit0-intro-seen") === "1"; } catch {}
    if (seen) return false;
    this.finished = false;
    this.started = clock();
    this.overlay.hidden = false;
    this.overlay.classList.add("active");
    this.overlay.setAttribute("aria-busy", "true");
    this.button?.focus();
    this.tick();
    return true;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.frame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
      else clearTimeout(this.frame);
    }
    try { globalThis.sessionStorage?.setItem("unit0-intro-seen", "1"); } catch {}
    this.overlay.classList.remove("active");
    this.overlay.hidden = true;
    this.overlay.setAttribute("aria-busy", "false");
    this.onDone?.();
    this.focusTarget?.focus();
  }

  tick() {
    if (this.finished) return;
    const elapsed = (clock() - this.started) / 1000;
    this.draw(elapsed);
    if (elapsed > 7) this.finish();
    else this.frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => this.tick()) : setTimeout(() => this.tick(), 32);
  }

  draw(elapsed) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || 640);
    const height = Math.max(260, rect.height || 480);
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wake = Math.max(0, Math.min(1, (elapsed - 1.7) / 2));
    const signal = Math.max(0, Math.min(1, (elapsed - 3.5) / 1.2));
    // Intro promises daylight; it must not reveal the payoff before level 8 succeeds.
    const horizonGlow = Math.max(0, Math.min(1, (elapsed - 3.5) / 3.5));
    const top = `rgb(${17 + Math.round(8 * horizonGlow)}, ${27 + Math.round(7 * horizonGlow)}, ${52 + Math.round(9 * horizonGlow)})`;
    const bottom = `rgb(${10 + Math.round(24 * horizonGlow)}, ${20 + Math.round(16 * horizonGlow)}, ${40 + Math.round(13 * horizonGlow)})`;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 236, 177, .65)";
    for (let i = 0; i < 28; i += 1) {
      const x = (i * 71) % width;
      const y = 20 + ((i * 37) % Math.max(70, height * .42));
      ctx.globalAlpha = .3 + ((i % 4) * .12) * (1 - horizonGlow * .35);
      ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 1.7 : 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(4, 10, 25, .72)";
    for (let i = 0; i < 8; i += 1) {
      const x = i * width / 7 - 20;
      const buildingHeight = 70 + (i % 3) * 30;
      ctx.fillRect(x, height * .72 - buildingHeight, 84, buildingHeight);
      ctx.fillStyle = `rgba(255, 218, 128, ${.2 + wake * .5})`;
      ctx.fillRect(x + 19, height * .72 - buildingHeight + 22, 8, 10);
      ctx.fillRect(x + 42, height * .72 - buildingHeight + 48, 8, 10);
      ctx.fillStyle = "rgba(4, 10, 25, .72)";
    }
    ctx.fillStyle = "#293f5b"; ctx.fillRect(0, height * .72, width, 16);
    ctx.strokeStyle = "rgba(255, 217, 128, .5)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, height * .72 + 8); ctx.lineTo(width, height * .72 + 8); ctx.stroke();
    const unitX = width * .26;
    const unitY = height * .72 - 15;
    ctx.save(); ctx.translate(unitX, unitY);
    ctx.fillStyle = "rgba(0, 0, 0, .3)"; ctx.beginPath(); ctx.ellipse(0, 30, 27, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f0a18a"; ctx.strokeStyle = "#14253d"; ctx.lineWidth = 3; roundRect(ctx, -20, -16, 40, 42, 15); ctx.stroke();
    ctx.fillStyle = "#fff5d8"; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = wake > .4 ? "#ffd36e" : "#607993"; ctx.beginPath(); ctx.arc(-5, 0, 3, 0, Math.PI * 2); ctx.arc(5, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#14253d"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, -30); ctx.stroke();
    ctx.fillStyle = wake > .4 ? "#ffd36e" : "#607993"; ctx.beginPath(); ctx.arc(0, -32, 4 + wake * 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (signal > 0) {
      const towerX = width * .76;
      ctx.strokeStyle = `rgba(255, 235, 169, ${signal})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(towerX, height * .72); ctx.lineTo(towerX, height * .22); ctx.stroke();
      ctx.fillStyle = `rgba(255, 235, 169, ${signal})`; ctx.shadowColor = "rgba(255, 235, 169, .8)"; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(towerX, height * .2, 13 + signal * 8, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    if (horizonGlow > 0) {
      ctx.save();
      ctx.globalAlpha = .08 + horizonGlow * .08;
      ctx.fillStyle = "#df956d";
      ctx.shadowColor = "rgba(223, 149, 109, .36)";
      ctx.shadowBlur = 28;
      ctx.beginPath(); ctx.ellipse(width * .72, height * .72 + 10, 110, 12, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    this.caption.textContent = elapsed < 1.7 ? "夜里，机械城停止呼吸。" : elapsed < 3.5 ? "一条紧急线路，唤醒沉睡的零号车。" : elapsed < 5.2 ? "中央塔发来最后一句请求：" : "让太阳再次升起";
    this.caption.dataset.final = elapsed >= 5.2 ? "true" : "false";
    this.signal.textContent = elapsed >= 3.5 ? "让太阳再次升起" : "";
  }
}
