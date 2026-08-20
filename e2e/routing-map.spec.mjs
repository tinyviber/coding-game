import { test, expect } from "@playwright/test";

const LEVEL_TITLES = {
  1: "唤醒轨道",
  2: "遗失的核心",
  3: "记住能量",
  4: "增加能量",
  5: "打开亮路",
  6: "匹配标签",
  7: "修好控制程序",
  8: "唤醒中央塔",
};

async function clearProgress(page) {
  await page.goto("/index.html");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function openRoute(page, id, { expectCanonical = true } = {}) {
  await page.goto(`/index.html#/level/${id}`);
  if (expectCanonical) await expect(page).toHaveURL(new RegExp(`#\\/level\\/${id}$`));
}

async function freshRoute(page, id = 1) {
  await clearProgress(page);
  await openRoute(page, id);
}

async function enterLevel(page) {
  const intro = page.locator("#introSequence");
  if (await intro.isVisible()) await page.locator("#introButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await expect(page.locator("#levelTitle")).toHaveText(/.+/);
}

async function solveLevelOne(page) {
  const row = page.locator('#codeLines .code-line[data-instruction-id="charge_station"]');
  await row.locator('button[aria-label="上移这一行"]').click();
  await page.locator("#runButton").click();
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "success", { timeout: 15_000 });
  const card = page.locator("#levelCard");
  await expect.poll(() => card.evaluate((element) => element.open)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
}

function mapLevelButton(page, id) {
  return page.locator(`#levelMapDialog button[data-level-id="${id}"]`);
}

test("static dist keeps clean /level/N paths as 404 while hash deep links load", async ({ page }) => {
  const cleanPath = await page.request.get("/level/3");
  expect(cleanPath.status()).toBe(404);

  const hashRoute = await page.goto("/index.html#/level/3");
  expect(hashRoute?.status()).toBe(200);
  await expect(page).toHaveURL(/#\/level\/3$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[3]);
});

test("explicit deep link remains the intro target instead of falling back to Level 1", async ({ page }) => {
  await freshRoute(page, 5);
  await expect(page.locator("#introSequence")).toBeVisible();
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[5]);
  await page.locator("#introButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await expect(page).toHaveURL(/#\/level\/5$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[5]);
});

test("invalid hash after an explicit route mounts the canonical fallback UI", async ({ page }) => {
  await freshRoute(page, 3);
  await expect(page.locator("#introSequence")).toBeVisible();
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[3]);
  await enterLevel(page);

  await page.goto("/index.html");
  await expect(page).toHaveURL(/#\/level\/3$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[3]);
  await openRoute(page, 1);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[1]);
  await openRoute(page, 3);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[3]);
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await page.locator("#runButton").click();
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "running", { timeout: 3_000 });

  const priorRoute = page.url();
  const historyBeforeHashNavigation = await page.evaluate(() => history.length);
  await page.evaluate(() => { window.location.hash = "#/level/invalid"; });
  await expect(page).toHaveURL(/#\/level\/3$/);
  expect(await page.evaluate(() => history.length)).toBe(historyBeforeHashNavigation + 1);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[3]);
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "idle");
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-event-cursor", "0");
  await expect(page.locator("#sceneCaption")).toBeHidden();
  await expect(page.locator('#codeLines .code-line[data-instruction-id="write_energy"] input')).toHaveValue("2");

  await page.goBack();
  await expect(page).toHaveURL(priorRoute);
  expect(await page.evaluate(() => history.length)).toBe(historyBeforeHashNavigation + 1);

  await clearProgress(page);
  await page.goto("/index.html");
  await openRoute(page, "not-a-level", { expectCanonical: false });
  await expect(page).toHaveURL(/#\/level\/1$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[1]);
});

test("Next and map selection make one history entry, while Back and Forward only remount", async ({ page }) => {
  await freshRoute(page, 1);
  await enterLevel(page);

  await page.locator("#mapButton").click();
  const beforeMap = await page.evaluate(() => history.length);
  await mapLevelButton(page, 2).click();
  await expect(page).toHaveURL(/#\/level\/2$/);
  expect(await page.evaluate(() => history.length)).toBe(beforeMap + 1);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[2]);
  await expect(page.locator("#levelMapDialog")).toBeHidden();
  await expect(page.locator("#levelCard")).toBeHidden();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);

  const beforeBack = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(page).toHaveURL(/#\/level\/1$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[1]);
  await expect(page.locator("#levelMapDialog")).toBeHidden();
  await expect(page.locator("#levelCard")).toBeHidden();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  expect(await page.evaluate(() => history.length)).toBe(beforeBack);

  await page.goForward();
  await expect(page).toHaveURL(/#\/level\/2$/);
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[2]);
  await expect(page.locator("#levelMapDialog")).toBeHidden();
  await expect(page.locator("#levelCard")).toBeHidden();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);

  await freshRoute(page, 1);
  await enterLevel(page);
  await solveLevelOne(page);
  const beforeNext = await page.evaluate(() => history.length);
  await page.locator("#nextButton").click();
  await expect(page).toHaveURL(/#\/level\/2$/);
  expect(await page.evaluate(() => history.length)).toBe(beforeNext + 1);
  await expect(page.locator("#levelMapDialog")).toBeHidden();
  await expect(page.locator("#levelCard")).toBeHidden();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
});

