# Time Garden — v2.0

Mobile-first, local-first time journal PWA. No build step: the repository root is the deployed site.

```bash
npm test                 # unit tests for the time calculations (Node 20+)
python3 -m http.server 8080   # then open http://localhost:8080
```

## Structure

```
index.html            app shell, screens, SVG icon sprite
styles/tokens.css     design tokens + themes (Pearl Dream, Pure White, 4 extra palettes)
styles/app.css        shared components and screens
styles/journal.css    journal sheet + Sticker Atelier
src/core/             business logic, no DOM
  time.js             interval maths: union / intersect / subtract, day summaries
  tracker.js          session + event state transitions and validation
  analytics.js        day / week / month / year analysis
  migrate.js          schema versions, v1 → v2 migration, import validation
  db.js               IndexedDB wrapper
  store.js            in-memory state + the only code that writes to the database
src/ui/               one module per screen, plus sheets, dial, router
sw.js                 offline app shell (bump VERSION on each release)
tests/                node:test unit tests
```

## Data model (schema 2, IndexedDB `time-garden`)

| Store | Key | Record |
|---|---|---|
| `sessions` | `id` | Primary activity: `name, category, startedAt, endedAt, pauses[{start,end}], note, source` |
| `events` | `id` | Secondary / concurrent activity: `label, attention(active\|background), startedAt, endedAt, sessionId, source` |
| `pages` | `date` | Journal page (v1 HTML model for now): `note, items, draw` |
| `kv` | `key` | `settings`, `schema`, migration markers, pre-import backup |

`source` is `timer` (both ends stamped by the clock) or `manual` (typed or edited by hand).
Durations are never stored; they are derived from timestamps, so a reload, backgrounding or
device sleep cannot make the timer drift.

Overlap rules (`time.js → summarize`):

- **Primary time** = union of running primary intervals (pauses removed).
- **Secondary time** = plain sum of each event's length; reported separately, may exceed wall time.
- **Concurrent time** = wall time where an event overlaps a running primary.
- **Unique elapsed** = union of everything; this is the "tracked time" figure.
- **Focus** = primary time with no attention-taking event on top (background events such as music do not count).

A native iOS companion can write `events` with a new `source` value into the same model.

## Status

Working and tested: timestamp timer with pause/resume, overlapping secondary events, editing
and retrospective entry, 24-hour dial, month/week/year calendar, day/week/month/year analysis,
journal save/autosave, tear-off drag gesture, themes, JSON backup/restore, offline shell.

Not built yet: object canvas for the journal (handles, undo/redo, layers, locking), sticker
library, background removal, emoji and GIF generation, native Screen Time integration.

## iOS Screen Time

A web app cannot read Screen Time or see other apps. Automatic app-usage data needs a native
iOS app using FamilyControls (user authorisation plus an Apple-granted entitlement for
distribution) and DeviceActivity. Usage details are rendered inside a sandboxed report
extension, so exporting per-app minutes into this data model may not be possible; verify
against current Apple documentation before committing to that design.

## Data safety

Everything stays in this browser's IndexedDB. Use **Tema → Yedek al** regularly; the OS can
evict site storage. The old v1 `localStorage` blob is migrated on first run and left in place.

Fonts: DM Sans, Caveat, Parisienne (SIL Open Font License, see `fonts/`).
