"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, ".secrets", "yandex-tiles.json");
const windowsPath = path.join(root, "electron", "yandex-tiles.secrets.cjs");
const androidPath = path.join(root, "android", "app", "src", "main", "java", "ru", "coordinate", "meter", "YandexTilesSecrets.java");

function readSecretConfig() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Не найден или поврежден файл ${sourcePath}. Ключи не будут записаны в исходный код.`);
  }
  for (const platform of ["windows", "android"]) {
    if (!parsed?.[platform]?.apiKey || !parsed?.[platform]?.signingSecret) {
      throw new Error(`В защищенном файле отсутствуют данные для платформы ${platform}.`);
    }
  }
  return parsed;
}

function javaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const config = readSecretConfig();
fs.writeFileSync(windowsPath,
  `"use strict";\nmodule.exports = Object.freeze(${JSON.stringify(config.windows)});\n`,
  { encoding: "utf8", mode: 0o600 });

fs.writeFileSync(androidPath, `package ru.coordinate.meter;

final class YandexTilesSecrets {
    static final String API_KEY = "${javaString(config.android.apiKey)}";
    static final String SIGNING_SECRET = "${javaString(config.android.signingSecret)}";
    private YandexTilesSecrets() {}
}
`, { encoding: "utf8", mode: 0o600 });

console.log("Защищенные настройки Яндекс Tiles API подготовлены для Windows и Android.");
