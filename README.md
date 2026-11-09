# Fringe — See the Unseen

An English-language NISAR explorer connecting a cinematic introduction, the A Changing Frontier field mission and a transparent observation desk.

## Try it locally

This repository is the web root. No JavaScript installation or build is required.

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open `http://127.0.0.1:5173/`.

| Section | Working experience |
|---|---|
| Journey | Original 2.5D Delta art, user-controlled radar/time scenes, optional original ambient sound and a real-map introduction |
| Briefing | A Changing Frontier: eight story scenes, recorded-date comparison and an illustrative model; replay from Guide |
| Inspect | Actual NISAR date comparison, swipe/side-by-side/manual blink, image pins, local notebook and illustrated HTML/JSON/CSV exports |
| Map & Events | One full explorer with optional Astrounit piloting, regional stories across thousands of states/provinces and named landscapes, real radar previews, historical GNSS context and dated imagery |
| Lab | Illustrative interference models for exploring the radar mechanism |
| Guide | Explanations, sources, replay and an optional anonymous observer kit |

The briefing deploys Astrounit into the explorer’s existing map. Toggle **Explore as Astrounit** in Map tools, move with WASD/arrows, touch or map taps, and switch Walk / Inspect to use the existing probes. Regional stories follow the astronaut’s actual location, with source links, Read aloud and optional longer excerpts. They preserve the selected layer and date; Find radar here opens the existing catalogue for that position. Legacy `#game` links open this shared pilot mode.
The Validation and Data & methods panels expose the full station sample, zero-motion baseline, provenance and limits.
Shared comparison links contain dates/pins, never private notebook text. Notes stay on the device until exported.

## Reproduce the checks

```sh
node --test tests/*.test.mjs
python3 Tools/audit_web.py --check
python3 -m pip install -r pipeline/test-requirements.txt
python3 pipeline/tests/test_pipeline.py
```

Observed locally: **61 Node tests**, **10 synthetic-product pipeline tests**, and **224 matching bundled-file fingerprints**.
CI runs these same checks on pushes and pull requests. The pipeline source is included with only filesystem-path
adaptations for this repository's flat web layout; its scientific processing is unchanged. Earthdata credentials are
needed only for optional full-product retrieval, never for the bundled demo or synthetic tests.

These checks do not independently validate every satellite measurement. The current nine-station comparison has
approximately **3.06 cm** radar–GNSS residual RMS, versus approximately **0.43 cm** for a zero-motion baseline,
and remains unresolved. Delta HH/HV images are qualitative previews, not a verified flood/crop classifier.

## Documentation and previews

- [Implementation, observed verification and limitations](docs/OBSERVATION_DESK.md)
- [Award positioning and an evidence-based demonstration](docs/AWARD_POSITIONING_2026-11-08.md)
- [Current project/submission notes and prior-work disclosure](docs/SUBMISSION_2026_CURRENT.md)
- [Game implementation](docs/GAME_IMPLEMENTATION.md)
- [Original Journey art provenance](assets/journey/ART_DIRECTION.md)
- [Field mission integration and artwork](docs/GAME_IMPLEMENTATION.md)

![Actual Observation Desk screenshot](docs/previews/investigate-desktop.jpg)

The local observer kit starts empty; no real participant outcomes, adoption or award selection are claimed.
Prior-work eligibility and the official submission requirements must be confirmed for the intended event.
Art generated with OpenAI image generation is separate from the actual scientific source material and is disclosed in the app.

## Source material and licensing

NASA/JPL-Caltech & ISRO NISAR provisional products via ASF DAAC; Nevada Geodetic Laboratory GNSS; cited per-event
publications; Esri and credited imagery providers; individually credited ground photographs. Product IDs, dates and
primary references are accessible in the app. Third-party imagery and library rights remain with their respective sources.

Fringe's original MIT copyright notice is preserved in [LICENSE](LICENSE). This fork includes additional Journey,
game, investigation, audit and observer tools developed with assistance from OpenAI Codex. See the contribution
disclosure in the submission notes. The project does not claim NASA endorsement or a guaranteed competition result.
