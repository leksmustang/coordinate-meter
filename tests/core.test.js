const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../core.js");
const { yandexMapsUrl } = require("../electron/map-links.cjs");
const { buildSignedTileUrl, utcHour } = require("../electron/yandex-tiles.cjs");

test("accepts JPEG and PNG images and rejects unrelated files", () => {
  assert.equal(core.isSupportedImageFile({ name: "route.JPG", type: "" }), true);
  assert.equal(core.isSupportedImageFile({ name: "route.jpeg", type: "application/octet-stream" }), true);
  assert.equal(core.isSupportedImageFile({ name: "route.PNG", type: "" }), true);
  assert.equal(core.isSupportedImageFile({ name: "clipboard", type: "image/png" }), true);
  assert.equal(core.isSupportedImageFile({ name: "route.webp", type: "image/webp" }), false);
  assert.equal(core.isSupportedImageFile({ name: "route.gif", type: "image/gif" }), false);
});

test("compares every unique valid point pair, including non-neighbours", () => {
  const points = [
    { latitude: 55, longitude: 37 },
    { latitude: null, longitude: null },
    { latitude: 55.0001, longitude: 37 },
    { latitude: 55.01, longitude: 37 }
  ];
  const pairs = core.allPairDistances(points);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.map(({ firstIndex, secondIndex }) => [firstIndex, secondIndex]).sort(), [[0, 2], [0, 3], [2, 3]]);
  assert.ok(pairs[0].distance < 25);
  assert.ok(pairs[1].distance > 25);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ latitude: 55 + index * .0001, longitude: 37 }));
  assert.equal(core.allPairDistances(hundred).length, 4950);
});

test("recognizes a PNG container without EXIF and sends it to OCR", () => {
  const pngHeader = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82
  ]);
  const exif = core.readExif(pngHeader.buffer);
  assert.equal(exif.latitude, null);
  assert.equal(exif.longitude, null);
  assert.match(exif.error, /PNG/);
});

test("reads GPS coordinates from a PNG eXIf chunk", () => {
  const tiff = new ArrayBuffer(128);
  const view = new DataView(tiff);
  view.setUint8(0, 0x49); view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true); view.setUint16(12, 4, true); view.setUint32(14, 1, true); view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  view.setUint16(26, 4, true);
  const writeEntry = (offset, tag, type, count, value) => {
    view.setUint16(offset, tag, true); view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true); view.setUint32(offset + 8, value, true);
  };
  writeEntry(28, 1, 2, 2, 0x0000004e);
  writeEntry(40, 2, 5, 3, 80);
  writeEntry(52, 3, 2, 2, 0x00000045);
  writeEntry(64, 4, 5, 3, 104);
  view.setUint32(76, 0, true);
  const writeRational = (offset, numerator, denominator) => {
    view.setUint32(offset, numerator, true); view.setUint32(offset + 4, denominator, true);
  };
  writeRational(80, 67, 1); writeRational(88, 34, 1); writeRational(96, 18966, 1000);
  writeRational(104, 30, 1); writeRational(112, 30, 1); writeRational(120, 68292, 10000);
  const png = new Uint8Array(8 + 12 + tiff.byteLength + 12);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const pngView = new DataView(png.buffer);
  pngView.setUint32(8, tiff.byteLength, false);
  png.set([0x65, 0x58, 0x49, 0x66], 12);
  png.set(new Uint8Array(tiff), 16);
  const iend = 20 + tiff.byteLength;
  pngView.setUint32(iend, 0, false);
  png.set([0x49, 0x45, 0x4e, 0x44], iend + 4);
  const exif = core.readExif(png.buffer);
  assert.ok(Math.abs(exif.latitude - 67.571935) < 1e-9);
  assert.ok(Math.abs(exif.longitude - 30.501897) < 1e-9);
  assert.equal(exif.error, null);
});

