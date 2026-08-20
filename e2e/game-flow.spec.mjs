import { test, expect } from "@playwright/test";

async function fresh(page) {
  await page.goto("/index.html");
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.reload();
}

async function enterAndWait(page, editableInstructionId = null) {
  const intro = page.locator("#introSequence");
  if (await intro.isVisible()) await page.locator("#introButton").click();
  if (await page.locator("#app").getAttribute("data-app-ready") !== "true") {
    await expect(page.locator("#runButton")).toBeDisabled();
    await expect(page.locator("#codeLines")).toHaveAttribute("data-presentation-locked", "true");
    await expect.poll(() => page.locator("#sceneCaption").textContent(), { timeout: 4_000 }).not.toBe("");
  }
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await expect(page.locator("#runButton")).toBeEnabled();
  await expect(page.locator("#codeLines")).toHaveAttribute("data-presentation-locked", "false");
  await expect.poll(() => page.locator("#codeLines .code-line").count()).toBeGreaterThan(0);
  if (editableInstructionId) {
    await expect(row(page, editableInstructionId).locator("input, select, button").first()).toBeEnabled();
  }
}

async function waitSuccess(page) {
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "success", { timeout: 15_000 });
  const card = page.locator("#levelCard");
  expect(await card.evaluate((element) => element instanceof HTMLDialogElement)).toBe(true);
  await expect.poll(() => card.evaluate((element) => element.open)).toBe(true);
  await expect(card).toBeVisible();
}

function row(page, instruction) {
  return page.locator(`#codeLines .code-line[data-instruction-id="${instruction}"]`);
}

function control(page, instruction, selector = "input, select", index = 0) {
  return row(page, instruction).locator(selector).nth(index);
}

async function moveRow(page, instruction, direction, times = 1) {
  for (let index = 0; index < times; index += 1) {
    await row(page, instruction).locator(`button[aria-label="${direction === "up" ? "上移这一行" : "下移这一行"}"]`).click();
  }
}

test.describe("Unit-0 真实交互 vertical slice", () => {
  test("success card is a native modal with Escape and Continue lifecycle", async ({ page }) => {
    await fresh(page);
    await enterAndWait(page, "charge_station");

    await moveRow(page, "charge_station", "up");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await expect(page.locator("#cardNextButton")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator("#levelCard")).toBeHidden();
    await expect(page.locator("#levelTitle")).toBeFocused();
    expect(await page.locator("#levelCard").evaluate((element) => element instanceof HTMLDialogElement && !element.open)).toBe(true);

    // Reset intentionally preserves editor changes. Reload a fresh level so the
    // second success path starts from the canonical program order.
    await fresh(page);
    await enterAndWait(page, "charge_station");
    await moveRow(page, "charge_station", "up");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await page.locator("#cardNextButton").click();
    await expect(page).toHaveURL(/#\/level\/2$/);
    await expect(page.locator("#levelCard")).toBeHidden();
    expect(await page.locator("#levelCard").evaluate((element) => element instanceof HTMLDialogElement && !element.open)).toBe(true);
    await expect(page.locator("#levelTitle")).toHaveText("遗失的核心");
  });

  test("Intro → Flow beat → 玩家控制，且已看 Intro 仍播放 Flow beat", async ({ page }) => {
    await fresh(page);
    await expect(page.locator("#introSequence")).toBeVisible();
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "false");
    await expect(page.locator("#runButton")).toBeDisabled();
    await expect(page.locator("#codeLines .code-line")).toHaveCount(0);
    await page.locator("#introButton").click();
    await expect(page.locator("#app")).toHaveAttribute("data-intro-complete", "true");
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "false");
    await expect(page.locator("#runButton")).toBeDisabled();
    await expect(page.locator("#sceneCaption")).toContainText("充电站");
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
    await expect(page.locator("#runButton")).toBeEnabled();

    await page.reload();
    await expect(page.locator("#introSequence")).toBeHidden();
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "false");
    await expect(page.locator("#runButton")).toBeDisabled();
    await expect(page.locator("#sceneCaption")).toContainText("充电站");
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  });

  test("首次点击提示就是第一条，且 1–7 关不可见太阳", async ({ page }) => {
    await fresh(page);
    await enterAndWait(page);
    const help = page.locator("#codeHelp");
    const initial = await help.textContent();
    await page.locator("#hintButton").click();
    const first = await help.textContent();
    await page.locator("#hintButton").click();
    const second = await help.textContent();
    await page.locator("#hintButton").click();
    const third = await help.textContent();
    expect(first).not.toBe(initial);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-sun-visible", "false");
  });

  test("从第 1 关完整玩到第 8 关，最后才出现日出", async ({ page }) => {
    await fresh(page);
    await enterAndWait(page, "charge_station");
    await expect(page.locator("#codeLines")).not.toContainText("read(");

    await moveRow(page, "charge_station", "up");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "pickup_relay_core");

    await expect(page.locator("#codeLines")).toContainText('pickup("relay_core")');
    await expect(page.locator("#codeLines")).not.toContainText("read(");
    await moveRow(page, "pickup_relay_core", "up", 2);
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "write_energy");

    await control(page, "write_energy", "input").fill("5");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "update_energy");

    await control(page, "update_energy", "input").fill("1");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "branch_gate");

    await control(page, "branch_gate", "select").selectOption("<");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-sun-visible", "false");
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "branch_gate");

    await control(page, "branch_gate", "select").selectOption("==");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-sun-visible", "false");
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "update_energy");

    await control(page, "update_energy", "input").fill("3");
    await row(page, "branch_gate").getByLabel("成立路线").selectOption("light");
    await moveRow(page, "branch_gate", "down");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-sun-visible", "false");
    await page.locator("#cardNextButton").click();
    await enterAndWait(page, "update_energy");

    await control(page, "update_energy", "input").fill("4");
    await control(page, "branch_gate", "select", 0).selectOption(">");
    await control(page, "branch_gate", "input").fill("3");
    await control(page, "branch_gate", "select", 1).selectOption("dawn");
    await moveRow(page, "write_energy", "up");
    await moveRow(page, "update_energy", "up");
    await page.locator("#runButton").click();
    await waitSuccess(page);
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-sun-visible", "true");
    await expect(page.locator("#cardTitle")).toHaveText("中央塔重新启动。");
  });

  test("移动端无横向溢出，worldMirror 仍为隐藏无障碍状态", async ({ page }) => {
    await fresh(page);
    await enterAndWait(page);
    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator("#worldMirror")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#worldMirror")).toBeAttached();
  });
});
