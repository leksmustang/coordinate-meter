"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const photos = ["104565.jpg", "104566.jpg", "104567.jpg", "104568.jpg", "104569.jpg"]
  .map(name => `D:/Рабочий стол/Клады/амф 2/${name}`);
photos.push("D:/Документы/ChatGPT/Координатный измеритель/.codex-remote-attachments/01a16ab4-c61f-7c11-8a25-ad3ca7374a9d/d1d20069-54c1-42ae-b964-e84a081f42cf/1-1000085361.jpg");

const fixture = {
  elements: [
    { type: "node", id: 1, lat: 67.2872, lon: 32.4472, tags: { amenity: "police", name: "Отдел МВД России" } },
    { type: "node", id: 2, lat: 67.2880, lon: 32.4480, tags: { name: "Управление ФСБ" } },
    { type: "node", id: 3, lat: 67.2860, lon: 32.4460, tags: { leisure: "playground", name: "Детская площадка" } },
    { type: "way", id: 4, center: { lat: 67.2890, lon: 32.4490 }, tags: { amenity: "kindergarten", name: "Детский сад" } },
    { type: "way", id: 5, center: { lat: 67.2850, lon: 32.4450 }, tags: { amenity: "school", name: "Школа" } }
  ]
};

(async () => {
  const cdpUrl = process.env.CDP_URL || "http://127.0.0.1:9226";
  let browser;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
      break;
    } catch (error) {
      if (attempt === 44) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await context.route("**/api/pois?**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fixture)
  }));
  await context.route("**/api/yandex-tile?**", route => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  }));
  await page.locator("#fileInput").setInputFiles(photos);
  await page.waitForFunction(() => document.querySelector("#routeSummary")?.textContent.includes("6 с GPS"), null, { timeout: 90000 });
  await page.locator("#openYandexButton").click();
  await page.waitForFunction(() => document.querySelector("#mapStatus")?.textContent.includes("открыта в Яндекс Картах"), null, { timeout: 10000 });
  const yandexStatus = await page.locator("#mapStatus").textContent();
  await page.locator("#loadMapButton").click();
  await page.waitForFunction(() => document.querySelector("#mapStatus")?.textContent.startsWith("Получено объектов:"), null, { timeout: 10000 });

  const status = await page.locator("#mapStatus").textContent();
  const cards = await page.locator(".facility-card").allTextContents();
  const routeMarkers = await page.locator(".route-marker").count();
  const poiMarkers = await page.locator(".poi-marker").count();
  const topBannerCoordinates = await page.locator(".point-card", { hasText: "1-1000085361.jpg" }).locator(".coordinates").textContent();
  const mapBox = await page.locator("#routeMap").boundingBox();
  assert.ok(mapBox);
  await page.mouse.click(mapBox.x + mapBox.width * 0.68, mapBox.y + mapBox.height * 0.58);
  await page.locator(".custom-marker").waitFor({ state: "visible" });
  const customMeasurement = await page.locator("#customPointResult").textContent();
  assert.equal(cards.length, 6);
  assert.equal(routeMarkers, 6);
  assert.equal(poiMarkers, 6);
  assert.equal(topBannerCoordinates, "57.746200, 40.974420");
  assert.match(customMeasurement, /От «.+»: \d+(?:[.,]\d+)? (?:м|км) · азимут \d+(?:[.,]\d+)?°/);
  assert.match(status, /Получено объектов: 5/);
  assert.ok(cards.every(card => !card.includes("Не найдено")), cards.join(" | "));
  console.log(JSON.stringify({ yandexStatus, status, cards, routeMarkers, poiMarkers, topBannerCoordinates, customMeasurement }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
