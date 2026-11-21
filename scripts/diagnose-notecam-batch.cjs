"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createWorker } = require("tesseract.js");
const { langPath } = require("@tesseract.js-data/rus");
const core = require("../core.js");

const directory = process.argv[2];
if (!directory || !fs.statSync(directory).isDirectory()) {
  throw new Error("Укажите папку с JPEG- или PNG-фотографиями.");
}

async function main() {
  const files = fs.readdirSync(directory)
    .filter((name) => /^\d+\.(?:jpe?g|png)$/i.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const worker = await createWorker("rus", 1, { langPath });
  try {
    for (const name of files) {
      const file = path.join(directory, name);
      const primary = await worker.recognize(file, { rectangle: {
        left: 0, top: 1024, width: 652, height: 256
      } });
      const parsed = core.extractCoordinatesFromText(primary.data.text);
      console.log(JSON.stringify({
        name,
        coordinates: core.hasCoordinates(parsed) ? [parsed.latitude, parsed.longitude] : null,
        text: primary.data.text.replace(/\s+/g, " ").trim()
      }));
    }
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
