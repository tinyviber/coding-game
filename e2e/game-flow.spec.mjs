import { test, expect } from "@playwright/test";

const mirrorSelector = "#worldMirror";

async function worldMirror(page) {
  const mirror = page.locator(mirrorSelector);
  await expect(mirror).toHaveCount(1);
  return mirror;
}

async function waitForIdle(page) {
  const appReady = page.locator("[data-app-ready]");
  if (await appReady.count()) await expect.poll(() => appReady.getAttribute("data-app-ready"), { timeout: 15_000 }).toBe("true");
  await expect.poll(() => page.locator("#runStatus").textContent(), { timeout: 15_000 }).toMatch(/IDLE|READY|准备/);
}

async function readCursor(mirror) {
  const value = await mirror.getAttribute("data-event-cursor");
  return value === null ? null : Number(value);
}

async function expectWorldPhase(page, mirror, pattern) {
  if (await mirror.getAttribute("data-phase") !== null) {
    await expect.poll(() => mirror.getAttribute("data-phase")).toMatch(new RegExp(pattern, "i"));
  } else {
    await expect.poll(() => page.locator("#runStatus").textContent()).toMatch(new RegExp(pattern, "i"));
  }
}

async function codeLockState(page) {
  return page.locator("#codeLines").evaluate((root) => {
    const controls = [...root.querySelectorAll("input, select, button")];
    return {
      locked: root.dataset.locked === "true",
      allDisabled: controls.length > 0 && controls.every((control) => control.disabled),
    };
  });
}

function chargeMoveUp(page) {
  return page.locator('#codeLines .code-line[data-instruction="charge"] button[aria-label="Move line up"]');
}

test.describe("Unit-0 playable vertical slice", () => {
  test("entry loads, isolated demo returns idle, and world mirror exposes state", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#levelTitle")).toBeVisible();
    await expect(page.locator("#codeLines .code-line").first()).toBeVisible();
    const nudge = page.locator("#starterNudge");
    const dismissNudge = page.locator("#dismissNudge");
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText(/observe|观察|先看/i);
    await expect(nudge).not.toHaveAttribute("role", "dialog");
    await expect(nudge).not.toHaveAttribute("inert", "");
    const starterCode = await page.locator("#codeLines").innerText();
    await waitForIdle(page);
    await expect(nudge).toContainText(/try|尝试|试试|跟我做/i);
    for (const selector of ["[data-nudge-target], .nudge-target", "[data-nudge-target-control], .nudge-target-control"]) {
      await expect(page.locator(selector)).toHaveCount(1);
      await expect(page.locator(selector)).toBeVisible();
    }
    for (const selector of ["#runButton", "#stepButton", "#resetButton", "#hintButton"]) {
      await expect(page.locator(selector)).toBeEnabled();
    }
    expect(await page.locator("#codeLines").innerText()).toBe(starterCode);

    const mirror = await worldMirror(page);
    await expectWorldPhase(page, mirror, /idle|ready/);
    for (const attr of ["data-unit", "data-memory", "data-read", "data-gate", "data-path", "data-error", "data-success"]) {
      await expect(mirror).toHaveAttribute(attr);
    }

    await dismissNudge.click();
    await expect(nudge).toBeHidden();
    await page.reload();
    await waitForIdle(page);
    await expect(page.locator("#starterNudge")).toBeHidden();
    await expect(page.locator("#runButton")).toBeEnabled();
  });

  test("Step/Reset editor lock", async ({ page }) => {
    await page.goto("/index.html");
    await waitForIdle(page);
    const mirror = await worldMirror(page);
    await page.locator("#resetButton").click();
    const initialCursor = await readCursor(mirror);

    await page.locator("#stepButton").click();
    if (initialCursor !== null) await expect.poll(() => readCursor(mirror)).toBeGreaterThan(initialCursor);
    else await expectWorldPhase(page, mirror, /paused/);
    await expectWorldPhase(page, mirror, /paused/);
    expect(await codeLockState(page)).toEqual({ locked: true, allDisabled: true });

    await page.locator("#resetButton").click();
    await waitForIdle(page);
    await expectWorldPhase(page, mirror, /idle|ready/);
    await expect(page.locator("#codeLines")).toHaveAttribute("data-locked", "false");
    expect(await codeLockState(page)).toEqual({ locked: false, allDisabled: false });
    if (await readCursor(mirror) !== null) expect(await readCursor(mirror)).toBe(0);
    await expect(mirror).toHaveAttribute("data-error", "");
  });

  test("starter error is visible, Reset enables retry, and solved retry reaches success", async ({ page }) => {
    await page.goto("/index.html");
    await waitForIdle(page);
    const mirror = await worldMirror(page);
    await page.locator("#runButton").click();
    await expectWorldPhase(page, mirror, /error|failed/);
    await expect.poll(() => mirror.getAttribute("data-error")).not.toBe("");

    await page.locator("#resetButton").click();
    await waitForIdle(page);
    const moveUp = chargeMoveUp(page);
    await expect(moveUp).toBeEnabled();
    await moveUp.click();
    await page.locator("#runButton").click();
    await expectWorldPhase(page, mirror, /success|complete/);
  });

  test("first puzzle can be solved through code controls and advances story", async ({ page }) => {
    await page.goto("/index.html");
    await waitForIdle(page);
    const moveUp = chargeMoveUp(page);
    await expect(moveUp).toBeEnabled();
    await moveUp.click();
    await page.locator("#runButton").click();
    await expect(page.locator("#runStatus")).toHaveText(/SUCCESS|COMPLETE|完成/, { timeout: 8_000 });
    const mirror = await worldMirror(page);
    await expect(mirror).toHaveAttribute("data-success", /true|success|on/);
    await expect(page.locator("#levelCard")).not.toHaveClass(/hidden/);
    expect(await codeLockState(page)).toEqual({ locked: true, allDisabled: true });
    await expect(page.locator("#cardTitle")).toContainText(/rail wakes|signal|restore/i);

    await page.locator("#cardNextButton").click();
    await expect(page.locator("#levelNumber")).toHaveText("02");
  });

  test("mobile layout has no horizontal overflow and touch-safe controls", async ({ page }) => {
    await page.goto("/index.html");
    await waitForIdle(page);
    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
    for (const selector of ["#runButton", "#pauseButton", "#stepButton", "#resetButton", "#hintButton"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} must be visible`).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator("#codeLines")).toBeVisible();
  });
});
