# Fringe — current project and submission notes

Updated **9 November 2026**. This file supersedes `SPACE_APPS_2026.md` for current feature descriptions and pitch claims.
It describes development completed before the hackathon. Do not present this work as having been built during the event.

## Project statement

Fringe helps people learn to interpret NISAR observations and question the evidence behind a surface-change claim.
An interactive radar explorer connects real provisional products with cited context, physics models and transparent
station comparisons. See the Unseen introduces beginners through an English-only cinematic 2.5D journey, then guides them over the actual map controls.

## Working features

- **Observation Desk / Inspect:** actual-date comparison, image pins, private local notebook, illustrated HTML brief and provenance JSON/CSV. Astrounit carries selected recorded acquisition dates into this workspace.
- **Data & methods / Validation:** complete station residuals and baseline, acquisition IDs, archive snapshot, historical-context limits, primary references and selected-file SHA-256 checks.
- Optional local observer kit for collecting real anonymous usability sessions; no participant outcomes are claimed.

- Web map, physics lab, dated satellite imagery, real NISAR phase previews and Nile Delta HH/HV previews.
- **A Changing Frontier:** the primary eight-scene introduction with Astrounit, cinematic Earth artwork, dated NISAR comparison, illustrative models and real-map scout exploration. The briefing deploys Astrounit into the full explorer; arrival stories preserve the selected data and explicit evidence actions open existing tools. It replaces the former pixel adventure.
- **See the Unseen:** original layered Delta artwork and a NISAR guide; cloud scanning; an explicitly illustrative
  phase model; real dated Delta previews; original Web Audio ambience; Timeline → Layers → Details & Sources tips.
  Free navigation, replay and skipping; no quizzes, scores or rewards. English only.
- Observation JSON reports with product IDs, dates, quality fields, limitations and GNSS temporal coverage.
- Central Valley comparison with RMS, correlation, mean residual, zero-motion baseline, scatterplot and complete CSV export.
- Explicit preview/derived/model labels, interpolation notes and historical GNSS warnings.
- Local Leaflet dependency; no JavaScript package installation or build required for the web app.
- iOS client sharing the evidence/GNSS files. The journey and observation-report tools are currently web-only.

## What the data actually establishes

| Component | Current evidence |
|---|---|
| GUNW archive | 93 unique acquisition-pair records across nine radar sites; browse and processed versions are not counted twice |
| Quantitative processing | Nine full-product pairs at Central Valley, track 114 |
| Station comparison | Nine station-to-CAD1 differences; about 3.06 cm residual RMS, 0.43 cm zero-motion baseline RMS and 0.07 correlation |
| Interpretation | Current station sample does not demonstrate that the radar resolves its small motion; no claim of verified subsidence precision |
| Nile Delta GCOV | Nine HH/HV preview frames, 26 June to 12 October 2026; scattering clues, not a verified crop/flood classifier |
| ALX2 chart | Historical context, 1 January 2014 to 4 December 2024; not contemporaneous validation of the 2026 images |
| Coastal numbers | Illustrative constant-rate scenarios, not operational forecasts or new NISAR measurements |
| Evidence hashes | File integrity and provenance checks, not scientific accuracy certification |

GUNW and GCOV are provisional. Product maturity, atmospheric effects, viewing geometry, masks and reference choices
must remain visible. A matching GNSS date alone does not establish spatial/reference compatibility or validate a water classifier.

## Challenge fit and award positioning

The challenge asks for an interactive application using NISAR to track and communicate surface change, with physical
interpretation and broad accessibility. Fringe addresses the access and interpretation part directly. The strongest
next evidence improvement is a small quantitative, independently validated surface-water case, rather than more preview sites.

The playable adventure adds a strong **Art & Technology** and **Best Use of Storytelling** direction. **Best Use of Data**
remains a complementary direction through the real explorer and provenance. A competitive quantitative-data or local-impact
claim still needs independent validation and real user evidence. See `GAME_AND_AWARDS.md` for the dated source review and gaps.
Scientific and impact claims must be supported by validation and actual user feedback. These are positioning choices,
not award eligibility decisions, scoring weights or assurances of winning multiple awards.

