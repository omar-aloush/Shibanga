# Fringe — See the Unseen, 7 November 2026

Update, 9 November 2026: A Changing Frontier is now the opening field mission and replaces the former pixel adventure. See `GAME_IMPLEMENTATION.md`. The journey-specific verification below records an earlier delivery.

## Implemented journey

The web landing is an English-only, free-paced cinematic 2.5D field guide. It replaces the former bilingual academy,
its questions, answer grading, stamps and notebook. Old academy preferences are ignored.

1. **A living delta:** original painted Delta panorama, layered depth and NISAR cutout; Begin Journey / Explore the map.
2. **Beyond the clouds:** native range input moves the radar scan and clears the cloud layer; keyboard arrows/Home/End work.
3. **Watch the ground change:** the shared physics renderer forms phase rings through time; visible illustrative/exaggerated labels.
4. **From illustration to observation:** actual indexed Delta HH/HV previews, 26 June–12 October 2026, with dates and source/maturity labels.
5. **Your first exploration:** the real map opens paused over the Delta; a non-modal guide highlights Timeline → Layers → Details & Sources.

Every chapter is available immediately. There are no timed gates, compulsory questions or reward conditions. The 2–3 minutes
is an approximate reading/exploration duration; the user controls the pace and can leave at any time.

## Integration and operation

- `#journey` is canonical; `#learn` redirects compatibly. The tab is Journey and Guide includes Replay Journey.
- First ordinary visits open the introduction. Site, layer, page, story and live-location links open their intended explorer state.
- Skipping preserves the selected site and layer. Completing opens the Delta's available observation layer at the acquisition date selected in the journey.
- `fringe.journey.v1` stores only visited/sound preferences. Storage exceptions do not stop the journey.
- Audio is composed locally using Web Audio after an explicit Begin/chapter action. Sound on/off remains available; exit and
  backgrounding fade the gain and suspend the audio clock. There is no narrator, downloaded music or sonification claim.
- Missing preview images show an explanation and retain access to the explorer. An illustration is never substituted as observation data.
- The globe remains a separate World tool. Scientific reports, GNSS comparisons, historical warnings and physics lab remain available.
- No hosting migration, public deployment, new scientific analysis or iOS changes were performed.

Run from the repository root:

```text
python -m http.server 5173 --directory web
```

Open `http://localhost:5173/#journey`.

## Art and performance

Four original assets were generated with the built-in image_gen tool. All final WebP files are in `web/assets/journey/`;
full final prompts, original PNG filenames, compression details and tool attribution are in that directory's
`ART_DIRECTION.md`. `manifest.json` records sizes, dimensions, alpha and SHA-256.

Initial artwork is **545,812 bytes**, below the 1.5 MB goal. Clouds/foreground load on entering a later chapter, and real
preview images load at the observation chapter. This budget describes journey artwork, not all background explorer data,
fonts or network basemap tiles. The site has no new engine, build step, account or telemetry service.

## Verification observed

- **28/28 Node tests passed:** `node --test web/tests/*.test.mjs`. Coverage includes the 16 retained scientific tests,
  route compatibility, new preferences, malformed/missing observation metadata, real dates, art budget and audio lifecycle.
- Audio tests verify that no context exists before Begin, muting/backgrounding suspends the clock, resuming does not duplicate
  scheduled chords, and audio failure does not block visuals.
- Browser walkthrough covered all chapters, range keyboard control, actual frame/date changes, sound toggling and persisted mute,
  replay from Guide, first and returning visits, `?lang=ar#learn`, direct Central Valley/NISAR links and skip without losing site/layer.
- Desktop **1280 × 720** and mobile **390 × 844** were inspected. Mobile source/timeline overlap was corrected. The journey has
  no horizontal overflow at the inspected width. Small screens scroll vertically when the real-observation scene needs more room.
- The three tips use actual controls, allow map interactions and can be skipped. The source tip scrolls to the report/source block
  and stays clear of it. Placement updates on scrolling, resizing and control replacement.
- Observation JSON and complete Central Valley CSV downloads worked and were read back. Central Valley retains nine station
  differences and the unresolved comparison; the Delta report keeps historical ALX2 separate from contemporaneous validation.
- The World globe opens independently. Preview failure, unavailable audio and throwing localStorage were exercised using
  `python web/tests/serve-failure-fixture.py` on localhost:5174. The visual journey and map exit still worked.
- Reduced-motion CSS disables decorative transitions/animation; the existing reduced-motion preference also disables parallax
  and map fly transitions. This was source-reviewed; no OS preference was changed for QA.
- Browser console errors were checked on the normal path. Expected 404 errors belong only to the deliberate failure fixture.

Viewport simulation is not testing on physical touch hardware, every browser or a screen reader. iOS/Xcode was not run on this
Windows host. The existing Python pipeline was not modified; its preceding synthetic-product test results are not new validation.

## Previews and files

- `journey-desktop.png`, `journey-mobile.png`: the new opening on desktop and mobile.
- `journey-observations.png`, `journey-ground.png`, `journey-map-guide.png`: the real preview, illustrative model and actual map guide.
- `web/learn.js`, `learn-content.js`, `learn.css`: cinematic scenes, English copy and responsive styling.
- `web/journey-audio.js`, `journey-tour.js`: generative sound and actual-control guide.
- `web/science.js`, `web/tests/science.test.mjs`: preserved scientific calculations, provenance and exports.
- `SUBMISSION_2026_CURRENT.md`, `USER_STUDY.md`: current pitch facts and a study protocol with no invented results.

Old `academy-*-ar.png` files and older IEEE materials are historical artifacts, not previews of this implementation.
The project still needs independent scientific validation and actual user feedback for new data/impact claims.
