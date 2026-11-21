"use strict";

const crypto = require("node:crypto");

const TILE_ORIGIN = "https://tiles.api-maps.yandex.ru";
const TILE_PATH = "/v1/tiles/";
const APP_REFERER = "http://local.coordinate-meter.ymapapp";

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function utcHour(date = new Date()) {
  return date.toISOString().replace(/:\d{2}:\d{2}\.\d{3}Z$/, ":00:00Z");
}

function tileNumber(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`Некорректный параметр тайла: ${name}`);
  }
  return parsed;
}

function buildTilePath(apiKey, x, y, z) {
  const zoom = tileNumber(z, 0, 20, "z");
  const upper = (2 ** zoom) - 1;
  const tileX = tileNumber(x, 0, upper, "x");
  const tileY = tileNumber(y, 0, upper, "y");
  const query = new URLSearchParams({
    x: String(tileX),
    y: String(tileY),
    z: String(zoom),
    lang: "ru_RU",
    l: "map",
    projection: "web_mercator",
    maptype: "map",
    apikey: apiKey
  });
  return `${TILE_PATH}?${query}`;
}

function buildSignedTileUrl(credentials, x, y, z, now = new Date()) {
  if (!credentials || !credentials.apiKey || !credentials.signingSecret) {
    throw new Error("Ключ Яндекс Tiles API не настроен");
  }
  const path = buildTilePath(credentials.apiKey, x, y, z);
  const secret = decodeBase64Url(credentials.signingSecret);
  if (secret.length < 16) throw new Error("Секрет подписи Яндекс Tiles API поврежден");
  const temporalSecret = crypto.createHmac("sha256", secret).update(utcHour(now)).digest();
  const signature = encodeBase64Url(crypto.createHmac("sha256", temporalSecret).update(path).digest());
  return `${TILE_ORIGIN}${path}&signature=${encodeURIComponent(signature)}`;
}

function loadCredentials() {
  try {
    const value = require("./yandex-tiles.secrets.cjs");
    return value && value.apiKey && value.signingSecret ? value : null;
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND" && String(error.message).includes("yandex-tiles.secrets.cjs")) return null;
    throw error;
  }
}

module.exports = { APP_REFERER, buildSignedTileUrl, loadCredentials, utcHour };
