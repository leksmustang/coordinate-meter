(function () {
  "use strict";
  const core = window.CoordinateCore;
  const mobile = window.CoordinateMobile?.isNative ? window.CoordinateMobile : null;
  const state = {
    points: [], nextId: 1, ocrWorker: null, ocrBusy: false,
    map: null, mapLoaded: false, mapTileFailed: false, routeLayer: null, poiLayer: null, customLayer: null, pairLayer: null,
    customPoint: null, facilities: [], allPairsLimit: 100, areaPointId: null, areaSelection: null, areaDrag: null, areaCandidates: []
  };
  const ocrDebug = new URLSearchParams(location.search).has("e2e") ? [] : null;
  if (ocrDebug) window.__ocrDebug = ocrDebug;
  const recordOcrStage = (stage, details = {}) => {
    if (!ocrDebug) return;
    const entry = { pass: "stage", stage, ...details };
    ocrDebug.push(entry);
    console.debug("[ocr-stage]", JSON.stringify(entry));
  };
  const mobileTileCache = new Map();
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    dropZone: $("#dropZone"), fileInput: $("#fileInput"), chooseButton: $("#chooseButton"),
    workspace: $("#workspace"), addMoreButton: $("#addMoreButton"), sortButton: $("#sortButton"),
    exportButton: $("#exportButton"), clearButton: $("#clearButton"), pointsList: $("#pointsList"),
    pointTemplate: $("#pointTemplate"), pointCount: $("#pointCount"), totalDistance: $("#totalDistance"),
    directDistance: $("#directDistance"), elevationDelta: $("#elevationDelta"), routeSummary: $("#routeSummary"),
    notice: $("#notice"), pointA: $("#pointA"), pointB: $("#pointB"), pairDistance: $("#pairDistance"),
    pairDetails: $("#pairDetails"), facilityOrigin: $("#facilityOrigin"), facilityRadius: $("#facilityRadius"),
    openYandexButton: $("#openYandexButton"), loadMapButton: $("#loadMapButton"), mapPrivacy: $("#mapPrivacy"), mapStatus: $("#mapStatus"),
    routeMap: $("#routeMap"), facilityResults: $("#facilityResults"), categoryFilters: Array.from(document.querySelectorAll(".category-filters input")),
    customPointPanel: $("#customPointPanel"), customPointResult: $("#customPointResult"), clearCustomPointButton: $("#clearCustomPointButton"),
    editDialog: $("#editDialog"),
    editForm: $("#editForm"), editId: $("#editId"), editFilename: $("#editFilename"), editLat: $("#editLat"),
    editLon: $("#editLon"), editAltitude: $("#editAltitude"), editAccuracy: $("#editAccuracy"), editNote: $("#editNote"),
    editError: $("#editError"), saveEditButton: $("#saveEditButton"),
    allPairsPanel: $("#allPairsPanel"), allPairsSummary: $("#allPairsSummary"), allPairsFilter: $("#allPairsFilter"),
    allPairsList: $("#allPairsList"), allPairsShown: $("#allPairsShown"), allPairsMore: $("#allPairsMore"),
    areaOcrDialog: $("#areaOcrDialog"), areaOcrFilename: $("#areaOcrFilename"), areaOcrImage: $("#areaOcrImage"),
    areaOcrSelection: $("#areaOcrSelection"), closeAreaOcr: $("#closeAreaOcr"), resetAreaOcr: $("#resetAreaOcr"),
    runAreaOcr: $("#runAreaOcr"), areaOcrStatus: $("#areaOcrStatus"), areaOcrResult: $("#areaOcrResult"),
    areaOcrCandidates: $("#areaOcrCandidates"), areaOcrLat: $("#areaOcrLat"), areaOcrLon: $("#areaOcrLon"),
    areaOcrError: $("#areaOcrError"), applyAreaOcr: $("#applyAreaOcr")
  };

  const openPicker = () => elements.fileInput.click();
  elements.chooseButton.addEventListener("click", (event) => { event.stopPropagation(); openPicker(); });
  elements.addMoreButton.addEventListener("click", openPicker);
  elements.dropZone.addEventListener("click", openPicker);
  elements.dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") openPicker(); });
  elements.fileInput.addEventListener("change", () => addFiles(elements.fileInput.files));
  ["dragenter", "dragover"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault(); elements.dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(type => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault(); elements.dropZone.classList.remove("dragover");
  }));
  elements.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  elements.pointA.addEventListener("change", renderPairMeasurement);
  elements.pointB.addEventListener("change", renderPairMeasurement);
  elements.loadMapButton.addEventListener("click", loadMapAndFacilities);
  elements.openYandexButton.addEventListener("click", openSelectedInYandex);
  elements.facilityOrigin.addEventListener("change", () => {
    renderCustomMeasurement();
    if (state.mapLoaded) loadFacilities();
  });
  elements.facilityRadius.addEventListener("change", () => { if (state.mapLoaded) loadFacilities(); });
  elements.categoryFilters.forEach(input => input.addEventListener("change", renderNearestFacilities));
  elements.sortButton.addEventListener("click", () => {
    state.points.sort((a, b) => sortableDate(a.capturedAt) - sortableDate(b.capturedAt) || a.name.localeCompare(b.name, "ru"));
    render();
  });
  elements.clearButton.addEventListener("click", () => {
    state.points.forEach(point => URL.revokeObjectURL(point.previewUrl));
    state.points = []; state.customPoint = null; elements.fileInput.value = ""; renderCustomMeasurement(); render();
  });
  elements.clearCustomPointButton.addEventListener("click", () => {
    state.customPoint = null;
    renderCustomMeasurement();
  });
  elements.exportButton.addEventListener("click", exportCsv);
  elements.editForm.addEventListener("submit", saveEdit);
  elements.allPairsFilter.addEventListener("change", () => { state.allPairsLimit = 100; renderAllPairs(); });
  elements.allPairsMore.addEventListener("click", () => { state.allPairsLimit += 100; renderAllPairs(); });
  elements.closeAreaOcr.addEventListener("click", () => elements.areaOcrDialog.close());
  elements.resetAreaOcr.addEventListener("click", resetAreaSelection);
  elements.runAreaOcr.addEventListener("click", runAreaOcr);
  elements.applyAreaOcr.addEventListener("click", applyAreaOcr);
  elements.areaOcrCandidates.addEventListener("change", showSelectedAreaCandidate);
  const areaWrap = elements.areaOcrImage.parentElement;
  areaWrap.addEventListener("pointerdown", startAreaSelection);
  areaWrap.addEventListener("pointermove", updateAreaSelection);
  areaWrap.addEventListener("pointerup", finishAreaSelection);
  areaWrap.addEventListener("pointercancel", finishAreaSelection);
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-yandex-external]");
    if (!link) return;
    event.preventDefault();
    openAllowedYandexPage(link.dataset.yandexExternal).catch(error => {
      console.error(error);
      setMapStatus(error.message || "Не удалось открыть Яндекс Карты.", true);
    });
  });

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(core.isSupportedImageFile);
    recordOcrStage("files-filtered", { files: files.map(file => ({ name: file.name, type: file.type, size: file.size })) });
    if (ocrDebug) ocrDebug.push({ pass: "upload-start", files: files.map(file => file.name) });
    if (!files.length) { showNotice("Выберите фотографии в формате JPEG или PNG."); return; }
    const loaded = await Promise.all(files.map(async file => {
      const exif = core.readExif(await file.arrayBuffer());
      recordOcrStage("metadata-read", { file: file.name, error: exif.error });
      return {
        id: state.nextId++, name: file.name, size: file.size, previewUrl: URL.createObjectURL(file),
        file,
        latitude: exif.latitude, longitude: exif.longitude, altitude: exif.altitude, accuracy: exif.accuracy,
        capturedAt: exif.capturedAt, note: exif.description || "", source: core.hasCoordinates(exif) ? "EXIF" : "ручной ввод",
        error: exif.error
      };
    }));
    state.points.push(...loaded);
    elements.fileInput.value = "";
    render();
    const missing = loaded.filter(point => !core.hasCoordinates(point));
    recordOcrStage("points-loaded", { total: loaded.length, missing: missing.length });
    if (missing.length) {
      showNotice(`В EXIF нет GPS у ${missing.length} ${plural(missing.length, "фотографии", "фотографий", "фотографий")}. Запускаю распознавание подписи…`, true);
      await recognizeMissing(missing);
    }
  }

  async function recognizeMissing(points) {
    if (location.protocol === "file:") {
      showNotice("OCR не может запуститься из открытого напрямую index.html. Откройте готовое приложение «Координатный измеритель.exe».", true);
      return;
    }
    if (!window.Tesseract) { showNotice("OCR-модуль не загрузился. Перезапустите приложение либо введите координаты вручную.", true); return; }
    state.ocrBusy = true;
    try {
      const worker = await getOcrWorker();
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        recordOcrStage("point-start", { file: point.name, index });
        showNotice(`Распознавание ${index + 1} из ${points.length}: ${point.name}`, true);
        const dimensions = await imageDimensions(point.file);
        recordOcrStage("dimensions-read", { file: point.name, dimensions });
        showNotice(`Проверяю верхнюю GPS-плашку: ${point.name}`, true);
        let parsed = await recognizeTopGpsBanner(worker, point.file, dimensions);
        recordOcrStage("top-banner-finished", { file: point.name, coordinates: core.hasCoordinates(parsed) ? [parsed.latitude, parsed.longitude] : null });
        if (!core.hasCoordinates(parsed)) {
          showNotice(`Сверяю цифры нижней подписи: ${point.name}`, true);
          parsed = await recognizeSmallNoteCamOverlay(worker, point.file, dimensions);
        }
        recordOcrStage("overlay-finished", { file: point.name, coordinates: core.hasCoordinates(parsed) ? [parsed.latitude, parsed.longitude] : null });
        if (!core.hasCoordinates(parsed) && dimensions.width > 700 && dimensions.height > 700) {
          const primaryRectangle = {
            left: 0,
            top: Math.floor(dimensions.height * 0.80),
            width: Math.floor(dimensions.width * 0.68),
            height: Math.ceil(dimensions.height * 0.20)
          };
          const primaryResult = await worker.recognize(point.file, { rectangle: primaryRectangle });
          parsed = core.extractCoordinatesFromText(primaryResult.data.text);
          if (!core.hasCoordinates(parsed) || Math.abs(parsed.latitude) < 10) {
            showNotice(`Уточняю координаты: ${point.name}`, true);
            const fallbackRectangle = {
              left: 0,
              top: Math.floor(dimensions.height * 0.84),
              width: Math.floor(dimensions.width * 0.52),
              height: Math.ceil(dimensions.height * 0.16)
            };
            const fallbackResult = await worker.recognize(point.file, { rectangle: fallbackRectangle });
            const fallback = core.extractCoordinatesFromText(fallbackResult.data.text);
            parsed = core.chooseOcrCandidate(parsed, fallback);
          }
        }
        if (!core.hasCoordinates(parsed) || Math.abs(parsed.latitude) < 10) {
          showNotice(`Ищу координаты по всему кадру: ${point.name}`, true);
          const anywhere = await recognizeCoordinatesAnywhere(worker, point.file, dimensions);
          parsed = core.chooseOcrCandidate(parsed, anywhere);
        }
        if (core.hasCoordinates(parsed) && Math.abs(parsed.latitude) >= 10) {
          point.latitude = parsed.latitude; point.longitude = parsed.longitude;
          point.altitude = parsed.altitude; point.accuracy = parsed.accuracy;
          point.capturedAt = parsed.capturedAt || point.capturedAt;
          point.source = "OCR — проверьте"; point.error = null; point.ocrText = parsed.rawText;
        } else {
          point.error = "OCR не смог уверенно найти широту и долготу"; point.ocrText = parsed.rawText;
        }
        render();
      }
      const failed = points.filter(point => !core.hasCoordinates(point)).length;
      showNotice(failed ? `Готово. Не удалось распознать ${failed} ${plural(failed, "точку", "точки", "точек")}; заполните их через ✎.` : "Координаты распознаны. Проверьте значения по подписи на фото перед использованием.", false);
    } catch (error) {
      console.error(error);
      if (ocrDebug) ocrDebug.push({ pass: "stage", stage: "ocr-error", error: error?.stack || String(error) });
      showNotice("Не удалось запустить OCR. Перезапустите приложение либо задайте координаты вручную.", true);
    } finally { state.ocrBusy = false; }
  }

  async function getOcrWorker() {
    if (state.ocrWorker) return state.ocrWorker;
    state.ocrWorker = await window.Tesseract.createWorker("rus+eng", 1, {
      workerPath: "vendor/worker.min.js",
      langPath: "vendor/lang",
      corePath: "vendor/core",
      gzip: !mobile,
      logger(message) {
        if (message.status === "recognizing text") {
          elements.notice.textContent = `Распознавание координат: ${Math.round(message.progress * 100)}%`;
        }
      }
    });
    return state.ocrWorker;
  }

  async function recognizeSmallNoteCamOverlay(worker, file, dimensions) {
    const sources = await createBottomOverlayOcrSources(file, dimensions);
    recordOcrStage("overlay-sources-ready", { file: file.name, sources: sources.map(source => source.name) });
    const candidates = [];
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist: "0123456789+-,.;: "
      });
      for (const source of sources) {
        recordOcrStage("overlay-source-start", { file: file.name, source: source.name });
        const result = await worker.recognize(source.blob);
        recordOcrStage("overlay-source-finished", { file: file.name, source: source.name });
        const parsed = core.extractCoordinatesFromText(result.data.text);
        if (ocrDebug) ocrDebug.push({ pass: `small-overlay-${source.name}`, text: result.data.text });
        if (core.hasCoordinates(parsed) && Math.abs(parsed.latitude) >= 10) {
          candidates.push({ parsed, source: source.name });
        }
        if (core.hasCoordinates(chooseConsensusCoordinates(candidates))) break;
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
    }
    const chosen = chooseConsensusCoordinates(candidates);
    if (ocrDebug) ocrDebug.push({
      pass: "small-overlay-consensus",
      candidates: candidates.map(candidate => ({
        source: candidate.source,
        coordinates: [candidate.parsed.latitude, candidate.parsed.longitude]
      })),
      chosen: core.hasCoordinates(chosen) ? [chosen.latitude, chosen.longitude] : null
    });
    return chosen;
  }

  async function recognizeTopGpsBanner(worker, file, dimensions) {
    const sources = await createTopBannerOcrSources(file, dimensions);
    const candidates = [];
    recordOcrStage("top-banner-sources-ready", { file: file.name, sources: sources.map(source => source.name) });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "7",
        tessedit_char_whitelist: "0123456789+-,. "
      });
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source.mode && source.mode !== "7") {
          await worker.setParameters({ tessedit_pageseg_mode: source.mode });
        } else if (index > 0 && sources[index - 1].mode !== "7") {
          await worker.setParameters({ tessedit_pageseg_mode: "7" });
        }
        const result = await worker.recognize(source.blob);
        const parsed = core.extractCoordinatesFromText(result.data.text);
        if (ocrDebug) ocrDebug.push({ pass: `top-banner-${source.name}`, text: result.data.text });
        if (core.hasCoordinates(parsed) && Math.abs(parsed.latitude) >= 10) {
          candidates.push({ parsed, source: source.name, confidence: result.data.confidence || 0 });
        }
        if (core.hasCoordinates(chooseConsensusCoordinates(candidates))) break;
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
    }
    let chosen = chooseConsensusCoordinates(candidates);
    chosen = preferMorePreciseNearbyCandidate(chosen, candidates);
    if (!core.hasCoordinates(chosen)) {
      // A busy background can damage a different latitude glyph in every
      // threshold while the longitude remains identical. Accept the clean
      // bright-mask result only when another independent mask confirms one
      // complete coordinate; this avoids guessing from the route itself.
      const trustedSources = new Set(["top-white-bright", "top-white-very-bright"]);
      const corroborated = candidates
        .filter(candidate => trustedSources.has(candidate.source) && Math.abs(candidate.parsed.longitude) >= 10)
        .find(candidate => candidates.some(other => other !== candidate && (
          Math.abs(other.parsed.latitude - candidate.parsed.latitude) <= 0.000012 ||
          Math.abs(other.parsed.longitude - candidate.parsed.longitude) <= 0.000012
        )));
      if (corroborated) chosen = corroborated.parsed;
    }
    if (!core.hasCoordinates(chosen)) {
      const isolated = candidates
        .filter(candidate => candidate.confidence >= 65)
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (isolated) chosen = isolated.parsed;
    }
    if (ocrDebug) ocrDebug.push({
      pass: "top-banner-consensus",
      file: file.name,
      candidates: candidates.map(candidate => ({
        source: candidate.source,
        coordinates: [candidate.parsed.latitude, candidate.parsed.longitude]
      })),
      chosen: core.hasCoordinates(chosen) ? [chosen.latitude, chosen.longitude] : null
    });
    return chosen;
  }

  function preferMorePreciseNearbyCandidate(chosen, candidates) {
    if (!core.hasCoordinates(chosen) || candidates.length < 2) return chosen;
    const precision = (value) => {
      const decimal = Number(value).toFixed(8).replace(/0+$/, "").split(".")[1];
      return decimal ? decimal.length : 0;
    };
    const chosenPrecision = precision(chosen.latitude) + precision(chosen.longitude);
    const nearby = candidates
      .filter(candidate => Math.abs(candidate.parsed.latitude - chosen.latitude) <= 0.0001 &&
        Math.abs(candidate.parsed.longitude - chosen.longitude) <= 0.0001)
      .map(candidate => ({
        ...candidate,
        precision: precision(candidate.parsed.latitude) + precision(candidate.parsed.longitude)
      }))
      .sort((a, b) => b.precision - a.precision || b.confidence - a.confidence);
    return nearby[0]?.precision > chosenPrecision ? nearby[0].parsed : chosen;
  }

  function chooseConsensusCoordinates(candidates) {
    if (!candidates.length) return core.extractCoordinatesFromText("");
    const sourceWeights = {
      "threshold-104": 4,
      "threshold-112": 4,
      "threshold-112-coordinates": 3,
      "raw": 1,
      "threshold-128": 1,
      "threshold-145": 1,
      "neutral-dark": 1
    };
    const buckets = new Map();
    for (const item of candidates) {
      const candidate = item.parsed;
      const key = `${candidate.latitude.toFixed(6)},${candidate.longitude.toFixed(6)}`;
      const bucket = buckets.get(key) || { items: [], weight: 0 };
      bucket.items.push(item);
      bucket.weight += sourceWeights[item.source] || 1;
      buckets.set(key, bucket);
    }
    const exact = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight || b.items.length - a.items.length)[0];
    if (exact.items.length >= 2) return exact.items[0].parsed;
    const tolerance = 0.000012;
    const clusters = candidates.map(item => ({
      item,
      matches: candidates.filter(other =>
        Math.abs(other.parsed.latitude - item.parsed.latitude) <= tolerance &&
        Math.abs(other.parsed.longitude - item.parsed.longitude) <= tolerance)
    })).sort((a, b) => {
      const weightA = a.matches.reduce((sum, match) => sum + (sourceWeights[match.source] || 1), 0);
      const weightB = b.matches.reduce((sum, match) => sum + (sourceWeights[match.source] || 1), 0);
      return weightB - weightA || b.matches.length - a.matches.length;
    });
    const best = clusters[0];
    if (best.matches.length < 2) return core.extractCoordinatesFromText("");
    const medoid = best.matches.map(item => ({
      item,
      distance: best.matches.reduce((sum, other) => sum +
        Math.abs(other.parsed.latitude - item.parsed.latitude) + Math.abs(other.parsed.longitude - item.parsed.longitude), 0)
    })).sort((a, b) => a.distance - b.distance)[0].item.parsed;
    return medoid;
  }

  async function createBottomOverlayOcrSources(file, dimensions) {
    const image = await createImageBitmap(file);
    // NoteCam prints latitude and longitude at the far left of the lower
    // caption. Cropping that edge loses the leading digits; a wider region
    // also keeps long values intact on both portrait and landscape photos.
    const sourceLeft = 0;
    const sourceTop = Math.max(0, Math.floor(dimensions.height * 0.78));
    const sourceWidth = Math.max(1, Math.ceil(dimensions.width * 0.76));
    const sourceHeight = Math.max(1, dimensions.height - sourceTop);
    const scale = Math.max(2, Math.min(5, Math.ceil(1150 / sourceWidth)));
    const base = document.createElement("canvas");
    base.width = sourceWidth * scale;
    base.height = sourceHeight * scale;
    const baseContext = base.getContext("2d", { willReadFrequently: true });
    baseContext.imageSmoothingEnabled = true;
    baseContext.imageSmoothingQuality = "high";
    baseContext.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, base.width, base.height);
    image.close();
    const original = baseContext.getImageData(0, 0, base.width, base.height);
    const variants = [
      { name: "threshold-104", threshold: 104 },
      { name: "threshold-112", threshold: 112 },
      { name: "raw", transform: null },
      { name: "threshold-128", threshold: 128 }
    ];
    return Promise.all(variants.map(async variant => {
      const canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = variant.cropRatio ? Math.max(1, Math.round(base.height * variant.cropRatio)) : base.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!variant.threshold) {
        context.drawImage(base, 0, 0);
      } else {
        const pixels = context.createImageData(canvas.width, canvas.height);
        for (let index = 0; index < original.data.length; index += 4) {
          const red = original.data[index];
          const green = original.data[index + 1];
          const blue = original.data[index + 2];
          const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
          const dark = luminance < variant.threshold && (!variant.neutralOnly || chroma < 48);
          const value = dark ? 0 : 255;
          pixels.data[index] = value;
          pixels.data[index + 1] = value;
          pixels.data[index + 2] = value;
          pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
      }
      return {
        name: variant.name,
        blob: await canvasToPngBlob(canvas, "Не удалось увеличить подпись NoteCam")
      };
    }));
  }

  async function imageDimensions(file) {
    const image = await createImageBitmap(file);
    const dimensions = { width: image.width, height: image.height };
    image.close();
    return dimensions;
  }

  async function createTopBannerOcrSources(file, dimensions) {
    const image = await createImageBitmap(file);
    const sourceTop = 0;
    // GPS overlays may wrap or sit a little below the status bar. Include more
    // vertical context while keeping this a small, fast top-of-frame pass.
    const sourceHeight = Math.max(1, Math.min(dimensions.height, Math.ceil(dimensions.height * 0.09)));
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 12;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(image, 0, 0, dimensions.width, sourceHeight, 0, 0, sample.width, sample.height);
    const samplePixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    let luminanceTotal = 0;
    let neutralPixels = 0;
    for (let index = 0; index < samplePixels.length; index += 4) {
      const red = samplePixels[index];
      const green = samplePixels[index + 1];
      const blue = samplePixels[index + 2];
      luminanceTotal += red * 0.299 + green * 0.587 + blue * 0.114;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) <= 34) neutralPixels += 1;
    }
    const pixelCount = samplePixels.length / 4;
    const solidBanner = luminanceTotal / pixelCount >= 165 && neutralPixels / pixelCount >= 0.65;
    const sourceLeft = solidBanner ? 0 : Math.floor(dimensions.width * 0.12);
    const sourceRight = solidBanner ? dimensions.width : Math.floor(dimensions.width * 0.57);
    const sourceWidth = Math.max(1, sourceRight - sourceLeft);
    const scale = Math.max(1, Math.min(4, Math.ceil(1100 / sourceWidth)));
    const base = document.createElement("canvas");
    base.width = sourceWidth * scale;
    base.height = sourceHeight * scale;
    const context = base.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, base.width, base.height);
    image.close();
    const original = context.getImageData(0, 0, base.width, base.height);
    const tightHeight = Math.max(1, Math.min(base.height, Math.ceil(dimensions.height * 0.055 * scale)));
    const variants = [
      { name: "top-tight-white", mode: "light", neutral: false, threshold: 165, tight: true, psm: "6" },
      { name: "top-tight-bright", mode: "light", neutral: false, threshold: 210, tight: true, psm: "6" },
      { name: "top-tight-very-bright", mode: "light", neutral: false, threshold: 235, tight: true, psm: "6" },
      { name: "top-tight-raw", transform: null, tight: true, psm: "6" },
      { name: "top-raw", transform: null },
      { name: "top-dark", mode: "dark", neutral: false, threshold: 155 },
      { name: "top-white-soft", mode: "light", neutral: false, threshold: 160 },
      { name: "top-white-bright", mode: "light", neutral: false, threshold: 175 },
      { name: "top-white-neutral", neutral: true, threshold: 155 },
      { name: "top-white-very-bright", neutral: false, threshold: 195 }
    ];
    return Promise.all(variants.map(async variant => {
      const canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = variant.tight ? tightHeight : base.height;
      const variantContext = canvas.getContext("2d", { willReadFrequently: true });
      if (!variant.transform && !variant.threshold) {
        variantContext.drawImage(base, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      } else {
        const pixels = variantContext.createImageData(canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const red = original.data[index];
          const green = original.data[index + 1];
          const blue = original.data[index + 2];
          const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
          const selected = variant.mode === "dark"
            ? luminance <= variant.threshold && (!variant.neutral || chroma <= 58)
            : luminance >= variant.threshold && (!variant.neutral || chroma <= 58);
          const value = selected ? 0 : 255;
          pixels.data[index] = value;
          pixels.data[index + 1] = value;
          pixels.data[index + 2] = value;
          pixels.data[index + 3] = 255;
        }
        variantContext.putImageData(pixels, 0, 0);
      }
      return {
        name: variant.name,
        mode: variant.psm || "7",
        blob: await canvasToPngBlob(canvas, "Не удалось подготовить верхнюю GPS-плашку")
      };
    }));
  }

  async function recognizeCoordinatesAnywhere(worker, file, dimensions) {
    let parsed = core.extractCoordinatesFromText("");
    const universalSources = await createUniversalOcrSources(file, dimensions);
    const fullCandidates = [];
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        tessedit_char_whitelist: "0123456789+-,.;: "
      });
      for (const source of universalSources.full) {
        const result = await worker.recognize(source.blob);
        if (ocrDebug) ocrDebug.push({ pass: `universal-${source.name}`, text: result.data.text });
        const candidate = core.extractCoordinatesFromText(result.data.text);
        if (core.hasCoordinates(candidate) && Math.abs(candidate.latitude) >= 10) {
          fullCandidates.push({ parsed: candidate, source: source.name, confidence: result.data.confidence || 0 });
        }
      }

      // Compare the two already prepared full-frame readings before deciding.
      // A single early OCR guess can be valid WGS-84 yet still contain a bad digit.
      const fullConsensus = chooseConsensusCoordinates(fullCandidates);
      if (core.hasCoordinates(fullConsensus)) return fullConsensus;

      // Large coordinates in the middle of a busy photo disappear when the
      // entire frame is sent to Tesseract. Read overlapping local regions at
      // a usable text size before falling back to wide horizontal bands.
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist: "0123456789+-,.;: "
      });
      for (const region of universalSources.regions) {
        let foundInRegion = false;
        const regionCandidates = [];
        for (const variant of ["white-185", "white-210", "white-230", "raw"]) {
          if (variant !== "white-185" && !foundInRegion) break;
          const source = await createUniversalOcrRegion(universalSources, region, variant);
          const result = await worker.recognize(source.blob);
          if (ocrDebug) ocrDebug.push({ pass: `universal-${source.name}`, text: result.data.text, rectangle: source.rectangle });
          const candidate = core.extractCoordinatesFromText(result.data.text);
          if (core.hasCoordinates(candidate) && Math.abs(candidate.latitude) >= 10) {
            foundInRegion = true;
            regionCandidates.push({ parsed: candidate, source: source.name, confidence: result.data.confidence || 0 });
          }
        }
        if (foundInRegion) {
          try {
            await worker.reinitialize("eng");
            await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789+-,.;: " });
            const englishSource = await createUniversalOcrRegion(universalSources, region, "white-210");
            const englishResult = await worker.recognize(englishSource.blob);
            if (ocrDebug) ocrDebug.push({ pass: `universal-${englishSource.name}-eng`, text: englishResult.data.text, rectangle: englishSource.rectangle });
            const englishCandidate = core.extractCoordinatesFromText(englishResult.data.text);
            if (core.hasCoordinates(englishCandidate) && Math.abs(englishCandidate.latitude) >= 10) {
              regionCandidates.push({ parsed: englishCandidate, source: `${englishSource.name}-eng`, confidence: englishResult.data.confidence || 0 });
            }
          } finally {
            await worker.reinitialize("rus+eng");
            await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789+-,.;: " });
          }
          fullCandidates.push(...regionCandidates);
          const consensus = chooseConsensusCoordinates(regionCandidates);
          if (core.hasCoordinates(consensus)) return preferMorePreciseNearbyCandidate(consensus, regionCandidates);
        }
      }
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist: "0123456789+-,.;: "
      });
      for (let index = 0; index < universalSources.bandTops.length; index += 1) {
        const source = await createUniversalOcrBand(universalSources, index);
        const result = await worker.recognize(source.blob);
        if (ocrDebug) ocrDebug.push({ pass: `universal-${source.name}`, text: result.data.text, rectangle: source.rectangle });
        const candidate = core.extractCoordinatesFromText(result.data.text);
        if (core.hasCoordinates(candidate) && Math.abs(candidate.latitude) >= 10) {
          fullCandidates.push({ parsed: candidate, source: source.name, confidence: result.data.confidence || 0 });
          const consensus = chooseConsensusCoordinates(fullCandidates);
          if (core.hasCoordinates(consensus)) return consensus;
        }
      }
      if (fullCandidates.length) {
        parsed = fullCandidates.sort((a, b) => b.confidence - a.confidence)[0].parsed;
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
    }

    const colorSources = await createColorOcrSources(file);
    try {
      if (colorSources.bands.length) {
        await worker.setParameters({
          tessedit_pageseg_mode: "13",
          tessedit_char_whitelist: "0123456789+-,.; "
        });
        for (let index = 0; index < colorSources.bands.length; index += 1) {
          const result = await worker.recognize(colorSources.bands[index]);
          if (ocrDebug) ocrDebug.push({ pass: `color-band-${index + 1}`, text: result.data.text, rectangle: colorSources.rectangles[index] });
          parsed = core.chooseOcrCandidate(parsed, core.extractCoordinatesFromText(result.data.text));
          if (core.hasCoordinates(parsed)) break;
        }
      }
      if (!core.hasCoordinates(parsed) && colorSources.bands.length) {
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          tessedit_char_whitelist: "0123456789+-,.; "
        });
        for (let index = 0; index < colorSources.bands.length; index += 1) {
          const result = await worker.recognize(colorSources.bands[index]);
          if (ocrDebug) ocrDebug.push({ pass: `color-band-raw-${index + 1}`, text: result.data.text, rectangle: colorSources.rectangles[index] });
          parsed = core.chooseOcrCandidate(parsed, core.extractCoordinatesFromText(result.data.text));
          if (core.hasCoordinates(parsed)) break;
        }
      }
      if (!core.hasCoordinates(parsed) && !window.__forceColorBandOcr) {
        await worker.setParameters({
          tessedit_pageseg_mode: "11",
          tessedit_char_whitelist: "0123456789+-,.; "
        });
        const colorResult = await worker.recognize(colorSources.full);
        if (ocrDebug) ocrDebug.push({ pass: "color-mask", text: colorResult.data.text });
        parsed = core.chooseOcrCandidate(parsed, core.extractCoordinatesFromText(colorResult.data.text));
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
    }
    if (core.hasCoordinates(parsed)) return parsed;

    const bandHeight = Math.max(1, Math.ceil(dimensions.height * 0.28));
    const lastTop = Math.max(0, dimensions.height - bandHeight);
    const tops = [];
    for (let ratio = 0; ratio <= 0.8; ratio += 0.2) {
      tops.push(Math.min(lastTop, Math.floor(dimensions.height * ratio)));
    }
    tops.push(lastTop);
    try {
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      for (const top of [...new Set(tops)]) {
        const result = await worker.recognize(file, {
          rectangle: { left: 0, top, width: dimensions.width, height: Math.min(bandHeight, dimensions.height - top) }
        });
        if (ocrDebug) ocrDebug.push({ pass: `band-${top}`, text: result.data.text });
        parsed = core.chooseOcrCandidate(parsed, core.extractCoordinatesFromText(result.data.text));
        if (core.hasCoordinates(parsed)) break;
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: "3" });
    }
    return parsed;
  }

  async function createUniversalOcrSources(file, dimensions) {
    const image = await createImageBitmap(file);
    const scale = Math.max(1, Math.min(4, Math.ceil(1080 / dimensions.width)));
    const base = document.createElement("canvas");
    base.width = Math.max(1, Math.round(dimensions.width * scale));
    base.height = Math.max(1, Math.round(dimensions.height * scale));
    const context = base.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, base.width, base.height);
    image.close();

    const contrast = document.createElement("canvas");
    contrast.width = base.width;
    contrast.height = base.height;
    const contrastContext = contrast.getContext("2d");
    contrastContext.filter = "grayscale(1) contrast(1.55)";
    contrastContext.drawImage(base, 0, 0);
    contrastContext.filter = "none";

    const full = [
      { name: "full-raw", blob: await canvasToPngBlob(base, "Не удалось подготовить полный кадр") },
      { name: "full-contrast", blob: await canvasToPngBlob(contrast, "Не удалось усилить контраст полного кадра") }
    ];

    const bandHeight = Math.min(base.height, Math.max(Math.round(92 * scale), Math.round(base.height * 0.18)));
    const step = Math.max(1, Math.round(bandHeight * 0.62));
    const lastTop = Math.max(0, base.height - bandHeight);
    const regularTops = [];
    for (let top = 0; top < lastTop; top += step) regularTops.push(top);
    regularTops.push(lastTop);
    const orderedTops = [...new Set([0, lastTop, ...regularTops])];
    const regions = [];
    for (const leftRatio of [0, 0.5]) {
      for (const topRatio of [0, 0.16, 0.32, 0.48, 0.64, 0.75]) {
        regions.push({ leftRatio, topRatio, widthRatio: 0.5, heightRatio: 0.25 });
      }
    }
    return { full, base, scale, dimensions, bandHeight, bandTops: orderedTops, regions };
  }

  async function createUniversalOcrRegion(sources, region, variant) {
    const left = Math.round(sources.base.width * region.leftRatio);
    const top = Math.round(sources.base.height * region.topRatio);
    const width = Math.min(sources.base.width - left, Math.round(sources.base.width * region.widthRatio));
    const height = Math.min(sources.base.height - top, Math.round(sources.base.height * region.heightRatio));
    const scale = Math.max(1, Math.min(3, Math.ceil(1100 / width)));
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(sources.base, left, top, width, height, 0, 0, canvas.width, canvas.height);
    if (variant !== "raw") {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const threshold = variant.startsWith("white-230") ? 230 : variant.startsWith("white-210") ? 210 : 185;
      for (let index = 0; index < pixels.data.length; index += 4) {
        const red = pixels.data[index];
        const green = pixels.data[index + 1];
        const blue = pixels.data[index + 2];
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 72;
        const value = luminance >= threshold && neutral ? 0 : 255;
        pixels.data[index] = value;
        pixels.data[index + 1] = value;
        pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    return {
      name: `region-${region.leftRatio}-${region.topRatio}-${variant}`,
      rectangle: { left: Math.round(left / sources.scale), top: Math.round(top / sources.scale), width: Math.round(width / sources.scale), height: Math.round(height / sources.scale) },
      blob: await canvasToPngBlob(canvas, "Не удалось подготовить область общего поиска")
    };
  }

  async function createUniversalOcrBand(sources, index) {
    const top = sources.bandTops[index];
    const band = document.createElement("canvas");
    band.width = sources.base.width;
    band.height = Math.min(sources.bandHeight, sources.base.height - top);
    const context = band.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, band.width, band.height);
    context.drawImage(sources.base, 0, top, sources.base.width, band.height, 0, 0, band.width, band.height);
    return {
      name: `band-${index + 1}`,
      rectangle: {
        left: 0,
        top: Math.round(top / sources.scale),
        width: sources.dimensions.width,
        height: Math.round(band.height / sources.scale)
      },
      blob: await canvasToPngBlob(band, "Не удалось подготовить область общего поиска")
    };
  }

  async function createColorOcrSources(file) {
    const image = await createImageBitmap(file);
    // Tesseract reads the thin outlined GPS-camera font more reliably at its
    // native size. Upscaling makes some 7/0 glyphs look like 4/8/9.
    const scale = 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const rowCounts = new Uint32Array(canvas.height);
    const selectedPixels = new Uint8Array(canvas.width * canvas.height);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const red = pixels.data[index];
        const green = pixels.data[index + 1];
        const blue = pixels.data[index + 2];
        // A stricter red mask rejects brown leaves and branches while retaining
        // the red overlay used by GPS-camera applications.
        const redText = red > 120 && red - green > 45 && red - blue > 35;
        const colored = redText;
        const value = colored ? 0 : 255;
        pixels.data[index] = value;
        pixels.data[index + 1] = value;
        pixels.data[index + 2] = value;
        pixels.data[index + 3] = 255;
        if (!colored) continue;
        selectedPixels[y * canvas.width + x] = 1;
        rowCounts[y] += 1;
      }
    }
    context.putImageData(pixels, 0, 0);
    const rowThreshold = Math.max(15, Math.floor(canvas.width * 0.02));
    const maxGap = Math.max(2, Math.round(canvas.height * 0.002));
    const groups = [];
    let group = null;
    const finishGroup = () => {
      if (!group) return;
      const height = group.lastY - group.firstY + 1;
      const columnCounts = new Uint16Array(canvas.width);
      for (let y = group.firstY; y <= group.lastY; y += 1) {
        const rowOffset = y * canvas.width;
        for (let x = 0; x < canvas.width; x += 1) columnCounts[x] += selectedPixels[rowOffset + x];
      }
      const denseThreshold = Math.max(3, Math.round(height * 0.40));
      const denseColumns = [];
      for (let x = 0; x < canvas.width; x += 1) if (columnCounts[x] >= denseThreshold) denseColumns.push(x);
      const clusters = [];
      const maxColumnGap = Math.max(10, Math.round(height * 1.2));
      for (const x of denseColumns) {
        const current = clusters.at(-1);
        if (!current || x - current.last > maxColumnGap) clusters.push({ first: x, last: x, count: 1 });
        else { current.last = x; current.count += 1; }
      }
      const scoredClusters = clusters.map(cluster => ({
        ...cluster,
        width: cluster.last - cluster.first + 1,
        score: (cluster.last - cluster.first + 1) * cluster.count
      })).sort((a, b) => b.score - a.score);
      const best = scoredClusters[0];
      const useful = best
        ? scoredClusters.filter(cluster => cluster.width >= Math.max(8, height * 0.55) && cluster.score >= best.score * 0.22)
        : [];
      const minX = useful.length ? Math.min(...useful.map(cluster => cluster.first)) : 0;
      const maxX = useful.length ? Math.max(...useful.map(cluster => cluster.last)) : -1;
      const width = maxX - minX + 1;
      if (useful.length && width >= canvas.width * 0.12 && height >= 5 && group.pixels >= 70) {
        groups.push({ ...group, minX, maxX, width, height });
      }
      group = null;
    };
    for (let y = 0; y < canvas.height; y += 1) {
      if (rowCounts[y] < rowThreshold) continue;
      if (!group || y - group.lastY > maxGap) {
        finishGroup();
        group = { firstY: y, lastY: y, pixels: rowCounts[y] };
        continue;
      }
      group.lastY = y;
      group.pixels += rowCounts[y];
    }
    finishGroup();
    const rectangles = groups
      .sort((a, b) => (b.pixels / (b.width * b.height)) - (a.pixels / (a.width * a.height)))
      .slice(0, 8)
      .map(group => {
        const horizontalPadding = Math.max(12, Math.round(group.height * 0.55));
        const topPadding = Math.max(5, Math.round(group.height * 0.22));
        const bottomPadding = Math.max(4, Math.round(group.height * 0.16));
        const left = Math.max(0, group.minX - horizontalPadding);
        const top = Math.max(0, group.firstY - topPadding);
        return {
          left,
          top,
          width: Math.min(canvas.width - left, group.width + horizontalPadding * 2),
          height: Math.min(canvas.height - top, group.height + topPadding + bottomPadding)
        };
      });
    const full = await canvasToPngBlob(canvas, "Не удалось подготовить общий поиск координат");
    const bands = await Promise.all(rectangles.map(async rectangle => {
      const crop = document.createElement("canvas");
      crop.width = rectangle.width;
      crop.height = rectangle.height;
      const cropContext = crop.getContext("2d");
      cropContext.fillStyle = "#fff";
      cropContext.fillRect(0, 0, crop.width, crop.height);
      cropContext.imageSmoothingEnabled = false;
      cropContext.drawImage(canvas, rectangle.left, rectangle.top, rectangle.width, rectangle.height, 0, 0, crop.width, crop.height);
      return canvasToPngBlob(crop, "Не удалось подготовить цветную строку координат");
    }));
    return { full, bands, rectangles };
  }

  function canvasToPngBlob(canvas, errorMessage) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(errorMessage)), "image/png"));
  }

  function openAreaOcr(id) {
    if (state.ocrBusy) { showNotice("Дождитесь завершения текущего распознавания.", true); return; }
    const point = state.points.find(item => item.id === id);
    if (!point?.file) return;
    state.areaPointId = id;
    elements.areaOcrFilename.textContent = point.name;
    elements.areaOcrImage.src = point.previewUrl;
    resetAreaSelection();
    elements.areaOcrDialog.showModal();
  }

  function resetAreaSelection() {
    state.areaSelection = null;
    state.areaDrag = null;
    state.areaCandidates = [];
    elements.areaOcrSelection.classList.add("hidden");
    elements.runAreaOcr.disabled = true;
    elements.areaOcrResult.classList.add("hidden");
    elements.areaOcrCandidates.textContent = "";
    elements.areaOcrLat.value = "";
    elements.areaOcrLon.value = "";
    elements.areaOcrStatus.textContent = "Область пока не выбрана";
    elements.areaOcrError.classList.add("hidden");
  }

  function imagePointerPosition(event) {
    const bounds = elements.areaOcrImage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  function startAreaSelection(event) {
    if (event.button !== 0 || !elements.areaOcrImage.naturalWidth || state.ocrBusy) return;
    const start = imagePointerPosition(event);
    state.areaDrag = { pointerId: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    drawAreaSelection(start, start);
    event.preventDefault();
  }

  function updateAreaSelection(event) {
    if (state.areaDrag?.pointerId !== event.pointerId) return;
    drawAreaSelection(state.areaDrag.start, imagePointerPosition(event));
  }

  function finishAreaSelection(event) {
    if (state.areaDrag?.pointerId !== event.pointerId) return;
    const start = state.areaDrag.start;
    state.areaDrag = null;
    if (event.type === "pointercancel") { resetAreaSelection(); return; }
    const end = imagePointerPosition(event);
    const selection = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    if (selection.width * elements.areaOcrImage.naturalWidth < 12 || selection.height * elements.areaOcrImage.naturalHeight < 12) {
      resetAreaSelection();
      elements.areaOcrStatus.textContent = "Выделите область побольше";
      return;
    }
    state.areaSelection = selection;
    drawAreaSelection(start, end);
    elements.runAreaOcr.disabled = false;
    elements.areaOcrResult.classList.add("hidden");
    elements.areaOcrStatus.textContent = `Выбрано ${Math.round(selection.width * elements.areaOcrImage.naturalWidth)} × ${Math.round(selection.height * elements.areaOcrImage.naturalHeight)} пикселей`;
  }

  function drawAreaSelection(start, end) {
    const selection = elements.areaOcrSelection;
    selection.style.left = `${Math.min(start.x, end.x) * 100}%`;
    selection.style.top = `${Math.min(start.y, end.y) * 100}%`;
    selection.style.width = `${Math.abs(end.x - start.x) * 100}%`;
    selection.style.height = `${Math.abs(end.y - start.y) * 100}%`;
    selection.classList.remove("hidden");
  }

  async function createAreaOcrImages(file, selection) {
    const bitmap = await createImageBitmap(file);
    const left = Math.floor(selection.x * bitmap.width);
    const top = Math.floor(selection.y * bitmap.height);
    const width = Math.max(1, Math.min(bitmap.width - left, Math.ceil(selection.width * bitmap.width)));
    const height = Math.max(1, Math.min(bitmap.height - top, Math.ceil(selection.height * bitmap.height)));
    const scale = Math.min(3, 1600 / width, 2200 / height);
    const base = document.createElement("canvas");
    base.width = Math.max(1, Math.round(width * scale));
    base.height = Math.max(1, Math.round(height * scale));
    const context = base.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, left, top, width, height, 0, 0, base.width, base.height);
    bitmap.close();
    const original = context.getImageData(0, 0, base.width, base.height);
    const sources = [{ name: "Оригинал", blob: await canvasToPngBlob(base, "Не удалось подготовить фрагмент"), mode: "6" }];
    sources.push({ name: "Оригинал, свободный текст", blob: sources[0].blob, mode: "11" });
    for (const { name, threshold, light } of [
      { name: "Тёмная надпись", threshold: 145, light: false },
      { name: "Светлая надпись", threshold: 185, light: true },
      { name: "Очень светлая надпись", threshold: 225, light: true }
    ]) {
      const canvas = document.createElement("canvas");
      canvas.width = base.width; canvas.height = base.height;
      const pixels = canvas.getContext("2d").createImageData(base.width, base.height);
      for (let index = 0; index < original.data.length; index += 4) {
        const luminance = original.data[index] * .299 + original.data[index + 1] * .587 + original.data[index + 2] * .114;
        const selected = light ? luminance >= threshold : luminance <= threshold;
        const value = selected ? 0 : 255;
        pixels.data[index] = value; pixels.data[index + 1] = value; pixels.data[index + 2] = value; pixels.data[index + 3] = 255;
      }
      canvas.getContext("2d").putImageData(pixels, 0, 0);
      sources.push({ name, blob: await canvasToPngBlob(canvas, "Не удалось подготовить фрагмент"), mode: "6" });
    }
    return sources;
  }

  async function runAreaOcr() {
    const point = state.points.find(item => item.id === state.areaPointId);
    if (!point || !state.areaSelection || state.ocrBusy) return;
    const selection = state.areaSelection;
    state.ocrBusy = true;
    elements.runAreaOcr.disabled = true;
    elements.areaOcrStatus.textContent = "Распознаю выбранную область…";
    elements.areaOcrResult.classList.add("hidden");
    try {
      const worker = await getOcrWorker();
      const sources = await createAreaOcrImages(point.file, selection);
      const candidates = new Map();
      try {
        for (const source of sources) {
          await worker.setParameters({ tessedit_pageseg_mode: source.mode, tessedit_char_whitelist: "0123456789+-,.;: " });
          const result = await worker.recognize(source.blob);
          if (ocrDebug) ocrDebug.push({ pass: `area-${source.name}`, text: result.data.text });
          const parsed = core.extractCoordinatesFromText(result.data.text);
          if (!core.hasCoordinates(parsed)) continue;
          const key = `${parsed.latitude.toFixed(6)},${parsed.longitude.toFixed(6)}`;
          const candidate = candidates.get(key) || { latitude: parsed.latitude, longitude: parsed.longitude, votes: 0, confidence: 0, rawText: result.data.text };
          candidate.votes += 1;
          if ((result.data.confidence || 0) > candidate.confidence) { candidate.confidence = result.data.confidence || 0; candidate.rawText = result.data.text; }
          candidates.set(key, candidate);
        }
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" });
      }
      if (state.areaPointId !== point.id || state.areaSelection !== selection) return;
      state.areaCandidates = [...candidates.values()].sort((a, b) => b.votes - a.votes || b.confidence - a.confidence);
      elements.areaOcrCandidates.textContent = "";
      if (state.areaCandidates.length) {
        state.areaCandidates.forEach((candidate, index) => {
          const label = `${candidate.latitude.toFixed(6)}, ${candidate.longitude.toFixed(6)}${candidate.votes > 1 ? ` · ${candidate.votes} совпадения` : ""}`;
          elements.areaOcrCandidates.add(new Option(label, String(index)));
        });
        elements.areaOcrCandidates.disabled = false;
        showSelectedAreaCandidate();
        elements.areaOcrStatus.textContent = `Найдено вариантов: ${state.areaCandidates.length}. Сверьте цифры с фото перед применением.`;
      } else {
        elements.areaOcrCandidates.add(new Option("Не найдено — введите координаты вручную", ""));
        elements.areaOcrCandidates.disabled = true;
        elements.areaOcrLat.value = "";
        elements.areaOcrLon.value = "";
        elements.areaOcrStatus.textContent = "OCR не нашёл пару координат. Можно выбрать другую область или ввести цифры вручную.";
      }
      elements.areaOcrResult.classList.remove("hidden");
    } catch (error) {
      console.error(error);
      elements.areaOcrStatus.textContent = "Не удалось распознать область. Попробуйте выбрать её заново.";
    } finally {
      state.ocrBusy = false;
      elements.runAreaOcr.disabled = !state.areaSelection;
    }
  }

  function showSelectedAreaCandidate() {
    const candidate = state.areaCandidates[Number(elements.areaOcrCandidates.value)];
    if (!candidate) return;
    elements.areaOcrLat.value = candidate.latitude.toFixed(6);
    elements.areaOcrLon.value = candidate.longitude.toFixed(6);
    elements.areaOcrError.classList.add("hidden");
  }

  function applyAreaOcr() {
    const point = state.points.find(item => item.id === state.areaPointId);
    if (!point) return;
    const latText = elements.areaOcrLat.value.trim(), lonText = elements.areaOcrLon.value.trim();
    const latitude = Number(latText), longitude = Number(lonText);
    if (!latText || !lonText || !core.hasCoordinates({ latitude, longitude })) {
      elements.areaOcrError.textContent = "Введите корректные широту и долготу.";
      elements.areaOcrError.classList.remove("hidden");
      return;
    }
    const selected = state.areaCandidates[Number(elements.areaOcrCandidates.value)];
    const fromOcr = selected && selected.latitude.toFixed(6) === latitude.toFixed(6) && selected.longitude.toFixed(6) === longitude.toFixed(6);
    point.latitude = latitude; point.longitude = longitude;
    point.source = fromOcr ? "OCR по области — проверьте" : "ручной ввод";
    point.error = null; point.ocrText = fromOcr ? selected.rawText : null;
    elements.areaOcrDialog.close();
    render();
    showNotice(`Координаты «${point.name}» обновлены.`, false);
  }

  function render() {
    const hasPoints = state.points.length > 0;
    elements.dropZone.classList.toggle("hidden", hasPoints);
    elements.workspace.classList.toggle("hidden", !hasPoints);
    if (!hasPoints) {
      state.customPoint = null;
      elements.allPairsPanel.classList.add("hidden");
      renderCustomMeasurement();
      return;
    }
    renderPoints(); renderSelectors(); renderMetrics(); renderMapRoute(); renderAllPairs();
  }

  function renderPoints() {
    elements.pointsList.textContent = "";
    state.points.forEach((point, index) => {
      const card = elements.pointTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.id = point.id;
      card.classList.toggle("invalid", !core.hasCoordinates(point));
      card.querySelector(".point-order").textContent = index + 1;
      const image = card.querySelector(".point-thumb"); image.src = point.previewUrl; image.alt = `Миниатюра ${point.name}`;
      card.querySelector("h4").textContent = point.name;
      const badge = card.querySelector(".source-badge"); badge.textContent = point.source; badge.classList.toggle("manual", point.source !== "EXIF");
      card.querySelector(".coordinates").textContent = core.hasCoordinates(point) ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "Координаты не заданы";
      card.querySelector(".metadata").textContent = metadataText(point);
      const segment = index ? core.distanceWgs84(state.points[index - 1], point) : null;
      card.querySelector(".segment-distance").textContent = index ? `От предыдущей: ${core.formatDistance(segment)}` : "Начальная точка";
      const up = card.querySelector(".move-up"), down = card.querySelector(".move-down");
      up.disabled = index === 0; down.disabled = index === state.points.length - 1;
      up.addEventListener("click", () => movePoint(index, -1)); down.addEventListener("click", () => movePoint(index, 1));
      card.querySelector(".edit").addEventListener("click", () => openEdit(point.id));
      const retryButton = card.querySelector(".retry-ocr");
      retryButton.classList.toggle("hidden", !!mobile);
      retryButton.addEventListener("click", () => openAreaOcr(point.id));
      card.querySelector(".remove").addEventListener("click", () => removePoint(point.id));
      elements.pointsList.appendChild(card);
    });
  }

  function metadataText(point) {
    const values = [];
    if (point.altitude !== null) values.push(`высота ${point.altitude.toFixed(1)} м`);
    if (point.accuracy !== null) values.push(`точность ±${point.accuracy.toFixed(1)} м`);
    if (point.capturedAt) values.push(formatExifDate(point.capturedAt));
    return values.join(" · ") || point.error || "Нет дополнительных данных";
  }

  function renderSelectors() {
    const oldA = elements.pointA.value, oldB = elements.pointB.value, oldOrigin = elements.facilityOrigin.value;
    const options = state.points.filter(core.hasCoordinates);
    [elements.pointA, elements.pointB, elements.facilityOrigin].forEach(select => { select.textContent = ""; });
    options.forEach((point) => {
      const index = state.points.indexOf(point) + 1;
      const label = `${index}. ${point.name}`;
      elements.pointA.add(new Option(label, point.id)); elements.pointB.add(new Option(label, point.id));
      elements.facilityOrigin.add(new Option(label, point.id));
    });
    elements.pointA.value = options.some(p => String(p.id) === oldA) ? oldA : String(options[0]?.id || "");
    elements.pointB.value = options.some(p => String(p.id) === oldB) ? oldB : String(options[Math.min(1, options.length - 1)]?.id || "");
    elements.facilityOrigin.value = options.some(p => String(p.id) === oldOrigin) ? oldOrigin : String(options[0]?.id || "");
    renderPairMeasurement();
  }

  function renderMetrics() {
    const valid = state.points.filter(core.hasCoordinates);
    const total = core.routeDistance(state.points);
    const direct = valid.length > 1 ? core.distanceWgs84(valid[0], valid[valid.length - 1]) : null;
    const altitudes = valid.map(point => point.altitude).filter(Number.isFinite);
    elements.pointCount.textContent = String(state.points.length);
    elements.totalDistance.textContent = valid.length > 1 ? core.formatDistance(total) : "—";
    elements.directDistance.textContent = core.formatDistance(direct);
    elements.elevationDelta.textContent = altitudes.length > 1 ? `${(altitudes[altitudes.length - 1] - altitudes[0]).toFixed(1)} м` : "—";
    elements.routeSummary.textContent = `${state.points.length} ${plural(state.points.length, "точка", "точки", "точек")} · ${valid.length} с GPS`;
  }

  function renderAllPairs() {
    elements.allPairsPanel.classList.toggle("hidden", !!mobile || state.points.filter(core.hasCoordinates).length < 2);
    if (mobile || elements.allPairsPanel.classList.contains("hidden")) return;
    const pairs = core.allPairDistances(state.points);
    const closeCount = pairs.filter(pair => pair.distance < 25).length;
    const filtered = elements.allPairsFilter.value === "close" ? pairs.filter(pair => pair.distance < 25) : pairs;
    const shown = filtered.slice(0, state.allPairsLimit);
    elements.allPairsSummary.textContent = `${pairs.length} ${plural(pairs.length, "пара", "пары", "пар")} · ближе 25 м: ${closeCount}`;
    elements.allPairsList.textContent = "";
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "all-pairs-empty";
      empty.textContent = elements.allPairsFilter.value === "close" ? "Близких пар нет. Переключите фильтр, чтобы увидеть все расстояния." : "Нет пар с координатами.";
      elements.allPairsList.appendChild(empty);
    }
    const fragment = document.createDocumentFragment();
    shown.forEach(pair => {
      const first = state.points[pair.firstIndex], second = state.points[pair.secondIndex];
      const row = document.createElement("div");
      row.className = `all-pair${pair.distance < 25 ? " close" : ""}`;
      const label = document.createElement("span");
      label.className = "all-pair-label";
      label.textContent = `${pair.firstIndex + 1}. ${first.name} ↔ ${pair.secondIndex + 1}. ${second.name}`;
      const distance = document.createElement("span");
      distance.className = "all-pair-distance";
      distance.textContent = core.formatDistance(pair.distance);
      const measure = document.createElement("button");
      measure.className = "secondary";
      measure.type = "button";
      measure.textContent = "Измерить";
      measure.addEventListener("click", () => selectPair(first.id, second.id));
      const showMap = document.createElement("button");
      showMap.className = "secondary";
      showMap.type = "button";
      showMap.textContent = "На карте";
      showMap.addEventListener("click", () => showPairOnMap(first.id, second.id));
      row.append(label, distance, measure, showMap);
      fragment.appendChild(row);
    });
    elements.allPairsList.appendChild(fragment);
    elements.allPairsShown.textContent = `Показано ${shown.length} из ${filtered.length}`;
    elements.allPairsMore.classList.toggle("hidden", shown.length >= filtered.length);
  }

  function selectPair(firstId, secondId) {
    elements.pointA.value = String(firstId);
    elements.pointB.value = String(secondId);
    renderPairMeasurement();
    elements.pairDistance.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function showPairOnMap(firstId, secondId) {
    selectPair(firstId, secondId);
    if (!state.mapLoaded) await loadMapAndFacilities();
    if (!state.mapLoaded) return;
    setTimeout(() => {
      const first = state.points.find(point => point.id === firstId);
      const second = state.points.find(point => point.id === secondId);
      if (!core.hasCoordinates(first) || !core.hasCoordinates(second)) return;
      renderPairHighlight();
      state.map.invalidateSize();
      state.map.fitBounds(window.L.latLngBounds([[first.latitude, first.longitude], [second.latitude, second.longitude]]).pad(.35), { maxZoom: 18 });
      elements.routeMap.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function renderPairMeasurement() {
    const a = state.points.find(point => String(point.id) === elements.pointA.value);
    const b = state.points.find(point => String(point.id) === elements.pointB.value);
    const distance = core.distanceWgs84(a, b);
    elements.pairDistance.textContent = core.formatDistance(distance);
    if (distance === null) { elements.pairDetails.textContent = "Выберите две точки"; renderPairHighlight(); return; }
    const bearing = core.bearingDegrees(a, b);
    const altitudeText = Number.isFinite(a.altitude) && Number.isFinite(b.altitude) ? ` · перепад ${(b.altitude - a.altitude).toFixed(1)} м` : "";
    elements.pairDetails.textContent = `Азимут ${bearing.toFixed(1)}°${altitudeText}`;
    renderMapRoute();
    renderPairHighlight();
    renderCustomMeasurement();
  }

  function renderPairHighlight() {
    if (!state.mapLoaded || !state.pairLayer) return;
    state.pairLayer.clearLayers();
    const first = state.points.find(point => String(point.id) === elements.pointA.value);
    const second = state.points.find(point => String(point.id) === elements.pointB.value);
    if (!core.hasCoordinates(first) || !core.hasCoordinates(second) || first.id === second.id) return;
    window.L.polyline([[first.latitude, first.longitude], [second.latitude, second.longitude]], { color: "#ffd280", weight: 5, opacity: .95, dashArray: "8 6" }).addTo(state.pairLayer);
  }

  async function loadMapAndFacilities() {
    if (!window.L) {
      setMapStatus("Картографический модуль не загрузился.", true);
      return;
    }
    if (!state.mapLoaded) {
      elements.mapPrivacy.classList.add("hidden");
      elements.routeMap.classList.remove("hidden");
      elements.facilityResults.classList.remove("hidden");
      state.map = window.L.map(elements.routeMap, { preferCanvas: true, zoomControl: true });
      const tileLayer = createYandexTileLayer();
      let tileErrors = 0;
      tileLayer.on("tileerror", () => {
        tileErrors += 1;
        if (tileErrors < 2) return;
        state.mapTileFailed = true;
        setMapStatus("Подложка Яндекс Карт не загрузилась. Проверьте интернет или обратитесь к владельцу приложения — сотрудникам менять ключ не требуется.", true);
      });
      tileLayer.on("tileload", () => { state.mapTileFailed = false; });
      tileLayer.addTo(state.map);
      addYandexLogo(state.map);
      state.routeLayer = window.L.layerGroup().addTo(state.map);
      state.poiLayer = window.L.layerGroup().addTo(state.map);
      state.customLayer = window.L.layerGroup().addTo(state.map);
      state.pairLayer = window.L.layerGroup().addTo(state.map);
      state.map.on("click", event => setCustomPoint(event.latlng.lat, event.latlng.lng));
      state.mapLoaded = true;
      elements.customPointPanel.classList.remove("hidden");
      elements.loadMapButton.textContent = "Обновить карту и объекты";
      setTimeout(() => { state.map.invalidateSize(); renderMapRoute(); renderPairHighlight(); renderCustomMeasurement(); }, 0);
    }
    await loadFacilities();
  }

  function createYandexTileLayer() {
    const options = {
      minZoom: 0,
      maxZoom: 20,
      tileSize: 256,
      attribution: '&copy; <a href="https://yandex.ru/maps/" data-yandex-external="maps">Яндекс</a> · <a href="https://yandex.ru/legal/maps_termsofuse" data-yandex-external="terms">Условия использования</a>'
    };
    if (!mobile) return window.L.tileLayer("/api/yandex-tile?x={x}&y={y}&z={z}", options);
    const MobileYandexLayer = window.L.TileLayer.extend({
      createTile(coords, done) {
        const image = document.createElement("img");
        image.alt = "";
        image.setAttribute("role", "presentation");
        const cacheKey = `${coords.z}/${coords.x}/${coords.y}`;
        const cached = mobileTileCache.get(cacheKey);
        if (cached) {
          image.src = cached;
          queueMicrotask(() => done(null, image));
          return image;
        }
        mobile.getYandexTile(coords.x, coords.y, coords.z).then(dataUrl => {
          mobileTileCache.set(cacheKey, dataUrl);
          if (mobileTileCache.size > 96) mobileTileCache.delete(mobileTileCache.keys().next().value);
          image.onload = () => done(null, image);
          image.onerror = () => done(new Error("Не удалось отобразить тайл"), image);
          image.src = dataUrl;
        }).catch(error => done(error, image));
        return image;
      }
    });
    return new MobileYandexLayer("", options);
  }

  function addYandexLogo(map) {
    const YandexLogoControl = window.L.Control.extend({
      options: { position: "bottomleft" },
      onAdd() {
        const link = window.L.DomUtil.create("a", "yandex-map-logo");
        link.href = "https://yandex.ru/maps/";
        link.dataset.yandexExternal = "maps";
        link.setAttribute("aria-label", "Открыть Яндекс Карты");
        const image = document.createElement("img");
        image.src = "assets/yandex-maps-logo.svg";
        image.alt = "Яндекс Карты";
        link.appendChild(image);
        window.L.DomEvent.disableClickPropagation(link);
        return link;
      }
    });
    new YandexLogoControl().addTo(map);
  }

  async function openAllowedYandexPage(target) {
    const urls = {
      maps: "https://yandex.ru/maps/",
      terms: "https://yandex.ru/legal/maps_termsofuse"
    };
    const url = urls[target];
    if (!url) throw new Error("Ссылка не разрешена");
    if (mobile) {
      await mobile.openExternal(url);
      return;
    }
    const response = await fetch(`/api/open-external?target=${encodeURIComponent(target)}`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  }

  async function openSelectedInYandex() {
    const origin = state.points.find(point => String(point.id) === elements.facilityOrigin.value);
    if (!core.hasCoordinates(origin)) {
      setMapStatus("Выберите точку с координатами.", true);
      return;
    }
    elements.openYandexButton.disabled = true;
    setMapStatus(`Открываю «${origin.name}» в Яндекс Картах…`, false);
    try {
      if (mobile) {
        const coordinates = `${origin.latitude.toFixed(7)}, ${origin.longitude.toFixed(7)}`;
        const url = `https://yandex.ru/maps/?text=${encodeURIComponent(coordinates)}`;
        let copied = false;
        try {
          await mobile.copyText(coordinates);
          copied = true;
        } catch (error) {
          console.warn("Не удалось скопировать координаты", error);
        }
        await mobile.openExternal(url);
        setMapStatus(`Точка «${origin.name}» открыта в Яндекс Картах.${copied ? " Координаты скопированы." : ""} Осмотрите объекты вокруг неё.`, false);
        return;
      }
      const response = await fetch(`/api/open-yandex?lat=${encodeURIComponent(origin.latitude)}&lon=${encodeURIComponent(origin.longitude)}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const copied = payload.copied ? " Координаты скопированы — при необходимости вставьте их в поиск." : "";
      setMapStatus(`Точка «${origin.name}» открыта в Яндекс Картах.${copied} Осмотрите объекты вокруг неё в браузере.`, false);
    } catch (error) {
      console.error(error);
      setMapStatus(error.message || "Не удалось открыть Яндекс Карты.", true);
    } finally {
      elements.openYandexButton.disabled = false;
    }
  }

  function renderMapRoute() {
    if (!state.mapLoaded || !state.map || !state.routeLayer) return;
    state.routeLayer.clearLayers();
    const points = state.points.filter(core.hasCoordinates);
    if (!points.length) return;
    const latLngs = points.map(point => [point.latitude, point.longitude]);
    window.L.polyline(latLngs, { color: "#3ed47d", weight: 4, opacity: .9 }).addTo(state.routeLayer);
    points.forEach(point => {
      const number = state.points.indexOf(point) + 1;
      const marker = window.L.marker([point.latitude, point.longitude], {
        icon: window.L.divIcon({ className: "", html: `<div class="route-marker">${number}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: point.name
      }).addTo(state.routeLayer);
      marker.bindPopup(popupContent(`Точка ${number}`, point.name, `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`));
    });
    const visiblePoints = state.customPoint ? [...latLngs, [state.customPoint.latitude, state.customPoint.longitude]] : latLngs;
    if (!state.facilities.length) state.map.fitBounds(window.L.latLngBounds(visiblePoints).pad(.18), { maxZoom: 17 });
  }

  function setCustomPoint(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    state.customPoint = { latitude, longitude };
    renderCustomMeasurement();
  }

  function renderCustomMeasurement() {
    if (!state.mapLoaded || !state.customLayer) return;
    state.customLayer.clearLayers();
    const customPoint = state.customPoint;
    elements.clearCustomPointButton.classList.toggle("hidden", !customPoint);
    if (!customPoint) {
      elements.customPointResult.textContent = "Точка пока не выбрана";
      return;
    }
    const origin = state.points.find(point => String(point.id) === elements.facilityOrigin.value);
    const marker = window.L.marker([customPoint.latitude, customPoint.longitude], {
      draggable: true,
      icon: window.L.divIcon({ className: "", html: '<div class="custom-marker">+</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: "Произвольная точка"
    }).addTo(state.customLayer);
    marker.on("dragend", event => {
      const position = event.target.getLatLng();
      setCustomPoint(position.lat, position.lng);
    });
    const coordinates = `${customPoint.latitude.toFixed(6)}, ${customPoint.longitude.toFixed(6)}`;
    if (!core.hasCoordinates(origin)) {
      elements.customPointResult.textContent = `${coordinates} · выберите исходную точку маршрута`;
      marker.bindPopup(popupContent("Произвольная точка", coordinates, "Выберите исходную точку маршрута"));
      return;
    }
    const distance = core.distanceWgs84(origin, customPoint);
    const bearing = core.bearingDegrees(origin, customPoint);
    const details = `От «${origin.name}»: ${core.formatDistance(distance)} · азимут ${bearing.toFixed(1)}°`;
    elements.customPointResult.textContent = `${coordinates} · ${details}`;
    marker.bindPopup(popupContent("Произвольная точка", coordinates, details));
    window.L.polyline([[origin.latitude, origin.longitude], [customPoint.latitude, customPoint.longitude]], {
      color: "#75b8ff", weight: 3, opacity: .9, dashArray: "8 7"
    }).addTo(state.customLayer);
  }

  async function loadFacilities() {
    const origin = state.points.find(point => String(point.id) === elements.facilityOrigin.value);
    if (!core.hasCoordinates(origin)) {
      setMapStatus("Выберите точку с координатами.", true);
      return;
    }
    const radius = Number(elements.facilityRadius.value);
    elements.loadMapButton.disabled = true;
    setMapStatus("Ищу ближайшие объекты по данным OpenStreetMap…", false);
    try {
      let payload;
      if (mobile) {
        payload = await mobile.fetchPois(origin.latitude, origin.longitude, radius);
      } else {
        const response = await fetch(`/api/pois?lat=${encodeURIComponent(origin.latitude)}&lon=${encodeURIComponent(origin.longitude)}&radius=${radius}`);
        payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      }
      state.facilities = (payload.elements || []).map(core.normalizeOsmFacility).filter(Boolean);
      renderNearestFacilities();
      if (!state.mapTileFailed) setMapStatus(`Получено объектов: ${state.facilities.length}. Расстояния рассчитаны от «${origin.name}».`, false);
    } catch (error) {
      console.error(error);
      state.facilities = [];
      renderNearestFacilities();
      setMapStatus(error.message || "Не удалось получить данные карты.", true);
    } finally {
      elements.loadMapButton.disabled = false;
    }
  }

  function renderNearestFacilities() {
    if (!state.mapLoaded || !state.poiLayer) return;
    const origin = state.points.find(point => String(point.id) === elements.facilityOrigin.value);
    state.poiLayer.clearLayers();
    elements.facilityResults.textContent = "";
    if (!core.hasCoordinates(origin)) return;
    const selected = new Set(elements.categoryFilters.filter(input => input.checked).map(input => input.value));
    const categories = [
      ["police", "Полиция", "П"], ["mvd", "МВД", "М"], ["fsb", "ФСБ", "Ф"],
      ["playground", "Детская площадка", "ДП"], ["kindergarten", "Детский сад", "ДС"], ["school", "Школа", "Ш"]
    ];
    const nearestPoints = [];
    categories.forEach(([key, title, abbreviation]) => {
      if (!selected.has(key)) return;
      const matches = state.facilities
        .filter(facility => facility.categories.includes(key))
        .map(facility => ({ facility, distance: core.distanceWgs84(origin, facility) }))
        .sort((a, b) => a.distance - b.distance);
      const nearest = matches[0];
      const card = document.createElement("article");
      card.className = `facility-card${nearest ? "" : " empty"}`;
      const label = document.createElement("span"); label.textContent = title;
      const distance = document.createElement("strong"); distance.textContent = nearest ? core.formatDistance(nearest.distance) : "Не найдено";
      const name = document.createElement("small"); name.textContent = nearest ? nearest.facility.name : `В радиусе ${Number(elements.facilityRadius.value) / 1000} км`;
      card.append(label, distance, name); elements.facilityResults.appendChild(card);
      if (!nearest) return;
      const facility = nearest.facility;
      nearestPoints.push([facility.latitude, facility.longitude]);
      const marker = window.L.marker([facility.latitude, facility.longitude], {
        icon: window.L.divIcon({ className: "", html: `<div class="poi-marker">${abbreviation}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: facility.name
      }).addTo(state.poiLayer);
      marker.bindPopup(popupContent(title, facility.name, `По прямой: ${core.formatDistance(nearest.distance)}`));
      window.L.polyline([[origin.latitude, origin.longitude], [facility.latitude, facility.longitude]], {
        color: "#ffd280", weight: 2, opacity: .6, dashArray: "6 7"
      }).addTo(state.poiLayer);
    });
    const routePoints = state.points.filter(core.hasCoordinates).map(point => [point.latitude, point.longitude]);
    const customPoints = state.customPoint ? [[state.customPoint.latitude, state.customPoint.longitude]] : [];
    const boundsPoints = [...routePoints, ...nearestPoints, ...customPoints];
    if (boundsPoints.length) state.map.fitBounds(window.L.latLngBounds(boundsPoints).pad(.15), { maxZoom: 16 });
  }

  function popupContent(title, name, details) {
    const container = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = title;
    const line1 = document.createElement("div"); line1.textContent = name;
    const line2 = document.createElement("small"); line2.textContent = details;
    container.append(strong, line1, line2); return container;
  }

  function setMapStatus(text, isError) {
    elements.mapStatus.textContent = text;
    elements.mapStatus.classList.remove("hidden");
    elements.mapStatus.classList.toggle("error", !!isError);
  }
  function movePoint(index, delta) { const target = index + delta; [state.points[index], state.points[target]] = [state.points[target], state.points[index]]; render(); }
  function removePoint(id) { const index = state.points.findIndex(point => point.id === id); if (index < 0) return; URL.revokeObjectURL(state.points[index].previewUrl); state.points.splice(index, 1); render(); }

  function openEdit(id) {
    const point = state.points.find(item => item.id === id); if (!point) return;
    elements.editId.value = point.id; elements.editFilename.textContent = point.name;
    elements.editLat.value = point.latitude ?? ""; elements.editLon.value = point.longitude ?? "";
    elements.editAltitude.value = point.altitude ?? ""; elements.editAccuracy.value = point.accuracy ?? "";
    elements.editNote.value = point.note || ""; elements.editError.classList.add("hidden"); elements.editDialog.showModal();
  }

  function saveEdit(event) {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const lat = Number(elements.editLat.value), lon = Number(elements.editLon.value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      elements.editError.textContent = "Проверьте широту (−90…90) и долготу (−180…180)."; elements.editError.classList.remove("hidden"); return;
    }
    const point = state.points.find(item => item.id === Number(elements.editId.value)); if (!point) return;
    point.latitude = lat; point.longitude = lon;
    point.altitude = elements.editAltitude.value === "" ? null : Number(elements.editAltitude.value);
    point.accuracy = elements.editAccuracy.value === "" ? null : Number(elements.editAccuracy.value);
    point.note = elements.editNote.value.trim(); point.source = "ручной ввод"; point.error = null;
    elements.editDialog.close(); render();
  }

  async function exportCsv() {
    const csv = core.pointsToCsv(state.points);
    const filename = `координаты-${new Date().toISOString().slice(0, 10)}.csv`;
    if (mobile) {
      try {
        await mobile.shareCsv(csv, filename);
      } catch (error) {
        console.error(error);
        showNotice("Не удалось открыть меню сохранения CSV.", false);
      }
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showNotice(text, persistent) {
    elements.notice.textContent = text; elements.notice.classList.remove("hidden");
    clearTimeout(showNotice.timer);
    if (!persistent) showNotice.timer = setTimeout(() => elements.notice.classList.add("hidden"), 8000);
  }
  function sortableDate(value) { if (!value) return Number.MAX_SAFE_INTEGER; const timestamp = Date.parse(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")); return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp; }
  function formatExifDate(value) { return value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$3.$2.$1"); }
  function plural(number, one, few, many) { const n = Math.abs(number) % 100, n1 = n % 10; if (n > 10 && n < 20) return many; if (n1 > 1 && n1 < 5) return few; if (n1 === 1) return one; return many; }

  render();
})();
