# Coordinate Meter

[Русская версия](./README.md)

An offline Windows/Electron and Android utility for extracting GPS coordinates from field photos, validating uncertain OCR results and calculating distances between points.

The project was built for mixed real-world photo sets produced by different camera applications, where coordinate overlays vary in position, typography and image quality.

## Capabilities

- EXIF GPS extraction when metadata is available;
- OCR fallback for coordinates printed into a photo;
- specialized recognition for NoteCam and GPS Camera 55 layouts;
- multiple crop and contrast passes for noisy overlays;
- selected-area OCR retry with user review before applying a result;
- protection against reconstructing an uncertain point from neighboring photos;
- pairwise distance calculation for every valid coordinate;
- distance filters, pagination, CSV export and map links;
- offline Tesseract and Leaflet assets;
- portable Windows packaging and an Android build path.

## Engineering approach

Recognition errors are more dangerous than missing values. The application therefore keeps OCR local to each image, exposes uncertain results for review and requires explicit confirmation before replacing a coordinate with a manually selected-area result.

The core distance and parsing logic is separated from the Electron and mobile interfaces so it can be tested without the desktop shell.

## Verification

- 20/20 representative NoteCam images passed the stabilized workflow;
- 15/15 mixed-format images passed the mixed-order dataset;
- 24/24 core and OCR integration tests pass in the current source tree.

Run the automated tests:

```powershell
pnpm install
pnpm test
```

Run the desktop application:

```powershell
pnpm start
```

Create a portable Windows build:

```powershell
pnpm run build:windows
```

## Security and distribution

Map-provider credentials, signing material, generated executables/APKs and local diagnostic data are excluded from version control. The repository includes an automated secret audit for public resources:

```powershell
pnpm run audit:secrets
```

## Stack

JavaScript · Electron · Capacitor · Tesseract.js · Leaflet · Node.js test runner · offline-first processing

## Status

Version 1.5.11 is the current Windows-focused source line. The Windows workflow is the verified primary target; Android remains available as a secondary build path.
