import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Clipboard } from "@capacitor/clipboard";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const YandexTiles = registerPlugin("YandexTiles");

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "yandex.ru"
      && (url.pathname.startsWith("/maps") || url.pathname === "/legal/maps_termsofuse");
  } catch (_error) {
    return false;
  }
}

function overpassQuery(latitude, longitude, radius) {
  const around = `(around:${Math.round(radius)},${latitude},${longitude})`;
  return `[out:json][timeout:25];(
    nwr${around}["amenity"="police"];
    nwr${around}["name"~"МВД|МВД России|ОВД|полици",i];
    nwr${around}["name"~"ФСБ|Федеральн.*безопасност",i];
    nwr${around}["leisure"="playground"];
    nwr${around}["amenity"="kindergarten"];
    nwr${around}["amenity"="school"];
  );out center tags;`;
}

async function fetchPois(latitude, longitude, radius) {
  const query = overpassQuery(latitude, longitude, radius);
  let lastError;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const response = await CapacitorHttp.get({
        url: endpoint,
        params: { data: query },
        headers: { Accept: "application/json" },
        connectTimeout: 30000,
        readTimeout: 30000,
        responseType: "json"
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`Overpass HTTP ${response.status}`);
      const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
      return { elements: Array.isArray(data?.elements) ? data.elements : [], radius };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Картографический сервис временно недоступен.");
}

window.CoordinateMobile = {
  isNative: Capacitor.isNativePlatform(),
  async openExternal(url) {
    if (!isAllowedExternalUrl(url)) throw new Error("Внешняя ссылка не разрешена");
    await Browser.open({ url, toolbarColor: "#101715" });
  },
  async copyText(value) {
    await Clipboard.write({ string: value, label: "GPS-координаты" });
  },
  async getYandexTile(x, y, z) {
    const result = await YandexTiles.getTile({ x, y, z });
    if (!result?.dataUrl?.startsWith("data:image/")) throw new Error("Некорректный тайл карты");
    return result.dataUrl;
  },
  fetchPois,
  async shareCsv(csv, filename) {
    const result = await Filesystem.writeFile({
      path: filename,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });
    await Share.share({
      title: "Координаты маршрута",
      text: "CSV-файл с координатами маршрута",
      url: result.uri,
      dialogTitle: "Сохранить или отправить CSV"
    });
  }
};