## A compact demo sequence

The following is a suggested structure, not an official duration or slide limit. Confirm the **2026** submission guide
when it is released on 13 November.

1. Start A Changing Frontier on a fresh visit or from Guide, compare recorded dates, then pilot Astrounit on the full explorer. Existing `#game` links enter shared-map piloting directly.
2. At mission completion, distinguish the fictional case from actual NISAR previews. Change a real date and continue to the map.
3. Optionally open `#journey`: begin over the living illustrated Delta, then move the radar scan through clouds.
4. Use the map guide over Timeline, Layers and Details & Sources; export an observation report.
5. Open Central Valley's station comparison: 3.06 cm radar residual versus 0.43 cm for the zero-motion baseline. Explain the unresolved small signal.
6. State the real user task and the independent validation still needed for a quantitative water-change result.

Keep the spoken claim faithful to the screen. Do not say “pink proves flooded rice”, “GPS verified every result”,
“every ring is measured ground motion”, or “the 2050 scenario is a forecast”.

## Prior-work eligibility

The official 2026 FAQ prohibits work on challenges before the hackathon. Fringe existed before the event and was
submitted to IEEE ClimateChain in October 2026; NISAR-specific work and the journey were also implemented before
14 November. A clear disclosure does not itself grant permission to reuse the project. Obtain an explicit organizer
clarification about eligible prior components and permissible event work. Keep the actual development history.

The detailed eligibility inquiry is in `GLOBAL_AWARDS_REVIEW_AR_2026-11-07.md`; it has not been sent by this implementation.

## Preparation checklist

- Confirm prior-work eligibility and the official submission/judging requirements.
- Register the actual team in the same Local Event, within the applicable team-size rules.
- Identify a real target user and run the short study in `USER_STUDY.md`; do not invent feedback or adoption.
- If undertaking a quantitative water case, obtain calibrated GCOV, independent matching-date references, and
  define a validation protocol before choosing thresholds. Preview images alone are insufficient.
- Make the code and working demo accessible to judges; confirm what the published deployment actually includes.
- Prepare English submission text, sources, actual team information and a truthful AI/SI tools disclosure.
- Replace old IEEE screenshots and videos if used for a new presentation.

## AI/SI contribution disclosure to review

OpenAI Codex was used to inspect the project and sources, implement and revise the English web journey, compose its Web Audio score,
build and later retire the earlier pixel adventure; create A Changing Frontier, its field guide poses and orbital artwork with image_gen,
add shared evidence calculations and exports, improve evidence labels, update documentation, and run automated and
browser checks. The pipeline tests use synthetic products; real-data summary checks use the bundled station rows.
Original journey art was generated with the built-in OpenAI image_gen tool and compressed as WebP; full prompts and source paths are recorded in `web/assets/journey/ART_DIRECTION.md`. These checks do not independently validate every satellite measurement. The team should add its other tools and
contributions and review this statement before submission. Preserve the earlier project's own disclosed tool history.

## Verification

```text
node --test web/tests/*.test.mjs
python pipeline/tests/test_pipeline.py
```

The Python tests require `pipeline/requirements.txt`; the Node tests require only Node.js. **53/53 Node tests and 10/10 synthetic pipeline tests pass**.
Browser checks cover the chapter controls, sound, first/return visits, legacy/direct routes, skip/replay, the real-map guide,
report/CSV downloads and desktop/mobile layouts. A local failure fixture checks unavailable storage/audio and failed
preview images. See `IMPLEMENTATION_NOTES.md` for the observed results and limits.

Official references: [challenge](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/),
[FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/),
[awards](https://www.spaceappschallenge.org/awards/),
[ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/).

The Observation Desk additions and exact observed checks are documented in [OBSERVATION_DESK.md](OBSERVATION_DESK.md).
Current award positioning is in [AWARD_POSITIONING_2026-11-08.md](AWARD_POSITIONING_2026-11-08.md).
Codex also implemented the comparison/notebook/report workflow, archive handoff, observer kit, file audit and CI configuration.
