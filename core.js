(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CoordinateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function isSupportedImageFile(file) {
    const name = String(file?.name || "");
    const type = String(file?.type || "").toLowerCase();
    return /\.(?:jpe?g|png)$/i.test(name) || type === "image/jpeg" || type === "image/jpg" || type === "image/png";
  }

  function readExif(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (isPng(view)) return readPngExif(view);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return emptyExif("Файл не является JPEG или PNG");
    return readJpegExif(view);
  }

  function readJpegExif(view) {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2, false);
      if (length < 2 || offset + 2 + length > view.byteLength) break;
      if (marker === 0xe1 && hasExifHeader(view, offset + 4)) {
        try { return parseTiff(view, offset + 10); }
        catch (error) { return emptyExif(`Ошибка EXIF: ${error.message}`); }
      }
      offset += 2 + length;
    }
    return emptyExif("В JPEG нет блока EXIF");
  }

  function isPng(view) {
    return view.byteLength >= 8 &&
      view.getUint32(0, false) === 0x89504e47 &&
      view.getUint32(4, false) === 0x0d0a1a0a;
  }

  function readPngExif(view) {
    let offset = 8;
    while (offset + 12 <= view.byteLength) {
      const length = view.getUint32(offset, false);
      const dataOffset = offset + 8;
      const chunkEnd = dataOffset + length + 4;
      if (length > view.byteLength || chunkEnd > view.byteLength) break;
      const type = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );
      if (type === "eXIf") {
        try { return parseTiff(view, dataOffset); }
        catch (error) { return emptyExif(`Ошибка EXIF в PNG: ${error.message}`); }
      }
      if (type === "IEND") break;
      offset = chunkEnd;
    }
    return emptyExif("В PNG нет блока EXIF");
  }

  function emptyExif(error) {
    return { latitude: null, longitude: null, altitude: null, accuracy: null, capturedAt: null, description: "", error };
  }

  function hasExifHeader(view, offset) {
    return offset + 6 <= view.byteLength &&
      view.getUint8(offset) === 0x45 && view.getUint8(offset + 1) === 0x78 &&
      view.getUint8(offset + 2) === 0x69 && view.getUint8(offset + 3) === 0x66 &&
      view.getUint8(offset + 4) === 0 && view.getUint8(offset + 5) === 0;
  }

  function parseTiff(view, tiff) {
    const byteOrder = String.fromCharCode(view.getUint8(tiff), view.getUint8(tiff + 1));
    if (byteOrder !== "II" && byteOrder !== "MM") throw new Error("неизвестный порядок байтов");
    const little = byteOrder === "II";
    if (view.getUint16(tiff + 2, little) !== 42) throw new Error("неверный TIFF-заголовок");

    const readIfd = (relativeOffset) => {
      const start = tiff + relativeOffset;
      if (start < tiff || start + 2 > view.byteLength) return new Map();
      const count = view.getUint16(start, little);
      const tags = new Map();
      for (let i = 0; i < count; i += 1) {
        const entry = start + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        const tag = view.getUint16(entry, little);
        const type = view.getUint16(entry + 2, little);
        const valueCount = view.getUint32(entry + 4, little);
        const size = (TYPE_SIZE[type] || 0) * valueCount;
        if (!size || size > view.byteLength) continue;
        const dataOffset = size <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little);
        if (dataOffset < 0 || dataOffset + size > view.byteLength) continue;
        tags.set(tag, readTagValue(view, dataOffset, type, valueCount, little));
      }
      return tags;
    };

    const ifd0Offset = view.getUint32(tiff + 4, little);
    const ifd0 = readIfd(ifd0Offset);
    const gpsPointer = first(ifd0.get(0x8825));
    const exifPointer = first(ifd0.get(0x8769));
    const gps = Number.isFinite(gpsPointer) ? readIfd(gpsPointer) : new Map();
    const exif = Number.isFinite(exifPointer) ? readIfd(exifPointer) : new Map();

    const lat = dmsToDecimal(gps.get(0x0002), gps.get(0x0001));
    const lon = dmsToDecimal(gps.get(0x0004), gps.get(0x0003));
    const altitudeRaw = first(gps.get(0x0006));
    const altitudeRef = first(gps.get(0x0005));
    const altitude = Number.isFinite(altitudeRaw) ? (altitudeRef === 1 ? -altitudeRaw : altitudeRaw) : null;
    const accuracy = finiteOrNull(first(gps.get(0x001f)));
    const capturedAt = cleanString(exif.get(0x9003)) || cleanString(exif.get(0x9004)) || cleanString(ifd0.get(0x0132));
    const description = cleanString(ifd0.get(0x010e));

    return {
      latitude: finiteOrNull(lat), longitude: finiteOrNull(lon), altitude,
      accuracy, capturedAt: capturedAt || null, description,
      error: Number.isFinite(lat) && Number.isFinite(lon) ? null : "GPS-координаты не найдены в EXIF"
    };
  }

  function readTagValue(view, offset, type, count, little) {
    if (type === 2) {
      let text = "";
      for (let i = 0; i < count && view.getUint8(offset + i) !== 0; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
      return text;
    }
    const values = [];
    for (let i = 0; i < count; i += 1) {
      if (type === 1 || type === 7) values.push(view.getUint8(offset + i));
      else if (type === 3) values.push(view.getUint16(offset + i * 2, little));
      else if (type === 4) values.push(view.getUint32(offset + i * 4, little));
      else if (type === 9) values.push(view.getInt32(offset + i * 4, little));
      else if (type === 5 || type === 10) {
        const signed = type === 10;
        const numerator = signed ? view.getInt32(offset + i * 8, little) : view.getUint32(offset + i * 8, little);
        const denominator = signed ? view.getInt32(offset + i * 8 + 4, little) : view.getUint32(offset + i * 8 + 4, little);
        values.push(denominator ? numerator / denominator : NaN);
      }
    }
    return values;
  }

  function first(value) { return Array.isArray(value) ? value[0] : value; }
  function cleanString(value) { return typeof value === "string" ? value.replace(/\0/g, "").trim() : ""; }
  function finiteOrNull(value) { return Number.isFinite(value) ? value : null; }

  function dmsToDecimal(parts, refValue) {
    if (!Array.isArray(parts) || parts.length < 3) return null;
    let decimal = parts[0] + parts[1] / 60 + parts[2] / 3600;
    const ref = cleanString(refValue).toUpperCase();
    if (ref === "S" || ref === "W") decimal *= -1;
    return decimal;
  }

  // Vincenty's inverse solution on the WGS-84 ellipsoid.
  function distanceWgs84(a, b) {
    if (!hasCoordinates(a) || !hasCoordinates(b)) return null;
    if (a.latitude === b.latitude && a.longitude === b.longitude) return 0;
    const major = 6378137;
    const flattening = 1 / 298.257223563;
    const minor = (1 - flattening) * major;
    const phi1 = toRad(a.latitude), phi2 = toRad(b.latitude);
    const L = toRad(b.longitude - a.longitude);
    const U1 = Math.atan((1 - flattening) * Math.tan(phi1));
    const U2 = Math.atan((1 - flattening) * Math.tan(phi2));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lambda = L, previous;
    let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
    for (let i = 0; i < 100; i += 1) {
      const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
      sinSigma = Math.sqrt((cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2);
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha ** 2;
      cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
      const C = flattening / 16 * cosSqAlpha * (4 + flattening * (4 - 3 * cosSqAlpha));
      previous = lambda;
      lambda = L + (1 - C) * flattening * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
      if (Math.abs(lambda - previous) < 1e-12) break;
      if (i === 99) return distanceHaversine(a, b);
    }
    const uSq = cosSqAlpha * (major ** 2 - minor ** 2) / minor ** 2;
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
    return minor * A * (sigma - deltaSigma);
  }

  function distanceHaversine(a, b) {
    const radius = 6371008.8;
    const phi1 = toRad(a.latitude), phi2 = toRad(b.latitude);
    const dPhi = phi2 - phi1, dLambda = toRad(b.longitude - a.longitude);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function bearingDegrees(a, b) {
    if (!hasCoordinates(a) || !hasCoordinates(b)) return null;
    const phi1 = toRad(a.latitude), phi2 = toRad(b.latitude), lambda = toRad(b.longitude - a.longitude);
    const y = Math.sin(lambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function routeDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const distance = distanceWgs84(points[i - 1], points[i]);
      if (distance !== null) total += distance;
    }
    return total;
  }

  function allPairDistances(points) {
    const pairs = [];
    for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
      if (!hasCoordinates(points[firstIndex])) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
        if (!hasCoordinates(points[secondIndex])) continue;
        pairs.push({ firstIndex, secondIndex, distance: distanceWgs84(points[firstIndex], points[secondIndex]) });
      }
    }
    return pairs.sort((a, b) => a.distance - b.distance || a.firstIndex - b.firstIndex || a.secondIndex - b.secondIndex);
  }

  function hasCoordinates(point) {
    return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
      point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
  }

  function toRad(value) { return value * Math.PI / 180; }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${meters.toFixed(meters < 100 ? 1 : 0)} м`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} км`;
  }

  function csvEscape(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function pointsToCsv(points) {
    const header = ["№", "Файл", "Широта", "Долгота", "Высота, м", "Точность, м", "Дата съёмки", "До предыдущей, м", "Комментарий"];
    const rows = points.map((point, index) => {
      const segment = index ? distanceWgs84(points[index - 1], point) : null;
      return [index + 1, point.name, point.latitude, point.longitude, point.altitude, point.accuracy, point.capturedAt, segment === null ? "" : segment.toFixed(3), point.note || ""];
    });
    return "\ufeff" + [header, ...rows].map(row => row.map(csvEscape).join(";")).join("\r\n");
  }

  function extractCoordinatesFromText(text) {
    const sourceText = String(text || "");
    const normalized = sourceText
      .replace(/[—–]/g, "-")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/(\d)[:;](\d{4,8})(?=\D|$)/g, "$1.$2")
      .replace(/(\d)-(\d{5,8})(?=\D|$)/g, "$1.$2")
      .replace(/\u00a0/g, " ");
    const coordinatePair = extractCoordinatePair(normalized);
    const latitude = extractLabeledNumber(normalized, /(?:шир[ое]т[аы]?|lat(?:itude)?)/i, "latitude") ?? coordinatePair?.latitude;
    const longitude = extractLabeledNumber(normalized, /(?:долгот[аы]?|lon(?:gitude)?)/i, "longitude") ?? coordinatePair?.longitude;
    const altitude = extractLabeledNumber(normalized, /(?:возвышени[ея]|высот[аы]|alt(?:itude)?)/i, "generic");
    let accuracy = extractLabeledNumber(normalized, /(?:точност[ьи]|accuracy)/i, "generic");
    if (Number.isInteger(accuracy) && accuracy >= 100 && accuracy <= 9999) {
      const digits = String(accuracy);
      accuracy = Number(`${digits[0]}.${digits.slice(1)}`);
    }
    const dateMatch = normalized.match(/\b(\d{1,2}[-.]\d{1,2}[-.]\d{4})\s+(\d{1,2}:\d{2}:\d{2})\b/);
    return {
      latitude: validRange(latitude, -90, 90),
      longitude: validRange(longitude, -180, 180),
      altitude: finiteOrNull(altitude),
      accuracy: validRange(accuracy, 0, Number.MAX_VALUE),
      capturedAt: dateMatch ? `${dateMatch[1]} ${dateMatch[2]}` : null,
      rawText: normalized.trim()
    };
  }

  function extractCoordinatePair(text) {
    const source = String(text || "").replace(/[−—–]/g, "-");
    const pattern = /([+-]?\d{1,2}[.,]\d{4,8})(?:\s*[,;]\s*|\s*\.\s*(?=[+-])|\s+|(?=[+-]))([+-]?\d{1,3}[.,]\d{4,8})/g;
    for (const match of source.matchAll(pattern)) {
      const latitude = Number(match[1].replace(",", "."));
      const longitude = Number(match[2].replace(",", "."));
      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude };
    }
    return extractNoisyCoordinatePair(source);
  }

  function extractNoisyCoordinatePair(source) {
    const tokenPattern = /[+-]?(?:\d{1,3}[.,]\d{4,8}|\d{1,3}\s+\d{4,8}|\d{7,10})/g;
    const tokens = Array.from(source.matchAll(tokenPattern), match => ({
      raw: match[0],
      index: match.index,
      end: match.index + match[0].length,
      decimal: /[.,]|\s/.test(match[0]),
      signed: /^[+-]/.test(match[0])
    }));
    const candidates = [];
    for (let leftIndex = 0; leftIndex < tokens.length; leftIndex += 1) {
      const left = tokens[leftIndex];
      const latitude = coordinateTokenValue(left.raw, "latitude");
      if (!Number.isFinite(latitude)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < tokens.length; rightIndex += 1) {
        const right = tokens[rightIndex];
        const gap = right.index - left.end;
        if (gap > 80) break;
        const longitude = coordinateTokenValue(right.raw, "longitude");
        if (!Number.isFinite(longitude)) continue;
        const score = (left.decimal ? 4 : 2) + (right.decimal ? 4 : 2) +
          (left.signed ? 1 : 0) + (right.signed ? 1 : 0) - gap / 100;
        candidates.push({ latitude, longitude, score, index: left.index });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    return candidates.length ? { latitude: candidates[0].latitude, longitude: candidates[0].longitude } : null;
  }

  function coordinateTokenValue(rawToken, kind) {
    const token = String(rawToken).replace(",", ".").replace(/\s+/, ".");
    if (token.includes(".")) {
      const value = Number(token);
      const min = kind === "latitude" ? -90 : -180;
      const max = kind === "latitude" ? 90 : 180;
      return value >= min && value <= max ? value : null;
    }
    const sign = token.startsWith("-") ? -1 : 1;
    const digits = token.replace(/^[+-]/, "");
    if (digits.length < 7 || digits.length > 10) return null;
    let degreeDigits = 2;
    if (kind === "longitude") {
      const threeDegrees = Number(digits.slice(0, 3));
      if (threeDegrees > 90 && threeDegrees <= 180) degreeDigits = 3;
    }
    const degrees = Number(digits.slice(0, degreeDigits));
    const fraction = digits.slice(degreeDigits);
    if (fraction.length < 4) return null;
    const value = sign * Number(`${degrees}.${fraction}`);
    const min = kind === "latitude" ? -90 : -180;
    const max = kind === "latitude" ? 90 : 180;
    return value >= min && value <= max ? value : null;
  }

  function extractLabeledNumber(text, labelPattern, kind) {
    const matcher = new RegExp(labelPattern.source, "gi");
    const candidates = [];
    for (const label of text.matchAll(matcher)) {
      const tail = text.slice(label.index + label[0].length, label.index + label[0].length + 40);
      const match = tail.match(/[^+\-\d]{0,12}([+\-]?(?:\d{1,3}[.:;]\d{2,8}|\d{6,10}|\d{1,3}))/);
      if (!match) continue;
      const explicitDecimal = /[.:;]/.test(match[1]);
      let token = match[1].replace(/[;:]/g, ".");
      if (!token.includes(".") && /^[-+]?\d{6,10}$/.test(token) && (kind === "latitude" || kind === "longitude")) {
        const sign = token.startsWith("-") ? "-" : "";
        const digits = token.replace(/^[-+]/, "");
        let degreeDigits = 2;
        if (kind === "longitude" && Number(digits.slice(0, 3)) <= 180 && Number(digits.slice(0, 3)) > 90) degreeDigits = 3;
        token = `${sign}${digits.slice(0, degreeDigits)}.${digits.slice(degreeDigits)}`;
      }
      const value = Number(token);
      if (Number.isFinite(value)) candidates.push({ value, score: explicitDecimal ? 2 : 1 });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.value ?? null;
  }

  function validRange(value, min, max) { return Number.isFinite(value) && value >= min && value <= max ? value : null; }

  function chooseOcrCandidate(primary, fallback) {
    const primaryValid = hasCoordinates(primary);
    const fallbackValid = hasCoordinates(fallback);
    const merged = { ...primary };
    if (!Number.isFinite(merged.latitude) && Number.isFinite(fallback?.latitude)) merged.latitude = fallback.latitude;
    if (!Number.isFinite(merged.longitude) && Number.isFinite(fallback?.longitude)) merged.longitude = fallback.longitude;
    if (!Number.isFinite(merged.altitude) && Number.isFinite(fallback?.altitude)) merged.altitude = fallback.altitude;
    if (!Number.isFinite(merged.accuracy) && Number.isFinite(fallback?.accuracy)) merged.accuracy = fallback.accuracy;
    if (!merged.capturedAt && fallback?.capturedAt) merged.capturedAt = fallback.capturedAt;
    if (!merged.rawText && fallback?.rawText) merged.rawText = fallback.rawText;
    if (primaryValid && fallbackValid && Math.abs(primary.latitude) < 10 && Math.abs(fallback.latitude) >= 10) {
      merged.latitude = fallback.latitude;
    }
    return merged;
  }

  function normalizeOsmFacility(element) {
    const latitude = element?.lat ?? element?.center?.lat;
    const longitude = element?.lon ?? element?.center?.lon;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const tags = element.tags || {};
    const name = tags["name:ru"] || tags.name || "Без названия";
    const categories = [];
    const lowerName = name.toLocaleLowerCase("ru");
    if (tags.amenity === "police") categories.push("police");
    if (/мвд|овд|отдел.*полици|управлен.*полици/.test(lowerName)) categories.push("mvd");
    if (/фсб|федеральн.*безопасност/.test(lowerName)) categories.push("fsb");
    if (tags.leisure === "playground") categories.push("playground");
    if (tags.amenity === "kindergarten") categories.push("kindergarten");
    if (tags.amenity === "school") categories.push("school");
    if (!categories.length) return null;
    return { id: `${element.type}/${element.id}`, latitude, longitude, name, categories };
  }

  return { isSupportedImageFile, readExif, extractCoordinatesFromText, chooseOcrCandidate, normalizeOsmFacility, distanceWgs84, distanceHaversine, bearingDegrees, routeDistance, allPairDistances, hasCoordinates, formatDistance, pointsToCsv };
});
