"use strict";

const fs = require("node:fs");

const port = Number(process.argv[2] || 9223);
const photoPath = process.argv[3];
const expectedLatitude = Number(process.argv[4]);
const expectedLongitude = Number(process.argv[5]);
const ocrAttempts = Math.max(20, Math.min(360, Number(process.argv[6]) || 240));
const forceColorBandOcr = process.argv[7] === "force-color-band";

if (!photoPath || !fs.existsSync(photoPath)) {
  throw new Error("Передайте существующий JPEG- или PNG-файл для проверки интерфейса.");
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page"
        && item.webSocketDebuggerUrl
        && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url || ""));
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("Не удалось подключиться к локальному окну Electron.");
}

async function main() {
  const page = await waitForDebugger();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const tileStatuses = [];
  const runtimeErrors = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      if (response?.url?.includes("/api/yandex-tile?")) tileStatuses.push(response.status);
    }
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      runtimeErrors.push(message.params.entry.text || "Log error");
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Ошибка JavaScript в окне приложения");
    return result.result?.value;
  };

  await Promise.all([send("Runtime.enable"), send("DOM.enable"), send("Network.enable"), send("Log.enable")]);
  let appReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      appReady = await evaluate("document.readyState === 'complete' && Array.isArray(window.__ocrDebug) && Boolean(window.CoordinateCore)");
      if (appReady) break;
    } catch {}
    await sleep(250);
  }
  if (!appReady) throw new Error("Окно приложения не завершило загрузку JavaScript.");
  if (forceColorBandOcr) await evaluate("window.__forceColorBandOcr = true; true");

  let inputSet = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const documentNode = await send("DOM.getDocument", { depth: 1 });
      const candidate = await send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: "#fileInput"
      });
      if (candidate.nodeId) {
        await send("DOM.setFileInputFiles", { nodeId: candidate.nodeId, files: [photoPath] });
        inputSet = true;
        break;
      }
    } catch (error) {
      if (!String(error.message).includes("Could not find node")) throw error;
    }
    await sleep(250);
  }
  if (!inputSet) throw new Error("Окно приложения не загрузило поле выбора фотографии.");
  await sleep(300);
  const uploadStarted = await evaluate("(window.__ocrDebug || []).some((entry) => entry.pass === 'upload-start')");
  if (!uploadStarted) {
    await evaluate("document.querySelector('#fileInput').dispatchEvent(new Event('change', { bubbles: true })); true");
  }

  let pointSummary = null;
  for (let attempt = 0; attempt < ocrAttempts; attempt += 1) {
    pointSummary = await evaluate(`(() => ({
      total: document.querySelectorAll('.point-card').length,
      withCoordinates: Array.from(document.querySelectorAll('.point-card')).filter((row) => /-?\\d{1,2}\\.\\d{4,}/.test(row.querySelector('.coordinates')?.textContent || '')).length,
      coordinates: Array.from(document.querySelectorAll('.point-card')).map((row) => row.querySelector('.coordinates')?.textContent?.trim() || ''),
      notice: document.querySelector('#notice')?.textContent?.trim() || '',
      busy: document.body.textContent.includes('Распознаю')
    }))()`);
    if (pointSummary.total > 0 && pointSummary.withCoordinates > 0 && !pointSummary.busy) break;
    await sleep(500);
  }

  if (!pointSummary || pointSummary.withCoordinates < 1) {
    const debug = await evaluate("window.__ocrDebug || []");
    throw new Error(`Интерфейс не получил координаты из тестовой фотографии. Состояние: ${JSON.stringify(pointSummary)}. Ошибки: ${JSON.stringify(runtimeErrors)}. OCR: ${JSON.stringify(debug)}`);
  }

  await evaluate("document.querySelector('#loadMapButton').click(); true");
  for (let attempt = 0; attempt < 60 && !tileStatuses.some((status) => status === 200); attempt += 1) {
    await sleep(500);
  }

  await evaluate("document.querySelector('#routeMap').scrollIntoView({ block: 'center' }); true");
  await sleep(300);
  const mapClick = await evaluate(`(() => {
    const rect = document.querySelector('#routeMap').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.68, y: rect.top + rect.height * 0.58 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: mapClick.x, y: mapClick.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: mapClick.x, y: mapClick.y, button: "left", clickCount: 1 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await evaluate("Boolean(document.querySelector('.custom-marker'))")) break;
    await sleep(250);
  }

  const ui = await evaluate(`(() => ({
    status: document.querySelector('#mapStatus')?.textContent?.trim() || '',
    mapVisible: !document.querySelector('#routeMap')?.classList.contains('hidden'),
    yandexLogo: Boolean(document.querySelector('.yandex-map-logo img')),
    customMarker: Boolean(document.querySelector('.custom-marker')),
    customMeasurement: document.querySelector('#customPointResult')?.textContent?.trim() || '',
    customClearVisible: !document.querySelector('#clearCustomPointButton')?.classList.contains('hidden'),
    publicTileUrlsSafe: performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/yandex-tile?'))
      .every((entry) => !entry.name.includes('apikey=') && !entry.name.includes('signature='))
  }))()`);

  const coordinateMatch = pointSummary.coordinates[0]?.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  const parsedLatitude = coordinateMatch ? Number(coordinateMatch[1]) : null;
  const parsedLongitude = coordinateMatch ? Number(coordinateMatch[2]) : null;
  const expectedMatch = !Number.isFinite(expectedLatitude) || !Number.isFinite(expectedLongitude)
    || (Math.abs(parsedLatitude - expectedLatitude) < 0.000002 && Math.abs(parsedLongitude - expectedLongitude) < 0.000002);
  const passed = pointSummary.withCoordinates >= 1
    && expectedMatch
    && ui.mapVisible
    && ui.yandexLogo
    && ui.customMarker
    && ui.customClearVisible
    && /От «.+»: \d+(?:[.,]\d+)? (?:м|км) · азимут \d+(?:[.,]\d+)?°/.test(ui.customMeasurement)
    && ui.publicTileUrlsSafe
    && tileStatuses.some((status) => status === 200);
  console.log(JSON.stringify({
    passed,
    points: pointSummary.total,
    pointsWithCoordinates: pointSummary.withCoordinates,
    coordinates: pointSummary.coordinates,
    expectedMatch,
    mapVisible: ui.mapVisible,
    yandexLogo: ui.yandexLogo,
    customMarker: ui.customMarker,
    customMeasurement: ui.customMeasurement,
    customClearVisible: ui.customClearVisible,
    publicTileUrlsSafe: ui.publicTileUrlsSafe,
    tileResponses: tileStatuses.length,
    successfulTiles: tileStatuses.filter((status) => status === 200).length,
    status: ui.status
  }, null, 2));
  socket.close();
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
