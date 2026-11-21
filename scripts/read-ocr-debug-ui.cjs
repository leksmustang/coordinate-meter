"use strict";

const port = Number(process.argv[2] || 9237);
const top = process.argv.includes("--top");

async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!page) throw new Error("Не найдено окно Electron с включённой отладкой.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result.result.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        expression: top
          ? `(() => (window.__ocrDebug || []).filter((entry) => entry.pass?.startsWith('top-banner')).map((entry) => ({ pass: entry.pass, text: entry.text, candidates: entry.candidates, chosen: entry.chosen })))()`
          : `(() => (window.__ocrDebug || [])
            .filter((entry) => entry.pass === 'small-overlay-consensus')
            .map((entry, index) => ({ index: index + 1, candidates: entry.candidates, chosen: entry.chosen })))()`
      }
    }));
  });
  socket.close();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
