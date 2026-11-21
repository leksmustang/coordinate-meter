"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { APP_REFERER, buildSignedTileUrl, loadCredentials } = require("../electron/yandex-tiles.cjs");

(async () => {
  const platform = process.argv[2] || "windows";
  const credentials = platform === "android"
    ? JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".secrets", "yandex-tiles.json"), "utf8")).android
    : loadCredentials();
  if (!new Set(["windows", "android"]).has(platform)) throw new Error("Use platform windows or android");
  if (!credentials) throw new Error("Сначала выполните: node scripts/configure-yandex-tiles.cjs");
  const url = buildSignedTileUrl(credentials, 9902, 5137, 14);
  const response = await fetch(url, {
    headers: {
      Accept: "image/png",
      Referer: APP_REFERER,
      "User-Agent": "CoordinateMeter/1.5.7 validation"
    },
    signal: AbortSignal.timeout(20000)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.startsWith("image/") || bytes.length === 0) {
    const detail = bytes.toString("utf8", 0, Math.min(bytes.length, 200)).replace(/[^\x20-\x7EА-Яа-яЁё]/g, " ").trim();
    throw new Error(`Tiles API validation failed: HTTP ${response.status}, ${contentType || "unknown type"}, ${bytes.length} bytes${detail ? `, ${detail}` : ""}`);
  }
  console.log(`Tiles API ${platform} validation passed: HTTP ${response.status}, ${contentType}, ${bytes.length} bytes`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