test("map uses a native accessible dialog with groups, current/completed state, and focus restoration", async ({ page }) => {
  await freshRoute(page, 1);
  await enterLevel(page);

  await page.locator("#mapButton").focus();
  await page.locator("#mapButton").click();
  const dialog = page.locator("#levelMapDialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element instanceof HTMLDialogElement)).toBe(true);
  await expect.poll(() => dialog.evaluate((element) => element.open)).toBe(true);
  await expect(page.locator("#mapCloseButton")).toBeFocused();
  await expect(dialog.locator("button[data-level-id]")).toHaveCount(8);
  await expect(dialog.getByRole("group")).toHaveCount(3);
  for (const group of ["Flow", "Memory", "Choice"]) {
  await expect(dialog.getByRole("group", { name: new RegExp(group) })).toBeVisible();
  }

  await expect(mapLevelButton(page, 1)).toHaveAttribute("aria-current", "page");
  await expect(mapLevelButton(page, 1)).toBeEnabled();
  await expect(mapLevelButton(page, 8)).toBeEnabled();

  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector("#levelMapDialog")?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.querySelector("#levelMapDialog")?.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#mapButton")).toBeFocused();

  await page.locator("#mapButton").click();
  await mapLevelButton(page, 1).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/level\/1$/);
  await expect(page.locator("#levelTitle")).toBeFocused();

  await solveLevelOne(page);
  await page.locator("#mapButton").click();
  await expect(mapLevelButton(page, 1)).toHaveAttribute("data-completed", "true");
  await expect(mapLevelButton(page, 1)).toHaveAccessibleName(/已修复/);

  await page.locator("#mapCloseButton").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#mapButton")).toBeFocused();
});

test("completion persists on reload, active transition resets runtime state, and code edits are not stored", async ({ page }) => {
  await freshRoute(page, 1);
  await enterLevel(page);
  await solveLevelOne(page);
  await page.reload();
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[1]);
  await page.locator("#mapButton").click();
  await expect(mapLevelButton(page, 1)).toHaveAttribute("data-completed", "true");
  await page.locator("#mapCloseButton").click();

  await freshRoute(page, 1);
  await enterLevel(page);
  await page.locator("#runButton").click();
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "running", { timeout: 3_000 });
  await page.locator("#mapButton").click();
  await mapLevelButton(page, 2).click();
  await expect(page.locator("#levelTitle")).toHaveText(LEVEL_TITLES[2]);
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "idle");
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-event-cursor", "0");
  await expect(page.locator("#levelCard")).toBeHidden();
  expect(await page.locator("#levelCard").evaluate((element) => element instanceof HTMLDialogElement && !element.open)).toBe(true);
  await expect(page.locator("#nextButton")).toBeDisabled();
  await expect(page.locator("#sceneCaption")).toBeHidden();
  await expect(page.locator("#levelTitle")).toBeFocused();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);

  await freshRoute(page, 3);
  await enterLevel(page);
  const energy = page.locator('#codeLines .code-line[data-instruction-id="write_energy"] input');
  await expect(energy).toHaveValue("2");
  await energy.fill("7");
  const stored = await page.evaluate(() => Object.values(localStorage).join("\n"));
  expect(stored).not.toMatch(/write_energy|program|runtime/i);
  await page.reload();
  await enterLevel(page);
  await expect(page.locator('#codeLines .code-line[data-instruction-id="write_energy"] input')).toHaveValue("2");
});

test("375px, 768px, and desktop layouts keep the map and controls inside the viewport", async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await freshRoute(page, 1);
    await enterLevel(page);
    await page.locator("#mapButton").click();

    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mapButtons: [...document.querySelectorAll("#levelMapDialog button")]
        .filter((button) => button.id !== "mapCloseButton")
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height, disabled: button.disabled };
        }),
    }));
    expect(metrics.scrollWidth, `${width}px document overflow`).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.mapButtons).toHaveLength(8);
    for (const button of metrics.mapButtons) {
      expect(button.disabled, `${width}px map button must be enabled`).toBe(false);
      expect(button.width, `${width}px map button width`).toBeGreaterThanOrEqual(44);
      expect(button.height, `${width}px map button height`).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
  }
});
