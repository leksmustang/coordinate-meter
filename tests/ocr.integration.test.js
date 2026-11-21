const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createWorker } = require("tesseract.js");
const { langPath } = require("@tesseract.js-data/rus");
const core = require("../core.js");

test("legacy raw-crop OCR still reads representative NoteCam photos", { timeout: 60000 }, async () => {
  const worker = await createWorker("rus", 1, { langPath });
  try {
    const samples = [
      ["D:\\Рабочий стол\\Клады\\шиш 1г", "IMG_3887.jpeg.jpg", 1125, 1500, 67.571935, 30.501897],
      ["D:\\Рабочий стол\\Клады\\шиш 1г", "IMG_3889.jpeg.jpg", 1125, 1500, 67.572404, 30.501809],
      ["D:\\Рабочий стол\\Клады\\амф 2", "104565.jpg", 960, 1280, 67.286694, 32.447859],
      ["D:\\Рабочий стол\\Клады\\амф 2", "104566.jpg", 960, 1280, 67.288241, 32.442686],
      ["D:\\Рабочий стол\\Клады\\амф 2", "104567.jpg", 960, 1280, 67.288318, 32.445000],
      // 104568 needs the browser canvas threshold consensus and is covered by test-ocr-batch-ui.cjs.
      ["D:\\Рабочий стол\\Клады\\амф 2", "104569.jpg", 960, 1280, 67.286871, 32.447219]
    ];
    for (const [directory, name, width, height, expectedLat, expectedLon] of samples) {
      const image = path.join(directory, name);
      const result = await worker.recognize(image, { rectangle: {
        left: 0, top: Math.floor(height * 0.80), width: Math.floor(width * 0.68), height: Math.ceil(height * 0.20)
      } });
      let parsed = core.extractCoordinatesFromText(result.data.text);
      if (!core.hasCoordinates(parsed) || Math.abs(parsed.latitude) < 10) {
        const fallbackResult = await worker.recognize(image, { rectangle: {
          left: 0, top: Math.floor(height * 0.84), width: Math.floor(width * 0.52), height: Math.ceil(height * 0.16)
        } });
        parsed = core.chooseOcrCandidate(parsed, core.extractCoordinatesFromText(fallbackResult.data.text));
      }
      assert.ok(Math.abs(parsed.latitude - expectedLat) < 0.000002, `${name}: ${result.data.text}`);
      assert.ok(Math.abs(parsed.longitude - expectedLon) < 0.000002, `${name}: ${result.data.text}`);
    }
  } finally {
    await worker.terminate();
  }
});