test("WGS-84 distance for the coordinates printed in the sample images", () => {
  const first = { latitude: 67.571935, longitude: 30.501897 };
  const second = { latitude: 67.572404, longitude: 30.501809 };
  const distance = core.distanceWgs84(first, second);
  assert.ok(distance > 52 && distance < 53, `unexpected distance ${distance}`);
});

test("detects that supplied JPEG samples have no usable EXIF GPS values", () => {
  const sourceDir = "D:\\Рабочий стол\\Клады\\шиш 1г";
  const samples = [
    "IMG_3887.jpeg.jpg",
    "IMG_3889.jpeg.jpg"
  ];
  for (const name of samples) {
    const buffer = fs.readFileSync(path.join(sourceDir, name));
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const exif = core.readExif(arrayBuffer);
    assert.equal(exif.latitude, null);
    assert.equal(exif.longitude, null);
    assert.match(exif.error, /GPS/);
  }
});

test("extracts Russian NoteCam coordinates, including a decimal point missed by OCR", () => {
  const parsed = core.extractCoordinatesFromText(`
    Широта: 67571935
    Долгота: 30.501897
    Возвышение: 255.97+10.24 м
    Точность: 4.97 м
    Время: 18-10-2026 14:42:18
  `);
  assert.equal(parsed.latitude, 67.571935);
  assert.equal(parsed.longitude, 30.501897);
  assert.equal(parsed.altitude, 255.97);
  assert.equal(parsed.accuracy, 4.97);
  assert.equal(parsed.capturedAt, "18-10-2026 14:42:18");
});

test("repairs common NoteCam OCR punctuation and missing decimal in accuracy", () => {
  const parsed = core.extractCoordinatesFromText("Широта: 67287582\nДолгота: 32445985\nТочность: 475 м");
  assert.equal(parsed.latitude, 67.287582);
  assert.equal(parsed.longitude, 32.445985);
  assert.equal(parsed.accuracy, 4.75);
});

test("extracts an unlabeled WGS84 coordinate pair from a top camera banner", () => {
  const parsed = core.extractCoordinatesFromText("WGS84 ±7м 57.74620, 40.97442 /\\ м ±6м 110");
  assert.equal(parsed.latitude, 57.74620);
  assert.equal(parsed.longitude, 40.97442);
});

test("extracts a signed coordinate pair separated only by whitespace", () => {
  const parsed = core.extractCoordinatesFromText("+67.536477 +30.556022");
  assert.equal(parsed.latitude, 67.536477);
  assert.equal(parsed.longitude, 30.556022);
});

test("extracts adjacent signed coordinates from noisy full-frame OCR", () => {
  const parsed = core.extractCoordinatesFromText("3\n6\n3 167.536477+30.556022");
  assert.equal(parsed.latitude, 67.536477);
  assert.equal(parsed.longitude, 30.556022);
});

test("extracts coordinates when OCR inserts a dot before the signed longitude", () => {
  const parsed = core.extractCoordinatesFromText("+67.537497.+30.549373");
  assert.equal(parsed.latitude, 67.537497);
  assert.equal(parsed.longitude, 30.549373);
});

test("extracts coordinates through noisy OCR separators", () => {
  const parsed = core.extractCoordinatesFromText(": 67.559414\n3: 30.474923 ,\n3: 239.98+12.64");
  assert.equal(parsed.latitude, 67.559414);
  assert.equal(parsed.longitude, 30.474923);
});

test("restores decimal points lost from compact OCR coordinates", () => {
  const parsed = core.extractCoordinatesFromText(": 67558509\n; 30475247\n; 246.18+13.24");
  assert.equal(parsed.latitude, 67.558509);
  assert.equal(parsed.longitude, 30.475247);
});

test("restores a decimal separator read as whitespace", () => {
  const parsed = core.extractCoordinatesFromText(": 67 557054\n: 30.474209\n: 239.62+12.27");
  assert.equal(parsed.latitude, 67.557054);
  assert.equal(parsed.longitude, 30.474209);
});

