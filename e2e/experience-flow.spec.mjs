import { test, expect } from "@playwright/test";

test("首屏目标清晰、代码未被自动替换，且外围界面中文化", async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.reload();
  await expect(page.locator("#introSequence")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "false");
  await page.locator("#introButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await expect(page.locator("#levelTitle")).toHaveText("唤醒轨道");
  await expect(page.locator("#goalText")).toContainText("充好电");
  const initialCode = await page.locator("#codeLines").innerText();
  expect(initialCode).toContain('move("charge")');
  expect(initialCode).toContain('deliver("relay")');
  expect(initialCode).not.toMatch(/\bread\s*\(/i);
  expect(initialCode).not.toMatch(/Reader/i);
  await expect(page.locator("#runStatus")).not.toHaveText(/演示|demo/i);
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/Wake Signal|Cargo Line|Memory Depot|Central Relay|SIGNAL RESTORED|World is listening/);
});
