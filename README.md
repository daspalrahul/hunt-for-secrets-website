# Hunt for Secrets — Barcelona (Client‑Only Treasure Hunt)

A privacy‑first, **static** treasure hunt you can deploy on GitHub Pages. Solve clue riddles, go to the spot, take a photo, and get validated **entirely in your browser** (no servers).

**Live URL (after publishing):** `https://daspalrahul.github.io/hunt-for-secrets-website/`

---

## ✨ Features

- **Client‑only**: Photos, EXIF, geolocation, and optional detection run locally.
- **Geofence validation**: Checks if you’re within `radiusMeters` of a target lat/lon.
- **EXIF fallback**: If live location is denied, we use GPS from the photo (if present).
- **Optional object check**: COCO‑SSD runs in‑browser to spot generic objects for bonus points.
- **Face/plate privacy**: Auto face blur (BlazeFace) + manual blur rectangles on the photo preview.
- **Map preview**: Leaflet map with tier‑colored pins (A/B/C) and gentle jitter (no exact reveals).
- **Progress & scoring**: Points per clue, bonus for object match, warm/cold proximity meter.
- **Completion card**: Shareable PNG generated on‑device (Web Share / Download / **Copy Code**).
- **Completion code**: Offline, checksum‑protected code for bragging rights and peer verification.
- **Nearby**: Show clues within 500m.
- **Search & filters**: Find clues; filter by tier and completion status.
- **Accessibility**: High‑contrast mode, mobile‑first layout, large touch targets.
- **Data control**: Backup/restore progress JSON; reset all local data.
- **Privacy & Permissions**: Clear in‑app page + just‑in‑time rationale dialogs.

---

## 🗂 Project Structure

```
.
├── index.html                 # Main UI (splash, controls, modals)
├── style.css                  # Theme, mobile-first styles
├── js/
│   └── app.js                 # Game logic (validation, map, models, UI)
├── data/
│   └── locations.json         # Clues: {id, title, clue, lat, lon, radiusMeters, points, tier, labelsAnyOf}
├── images/                    # Background + icons
│   ├── bg.svg
│   ├── logo.png
│   └── icons/{map.svg,camera.svg,trophy.svg}
├── PRIVACY.md                 # Privacy & permissions policy
├── LICENSE                    # Restrictive license (permission required for reuse)
└── .github/workflows/pages.yml# GitHub Pages deploy
```

---

## ⚙️ How it Works (Tech Overview)

### Validation flow
1. User selects a clue and chooses/takes a photo (`<input type="file" capture="environment">`).
2. The app shows a **preview** and applies **auto/manual blur** (privacy).
3. We request **live geolocation** only after a **rationale prompt**; if declined, we try **EXIF GPS** via `exifr`.
4. Compute **Haversine** distance to the target; if within `radiusMeters` → success.
5. Optional **object check** (`@tensorflow-models/coco-ssd`) gives a small bonus.
6. Progress is saved in `localStorage`. No data is uploaded.

### Models
- **COCO‑SSD (TensorFlow.js)** for generic object presence.
- **BlazeFace** for face detection (blur on preview only).
- Both load via CDN and execute with WebGL/WebGPU/WASM in the browser.

### Map
- **Leaflet + OSM tiles**.
- Pins are **jittered** ~100 m (deterministic per clue id) to avoid exact reveals.
- **Tier colors**: A (green), B (amber), C (red).

### Completion
- **Card**: Canvas PNG with stats and a footer note (“on‑device”).
- **Code**: SHA‑256 of completed IDs + points (truncated), with a simple **checksum**.
- **Verify**: Paste a code; we validate format + checksum locally.

---

## 🚀 Running & Publishing

### Local run
Open `index.html` in a modern browser. For best results (permissions), use a static file server:
```bash
# any of these work
python3 -m http.server 8080
# or
npx http-server -p 8080
```
Then visit `http://localhost:8080/`.

### GitHub Pages
1. Create repo `daspalrahul/hunt-for-secrets-website` (default branch `main`).
2. Commit & push the files.
3. In **Settings → Pages**, choose **GitHub Actions** as the source.  
   The included workflow deploys on every push to `main`.
4. Your site will appear at `https://daspalrahul.github.io/hunt-for-secrets-website/`.

---

## 🧩 Editing Clues (`data/locations.json`)

Each entry:
```json
{
  "id": "sagrada",
  "title": "Sagrada Família",
  "clue": "Count the towers that look like honey-dripped spires.",
  "lat": 41.40363,
  "lon": 2.17436,
  "radiusMeters": 120,
  "points": 10,
  "tier": "A",
  "labelsAnyOf": ["church", "cathedral", "tower"]
}
```
- **lat/lon**: target location.  
- **radiusMeters**: tolerance; 80–150 m is typical for dense city GPS.  
- **labelsAnyOf**: optional object labels (generic) to award a small bonus when detected.

---

## 🔐 Privacy & Permissions

- **No tracking / analytics**.  
- **No uploads**: photos and location never leave your device.  
- **Permissions are requested only when needed**:
  - **Location**: at validation time to compute distance; fallback to EXIF if denied.
  - **Camera/Photos**: only when you choose a photo.
  - **Storage**: `localStorage` for progress.
- See **`PRIVACY.md`** for the full policy.

---

## ♿ Accessibility & Mobile

- Mobile-first layout with ≥44px touch targets.
- High-contrast mode (toggle in Privacy).
- Confetti/haptics are purely decorative and can be disabled via high-contrast mode if desired.

---

## 🧰 Troubleshooting

- **Location fails**: ensure device GPS is on, grant permission, or include EXIF GPS in your photo.  
- **Object detection slow**: enable **Battery Saver** (disables detection) or rely on geofence only.  

---

## 📄 License

Copyright (c) 2025 Rahul Daspal

This project is provided for **personal evaluation and non‑commercial use** only. **Any other use requires written permission.** See `LICENSE`.

---

## 🙌 Credits

- COCO‑SSD & BlazeFace via TensorFlow.js
- Leaflet & OpenStreetMap contributors
- exifr (EXIF parsing)
- Made with ❤️ for Barcelona adventures
