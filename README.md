# Time Garden — v1.1

Mobile-first, local-first time journal PWA.

## Run locally

Serve this folder over HTTP (service workers require localhost or HTTPS):

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

## Implemented in this build

- Pearl Dream and Pure White themes plus additional palettes.
- Monthly, weekly and yearly calendar views.
- Daily scrapbook page with photos, text, emoji stickers, washi strips, decorative marks and freehand SVG drawing.
- Selectable page objects with drag, resize, rotate, layer ordering, edit and delete controls.
- Touch pull gesture that follows the finger and triggers the page-tear transition on release.
- Real timestamp-based primary timer with persistence across reloads, pause/resume, and multiple independently stoppable concurrent context intervals.
- Context intervals are recorded as overlapping annotations and are not added to primary elapsed time.
- Local JSON export/import.
- Photo-to-washi PNG composition in Sticker Atelier.
- PWA manifest and offline shell cache.

## Honest limitations

- A browser PWA cannot read iOS Screen Time or inspect other apps. Automatic app-usage capture requires a native iOS companion and Apple's Screen Time APIs/entitlements.
- Sticker Atelier currently composes an imported image into a washi-style PNG. It does not yet perform AI subject segmentation/background removal or generative restyling.
- Animated GIF generation is not included in this build. A valid GIF encoder or server-side image pipeline is required; a static PNG is never mislabeled as a GIF.
- Data is currently stored in browser localStorage. Large image-heavy journals should migrate to IndexedDB before extensive use.

## Data safety

Use **Tema → Verilerini dışa aktar** regularly. Browser storage can be cleared by the user or the operating system.
