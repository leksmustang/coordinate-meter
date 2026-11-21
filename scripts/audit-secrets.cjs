"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, ".secrets", "yandex-tiles.json");
const publicTargets = [
  "app.js",
  "core.js",
  "index.html",
  "styles.css",
  "mobile",
  "www",
  path.join("android", "app", "src", "main", "assets", "public")
];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    walk(path.join(target, entry.name)));
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const sensitiveValues = [
  config?.windows?.apiKey,
  config?.windows?.signingSecret,
  config?.android?.apiKey,
  config?.android?.signingSecret
].filter((value) => typeof value === "string" && value.length >= 8);

if (sensitiveValues.length !== 4) {
  throw new Error("Защищенная конфигурация неполна; аудит остановлен.");
}

const leaks = [];
for (const relative of publicTargets) {
  for (const file of walk(path.join(root, relative))) {
    const content = fs.readFileSync(file);
    if (sensitiveValues.some((value) => content.includes(Buffer.from(value)))) {
      leaks.push(path.relative(root, file));
    }
  }
}

if (leaks.length) {
  console.error("ОШИБКА: секретные данные обнаружены в публичных ресурсах:");
  for (const file of leaks) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log("OK: ключи и секреты отсутствуют в публичных HTML/JS-ресурсах.");
}

const pnpmPath = path.join(root, "node_modules", ".pnpm");
const asarCandidates = [
  path.join(root, "dist", "win-unpacked", "resources", "app.asar"),
  path.join(root, ".windows-build-app", "dist", "win-unpacked", "resources", "app.asar")
].filter((candidate) => fs.existsSync(candidate));
if (asarCandidates.length && fs.existsSync(pnpmPath)) {
  const asarPackage = fs.readdirSync(pnpmPath).find((name) => name.startsWith("@electron+asar@"));
  if (asarPackage) {
    const asar = require(path.join(pnpmPath, asarPackage, "node_modules", "@electron", "asar"));
    for (const asarPath of asarCandidates) {
      const packedPublicFiles = ["app.js", "core.js", "index.html", "styles.css"];
      const packedLeaks = packedPublicFiles.filter((file) => {
        const content = asar.extractFile(asarPath, file);
        return sensitiveValues.some((value) => content.includes(Buffer.from(value)));
      });
      const entries = asar.listPackage(asarPath);
      if (entries.some((entry) => entry.split(/[\\/]/).includes(".secrets"))) {
        throw new Error("ОШИБКА: исходный каталог .secrets попал в Windows-пакет.");
      }
      const backendCredentials = asar.extractFile(asarPath, "electron/yandex-tiles.secrets.cjs");
      if (!backendCredentials.includes(Buffer.from(config.windows.apiKey))
          || !backendCredentials.includes(Buffer.from(config.windows.signingSecret))
          || backendCredentials.includes(Buffer.from(config.android.apiKey))
          || backendCredentials.includes(Buffer.from(config.android.signingSecret))) {
        throw new Error("ОШИБКА: Windows-пакет содержит неверный набор учетных данных.");
      }
      if (packedLeaks.length) {
        throw new Error(`ОШИБКА: секретные данные попали в упакованные публичные ресурсы: ${packedLeaks.join(", ")}`);
      }
      console.log(`OK: Windows-пакет ${path.relative(root, asarPath)} содержит только свой ключ в закрытой серверной части Electron.`);
    }
  }
}

const androidCredentialsPath = path.join(root, "android", "app", "src", "main", "java", "ru", "coordinate", "meter", "YandexTilesSecrets.java");
if (fs.existsSync(androidCredentialsPath)) {
  const androidCredentials = fs.readFileSync(androidCredentialsPath);
  if (!androidCredentials.includes(Buffer.from(config.android.apiKey))
      || !androidCredentials.includes(Buffer.from(config.android.signingSecret))
      || androidCredentials.includes(Buffer.from(config.windows.apiKey))
      || androidCredentials.includes(Buffer.from(config.windows.signingSecret))) {
    throw new Error("ОШИБКА: Android-сборка содержит неверный набор учетных данных.");
  }
  console.log("OK: Android нативная часть содержит только отдельный Android-ключ.");
}
