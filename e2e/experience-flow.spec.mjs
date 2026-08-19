import { test, expect } from "@playwright/test";

test.describe("responsive experience contract", () => {
  test("loads the playable shell without depending on a puzzle answer", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page.locator("#levelTitle")).toBeVisible();
    const intro = page.locator("#introSequence");
    if (await intro.isVisible()) {
      await page.locator("#introButton").click();
      await expect(page.locator("#runButton")).toBeFocused();
    }
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true");
    await expect(page.locator("#codeLines .code-line").first()).toBeVisible();
    await expect(page.locator("#worldMirror")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", /idle|ready/);

    const initialCode = await page.locator("#codeLines").innerText();
    expect(initialCode.indexOf('move_to("charge")')).toBeGreaterThanOrEqual(0);
    expect(initialCode.indexOf('move_to("charge")')).toBeLessThan(initialCode.indexOf('deliver("exit")'));
    expect(initialCode.indexOf('deliver("exit")')).toBeLessThan(initialCode.indexOf("charge(3)"));
    await expect(page.locator("#runStatus")).not.toHaveText(/演示|demo/i);
    await page.waitForTimeout(500);
    expect(await page.locator("#codeLines").innerText()).toBe(initialCode);

    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
    for (const selector of ["#runButton", "#pauseButton", "#stepButton", "#resetButton", "#hintButton"]) {
      if (selector !== "#pauseButton") await expect(page.locator(selector)).toBeEnabled();
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} must have a rendered hit area`).not.toBeNull();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