test("restores coordinate decimal separators read as hyphens", () => {
  const parsed = core.extractCoordinatesFromText("5774056, 40-96650");
  assert.equal(parsed.latitude, 57.74056);
  assert.equal(parsed.longitude, 40.96650);
});

test("prefers a full latitude when OCR dropped the leading digit", () => {
  const primary = { latitude: 7.286694, longitude: 32.447859 };
  const fallback = { latitude: 67.286694, longitude: 32.447859 };
  assert.equal(core.chooseOcrCandidate(primary, fallback).latitude, fallback.latitude);
});

test("combines coordinates from complementary OCR crops", () => {
  const primary = { latitude: null, longitude: 32.445985, altitude: 141.6 };
  const fallback = { latitude: 67.287582, longitude: 32 };
  assert.deepEqual(core.chooseOcrCandidate(primary, fallback), {
    latitude: 67.287582, longitude: 32.445985, altitude: 141.6
  });
});

test("CSV includes route segment and escapes notes", () => {
  const csv = core.pointsToCsv([
    { name: "a.jpg", latitude: 67.571935, longitude: 30.501897, altitude: 255.97, accuracy: 4.97, capturedAt: "2026:10:18 14:42:18", note: "начало" },
    { name: "b.jpg", latitude: 67.572404, longitude: 30.501809, altitude: 254.91, accuracy: 3.02, capturedAt: "2026:10:18 14:44:13", note: "лес; точка" }
  ]);
  assert.match(csv, /52\.[0-9]{3}/);
  assert.match(csv, /"лес; точка"/);
});

test("classifies OpenStreetMap facilities and supports way centers", () => {
  assert.deepEqual(core.normalizeOsmFacility({
    type: "way", id: 10, center: { lat: 67.28, lon: 32.44 },
    tags: { amenity: "police", "name:ru": "Отдел МВД России" }
  }), {
    id: "way/10", latitude: 67.28, longitude: 32.44,
    name: "Отдел МВД России", categories: ["police", "mvd"]
  });
  assert.deepEqual(core.normalizeOsmFacility({
    type: "node", id: 11, lat: 67.29, lon: 32.45,
    tags: { leisure: "playground", name: "Детская площадка" }
  }).categories, ["playground"]);
  assert.equal(core.normalizeOsmFacility({ type: "node", id: 12, lat: 1, lon: 2, tags: { amenity: "cafe" } }), null);
});

test("builds a safe Yandex Maps link for a selected coordinate", () => {
  assert.equal(
    yandexMapsUrl(67.286694, 32.447859),
    "https://yandex.ru/maps/?text=67.2866940%2C%2032.4478590"
  );
  assert.equal(yandexMapsUrl(100, 32), null);
  assert.equal(yandexMapsUrl("bad", 32), null);
});

test("signs Yandex tile URLs with a time-limited signature", () => {
  const credentials = {
    apiKey: "11111111-2222-3333-4444-555555555555",
    signingSecret: Buffer.alloc(16, 7).toString("base64url")
  };
  const url = buildSignedTileUrl(credentials, 9902, 5137, 14, new Date("2026-10-25T09:47:12Z"));
  assert.match(url, /^https:\/\/tiles\.api-maps\.yandex\.ru\/v1\/tiles\/\?/);
  assert.match(url, /projection=web_mercator/);
  assert.match(url, /apikey=11111111-2222-3333-4444-555555555555/);
  assert.match(url, /&signature=[A-Za-z0-9_%=-]+$/);
  assert.equal(url.includes(credentials.signingSecret), false);
  assert.equal(utcHour(new Date("2026-10-25T09:47:12Z")), "2026-10-25T09:00:00Z");
});

test("rejects tile coordinates outside the selected zoom level", () => {
  const credentials = { apiKey: "key", signingSecret: Buffer.alloc(16, 1).toString("base64url") };
  assert.throws(() => buildSignedTileUrl(credentials, 4, 0, 1), /x/);
  assert.throws(() => buildSignedTileUrl(credentials, 0, 0, 21), /z/);
});
