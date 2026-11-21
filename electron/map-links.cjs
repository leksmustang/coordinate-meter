"use strict";

function yandexMapsUrl(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  const coordinates = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
  return `https://yandex.ru/maps/?text=${encodeURIComponent(coordinates)}`;
}

module.exports = { yandexMapsUrl };
