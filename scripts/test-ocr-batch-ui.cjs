"use strict";

const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 9234);
const directory = process.argv[3] || "D:\\Рабочий стол\\Клады\\проверка";
const dataset = process.argv[4] || "red-overlay";
const quiet = process.argv.includes("--quiet");
const datasets = {
  "reported-failures": [
    ["0.5 новороссийск\\1.jpg", 44.690177, 37.760899],
    ["0,25\\3.jpg", 44.692253, 37.777446]
  ],
  "reported-failure-second": [
    ["0,25\\3.jpg", 44.692253, 37.777446]
  ],
  "red-overlay": [
    ["1.jpg", 67.536576, 30.555379],
    ["2.jpg", 67.536477, 30.556022],
    ["3.jpg", 67.536259, 30.555860],
    ["4.jpg", 67.537244, 30.552567],
    ["5.jpg", 67.537591, 30.548725],
    ["6.jpg", 67.537654, 30.548055],
    ["7.jpg", 67.537497, 30.549373]
  ],
  "lowres-notecam": [
    ["minfvrlsdpgzafzgtx64nqdq3vwnrgla5mxq7qpbjuca27xfbz43jyqd.jpg", 67.559414, 30.474923],
    ["2.jpg", 67.556732, 30.473055],
    ["3.jpg", 67.558867, 30.475056],
    ["4.jpg", 67.557054, 30.474209],
    ["5.jpg", 67.559751, 30.473399],
    ["6.jpg", 67.558509, 30.475247],
    ["7.jpg", 67.558183, 30.475905]
  ],
  "notecam-originals": [
    ["IMG_3887.jpeg.jpg", 67.571935, 30.501897],
    ["IMG_3889.jpeg.jpg", 67.572404, 30.501809]
  ],
  "notecam-originals-png": [
    ["IMG_3887.png", 67.571935, 30.501897],
    ["IMG_3889.png", 67.572404, 30.501809]
  ],
  "notecam-amf": [
    ["104565.jpg", 67.286694, 32.447859],
    ["104566.jpg", 67.288241, 32.442686],
    ["104567.jpg", 67.288318, 32.445000],
    ["104568.jpg", 67.287582, 32.445985],
    ["104569.jpg", 67.286871, 32.447219]
  ],
  "notecam-boshka": [
    ["1.jpg", 67.271710, 32.449824],
    ["2.jpg", 67.272149, 32.448813],
    ["3.jpg", 67.271401, 32.451210],
    ["4.jpg", 67.272383, 32.450081],
    ["5.jpg", 67.272343, 32.450791],
    ["6.jpg", 67.271886, 32.450942],
    ["7.jpg", 67.272573, 32.449483],
    ["8.jpg", 67.271996, 32.449234],
    ["9.jpg", 67.271623, 32.450623],
    ["10.jpg", 67.272154, 32.450701],
    ["11.jpg", 67.273701, 32.450428],
    ["12.jpg", 67.273952, 32.451195],
    ["13.jpg", 67.272881, 32.449866],
    ["14.jpg", 67.273489, 32.449931],
    ["15.jpg", 67.273152, 32.449803],
    ["16.jpg", 67.273385, 32.451052],
    ["17.jpg", 67.273905, 32.452553],
    ["18.jpg", 67.273592, 32.451827],
    ["19.jpg", 67.272289, 32.448401],
    ["20.jpg", 67.273976, 32.451756]
  ],
  "notecam-boshka-trouble": [
    ["5.jpg", 67.272343, 32.450791],
    ["11.jpg", 67.273701, 32.450428],
    ["17.jpg", 67.273905, 32.452553]
  ],
  "gps55-top-banner": [
    ["1.jpg", 57.740760, 40.966600],
    ["3БС.jpg", 57.740560, 40.966500],
    ["5.jpg", 57.740000, 40.966600],
    ["7.jpg", 57.739690, 40.967180],
    ["9.jpg", 57.739660, 40.966490],
    ["11.jpg", 57.739570, 40.965450],
    ["13.jpg", 57.739480, 40.964750],
    ["15.jpg", 57.739690, 40.964100],
    ["17.jpg", 57.739470, 40.962310],
    ["19БС.jpg", 57.740890, 40.964570],
    ["21.jpg", 57.745010, 40.973960],
    ["23.jpg", 57.744520, 40.972970],
    ["25.jpg", 57.743870, 40.971790],
    ["27.jpg", 57.743150, 40.969600],
    ["29.jpg", 57.742530, 40.968370],
    ["31.jpg", 57.742060, 40.966820],
    ["33.jpg", 57.741620, 40.965780],
    ["35.jpg", 57.741380, 40.964820],
    ["37.jpg", 57.740540, 40.964920],
    ["39.png", 57.740610, 40.965940]
  ],
  "gps55-top-smoke": [
    ["3БС.jpg", 57.740560, 40.966500],
    ["15.jpg", 57.739690, 40.964100],
    ["31.jpg", 57.742060, 40.966820],
    ["39.png", 57.740610, 40.965940]
  ],
  "gps55-top-15": [
    ["15.jpg", 57.739690, 40.964100]
  ],
  "gps55-mef-2g": [
    ["1.jpeg", 55.85789, 37.56826],
    ["2.jpeg", 55.85797, 37.56847],
    ["3.jpeg", 55.85796, 37.56839],
    ["4.jpeg", 55.85992, 37.57004],
    ["5.jpeg", 55.85993, 37.57009],
    ["6.jpeg", 55.85991, 37.57001],
    ["7.jpeg", 55.85805, 37.56468],
    ["8.jpeg", 55.82193, 37.58021],
    ["9.jpeg", 55.85827, 37.56476],
    ["10.jpeg", 55.82192, 37.58016],
    ["11.jpeg", 55.82188, 37.58003],
    ["12.jpeg", 55.82296, 37.57971],
    ["13.jpeg", 55.82298, 37.57974],
    ["14.jpeg", 55.84729, 37.57083],
    ["15.jpeg", 55.84731, 37.57077],
    ["16.jpeg", null, null],
    ["17.jpeg", 55.822946, 37.579785],
    ["18.jpeg", 55.823146, 37.579745]
  ],
  "gps55-mef-pair": [
    ["1.jpeg", 55.85789, 37.56826],
    ["2.jpeg", 55.85797, 37.56847]
  ],
  "mixed-current-open": [
    ["меф\\2г\\8.jpeg", 55.82193, 37.58021],
    ["меф\\2г\\9.jpeg", 55.85827, 37.56476],
    ["меф\\2г\\10.jpeg", 55.82192, 37.58016],
    ["меф\\2г\\11.jpeg", 55.82188, 37.58003],
    ["меф\\2г\\12.jpeg", 55.82296, 37.57971],
    ["меф\\2г\\13.jpeg", 55.82298, 37.57974],
    ["меф\\2г\\18.jpeg", 55.823146, 37.579745],
    ["меф\\2г\\14.jpeg", 55.84729, 37.57083],
    ["меф\\2г\\1.jpeg", 55.85789, 37.56826],
    ["меф\\2г\\2.jpeg", 55.85797, 37.56847],
    ["меф\\2г\\3.jpeg", 55.85796, 37.56839],
    ["меф\\2г\\4.jpeg", 55.85992, 37.57004],
    ["проверка\\5.jpg", 67.272343, 32.450791],
    ["проверка\\11.jpg", 67.273701, 32.450428],
    ["проверка\\17.jpg", 67.273905, 32.452553]
  ],
  "release-ocr-smoke": [
    ["соль\\1.11\\15.jpg", 57.739690, 40.964100],
    ["проверка\\5.jpg", 67.272343, 32.450791],
    ["проверка\\11.jpg", 67.273701, 32.450428],
    ["проверка\\17.jpg", 67.273905, 32.452553]
  ]
};
const samples = datasets[dataset];
if (!samples) throw new Error(`Неизвестный набор: ${dataset}`);
const files = samples.map(([name]) => path.resolve(directory, name));
for (const file of files) if (!fs.existsSync(file)) throw new Error(`Нет тестового файла: ${file}`);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  let page;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) break;
    } catch {}
    await sleep(250);
  }
  if (!page) throw new Error("Не удалось подключиться к Electron.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const runtimeErrors = [];
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      const values = (message.params?.args || []).map((item) => item.value ?? item.description).filter(Boolean);
      if (message.params?.type === "error") runtimeErrors.push(values.join(" "));
      if (values[0] === "[ocr-stage]") {
        if (!quiet) console.error(values.join(" "));
      }
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
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
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Ошибка в окне приложения");
    return response.result?.value;
  };
  await Promise.all([send("Runtime.enable"), send("DOM.enable")]);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#fileInput'))")) break;
    await sleep(250);
  }
  await evaluate("if (Array.isArray(window.__ocrDebug)) window.__ocrDebug.length = 0; document.querySelector('#clearButton')?.click(); if (document.querySelector('#notice')) document.querySelector('#notice').textContent = ''");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await evaluate("document.querySelectorAll('.point-card').length === 0")) break;
    await sleep(100);
  }
  const documentNode = await send("DOM.getDocument", { depth: 1 });
  const input = await send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#fileInput" });
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files });

  let snapshot;
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    snapshot = await evaluate(`(() => ({
      notice: document.querySelector('#notice')?.textContent?.trim() || '',
      names: Array.from(document.querySelectorAll('.point-card h4')).map((row) => row.textContent?.trim() || ''),
      coordinates: Array.from(document.querySelectorAll('.point-card')).map((row) => row.querySelector('.coordinates')?.textContent?.trim() || ''),
      debug: window.__ocrDebug || []
    }))()`);
    const expectedNames = samples.map((sample) => path.basename(sample[0]));
    const startedPoints = snapshot.debug.filter((entry) => entry?.pass === "stage" && entry.stage === "point-start").length;
    if (snapshot.coordinates.length === samples.length &&
        snapshot.names.every((name, index) => name === expectedNames[index]) &&
        startedPoints >= samples.length &&
        /^(?:Готово|Координаты распознаны)/.test(snapshot.notice)) break;
    if (/Не удалось запустить OCR/.test(snapshot.notice)) break;
    if (!quiet && attempt > 0 && attempt % 20 === 0) {
      console.error(JSON.stringify({ attempt, notice: snapshot.notice, coordinates: snapshot.coordinates, runtimeErrors }));
    }
    await sleep(500);
  }
  const parsed = snapshot.coordinates.map((text) => {
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  });
  const failures = samples.flatMap((sample, index) => {
    const actual = parsed[index];
    if (sample[1] === null && sample[2] === null) {
      return actual === null ? [] : [{ file: sample[0], expected: [null, null], actual, shown: snapshot.coordinates[index] }];
    }
    if (actual && Math.abs(actual[0] - sample[1]) < 0.000002 && Math.abs(actual[1] - sample[2]) < 0.000002) return [];
    return [{ file: sample[0], expected: sample.slice(1), actual, shown: snapshot.coordinates[index] }];
  });
  const consensusDebug = snapshot.debug
    .filter((entry) => typeof entry?.pass === "string" && entry.pass.startsWith("small-overlay"));
  const topBannerDebug = snapshot.debug
    .filter((entry) => typeof entry?.pass === "string" && entry.pass.startsWith("top-banner"));
  const universalDebug = snapshot.debug
    .filter((entry) => typeof entry?.pass === "string" && entry.pass.startsWith("universal-region") && /\d{2}[.,]\d{3}/.test(String(entry.text || "")))
    .map((entry) => ({ pass: entry.pass, text: String(entry.text || "").slice(0, 600) }));
  console.log(JSON.stringify({
    passed: failures.length === 0,
    coordinates: parsed,
    failures,
    notice: snapshot.notice,
    runtimeErrors,
    debug: failures.length ? { top: topBannerDebug, universal: universalDebug } : undefined
  }, null, 2));
  socket.close();
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
