import { test, expect } from "@playwright/test";

async function enter(page) {
  await page.goto("/index.html");
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.reload();
  const intro = page.locator("#introSequence");
  if (await intro.isVisible()) await page.locator("#introButton").click();
  await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "true", { timeout: 8_000 });
}

test("code text and order controls stay readable at supported widths", async ({ page }) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await enter(page);

    const layout = await page.evaluate(() => {
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const intersects = (a, b) => Boolean(a && b
        && a.left < b.right && a.right > b.left
        && a.top < b.bottom && a.bottom > b.top);
      const rows = [...document.querySelectorAll("#codeLines .code-line")].map((row) => ({
        text: rect(row.querySelector(".code-text")),
        controls: rect(row.querySelector(".order-controls")),
        intersects: intersects(rect(row.querySelector(".code-text")), rect(row.querySelector(".order-controls"))),
      }));
      const buttons = [...document.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length > 0)
        .map(rect)
        .filter((box) => box.width > 0 && box.height > 0);
      return {
        rows,
        buttons,
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.scrollWidth, `${width}px document overflow`).toBeLessThanOrEqual(layout.innerWidth);
    for (const row of layout.rows) {
      expect(row.intersects, `${width}px code/order rectangles overlap`).toBe(false);
    }
    for (const button of layout.buttons) {
      expect(button.width, `${width}px button width`).toBeGreaterThanOrEqual(44);
      expect(button.height, `${width}px button height`).toBeGreaterThanOrEqual(44);
    }
  }
});
