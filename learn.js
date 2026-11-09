import { CHAPTERS, JOURNEY_KEY, readJourneyPrefs, clampChapter, observationFrames } from "./learn-content.js?v=10.0";
import { createJourneyAudio } from "./journey-audio.js?v=10.0";
import * as F from "./fringe.js?v=10.0";
import { icon } from "./icons.js?v=10.0";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateLabel = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function initJourney({ root, getData, onExplore, onGame, reducedMotion = false }) {
  let raw;
  try { raw = localStorage.getItem(JOURNEY_KEY); } catch { /* optional persistence */ }
  const prefs = readJourneyPrefs(raw);
  const state = { chapter: 0, scan: 26, time: 38, frame: 0, active: false, ready: false, leaving: false, soundStatus: "idle" };
  let prepared, paintQueued = false;
  const save = () => { try { localStorage.setItem(JOURNEY_KEY, JSON.stringify(prefs)); } catch { /* the journey still works */ } };
  const audio = createJourneyAudio({ enabled: prefs.sound, onStatus: ({ status }) => { state.soundStatus = status; updateSound(); } });

  root.className = "journey"; root.lang = "en"; root.dir = "ltr";
  root.innerHTML = `<div class="jr-stage" data-chapter="delta">
    <div class="jr-art" aria-hidden="true">
      <img class="jr-landscape" src="assets/journey/delta.webp" alt="" fetchpriority="high" width="1672" height="941">
      <div class="jr-water-light"></div>
      <div class="jr-grid"></div>
      <canvas class="jr-fringes" width="380" height="380"></canvas>
      <div class="jr-distance"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><path></path><circle r="4"></circle></svg><span>LINE OF SIGHT</span></div>
      <div class="jr-scan"><span></span></div>
      <img class="jr-clouds" data-src="assets/journey/clouds.webp" alt="">
      <img class="jr-foreground" data-src="assets/journey/foreground.webp" alt="">
      <div class="jr-shade"></div>
      <div class="jr-satellite"><div class="jr-orbit"></div><img src="assets/journey/satellite.webp" alt="" width="1024" height="1024"><span class="jr-satellite-tag"><i></i>NISAR <small>NASA / ISRO</small></span></div>
    </div>
    <header class="jr-header"><button class="jr-brand" data-jr="home" aria-label="Fringe journey home"><span class="jr-logo">◉</span>fringe<span class="jr-brand-line"></span><small>FIELD NOTES FROM EARTH</small></button><div class="jr-header-actions"><button class="jr-sound" data-jr="sound" aria-pressed="${prefs.sound}" title="Music starts when you begin the journey"></button><button class="jr-exit" data-jr="skip">Explore the map ${icon("arrowRight", { size: 15 })}</button></div></header>
    <div class="jr-copy"><p class="jr-eyebrow"></p><h1 class="jr-title" tabindex="-1"></h1><p class="jr-description"></p><div class="jr-begin"><button class="jr-primary" data-jr="game">${icon("gamepad", { size: 18 })}Start the field mission</button><button class="jr-game-entry" data-jr="begin">Begin Journey ${icon("arrowRight", { size: 15 })}</button></div></div>
    <div class="jr-observations" hidden><div class="jr-observation-top"><span><i></i>OBSERVATION WINDOW</span><span>L-BAND / HH + HV</span></div><div class="jr-observation-image"><img alt=""><div class="jr-observation-missing" role="status"></div><span class="jr-viewfinder" aria-hidden="true"></span></div><div class="jr-observation-bottom"><span>NILE DELTA, EGYPT</span><time></time></div><p>NASA/JPL-Caltech & ISRO · ASF DAAC · Provisional GCOV</p></div>
    <div class="jr-interaction" hidden><p class="jr-model-note" hidden>Illustrative model · motion exaggerated</p><div class="jr-interaction-title"><span></span><output></output></div><input type="range" id="journey-slider"><div class="jr-range-ends"><span></span><span></span></div><p class="jr-interaction-note"></p></div>
    <footer class="jr-footer"><div class="jr-chapter"><span class="jr-chapter-count"></span><span class="jr-chapter-line"></span><div><span class="jr-chapter-name"></span><nav class="jr-chapters" aria-label="Journey chapters">${CHAPTERS.map((c, i) => `<button data-chapter="${i}" aria-label="${esc(c.label)}" title="${esc(c.label)}"></button>`).join("")}</nav></div></div><div class="jr-footer-right"><span class="jr-evidence-tag"></span><button class="jr-back" data-jr="back" aria-label="Previous chapter">${icon("chevronLeft", { size: 18 })}</button><button class="jr-next" data-jr="next"></button></div></footer>
    <div class="jr-opening" role="status" hidden>Opening the explorer…</div>
  </div>`;
  const $ = (selector) => root.querySelector(selector);
  const stage = $(".jr-stage"), slider = $("#journey-slider"), picture = $(".jr-observation-image img");

  function updateSound() {
    const button = root.querySelector(".jr-sound");
    if (!button) return;
    const unavailable = state.soundStatus === "unavailable";
    root.dataset.audio = state.soundStatus;
    button.setAttribute("aria-pressed", String(prefs.sound && !unavailable));
    button.setAttribute("aria-label", unavailable ? "Sound unavailable" : prefs.sound ? "Mute journey sound" : "Enable journey sound");
    button.innerHTML = `${icon(prefs.sound && !unavailable ? "volume" : "volumeOff", { size: 17 })}<span>${unavailable ? "Sound unavailable" : prefs.sound ? "Sound on" : "Sound off"}</span>`;
  }

  function loadLayers() {
    for (const image of root.querySelectorAll("img[data-src]")) { image.src = image.dataset.src; delete image.dataset.src; }
  }

  function paintGround() {
    if (state.chapter !== 2 || paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (!prepared) prepared = F.prepareScene({ model: { type: "bowl", peakM: .36, sigmaKm: 13, aspect: 1.5, rotationDeg: 22 }, extentKm: 85, geometry: F.GEOMETRIES.ascending, resolution: 380, seed: 811 });
      F.renderPrepared($(".jr-fringes").getContext("2d"), prepared, { scale: state.time / 100, wavelengthCm: 23.8, atmosphereCm: 0, style: "overlay" });
    });
  }

  function updateObservation() {
    const frames = observationFrames(getData());
    const status = $(".jr-observation-missing");
    if (!frames.length) {
      picture.hidden = true; status.hidden = false;
      status.textContent = state.ready ? "Observations are unavailable right now. You can still explore the map." : "Bringing the observations into view…";
      $(".jr-observation-bottom time").textContent = "";
      return;
    }
    state.frame = Math.min(frames.length - 1, state.frame);
    const frame = frames[state.frame], src = `data/${frame.file}`;
    if (picture.getAttribute("src") !== src) { picture.hidden = false; status.hidden = true; picture.src = src; }
    picture.alt = `Real NISAR HH/HV qualitative preview over the Nile Delta, ${frame.date}`;
    $(".jr-observation-bottom time").textContent = dateLabel(frame.date);
    $(".jr-observation-bottom time").dateTime = frame.date;
  }
  picture.addEventListener("error", () => {
    picture.hidden = true; const status = $(".jr-observation-missing"); status.hidden = false;
    status.textContent = "This preview is unavailable. Continue to the explorer to check the available observations.";
  });
  picture.addEventListener("load", () => { picture.hidden = false; $(".jr-observation-missing").hidden = true; });

  function updateSlider() {
    const chapter = state.chapter;
    const frames = observationFrames(getData());
    const output = $(".jr-interaction output"), ends = root.querySelectorAll(".jr-range-ends span");
    const value = chapter === 1 ? state.scan : chapter === 2 ? state.time : state.frame;
    slider.min = "0"; slider.max = String(chapter === 3 ? Math.max(0, frames.length - 1) : 100); slider.step = "1";
    slider.disabled = chapter === 3 && frames.length < 2; slider.value = String(value);
    slider.style.setProperty("--fill", `${chapter === 3 ? frames.length > 1 ? value / (frames.length - 1) * 100 : 0 : value}%`);
    slider.setAttribute("aria-label", chapter === 1 ? "Move the radar scan" : chapter === 2 ? "Time through the illustrative ground-motion model" : "NISAR acquisition date");
    $(".jr-interaction-title > span").textContent = chapter === 1 ? "MOVE THE RADAR SCAN" : chapter === 2 ? "MOVE THROUGH TIME" : "EXPLORE THE ACQUISITION DATES";
    output.textContent = chapter === 1 ? `${value}% revealed` : chapter === 2 ? `Day ${Math.round(value / 100 * 180)}` : frames[value] ? dateLabel(frames[value].date) : "";
    slider.setAttribute("aria-valuetext", output.textContent);
    ends[0].textContent = chapter === 1 ? "Cloud cover" : chapter === 2 ? "Day 0" : frames.length ? dateLabel(frames[0].date) : "";
    ends[1].textContent = chapter === 1 ? "A radar view" : chapter === 2 ? "Day 180" : frames.length ? dateLabel(frames[frames.length - 1].date) : "";
    $(".jr-interaction-note").textContent = chapter === 1 ? "Drag, tap, or use the arrow keys. Follow the returning echo." : chapter === 2 ? "Colour cycles represent changes along the radar line of sight. This is a model." : "Echo colours are clues about the surface. Water and crop classifications need independent checks.";
    stage.style.setProperty("--scan", `${state.scan}%`);
    stage.style.setProperty("--ground-time", String(state.time / 100));
    if (chapter === 2) {
      const narrow = window.innerWidth <= 600;
      const compact = window.innerWidth <= 860;
      const end = [narrow ? 640 : compact ? 690 : 740, (narrow ? 610 : compact ? 560 : 645) + state.time * .35];
      $(".jr-distance path").setAttribute("d", `M ${narrow ? "770 500" : compact ? "860 450" : "810 240"} L ${end.join(" ")}`);
      $(".jr-distance circle").setAttribute("cx", end[0]);
      $(".jr-distance circle").setAttribute("cy", end[1]);
      paintGround();
    }
    if (chapter === 3) updateObservation();
  }

  function showChapter(index, { focus = true } = {}) {
    state.chapter = clampChapter(index);
    if (state.chapter === 0) void audio.setActive(false);
    const chapter = CHAPTERS[state.chapter];
    stage.dataset.chapter = chapter.id;
    root.classList.toggle("jr-is-intro", state.chapter === 0);
    $(".jr-eyebrow").textContent = chapter.eyebrow;
    $(".jr-title").innerHTML = chapter.title;
    $(".jr-description").textContent = chapter.text;
    $(".jr-begin").hidden = state.chapter !== 0;
    $(".jr-interaction").hidden = state.chapter === 0;
    $(".jr-model-note").hidden = state.chapter !== 2;
    $(".jr-observations").hidden = state.chapter !== 3;
    $(".jr-next").hidden = state.chapter === 0;
    $(".jr-back").hidden = state.chapter === 0;
    $(".jr-next").innerHTML = `${chapter.next} ${icon("arrowRight", { size: 17 })}`;
    $(".jr-evidence-tag").textContent = chapter.tag;
    $(".jr-chapter-count").textContent = `${String(state.chapter + 1).padStart(2, "0")} / 04`;
    $(".jr-chapter-name").textContent = chapter.label;
    for (const button of root.querySelectorAll(".jr-chapters button")) {
      const current = Number(button.dataset.chapter) === state.chapter;
      button.setAttribute("aria-current", current ? "step" : "false");
    }
    if (state.chapter > 0) { loadLayers(); updateSlider(); }
    if (focus && state.active) $(".jr-title").focus({ preventScroll: true });
  }

  async function leave(guided) {
    if (state.leaving) return;
    state.leaving = true; prefs.visited = true; save();
    void audio.setActive(false);
    root.classList.add("is-leaving"); $(".jr-opening").hidden = false;
    try { await onExplore({ guided, observationDate: observationFrames(getData())[state.frame]?.date }); }
    finally { state.leaving = false; root.classList.remove("is-leaving"); $(".jr-opening").hidden = true; }
  }

  root.addEventListener("click", (ev) => {
    const button = ev.target.closest("button");
    if (!button || state.leaving) return;
    const action = button.dataset.jr;
    if (button.dataset.chapter !== undefined) {
      const index = Number(button.dataset.chapter);
      if (index > 0) void audio.begin();
      showChapter(index);
    }
    if (action === "begin") { void audio.begin(); showChapter(1); }
    if (action === "game") onGame?.();
    if (action === "home") { void audio.setActive(false); showChapter(0); }
    if (action === "back") showChapter(state.chapter - 1);
    if (action === "next") {
      audio.ping(.6);
      if (state.chapter === CHAPTERS.length - 1) void leave(true);
      else showChapter(state.chapter + 1);
    }
    if (action === "skip") void leave(false);
    if (action === "sound") { prefs.sound = !prefs.sound; save(); void audio.setEnabled(prefs.sound); updateSound(); }
  });
  slider.addEventListener("input", () => {
    const value = Number(slider.value);
    if (state.chapter === 1) state.scan = value;
    if (state.chapter === 2) state.time = value;
    if (state.chapter === 3) state.frame = value;
    updateSlider(); audio.ping(value / Number(slider.max || 1));
  });
  root.addEventListener("pointermove", (ev) => {
    if (reducedMotion || ev.pointerType === "touch") return;
    const r = root.getBoundingClientRect();
    stage.style.setProperty("--look-x", `${((ev.clientX - r.left) / r.width - .5) * 10}px`);
    stage.style.setProperty("--look-y", `${((ev.clientY - r.top) / r.height - .5) * 7}px`);
  });
  document.addEventListener("visibilitychange", () => { void audio.setVisible(!document.hidden); });
  window.addEventListener("resize", () => { if (state.chapter === 2) updateSlider(); });
  window.addEventListener("pagehide", () => { void audio.setActive(false); });
  root.addEventListener("keydown", (ev) => { if (ev.key === "Escape") void leave(false); });
  updateSound(); showChapter(0, { focus: false });
  return {
    hasVisited: () => prefs.visited,
    markVisited() { prefs.visited = true; save(); },
    refreshData(ready = true) { state.ready = ready; if (state.chapter === 3) updateSlider(); },
    setActive(value) { state.active = value; void audio.setActive(value && state.chapter > 0); },
    replay() { state.leaving = false; void audio.setActive(false); showChapter(0); },
    enter() { $(".jr-title").focus({ preventScroll: true }); },
    destroy() { audio.destroy(); },
  };
}
