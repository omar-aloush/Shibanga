# Observation Desk — implementation and verification

Release reviewed 8 November 2026. Product UI is English only. Public deployment and a new scientific retrieval are outside this change.

## The user outcome

Fringe now connects a cinematic introduction, a playable exploration mission and an actual-data investigation.
**Inspect** (`#investigate`) compares real visits to the Nile Delta, records a user's visual observation separately
from its possible cause, and exports an illustrated brief with actual acquisition IDs and limitations.

## Working functionality

- Nine actual provisional NISAR HH/HV previews, 26 June–12 October 2026, with real date selectors and elapsed days.
- Swipe, side-by-side and manually started blink comparisons. Entire image footprints are preserved. No automatic
  registration, pixel classification, calibrated difference, water area or displacement is calculated from RGB previews.
- Mouse/touch image pins and arrow-key positioning. Pins are normalized image coordinates, not surveyed locations.
- An optional local notebook: observation, hypothesis and independent check needed. Bounded and sanitized imports,
  duplicate-note handling, CSV formula protection, JSON provenance export and a standalone illustrated HTML brief.
  The brief can be printed to PDF by the user; native PDF generation is not implemented.
- Shared links contain acquisition dates and an optional pin, never notebook text. Map handoff selects the later actual date.
- Validation exposes every one of the nine Central Valley station-to-CAD1 differences, residual RMS, a zero-motion
  baseline, correlation, scatterplot and full CSV. Current result remains unresolved; no samples are discarded.
- Data & methods separates illustration, qualitative browse, derived LOS and independent context. It shows the snapshot,
  actual inventory, alignment limits, historical ALX2 mismatch, primary references and generated-art contribution disclosure.
- SHA-256 checks compare selected preview bytes with the local audit manifest. This checks bundled file consistency,
  not authenticity, field validation, scientific accuracy or OTS proof verification.
- A Changing Frontier lets Astrounit guide the visitor through recorded dates and into Inspect. Its selected acquisition pair is carried into the existing workspace without a page reload. Illustrations do not validate the actual imagery.
- The optional `study.html` facilitator kit records an anonymous, permission-based observer session, task outcomes,
  active time and assistance. It starts empty, stays local and exports JSON. No participant feedback or learning results
  have been invented. The isolated QA fixture is not a usability study.

## Reproduce the checks

```sh
node --test tests/*.test.mjs
python Tools/audit_web.py --check
python -m pip install -r pipeline/test-requirements.txt
python pipeline/tests/test_pipeline.py
python -m http.server 5173 --bind 127.0.0.1 --directory .
```

The audit covers 222 bundled files. Regenerate it only after reviewing intentional scientific-data changes:
`python Tools/audit_web.py`. The test pipeline uses known synthetic HDF5 products and a temporary output directory.
It does not overwrite the bundled real observations or establish their external accuracy. CI runs these checks on pushes.

## Observed checks

- **53 Node tests passed**, including actual-date selection, malformed imports/pins, escaping, private-share links,
  full station samples, CSV formulas and a continuous-pair branching regression.
- **10 Python pipeline tests passed** in an isolated Python 3.13 environment with the declared test dependencies.
- All **222 bundled files** matched the generated integrity/metadata manifest.
- Browser: saved observations survived reload; swipe range and image pins worked with keyboard; side-by-side and
  manually controlled blink worked; the selected later date opened on the actual map with playback stopped.
- Historical browser check for the retired adventure: its archive accepted a real 20 July–18 September pair and carried
  those exact dates to Inspect. The mid-mission checkpoint was an explicitly isolated QA fixture.
- Browser: the HTML export contained both actual embedded previews and product IDs. Its content was inspected locally;
  opening a downloaded `file:` URL in the automation browser was blocked by that browser's protocol policy, so
  standalone-file browser rendering was not certified. No browser security setting was changed.
- Browser: missing images produced explicit errors and export placeholders. Denied storage retained session notes
  and explained exporting. Verification failed explicitly when an image could not be fetched.
- Browser: 1280×720 and 390×844 layouts were inspected; the mobile document had no horizontal overflow.
- Facilitator kit: no recording before permission, all tasks initially unattempted, synthetic QA export and discard checked.

Physical phones, iOS Safari, a full screen-reader audit and real participant studies remain untested. Prior Journey,
map/lab, audio and report checks are documented in `IMPLEMENTATION_NOTES.md`; this release did not change their core controls.

## Visual records

See `previews/investigate-mobile.jpg`, `previews/game-archive-desktop.jpg` and `previews/validation-desktop.jpg`.
These are actual browser captures; QA notes, when visible, are explicitly synthetic, not claimed field observations.

## Data interpretation

Central Valley residual RMS is approximately **3.06 cm**, versus approximately **0.43 cm** for the same-sample
zero-motion baseline, with approximately **0.07 correlation**. This sample does not establish reliable small-motion
retrieval. The Delta browse-to-map fit is an alignment metric, and an absent fit remains unknown.
ALX2 spans 2014–2024 and is not validation of 2026 water change. Independent, date-matched validation and actual users
are still needed before operational or impact claims can be supported.

In this GitHub checkout the repository root is the static web root. The original multi-client checkout used `web/`; pipeline filesystem paths are adapted for either layout without changing the scientific processing.
