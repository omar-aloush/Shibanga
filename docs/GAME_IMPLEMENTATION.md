# A Changing Frontier — Astrounit in the full explorer

Updated 9 November 2026. The former adventure and its separate map have been retired. The welcome and eight-scene briefing now hand off to the existing explorer's single Leaflet map.

## Entry and controls

First ordinary visits open the briefing. Completing it selects the Nile Delta and enables **Explore as Astrounit**; skipping returns to normal exploration without resetting the existing layer/date. Guide replays the briefing. The old Mission tab is removed; legacy `#game` links activate piloting on Map.

Map tools offer the Astrounit toggle. WASD/arrows, a touch joystick and map taps move the guide; Walk / Inspect switches map taps between movement and the existing inspection behavior. Place markers and Events fast-travel through the existing selection function. Following starts enabled, manual dragging releases it, and Follow Astrounit restores it.

The map dock introduces the recognized region after 600 milliseconds of stable entry. Regional stories follow the astronaut throughout the map. The ten original field missions retain their navigation areas (half the configured extent, with a 120% exit threshold) for place-specific story and evidence actions. These areas are navigation aids, not scientific footprints. Nearby field missions remain available in a collapsed list.

Regional text comes from sourced geographic context and exact-entity Wikipedia excerpts; original `TOURS` introductions remain the fallback when the regional atlas cannot load. Arrivals never select a dataset, layer, date or camera position. Explicit actions offer Read aloud, Find radar here, available local field stories and (only for the supported Nile Delta workspace) Compare visits. Comparison opens the actual first and last indexed GCOV acquisition dates.

## Implementation

- `app.js` owns the only `L.map`, its frame loop, data selection, evidence actions and views.
- `scout-controller.js` attaches a directional Astrounit marker and dock to that map. It exposes activation, positioning, frame updates, refresh and cleanup. It never creates a map or selects data on an arrival.
- `scout-core.js` supplies geographic distance, documented story areas, dwell/hysteresis/session tracking and bounded Web Mercator movement with world wrapping.
- `scout.css` reserves separate space for artwork, text, navigation and evidence controls. The compact event card retains layer tools and the timeline.
- `mission.html`, `mission-layout.css` and `mission-controller.js` provide the same welcome and eight scenes in the app and standalone preview. The controller's `onExplore({eventId, robotMode})` callback hands off to the explorer; it has no map runtime.
- `mission.js` lazily mounts the briefing in a Shadow DOM, isolates its theme and handles loading/retry/cleanup. `mission-routing.js` retains first-visit policy and legacy destination parsing.

Movement is suspended in other views, the globe, details, full-story playback, dialogs and hidden-page states. Keys, targets and touch vectors are cleared on suspension, avoiding background jumps. Native text/range inputs and tab navigation retain their controls. Disabling piloting restores Leaflet keyboard navigation; cleanup removes listeners, marker and dock. Existing local notes, visited preferences and old discovery records remain untouched.

Illustrated artwork stays separate from scientific observations. The existing four-pose atlas is shared at `assets/mission/astrounit.webp`; the orbital backdrop remains in the briefing template. No new generated scientific imagery is used.

## Verification

Run `node --test tests/*.test.mjs` and `python3 Tools/audit_web.py --check`. The tests cover the ten areas, 600 ms dwell, 120% exit boundary, session suppression, manual replay, pause/relocation reset, nearest stories, normalized movement, capped frame deltas, target arrival, wrapping and latitude bounds. Existing source/date/report/notebook tests remain included.

Browser checks cover fresh entry, eight-scene interactions, deployment to the full map, skip/replay, legacy links, layer/date preservation, Walk / Inspect, follow release/restoration, site fast travel and story/evidence actions. The responsive matrix uses 1280×720, 1440×900, 1024×768, 900×600, 768×1024, 390×844, 320×568 and 1920×1080. The failure fixture exercises unavailable storage/audio and optional missing previews/template.

## Continuous regional storytelling

Astrounit now recognizes the region beneath his feet throughout the map. The
primary dock follows real administrative boundaries and named landscapes/waters,
rather than becoming a nearby-target list after leaving the ten field missions.
A local spatial index resolves the bundled Natural Earth gazetteer; 600 ms stable
entry and a 220 ms sampling interval prevent rapid boundary chatter. Region
recognition follows the astronaut's position, never the camera centre.

`region-resolver.js` handles polygon interiors/holes, the spatial index, world
wrapping and stable entry. `region-stories.js` provides sourced local context and
optional exact-entity Wikipedia excerpts. Excerpts retain article/license links,
are cached with optional storage, and reject mismatched entities. Requests are
throttled and obsolete requests are aborted on a new region, suspension or cleanup.
The local atlas is lazy-loaded; movement remains available while it loads.

The current region and **Selected map data** are labeled separately. A regional
arrival never changes the map dataset, mode or acquisition date. **Find radar here**
explicitly opens the explorer's existing public-catalogue tool at the astronaut's
position. The original field missions remain available in a collapsed nearby list
and expose their specific evidence actions when the astronaut is inside their area.

Coverage and attribution are documented in `data/geography/README.md`. Geography
is approximate; detailed online history needs connectivity, while local region and
landscape context remains available offline after the atlas has loaded. The QA
fixture supports `--fail-regional-stories` and `--fail-regional-map` for these cases.
