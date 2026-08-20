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

async function enterFreshGame(page) {
  await page.goto("/index.html");
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.reload();
  if (await page.locator("#introSequence").isVisible()) await page.locator("#introButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
  await expect(page.locator("#runButton")).toBeEnabled();
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

async function finishLevel(page) {
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "success", { timeout: 15_000 });
  await page.locator("#cardNextButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
}

test("第 4、6 关的可见运行文案不泄漏内部变量名", async ({ page }) => {
  await enterFreshGame(page);

  await moveRow(page, "charge_station", "up");
  await page.locator("#runButton").click();
  await finishLevel(page);

  await moveRow(page, "pickup_relay_core", "up", 2);
  await page.locator("#runButton").click();
  await finishLevel(page);

  await control(page, "write_energy", "input").fill("5");
  await page.locator("#runButton").click();
  await finishLevel(page);

  await page.locator("#runButton").click();
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "error", { timeout: 15_000 });
  const levelFourError = await page.locator("#runtimeMessage").textContent();
  expect(levelFourError).toMatch(/energy|能量/);
  expect(levelFourError).not.toMatch(/\bupdate\b/i);
  await page.locator("#resetButton").click();
  await control(page, "update_energy", "input").fill("1");
  await page.locator("#runButton").click();
  await expect(page.locator("#runtimeMessage")).toContainText("energy 从 1 变成了 2");
  await expect(page.locator("#runtimeMessage")).not.toContainText(/\bupdate\b/i);
  await finishLevel(page);

  await control(page, "branch_gate", "select").selectOption("<");
  await page.locator("#runButton").click();
  await finishLevel(page);

  await control(page, "branch_gate", "select").selectOption("==");
  await page.locator("#runButton").click();
  await expect(page.locator("#worldMirror")).toHaveAttribute("data-phase", "success", { timeout: 15_000 });
  await expect(page.locator("#worldMirror")).toContainText("标签");

  for (const selector of ["#runtimeMessage", "#eventText", "#worldMirror"]) {
    const text = await page.locator(selector).textContent();
    expect(text).not.toMatch(/\bcargo\b/i);
    expect(text).not.toMatch(/\bupdate\b/i);
    expect(text).not.toMatch(/原子交付|消费数据|数据消费|直连轨道|Choice 链|完整链路/);
  }
});
