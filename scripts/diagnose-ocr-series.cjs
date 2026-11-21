"use strict";

const path = require("node:path");
const { createWorker } = require("tesseract.js");
const useEnglish = process.argv.includes("--eng");
const useCombined = process.argv.includes("--combo");
const packageLanguage = require(useEnglish ? "@tesseract.js-data/eng" : "@tesseract.js-data/rus");
const langPath = useCombined ? path.join(__dirname, "..", ".ocr-debug", "lang") : packageLanguage.langPath;
const core = require("../core.js");

const useMasks = process.argv.includes("--masks");
const maskTagArg = process.argv.find((value) => value.startsWith("--mask-tag="));
const maskTag = maskTagArg ? maskTagArg.slice("--mask-tag=".length) : "strict";
const onlyArg = process.argv.find((value) => value.startsWith("--only="));
const onlyNames = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
const noWhitelist = process.argv.includes("--no-whitelist");
const directory = process.argv[2] && process.argv[2] !== "--masks"
  ? process.argv[2]
  : (useMasks ? path.join(__dirname, "..", ".ocr-debug") : "D:\\Рабочий стол\\Клады\\проверка");
const samples = [
  ["1.jpg", 67.536570, 30.555979],
  ["2.jpg", 67.536477, 30.556022],
  ["3.jpg", 67.536259, 30.555860],
  ["4.jpg", 67.537244, 30.552567],
  ["5.jpg", 67.537591, 30.548725],
  ["6.jpg", 67.537654, 30.548055],
  ["7.jpg", 67.537497, 30.549373]
];

const rawVariants = [
  ["bottom-25-psm11", "11", { left: 0, top: 768, width: 768, height: 256 }],
  ["bottom-20-psm6", "6", { left: 0, top: 819, width: 768, height: 205 }],
  ["coordinate-row-psm7", "7", { left: 0, top: 820, width: 768, height: 92 }]
];
const maskedVariants = [
  ["strict-row-psm7", "7", null],
  ["strict-row-psm13", "13", null],
  ["strict-row-psm6", "6", null]
];

async function main() {
  const worker = await createWorker(useCombined ? "rus+eng" : (useEnglish ? "eng" : "rus"), 1, { langPath });
  const report = [];
  try {
    for (const [name, expectedLatitude, expectedLongitude] of samples) {
      if (onlyNames && !onlyNames.has(name)) continue;
      const image = path.join(directory, useMasks ? name.replace(/\.jpg$/i, `-${maskTag}-row.png`) : name);
      const attempts = [];
      for (const [variant, psm, rectangle] of useMasks ? maskedVariants : rawVariants) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: noWhitelist ? "" : "0123456789+-,.; ",
          classify_bln_numeric_mode: process.argv.includes("--numeric") ? "1" : "0"
        });
        const result = rectangle ? await worker.recognize(image, { rectangle }) : await worker.recognize(image);
        const parsed = core.extractCoordinatesFromText(result.data.text);
        attempts.push({
          variant,
          text: result.data.text.replace(/\s+/g, " ").trim(),
          parsed: core.hasCoordinates(parsed) ? [parsed.latitude, parsed.longitude] : null,
          exact: core.hasCoordinates(parsed)
            && Math.abs(parsed.latitude - expectedLatitude) < 0.000002
            && Math.abs(parsed.longitude - expectedLongitude) < 0.000002
        });
      }
      report.push({ name, expected: [expectedLatitude, expectedLongitude], attempts });
      console.log(JSON.stringify(report.at(-1)));
    }
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
