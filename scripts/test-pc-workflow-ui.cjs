"use strict";

const assert = require("node:assert/strict");

const port = Number(process.argv[2] || 9282);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const page = pages.find(item => item.type === "page" && item.webSocketDebuggerUrl);
  if (!page) throw new Error("Нет тестового окна Electron");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
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
  const evaluate = async expression => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  try {
    if (process.argv.includes("--default-only")) {
      assert.equal(await evaluate("document.querySelector('#allPairsFilter').value"), "all");
      console.log(JSON.stringify({ passed: true, defaultFilter: "all" }));
      return;
    }
    assert.equal(await evaluate("document.querySelectorAll('.point-card').length"), 2);
    assert.equal(await evaluate("document.querySelector('#allPairsPanel').classList.contains('hidden')"), false);
    assert.match(await evaluate("document.querySelector('#allPairsSummary').textContent"), /1 пара/);
    await evaluate("document.querySelector('#allPairsFilter').value = 'all'; document.querySelector('#allPairsFilter').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelectorAll('.all-pair').length"), 1);
    await evaluate("document.querySelector('.all-pair button').click()");
    assert.notEqual(await evaluate("document.querySelector('#pairDistance').textContent"), "—");

    await evaluate("if (document.querySelector('#areaOcrDialog').open) document.querySelector('#areaOcrDialog').close(); document.querySelector('.point-card .retry-ocr').click()");
    const bounds = await evaluate(`(() => { const image = document.querySelector('#areaOcrImage'); const r = image.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, loaded: image.naturalWidth > 0 }; })()`);
    assert.ok(bounds.loaded && bounds.width > 0 && bounds.height > 0);
    const start = { x: bounds.x + bounds.width * .005, y: bounds.y + bounds.height * .832 };
    const end = { x: bounds.x + bounds.width * .44, y: bounds.y + bounds.height * .895 };
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1 });
    assert.equal(await evaluate("document.querySelector('#runAreaOcr').disabled"), false);
    await evaluate("document.querySelector('#runAreaOcr').click()");
    let result;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      result = await evaluate(`(() => ({
        visible: !document.querySelector('#areaOcrResult').classList.contains('hidden'),
        values: Array.from(document.querySelector('#areaOcrCandidates').options).map(option => option.textContent),
        status: document.querySelector('#areaOcrStatus').textContent
      }))()`);
      if (result.visible || /Не удалось/.test(result.status)) break;
      await sleep(500);
    }
    assert.equal(result.visible, true, result.status);
    const expected = result.values.findIndex(value => value.includes("67.571935, 30.501897"));
    assert.ok(expected >= 0, JSON.stringify({ ...result, debug: await evaluate("window.__ocrDebug.filter(entry => entry.pass?.startsWith('area-'))") }));
    await evaluate(`document.querySelector('#areaOcrCandidates').value = '${expected}'; document.querySelector('#areaOcrCandidates').dispatchEvent(new Event('change')); document.querySelector('#applyAreaOcr').click()`);
    assert.equal(await evaluate("document.querySelector('#areaOcrDialog').open"), false);
    assert.equal(await evaluate("document.querySelector('.point-card .coordinates').textContent"), "67.571935, 30.501897");
    console.log(JSON.stringify({ passed: true, pairCount: 1, selectedAreaRecognized: true }));
  } finally {
    socket.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
