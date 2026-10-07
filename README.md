# lampa-filter

Client-side content filters for [Lampa](https://lampa.mx): digital releases, catalog, main page rows, top lists, collections and favorites, filtered right inside the app. No backend service required.

Документация на русском: [README.ru.md](README.ru.md)

## What it does

- Filters every list response that flows through the app network layer via the official `request_secuses` hook: digital releases, catalog, main page rows, top-100, collections, recommendations. Cached responses are filtered too. Search results are never filtered.
- Separate rule set for Favorites (favorites are stored on the device, so the plugin filters them locally). Its settings screen is a native Lampa settings panel component (SettingsApi.addComponent + Settings.create), opened from the head funnel icon, from the global filter screen or directly from the settings list; genres live in nested native checkbox lists; the favorites list refreshes right after leaving the screen.
- Criteria:
  - min rating with source choice: `auto` (TMDB when the item has 10+ votes, IMDb otherwise), TMDB only, IMDb only
  - year range (from / to)
  - include genres: keep only items with at least one selected genre
  - exclude genres: any hit rejects the item
  - quality checkboxes: 4K / webdl / bdrip; cam quality (`ts`/`tc`) is rejected by default and individually toggleable
  - items without quality data are kept (configurable)
- Auto-off timer (1/3/6/12/24 hours, default 12) so a forgotten filter resets itself.

## Install

The main artifact is a plain JS file: `lampa-filters.plugin.js`.

Option A (persistent): host it on any static HTTP server reachable from your device (GitHub raw, gist, home server) and add the URL in Lampa: Settings -> Extensions -> Add plugin.

Option B (quick test on a computer): open Lampa in a desktop browser, open DevTools console and paste the file content.

After install a new settings section appears: Settings -> the filter folder. All criteria are configured there; the config lives in device localStorage (key `lampa_filters`).

## Files

- `lampa-filters.plugin.js`: the standalone plugin (main artifact)
- `mock.py`, `mirror.sh`: optional local debug proxy (FastAPI) that mirrors the Lampa frontend and filters responses server-side; used during development, not required for the plugin to work
- `test/test-lampa-filters.js`: node smoke test with Lampa/jQuery stubs

## Tests

```
make test        # or: node test/test-lampa-filters.js
```

8 checks: basic filtering, search passthrough, cub lists, timer expiry and auto-disable, favorites with own rules, year range.

## Notes and limitations

- Filtered pages are shorter (20 -> K items) and almost never empty.
- Quality data (`webdl`/`4K`/`ts`) is present only on lists enriched by the cub backend; other lists rely on the "keep unknown quality" rule.
- Pages are filtered in place; no pagination refilling.

## Security

No credentials, accounts or API keys are required or stored. The plugin only filters responses inside the app and keeps its config in localStorage.

## Uninstall

Settings -> Extensions -> remove the plugin. Optionally remove the `lampa_filters` key from localStorage to drop the config.
