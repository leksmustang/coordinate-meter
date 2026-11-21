"use strict";

const { app, BrowserWindow, session, shell, clipboard } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { yandexMapsUrl } = require("./map-links.cjs");
const { APP_REFERER, buildSignedTileUrl, loadCredentials } = require("./yandex-tiles.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8"
};
const APP_USER_AGENT = "CoordinateMeter/1.5.11 (Windows route planner)";
const TILE_INTERVAL_MS = 125;
const EXTERNAL_URLS = Object.freeze({
  maps: "https://yandex.ru/maps/",
  terms: "https://yandex.ru/legal/maps_termsofuse"
});
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://overpass-api.de https://overpass.kumi.systems",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join("; ");
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

let localServer;
let localHost;
let nextTileRequestAt = 0;
const isE2E = process.argv.includes("--e2e") || app.commandLine.hasSwitch("e2e");
const isTestInstance = process.argv.includes("--test-instance") || app.commandLine.hasSwitch("test-instance");
const isAutomation = isE2E || isTestInstance;
if (isAutomation) {
  if (isE2E) app.disableHardwareAcceleration();
  const e2eUserData = path.join(app.getPath("temp"), `coordinate-meter-test-${process.pid}`);
  fs.mkdirSync(e2eUserData, { recursive: true });
  app.setPath("userData", e2eUserData);
}

function rejectUntrustedRequest(request, response, apiRequest) {
  if (!localHost || request.headers.host !== localHost) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }
  if (apiRequest && request.headers["sec-fetch-site"] !== "same-origin") {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }
  return false;
}

async function waitForTileSlot() {
  const now = Date.now();
  const scheduled = Math.max(now, nextTileRequestAt);
  nextTileRequestAt = scheduled + TILE_INTERVAL_MS;
  const delay = scheduled - now;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function startLocalServer() {
  const appRoot = app.getAppPath();
  return new Promise((resolve, reject) => {
    localServer = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const rawPath = requestUrl.pathname;
      if (rejectUntrustedRequest(request, response, rawPath.startsWith("/api/"))) return;
      if (rawPath === "/api/pois") {
        await servePois(requestUrl, response);
        return;
      }
      if (rawPath === "/api/open-yandex") {
        await openYandexMaps(request, requestUrl, response);
        return;
      }
      if (rawPath === "/api/open-external") {
        await openAllowedExternal(request, requestUrl, response);
        return;
      }
      if (rawPath === "/api/yandex-tile") {
        await serveYandexTile(request, requestUrl, response);
        return;
      }
      const requested = rawPath === "/" ? "/index.html" : rawPath;
      const relative = decodeURIComponent(requested).replace(/^[/\\]+/, "");
      const filePath = path.resolve(appRoot, relative);
      const insideApp = filePath === appRoot || filePath.startsWith(`${appRoot}${path.sep}`);
      if (!insideApp) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Content-Length": data.length,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "Referrer-Policy": "no-referrer"
        });
        response.end(data);
      });
    });
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", () => {
      const address = localServer.address();
      localHost = `127.0.0.1:${address.port}`;
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function openAllowedExternal(request, requestUrl, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Метод не поддерживается" });
    return;
  }
  const url = EXTERNAL_URLS[requestUrl.searchParams.get("target")];
  if (!url) {
    sendJson(response, 400, { error: "Ссылка не разрешена" });
    return;
  }
  try {
    if (!isAutomation) await shell.openExternal(url, { activate: true });
    sendJson(response, 200, { opened: true });
  } catch (error) {
    console.error("Failed to open allowed external URL", error);
    sendJson(response, 500, { error: "Не удалось открыть браузер" });
  }
}

async function serveYandexTile(request, requestUrl, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Метод не поддерживается" });
    return;
  }
  const credentials = loadCredentials();
  if (!credentials) {
    sendJson(response, 503, { error: "Яндекс Tiles API не настроен в этой сборке" });
    return;
  }
  try {
    await waitForTileSlot();
    const tileUrl = buildSignedTileUrl(
      credentials,
      requestUrl.searchParams.get("x"),
      requestUrl.searchParams.get("y"),
      requestUrl.searchParams.get("z")
    );
    const upstream = await fetch(tileUrl, {
      method: "GET",
      headers: { Accept: "image/png", Referer: APP_REFERER, "User-Agent": APP_USER_AGENT },
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) throw new Error(`Tiles API HTTP ${upstream.status}`);
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) throw new Error("Tiles API returned a non-image response");
    const data = Buffer.from(await upstream.arrayBuffer());
    if (!data.length || data.length > 2 * 1024 * 1024) throw new Error("Invalid tile size");
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin"
    });
    response.end(data);
  } catch (error) {
    console.error("Yandex tile request failed", error?.message || error);
    sendJson(response, 502, { error: "Не удалось загрузить тайл Яндекс Карт" });
  }
}

async function openYandexMaps(request, requestUrl, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Метод не поддерживается" });
    return;
  }
  const latitude = Number(requestUrl.searchParams.get("lat"));
  const longitude = Number(requestUrl.searchParams.get("lon"));
  const url = yandexMapsUrl(latitude, longitude);
  if (!url) {
    sendJson(response, 400, { error: "Некорректные координаты" });
    return;
  }
  try {
    if (!isAutomation) {
      clipboard.writeText(`${latitude.toFixed(7)}, ${longitude.toFixed(7)}`);
      await shell.openExternal(url, { activate: true });
    }
    sendJson(response, 200, { opened: true, copied: !isAutomation, url });
  } catch (error) {
    console.error("Failed to open Yandex Maps", error);
    sendJson(response, 500, { error: "Не удалось открыть браузер" });
  }
}

async function servePois(requestUrl, response) {
  const latitude = Number(requestUrl.searchParams.get("lat"));
  const longitude = Number(requestUrl.searchParams.get("lon"));
  const radius = Math.min(25000, Math.max(500, Number(requestUrl.searchParams.get("radius")) || 10000));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    sendJson(response, 400, { error: "Некорректные координаты" });
    return;
  }
  const around = `(around:${Math.round(radius)},${latitude},${longitude})`;
  const query = `[out:json][timeout:25];(
    nwr${around}["amenity"="police"];
    nwr${around}["name"~"МВД|МВД России|ОВД|полици",i];
    nwr${around}["name"~"ФСБ|Федеральн.*безопасност",i];
    nwr${around}["leisure"="playground"];
    nwr${around}["amenity"="kindergarten"];
    nwr${around}["amenity"="school"];
  );out center tags;`;
  let lastError;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": APP_USER_AGENT,
          "Accept": "application/json"
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30000)
      });
      if (!upstream.ok) throw new Error(`Overpass HTTP ${upstream.status}`);
      const data = await upstream.json();
      sendJson(response, 200, { elements: Array.isArray(data.elements) ? data.elements : [], radius });
      return;
    } catch (error) {
      lastError = error;
      console.error("POI request failed", endpoint, error);
    }
  }
  console.error("All POI providers failed", lastError);
  sendJson(response, 502, { error: "Картографический сервис временно недоступен. Проверьте интернет и повторите попытку." });
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  response.end(body);
}

async function createWindow() {
  const localUrl = await startLocalServer();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: "#0c1210",
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    title: "Координатный измеритель",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false
    }
  });
  window.webContents.setUserAgent(APP_USER_AGENT);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localUrl)) event.preventDefault();
  });
  if (!isAutomation) window.once("ready-to-show", () => window.show());
  await window.loadURL(isAutomation ? `${localUrl}?e2e=1` : localUrl);
}

if (!isAutomation && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (localServer) localServer.close();
  });
}
