import * as F from "./fringe.js?v=10.0";
import { icon, playIcon, pauseIcon } from "./icons.js?v=10.0";
import { TOURS, LOOK_FOR, FEATURED } from "./stories.js?v=10.0";
import { createRingRenderer } from "./gl.js?v=10.0";
import { initJourney } from "./learn.js?v=11.0";
import { initFieldMission } from "./mission.js?v=14.0";
import { initScout } from "./scout-controller.js?v=14.0";
import { shouldOpenMission } from "./mission-routing.js?v=13.0";
import { initInvestigation } from "./investigate.js?v=10.0";
import { canonicalView } from "./learn-content.js?v=10.0";
import { createExplorerTour } from "./journey-tour.js?v=10.0";
import { consecutiveRun, datasetCounts, validationSummary, seriesSpan, buildObservationReport, comparisonCsv, downloadFile } from "./science.js?v=10.0";

// ===========================================================================
// State
// ===========================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Evidence records are stamped in Bitcoin, so their bytes must never change. This only evens out
// their punctuation on screen (dashes, arrows, curly quotes); the words stay exactly as recorded.
const plain = (s) => String(s ?? "")
  .replace(/(\d)\s*–\s*(\d)/g, "$1-$2")
  .replace(/\s+–\s+/g, " to ")
  .replace(/\s*—\s*/g, ", ")
  .replace(/\s+·\s+/g, ", ")
  .replace(/\s*→\s*/g, " to ")
  .replace(/≈\s*/g, "about ")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/…/g, "...")
  .replace(/(\d{4})–([A-Z][a-z]{2})/g, "$1 to $2")
  .replace(/–/g, "-")
  .replace(/,\s*([.,;:)])/g, "$1");
const byId = (id) => F.EVENTS.find((e) => e.id === id) || F.EVENTS[0];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => window.matchMedia("(max-width: 860px)").matches;

// Timing copied from the iOS app (RadarMapView.swift + Dance in SharedComponents.swift):
// the selected site "dances" from pass 1 to the last pass in 3.2 s with an ease-out of
// 1 − (1 − t)^2.2, starting 0.9 s after launch and 1.3 s after picking a site.
const DANCE_MS = 3200;
const INTRO_DELAY_MS = 900;
const SELECT_DELAY_MS = 1300;
const HOLD_MS = 2600;      // web addition: hold on the full rings, then dance again
const NISAR_PAIR_MS = 950; // real data: one 12-day pair every ~1 s
const NISAR_HOLD_MS = 2600;

const state = {
  eventId: "nile-delta",
  band: "L",
  geom: "ascending",
  progress: 0,
  playing: !reduceMotion,
  noise: true,
  base: "dark",
  filter: "all",
  audience: "public",
  mode: "model",          // "model" | "nisar"
  view: "map",
  sheetOpen: false,
};

const data = { index: null, stations: {}, manifest: null, evidence: {}, evidenceBytes: {}, proofs: {}, gnss: {}, nisar: null, imagery: null, photos: null };
let journey = null, explorerTour = null, fieldMission = null, investigation = null, scout = null;
const PAGE_VIEWS = ["events", "journey", "briefing", "investigate", "lab", "guide"];

function openInvestigation(selection = {}) { closeWelcome(); setView("investigate"); investigation?.open(selection); }

function openBriefing() { closeWelcome(); setView("briefing"); fieldMission?.replay(); }

function openJourney() {
  closeWelcome();
  setView("journey");
  journey?.replay();
  journey?.enter();
}

function observationReport(event = byId(state.eventId), stackId = nis.stackId) {
  return buildObservationReport({ event, site: nisarSiteFor(event.id), series: data.gnss[event.id] || [], stackId, mode: state.mode });
}
// Then & Now: real satellite photos of one spot per event, from Esri World Imagery Wayback.
const photos = { site: null, idx: 0, layer: null, nextAt: 0, holdUntil: 0, compare: false, before: null, after: null, split: 0.5, thumbKey: null };
const PHOTO_STEP_MS = 2600;   // each photo stays ~2.6 s, with a slow cross-fade
const PHOTO_HOLD_MS = 2600;
// Real-NISAR animation state: `t` runs 0 … pairs through a chain of consecutive 12-day pairs.
const nis = { site: null, stackId: null, items: [], t: 0, stack: null, loading: null, holdUntil: 0, cache: new Map() };
// Model dance state.
const dance = { from: 0, start: 0, delayUntil: 0, holdUntil: 0, active: false };
const statsCache = new Map();

function eventStats(e, geomId) {
  const key = `${e.id}|${geomId}`;
  if (!statsCache.has(key)) statsCache.set(key, F.stats(e.model, e.extentKm, F.GEOMETRIES[geomId]));
  return statsCache.get(key);
}

const kindColor = (k) => ({ subsidence: "coral", uplift: "amber", flank: "lateral", faultSlip: "lateral" }[k]);
const kindIcon = (k) => ({ subsidence: "down", uplift: "up", flank: "lr", faultSlip: "lr" }[k]);
const fmtDay = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
const shortDay = (iso) => fmtDay(iso, { day: "numeric", month: "short" });

// ===========================================================================
// Map
// ===========================================================================

const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const el = (this._image = this._url);
    L.DomUtil.addClass(el, "leaflet-image-layer");
    if (this._zoomAnimated) L.DomUtil.addClass(el, "leaflet-zoom-animated");
    if (this.options.className) L.DomUtil.addClass(el, this.options.className);
    el.onselectstart = L.Util.falseFn;
    el.onmousemove = L.Util.falseFn;
  },
});

let map, baseLayers, activeBase, nisarOverlay, stationLayer;
const nisarCanvas = document.createElement("canvas");
// The moving rings are drawn on the GPU when WebGL 2 is there (gl.js), so the main thread stays free for
// the map. Without it, the 2D canvas path below still works.
const nisarGl = createRingRenderer(nisarCanvas, F.LUT);
const nisarCtx = nisarGl ? null : nisarCanvas.getContext("2d");
const danceCanvas = document.createElement("canvas");
const danceGl = createRingRenderer(danceCanvas, F.LUT);
let danceOverlay = null;
// What the interface is doing right now (read by the animation loop).
const ui = { welcome: false, dockMin: false, dockShift: 0 };
let mapBusy = false;
const layers = new Map();   // eventId -> { canvas, ctx, overlay, marker }
let dirty = true;

function boundsFor(e) {
  const dLat = e.extentKm / 2 / 110.574;
  const dLon = e.extentKm / 2 / (111.32 * Math.cos((e.lat * Math.PI) / 180));
  return L.latLngBounds([e.lat - dLat, e.lon - dLon], [e.lat + dLat, e.lon + dLon]);
}

function initMap() {
  const featured = byId(state.eventId);
  map = L.map("map", {
    zoomControl: false, worldCopyJump: true, minZoom: 2, zoomSnap: 0.25, attributionControl: true,
    // Stay on the planet (no dragging into the empty band past the poles) and let a flick glide a little longer.
    maxBounds: [[-85.06, -900], [85.06, 900]], maxBoundsViscosity: 1, bounceAtZoomLimits: false,
    inertiaDeceleration: 2400, easeLinearity: 0.25, wheelPxPerZoomLevel: 80,
  }).setView([featured.lat, featured.lon], reduceMotion ? 7 : 3);
  // The world always fills the screen's height, so there is never a grey band to get lost in.
  const fitMinZoom = () => map.setMinZoom(Math.max(2, Math.ceil(Math.log2(window.innerHeight / 256) * 4) / 4));
  fitMinZoom();
  window.addEventListener("resize", fitMinZoom);
  map.attributionControl.setPrefix(false);
  // Real-photo panes sit above the basemap and below fringes and labels.
  for (const [name, z] of [["photosA", 250], ["photosB", 260]]) {
    map.createPane(name);
    map.getPane(name).style.zIndex = z;
    map.getPane(name).style.pointerEvents = "none";
  }
  map.createPane("labels");
  map.getPane("labels").style.zIndex = 420;
  map.getPane("labels").style.pointerEvents = "none";
  // Picture tiles load while you drag (no grey gaps) and keep a wider ring of neighbours. Labels and relief
  // wait until the map settles, so a flight does not fetch tiles it will never show.
  const eager = { updateWhenIdle: false, keepBuffer: 3 };
  const quiet = { updateWhenZooming: false, updateWhenIdle: true };
  const esri = (path, opts) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`, opts);
  baseLayers = {
    dark: L.layerGroup([
      esri("Canvas/World_Dark_Gray_Base", { ...eager, maxZoom: 16, attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors" }),
      // Terrain relief so valleys, volcanoes and coasts read at a glance.
      esri("Elevation/World_Hillshade_Dark", { ...quiet, maxZoom: 16, opacity: 0.55, attribution: "Hillshade &copy; Esri" }),
      esri("Canvas/World_Dark_Gray_Reference", { ...quiet, maxZoom: 16, pane: "labels" }),
    ]),
    sat: L.layerGroup([
      esri("World_Imagery", { ...eager, maxZoom: 18, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN" }),
      esri("Reference/World_Boundaries_and_Places", { ...quiet, maxZoom: 18, pane: "labels", opacity: 0.72 }),
    ]),
  };
  setBase("sat");

  for (const e of F.EVENTS) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const overlay = new CanvasOverlay(canvas, boundsFor(e), { className: "fringe-overlay", interactive: false }).addTo(map);
    const marker = L.marker([e.lat, e.lon], { icon: siteIcon(e, false), keyboard: true, title: `${e.name}, ${e.episode}` })
      .on("click", () => selectEvent(e.id, { fly: true }))
      .addTo(map);
    layers.set(e.id, { canvas, ctx: canvas.getContext("2d"), overlay, marker });
  }
  nisarCanvas.width = nisarCanvas.height = 2;
  nisarOverlay = new CanvasOverlay(nisarCanvas, boundsFor(featured), { opacity: 0, interactive: false, className: "nisar-layer" }).addTo(map);
  if (danceGl) {
    danceCanvas.width = danceCanvas.height = 320;
    danceOverlay = new CanvasOverlay(danceCanvas, boundsFor(featured), { opacity: 0, interactive: false, className: "fringe-overlay" }).addTo(map);
  }
  stationLayer = L.layerGroup().addTo(map);

  const zoomClass = () => {
    map.getContainer().classList.toggle("zoom-close", map.getZoom() >= 9);
    map.getContainer().classList.toggle("zoom-mid", map.getZoom() >= 4.5);
  };
  map.on("movestart zoomstart", () => { mapBusy = true; });
  map.on("moveend", () => { mapBusy = false; });
  map.on("moveend zoomend", () => { dirty = true; zoomClass(); });
  zoomClass();
  map.on("click", onMapClick);
}

// One plain line under each place's name: what the ground is doing and how fast (from the model,
// which is tuned to the published numbers).
function statusText(e) {
  const st = eventStats(e, e.geometry);
  if (e.coseismicDay != null) return `Torn ${F.motionText(e, st).replace(/^[+−-]/, "")} in a quake`;
  const verb = { subsidence: "Sinking", uplift: "Rising", flank: "Sliding to sea", faultSlip: "Creeping" }[e.kind];
  const rate = F.rateText(e, st).replace(/^[+−-]/, "").replace("/yr", " a year").replace("/mo", " a month").replace("/day", " a day");
  return `${verb} ${rate}`;
}

const siteIcon = (e, selected) => L.divIcon({
  className: "",
  iconSize: [0, 0],
  html: `<div class="site kind-${kindColor(e.kind)}${selected ? " is-selected" : ""}"><span class="site-dot"></span><span class="site-label">${esc(e.name)}<small>${esc(statusText(e))}</small></span></div>`,
});

function setBase(id) {
  state.base = id;
  if (activeBase) map.removeLayer(activeBase);
  activeBase = baseLayers[id].addTo(map);
  const el = map.getContainer();
  el.classList.toggle("basemap-dark", id === "dark");
  el.classList.toggle("basemap-sat", id === "sat");
  const btn = $("#btn-base");
  if (btn) btn.setAttribute("aria-label", id === "dark" ? "Switch to optical imagery" : "Switch to dark map");
}

function mapPadding() {
  const overlayCard = story.active ? $("#story") : live.active ? $("#live") : null;
  if (overlayCard) {
    const card = overlayCard.getBoundingClientRect();
    const bottom = Math.max(40, window.innerHeight - card.top + 16);
    return isPhone() ? { paddingTopLeft: [16, 90], paddingBottomRight: [16, bottom] } : { paddingTopLeft: [window.innerWidth > 1100 ? 300 : 110, 100], paddingBottomRight: [40, bottom] };
  }
  if (isPhone()) {
    const dock = $("#dock").getBoundingClientRect();
    return { paddingTopLeft: [16, 90], paddingBottomRight: [16, window.innerHeight - dock.top + 12] };
  }
  const right = state.sheetOpen ? $("#sheet").offsetWidth + 50 : 40;
  const dockH = $("#dock").offsetHeight + 40;
  return { paddingTopLeft: [window.innerWidth > 1100 ? 300 : 110, 100], paddingBottomRight: [right, dockH] };
}

function focusEvent(e, { animate = true } = {}) {
  const opts = mapPadding();
  if (animate && !reduceMotion) map.flyToBounds(boundsFor(e), { ...opts, duration: 1.8, easeLinearity: 0.2 });
  else map.fitBounds(boundsFor(e), { ...opts, animate: false });
}

// As in the app: the selected site animates through its passes; every other site shows its
// full rings (scale 1) at 85% opacity, drawn once per band/geometry.
function renderOverlays() {
  const view = map.getBounds().pad(0.25);
  const band = F.BANDS[state.band];
  const atm = state.noise ? 0.6 : 0;
  for (const e of F.EVENTS) {
    const lay = layers.get(e.id);
    if (!view.intersects(boundsFor(e))) continue;
    const selected = e.id === state.eventId;
    const res = selected ? 320 : 200;
    const geomId = selected ? state.geom : e.geometry;
    if (!selected) {
      const key = `${band.id}|${geomId}|${atm}|${res}`;
      if (lay.staticKey === key) continue;
      lay.staticKey = key;
    } else {
      lay.staticKey = null;
    }
    // The selected place's model rings are hidden behind real data or photos: nothing to draw.
    if (selected && (state.mode === "photos" || state.mode === "fields" || (state.mode === "nisar" && nis.stack))) continue;
    // The model field only depends on the place, look direction and size: compute it once, then
    // each animation frame just rescales it.
    const pkey = `${geomId}|${res}`;
    if (lay.preparedKey !== pkey) {
      lay.prepared = F.prepareScene({ model: e.model, extentKm: e.extentKm, geometry: F.GEOMETRIES[geomId], resolution: res, seed: e.seed });
      lay.preparedKey = pkey;
    }
    const opts = { scale: selected ? F.scaleAt(e, state.progress) : 1, wavelengthCm: band.wavelengthCm, atmosphereCm: atm, style: "overlay" };
    if (selected && danceOverlay && danceGl.drawModel(lay.prepared, opts)) continue;
    if (lay.canvas.width !== res) lay.canvas.width = lay.canvas.height = res;
    F.renderPrepared(lay.ctx, lay.prepared, opts);
  }
  if (state.mode === "nisar" && nis.stack && !nisarGl?.drawStack(nis.stack, nis.t) && nisarCtx) F.renderPhaseStack(nisarCtx, nis.stack, nis.t);
}

function applyLayerOpacity() {
  const real = state.mode === "nisar" && !!nis.stack;
  const pics = state.mode === "photos" || state.mode === "fields";
  for (const e of F.EVENTS) {
    const lay = layers.get(e.id);
    const selected = e.id === state.eventId;
    lay.overlay.setOpacity(pics ? 0 : selected ? (real || danceOverlay ? 0 : 1) : 0.85);
  }
  if (danceOverlay) {
    danceOverlay.setBounds(boundsFor(byId(state.eventId)));
    danceOverlay.setOpacity(pics || real ? 0 : 1);
  }
  if (real) {
    const [[s, w], [n, e]] = nis.site.bounds;
    nisarOverlay.setBounds(L.latLngBounds([s, w], [n, e]));
    nisarOverlay.setOpacity(1);
  } else {
    nisarOverlay.setOpacity(0);
  }
}

function drawStations(e) {
  stationLayer.clearLayers();
  for (const s of data.gnss[e.id] || []) {
    const c = data.stations[s.station];
    if (!c) continue;
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="station"><i></i><span>${esc(s.station)}</span></div>` }), interactive: true, zIndexOffset: -100 })
      .bindTooltip(`GPS station ${esc(s.station)} (${esc(plain(s.name))})`, { direction: "top", offset: [0, -6] })
      .addTo(stationLayer);
  }
}

async function onMapClick(ev) {
  if (scout?.handleMapClick(ev)) return;
  if (live.active) { const ll = ev.latlng.wrap(); openLive(ll.lat, ll.lng); return; }
  if (state.mode === "photos" || state.mode === "fields") return;
  const e = byId(state.eventId);
  const x = (ev.latlng.lng - e.lon) * 111.32 * Math.cos((e.lat * Math.PI) / 180);
  const y = (ev.latlng.lat - e.lat) * 110.574;
  if (Math.abs(x) > e.extentKm / 2 || Math.abs(y) > e.extentKm / 2) { anywherePopup(ev.latlng.wrap()); return; }
  const scale = F.scaleAt(e, state.progress);
  const p = F.probe(e.model, F.GEOMETRIES[state.geom], x, y, scale);
  const band = F.BANDS[state.band];
  const cm = (v) => `${F.fmt(v * 100, 1)} cm`;
  const modelHtml = `<div class="kicker amber">Model, day ${F.dayAt(e, state.progress)}</div>
    <div style="font:650 18px var(--mono);margin:4px 0">${cm(p.los)} <span class="muted" style="font:13px var(--sans)">line of sight</span></div>
    <div class="muted" style="font-size:12.5px">${p.los >= 0 ? "Moving toward" : "Moving away from"} the satellite, ${F.fmt(Math.abs(p.los / (band.wavelengthCm / 200)), 2)} fringes in ${esc(band.label)}</div>
    <div class="mono" style="font-size:11.5px;margin-top:6px;color:var(--text-2)">Up ${cm(p.up)}, east ${cm(p.east)}, north ${cm(p.north)}</div>`;
  const popup = L.popup({ maxWidth: 290, ...popupPadding() }).setLatLng(ev.latlng).setContent(modelHtml).openOn(map);
  if (state.mode === "nisar") {
    const html = await nisarProbe(ev.latlng);
    if (html) popup.setContent(`${html}<div style="border-top:1px solid var(--hair);margin:10px 0"></div>${modelHtml}`);
  }
}

// Keep popups clear of the top bar and the dock that float over the map.
function popupPadding() {
  const p = mapPadding();
  return { autoPanPaddingTopLeft: L.point(p.paddingTopLeft[0], 96), autoPanPaddingBottomRight: L.point(p.paddingBottomRight[0], p.paddingBottomRight[1]) };
}

// Outside the selected scene: every place on land is in NISAR's 12-day cycle, so point people at the free data.
function anywherePopup(ll) {
  const near = F.EVENTS.map((ev) => ({ ev, km: kmBetween(ll.lat !== undefined ? { lat: ll.lat, lon: ll.lng } : ll, ev) })).sort((a, b) => a.km - b.km)[0];
  const wkt = `POINT(${ll.lng.toFixed(4)} ${ll.lat.toFixed(4)})`;
  const url = `https://search.asf.alaska.edu/#/?dataset=NISAR&polygon=${encodeURIComponent(wkt)}&zoom=8&center=${ll.lng.toFixed(3)},${ll.lat.toFixed(3)}`;
  const el = document.createElement("div");
  el.className = "anywhere";
  el.innerHTML = `<div class="kicker accent">Any place on Earth</div>
    <div style="font:650 16px var(--mono);margin:4px 0">${ll.lat.toFixed(3)}°, ${ll.lng.toFixed(3)}°</div>
    <div class="muted" style="font-size:13px;line-height:1.45">NISAR images nearly all land and ice every 12 days. The data is free.</div>
    <button class="pill-btn" data-live style="margin-top:10px">${icon("radio", { size: 14 })}Show NISAR here, live</button>
    <a class="pill-btn ghost" href="${esc(url)}" target="_blank" rel="noopener" style="margin-top:6px">${icon("external", { size: 14 })}Get the data</a>
    <button class="pill-btn ghost" data-go style="margin-top:6px">${icon("locate", { size: 14 })}Nearest story: ${esc(near.ev.name)}</button>`;
  el.querySelector("[data-go]").addEventListener("click", () => { map.closePopup(); selectEvent(near.ev.id, { fly: true }); });
  el.querySelector("[data-live]").addEventListener("click", () => openLive(ll.lat, ll.lng));
  L.popup({ maxWidth: 300, ...popupPadding() }).setLatLng(ll).setContent(el).openOn(map);
}

// ===========================================================================
// Animation loop
// ===========================================================================

let lastT = 0;

/** Start the app's dance from the current pass (or from pass 1 if already at the end). */
function startDance(now = performance.now(), delayMs = 0) {
  dance.from = state.progress >= 0.999 ? 0 : state.progress;
  if (dance.from === 0) state.progress = 0;
  dance.delayUntil = now + delayMs;
  dance.start = dance.delayUntil;
  dance.holdUntil = 0;
  dance.active = true;
  dirty = true;
}

function frame(t) {
  const dt = lastT ? Math.min(250, t - lastT) : 16;
  lastT = t;
  scout?.update(t, dt);
  if (state.playing && state.view === "map") {
    if (state.mode === "model") {
      if (dance.active && t >= dance.delayUntil) {
        // Dance.run: linear = elapsed / (duration·(1 − begin)); eased = 1 − (1 − linear)^2.2
        const span = Math.max(DANCE_MS * (1 - dance.from), 10);
        const linear = Math.min(1, (t - dance.start) / span);
        state.progress = dance.from + (1 - dance.from) * (linear < 1 ? 1 - Math.pow(1 - linear, 2.2) : 1);
        dirty = true;
        if (linear >= 1) { dance.active = false; dance.holdUntil = t + HOLD_MS; }
      } else if (!dance.active && dance.holdUntil && t >= dance.holdUntil) {
        state.progress = 0;
        startDance(t, 0);
      }
    } else if (state.mode === "photos") {
      // Timelapse: hold each real photo, cross-fade to the next, pause on the newest, loop.
      const n = photos.site?.versions.length || 0;
      if (n > 1 && !photos.compare && t >= photos.nextAt) {
        if (photos.idx >= n - 1) {
          if (!photos.holdUntil) photos.holdUntil = t + PHOTO_HOLD_MS - PHOTO_STEP_MS;
          if (t >= photos.holdUntil && photoReady(0)) { photos.holdUntil = 0; showPhoto(0); photos.nextAt = t + PHOTO_STEP_MS; }
        } else if (photoReady(photos.idx + 1)) {
          showPhoto(photos.idx + 1);
          photos.nextAt = t + PHOTO_STEP_MS;
        }
      }
    } else if (state.mode === "fields") {
      const n = gcovOf()?.frames.length || 0;
      if (n > 1 && t >= fields.nextAt) {
        if (fields.idx >= n - 1) {
          if (!fields.holdUntil) fields.holdUntil = t + FIELDS_HOLD_MS - FIELDS_STEP_MS;
          if (t >= fields.holdUntil) { fields.holdUntil = 0; showField(0); fields.nextAt = t + FIELDS_STEP_MS; }
        } else {
          showField(fields.idx + 1);
          fields.nextAt = t + FIELDS_STEP_MS;
        }
      }
    } else if (nis.stack) {
      if (nis.holdUntil) {
        if (t >= nis.holdUntil) { nis.holdUntil = 0; nis.t = 0; dirty = true; }
      } else {
        nis.t = Math.min(nis.stack.pairs, nis.t + dt / NISAR_PAIR_MS);
        if (nis.t >= nis.stack.pairs) nis.holdUntil = t + NISAR_HOLD_MS;
        dirty = true;
      }
    }
  }
  // Nothing to draw behind the welcome screen. Without the GPU path, also wait while the map is being
  // dragged or zoomed, so the gesture gets the whole frame.
  if (dirty && state.view === "map" && !ui.welcome && !(mapBusy && !danceOverlay)) {
    dirty = false;
    renderOverlays();
    updateDock();
  }
  requestAnimationFrame(frame);
}

function setPlaying(on) {
  state.playing = on;
  if (on && state.mode === "model") startDance();
  if (!on) { dance.active = false; dance.holdUntil = 0; nis.holdUntil = 0; }
  if (on && state.mode === "nisar" && nis.stack && nis.t >= nis.stack.pairs) nis.t = 0;
  if (on && state.mode === "photos") { if (photos.compare) setCompare(false); photos.nextAt = performance.now() + 900; photos.holdUntil = 0; }
  if (on && state.mode === "fields") { fields.nextAt = performance.now() + 700; fields.holdUntil = 0; }
  const btn = $("#play");
  btn.innerHTML = on ? pauseIcon(24) : playIcon(24);
  btn.setAttribute("aria-label", on ? "Pause" : "Play");
}

// ===========================================================================
// Dock: event card + pass scrubber
// ===========================================================================

const refs = {};

function buildDock() {
  const e = byId(state.eventId);
  const k = F.KIND[e.kind];
  const rec = data.evidence[e.id];
  const hasNisar = !!nis.site;
  const climate = rec && rec.climateLink !== "none-claimed";
  $("#event-card").innerHTML = `
    <div class="ec-thumb"><canvas width="140" height="140" aria-hidden="true"></canvas><span class="thumb-tag" data-r="tag">MODEL</span></div>
    <div class="ec-body">
      <span class="scout-data-context">Selected map data</span>
      <div class="ec-title"><h2>${esc(e.name)}, ${esc(e.region)}</h2>${climate
        ? `<span class="chip-tag">${icon("leaf", { size: 13 })}Climate</span>`
        : `<span class="chip-tag ${kindColor(e.kind)}">${icon(kindIcon(e.kind), { size: 13 })}${esc(k.label)}</span>`}</div>
      <div class="ec-big"><span class="ec-num ${kindColor(e.kind)}" data-r="num"></span><span class="ec-unit" data-r="unit"></span></div>
      <div class="ec-meta" data-r="meta1"></div>
      <div class="ec-meta" data-r="meta2"></div>
      <div class="ec-clock">${icon("radio", { size: 16 })}<span class="t" data-r="clock"></span><span data-r="clockLabel"></span></div>
    </div>
    <div class="ec-side">
      <div class="ec-nav">
        <button class="icon-btn" data-act="prev" aria-label="Previous site">${icon("chevronLeft", { size: 18 })}</button>
        <button class="icon-btn" data-act="next" aria-label="Next site">${icon("chevronRight", { size: 18 })}</button>
      </div>
      <button class="pill-btn ghost" data-act="compare" hidden aria-pressed="false">${icon("lr", { size: 15 })}<span>Before / after</span></button>
      <button class="pill-btn ghost" data-act="fields" hidden aria-pressed="false"></button>
      <button class="pill-btn ghost" data-act="details">Details${icon("chevronRight", { size: 15 })}</button>
    </div>
    <div class="ec-modes" role="group" aria-label="What to show">
      <button class="mode-btn" data-act="model" aria-pressed="${state.mode === "model"}">${icon("activity", { size: 15 })}Model</button>
      ${hasNisar ? `<button class="mode-btn" data-act="nisar" aria-pressed="${state.mode === "nisar" || state.mode === "fields"}">${icon("radio", { size: 15 })}Real NISAR</button>` : ""}
      ${photoSiteFor(e.id) ? `<button class="mode-btn" data-act="photos" aria-pressed="${state.mode === "photos"}">${icon("image", { size: 15 })}Then &amp; Now</button>` : ""}
    </div>`;
  const card = $("#event-card");
  for (const el of $$("[data-r]", card)) refs[el.dataset.r] = el;
  refs.canvas = $("canvas", card);
  refs.thumbCtx = refs.canvas.getContext("2d");
  refs.thumbKey = null;
  refs.cmp = card.querySelector('[data-act="compare"]');
  refs.fbtn = card.querySelector('[data-act="fields"]');
  const cta = $("#story-cta");
  if (cta) {
    cta.hidden = !storySteps(e).length;
    cta.innerHTML = `${playIcon(15)}<span>Play the story</span>`;
    cta.setAttribute("aria-label", `Play the story of ${e.name}`);
  }
  card.querySelector('[data-act="prev"]').addEventListener("click", () => stepEvent(-1));
  card.querySelector('[data-act="next"]').addEventListener("click", () => stepEvent(1));
  card.querySelector('[data-act="details"]').addEventListener("click", () => setSheet(!state.sheetOpen));
  card.querySelector('[data-act="compare"]').addEventListener("click", () => setCompare(!photos.compare));
  card.querySelector('[data-act="fields"]').addEventListener("click", () => setMode(state.mode === "fields" ? "nisar" : "fields"));
  card.querySelector('[data-act="model"]').addEventListener("click", () => setMode("model"));
  card.querySelector('[data-act="nisar"]')?.addEventListener("click", () => setMode("nisar"));
  card.querySelector('[data-act="photos"]')?.addEventListener("click", () => setMode("photos"));
  buildTicks();
  updateDock(true);
}

const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

function updateDock(force = false) {
  if (!refs.num) return;
  const e = byId(state.eventId);
  const band = F.BANDS[state.band];
  const scrub = (refs.scrub ||= $("#scrubber"));
  const cmp = refs.cmp;
  if (cmp) {
    cmp.hidden = !(state.mode === "photos" && photos.site);
    cmp.setAttribute("aria-pressed", String(photos.compare));
    setText(cmp.querySelector("span"), photos.compare ? "Timelapse" : "Before / after");
  }
  const fbtn = refs.fbtn;
  if (fbtn) {
    fbtn.hidden = !((state.mode === "nisar" || state.mode === "fields") && gcovOf());
    fbtn.setAttribute("aria-pressed", String(state.mode === "fields"));
    const label = state.mode === "fields" ? "Ground motion" : "Crops & water";
    if (fbtn.dataset.label !== label) {
      fbtn.dataset.label = label;
      fbtn.innerHTML = `${icon(state.mode === "fields" ? "activity" : "leaf", { size: 15 })}<span>${esc(label)}</span>`;
    }
  }
  if (state.mode === "fields" && gcovOf()) {
    const fr = gcovOf().frames;
    const f = fr[fields.idx];
    setText(refs.tag, "HH + HV");
    refs.tag.style.color = "var(--accent)";
    drawFieldThumb(f);
    setText(refs.num, shortDay(f.date));
    refs.num.className = "ec-num accent";
    setText(refs.unit, "crops and water");
    setText(refs.meta1, `${fmtDay(f.date)}, image ${fields.idx + 1} of ${fr.length}`);
    setText(refs.meta2, "HH/HV preview · colours are clues, not a verified classification");
    if (scrub.max !== String(fr.length - 1) || force) { scrub.max = String(fr.length - 1); scrub.step = "1"; buildTicks(); }
    scrub.value = String(fields.idx);
    setText((refs.left ||= $("#scrub-left")), fmtDay(fr[0].date));
    setText((refs.right ||= $("#scrub-right")), fmtDay(f.date));
    scrub.style.setProperty("--fill", `${(fields.idx / (fr.length - 1)) * 100}%`);
    scrub.setAttribute("aria-valuetext", `Image ${fields.idx + 1} of ${fr.length}, ${fmtDay(f.date)}`);
    updateClock();
    return;
  }
  if (state.mode === "photos" && photos.site) {
    const vs = photos.site.versions;
    const v = vs[photos.idx];
    setText(refs.tag, "PHOTO");
    refs.tag.style.color = "#fff";
    drawPhotoThumb(v);
    setText(refs.num, monthYear(v.captured));
    refs.num.className = "ec-num";
    setText(refs.unit, photos.compare ? `vs ${monthYear(beforeVersion().captured)}` : v.approx ? "satellite photo (rough date)" : "satellite photo");
    setText(refs.meta1, photos.site.focus.label);
    setText(refs.meta2, `${v.approx ? "Date is roughly when Esri published it" : (v.source || "Satellite imagery") + (v.resM ? `, ${F.fmt(v.resM, v.resM < 1 ? 1 : 0)} m detail` : "")}. Photo ${photos.idx + 1} of ${vs.length}`);
    if (scrub.max !== String(vs.length - 1) || force) { scrub.max = String(Math.max(0, vs.length - 1)); scrub.step = "1"; buildTicks(); }
    scrub.value = String(photos.idx);
    setText((refs.left ||= $("#scrub-left")), monthYear(vs[0].captured));
    setText((refs.right ||= $("#scrub-right")), `${fmtDay(v.captured)}`);
    scrub.style.setProperty("--fill", `${vs.length > 1 ? (photos.idx / (vs.length - 1)) * 100 : 100}%`);
    scrub.setAttribute("aria-valuetext", `Photo ${photos.idx + 1} of ${vs.length}, taken ${fmtDay(v.captured)}`);
    updateClock();
    return;
  }
  if (state.mode === "nisar" && (nis.stack || nis.loading)) {
    const st = nisarStack();
    setText(refs.tag, st?.pairs?.length ? "DERIVED LOS" : "PREVIEW");
    refs.tag.style.color = "var(--accent)";
    setText(refs.num, "Real NISAR");
    refs.num.className = "ec-num accent";
    setText(refs.unit, "L-band");
    if (!nis.stack) {
      setText(refs.meta1, "Loading the real radar images...");
      setText(refs.meta2, `${nis.items.length} acquisition pairs (track ${Number(st?.track ?? 0)}); intervals may vary`);
      updateClock();
      return;
    }
    // Live miniature of the real animation, like the app's thumbnail.
    refs.thumbKey = null;
    const c = refs.thumbCtx;
    c.fillStyle = "#0a0f12";
    c.fillRect(0, 0, 140, 140);
    const s = Math.min(140 / nisarCanvas.width, 140 / nisarCanvas.height);
    c.drawImage(nisarCanvas, (140 - nisarCanvas.width * s) / 2, (140 - nisarCanvas.height * s) / 2, nisarCanvas.width * s, nisarCanvas.height * s);
    const n = nis.stack.pairs;
    const k = Math.min(Math.floor(nis.t), n - 1);
    const start = nis.items[0].reference;
    const now = nisarDate(nis.t);
    const days = Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
    setText(refs.meta1, `${shortDay(start)} to ${fmtDay(now)}, ${days} days`);
    setText(refs.meta2, `Track ${Number(st?.track ?? 0)}, ${st?.direction === "A" ? "ascending" : "descending"} · dates between passes are interpolated`);
    if (scrub.max !== String(n * 100) || force) { scrub.max = String(n * 100); scrub.step = "1"; buildTicks(); }
    scrub.value = String(Math.round(nis.t * 100));
    setText((refs.left ||= $("#scrub-left")), fmtDay(start));
    setText((refs.right ||= $("#scrub-right")), `Pair ${k + 1} of ${n}, ≈ ${shortDay(now)}`);
    scrub.style.setProperty("--fill", `${(nis.t / n) * 100}%`);
    scrub.setAttribute("aria-valuetext", `${fmtDay(now)}, pair ${k + 1} of ${n}`);
  } else {
    setText(refs.tag, "MODEL");
    refs.tag.style.color = "var(--amber)";
    // As in the app, the thumbnail shows the full rings for the whole window.
    const tKey = `${e.id}|${band.id}|${state.geom}`;
    if (refs.thumbKey !== tKey) {
      refs.thumbKey = tKey;
      const prepared = F.prepareScene({ model: e.model, extentKm: e.extentKm, geometry: F.GEOMETRIES[state.geom], resolution: 140, seed: e.seed });
      F.renderPrepared(refs.thumbCtx, prepared, { scale: 1, wavelengthCm: band.wavelengthCm, atmosphereCm: state.noise ? 0.6 : 0, style: "scene" });
    }
    const full = eventStats(e, state.geom);
    const now = F.scaleStats(full, F.scaleAt(e, state.progress));
    setText(refs.num, F.motionText(e, now));
    refs.num.className = `ec-num ${kindColor(e.kind)}`;
    setText(refs.unit, F.KIND[e.kind].word);
    const day = F.dayAt(e, state.progress);
    setText(refs.meta1, `Day ${day} of ${e.windowDays}`);
    setText(refs.meta2, `${F.fmt(F.fringeCount(now, band.wavelengthCm), 1)} rings, ${F.fmt(band.wavelengthCm / 2, 1)} cm each`);
    if (scrub.max !== "1000" || force) { scrub.max = "1000"; scrub.step = "1"; buildTicks(); }
    scrub.value = String(Math.round(state.progress * 1000));
    const acq = F.acquisitions(e);
    const k = Math.round(state.progress * acq);
    setText((refs.left ||= $("#scrub-left")), "Start");
    setText((refs.right ||= $("#scrub-right")), `Pass ${k + 1}, day ${day}`);
    scrub.style.setProperty("--fill", `${state.progress * 100}%`);
    scrub.setAttribute("aria-valuetext", `Pass ${k + 1}, day ${day}`);
  }
  updateClock();
}

function buildTicks() {
  const e = byId(state.eventId);
  const n = state.mode === "fields" && gcovOf() ? gcovOf().frames.length
    : state.mode === "photos" && photos.site ? photos.site.versions.length
    : state.mode === "nisar" && nis.stack ? nis.stack.pairs + 1 : Math.min(F.acquisitions(e) + 1, 25);
  const ticks = $("#ticks");
  ticks.innerHTML = "";
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const t = document.createElement("i");
    t.style.left = `${(i / (n - 1)) * 100}%`;
    if (i === 0 || i === n - 1 || (n > 8 && i % Math.round(n / 4) === 0)) t.className = "major";
    ticks.appendChild(t);
  }
}

// Next NISAR pass: from the real 12-day repeat of a bundled track when we have one, else modeled.
function nextPass(e) {
  const now = Date.now();
  const site = nisarSiteFor(e.id);
  let best = null;
  for (const [id, st] of Object.entries(site?.stacks || {})) {
    const items = [...(st.pairs || []), ...(st.browse || [])];
    let lastT = 0;
    for (const it of items) {
      const m = /_\d{8}T\d{6}_\d{8}T\d{6}_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})_\d{8}T\d{6}_/.exec(it.granule || "");
      if (m) lastT = Math.max(lastT, Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    }
    if (!lastT) continue;
    const step = 12 * 86_400_000;
    const next = lastT + Math.max(1, Math.ceil((now - lastT) / step)) * step;
    if (!best || next < best.date) best = { date: next, ascending: st.direction === "A", track: st.track ?? id.split("_")[0], real: true };
  }
  if (best) return best;
  const m = F.modeledPasses(e, now, 1)[0];
  return m ? { ...m, real: false } : null;
}

let cachedPass = null;
function updateClock() {
  const e = byId(state.eventId);
  if (!cachedPass || cachedPass.id !== e.id || !cachedPass.p || cachedPass.p.date < Date.now()) cachedPass = { id: e.id, p: nextPass(e) };
  const p = cachedPass.p;
  if (!p) return;
  setText(refs.clock, F.countdown(p.date - Date.now()));
  setText(refs.clockLabel, p.real ? `to estimated 12-day repeat (track ${Number(p.track)})` : "to estimated 12-day repeat");
  const why = p.real
    ? `Extrapolated from a bundled acquisition on track ${Number(p.track)} using a nominal 12-day repeat. Not a confirmed acquisition schedule or live tracking.`
    : "An estimate from NISAR's 12-day orbit. It is not live tracking data.";
  if (refs.clockLabel.parentElement.title !== why) refs.clockLabel.parentElement.title = why;
  for (const el of $$("[data-pulse-clock]")) setText(el, F.countdown(p.date - Date.now()));
}

function stepEvent(dir) {
  const ids = F.EVENTS.map((e) => e.id);
  const i = ids.indexOf(state.eventId);
  selectEvent(ids[(i + dir + ids.length) % ids.length], { fly: true });
}

// ===========================================================================
// Selection, mode, sheet
// ===========================================================================

function selectEvent(id, { fly = true, intro = false } = {}) {
  const e = byId(id);
  setDockMin(false);
  if (story.active && e.id !== story.eventId) stopStory();
  if (live.active) clearLive();
  const prev = state.eventId;
  state.eventId = e.id;
  state.geom = e.geometry;
  state.progress = 0;
  if (state.view === "map" && location.hash.slice(1) !== e.id) history.replaceState(null, "", `#${e.id}`);
  for (const ev of F.EVENTS) {
    if (ev.id === e.id || ev.id === prev) {
      layers.get(ev.id).marker.setIcon(siteIcon(ev, ev.id === e.id));
      layers.get(ev.id).staticKey = null;
    }
  }
  map.closePopup();
  // Keep the viewer in the same mode (model / real NISAR / then & now) when the site has it.
  const keepMode = state.mode;
  if (keepMode === "photos") exitPhotos();
  if (keepMode === "fields") exitFields();
  state.mode = "model";
  setupNisar(e);
  setupPhotos(e);
  drawStations(e);
  updateTools();
  buildDock();
  renderLegend();
  applyLayerOpacity();
  renderDetail(e);
  const photosNext = keepMode === "photos" && photos.site;
  if (!photosNext) focusEvent(e, { animate: fly && !scout?.isActive() });
  // The app starts the dance 0.9 s after launch and 1.3 s after a site is picked.
  if (state.playing) startDance(performance.now(), reduceMotion ? 0 : intro ? INTRO_DELAY_MS : SELECT_DELAY_MS);
  if (keepMode === "fields" && gcovOf()) setMode("fields");
  else if ((keepMode === "nisar" || keepMode === "fields") && nis.site) setMode("nisar");
  else if (photosNext) setMode("photos");
  scout?.setPosition(e);
  dirty = true;
}

async function setMode(mode) {
  const was = state.mode;
  state.mode = mode === "nisar" && nis.site ? "nisar" : mode === "fields" && gcovOf() ? "fields" : mode === "photos" && photos.site ? "photos" : "model";
  renderDetailReadouts();
  for (const m of ["model", "nisar", "photos"]) $(`#event-card [data-act="${m}"]`)?.setAttribute("aria-pressed", String(state.mode === m || (m === "nisar" && state.mode === "fields")));
  if (was === "photos" && state.mode !== "photos") exitPhotos();
  if (was === "fields" && state.mode !== "fields") exitFields();
  if (state.mode === "fields") {
    if (was !== "fields") enterFields();
    applyLayerOpacity();
    renderLegend();
    updateDock(true);
    renderNisarCard();
    renderPhotoCard();
    return;
  }
  if (state.mode === "photos") {
    enterPhotos();
    applyLayerOpacity();
    renderLegend();
    updateDock(true);
    renderNisarCard();
    renderPhotoCard();
    return;
  }
  if (state.mode === "nisar" && !nis.stack) {
    const want = nis.stackId;
    const pending = loadNisarStack(); // sets nis.loading before the first await
    updateDock(true);
    renderNisarCard();
    try {
      await pending;
    } catch (err) {
      console.warn("NISAR stack failed to load", err);
      nis.loading = null;
      state.mode = "model";
      for (const m of ["model", "nisar", "photos"]) $(`#event-card [data-act="${m}"]`)?.setAttribute("aria-pressed", String(m === "model"));
      setText(refs.meta2, "Couldn't load the real NISAR data, so you're seeing the model.");
    }
    if (state.mode !== "nisar" || nis.stackId !== want) { applyLayerOpacity(); renderLegend(); renderNisarCard(); return; }
  }
  if (state.mode === "nisar") { nis.t = state.playing ? 0 : nis.stack?.pairs ?? 0; nis.holdUntil = 0; }
  if (state.mode === "model" && state.playing) startDance();
  applyLayerOpacity();
  renderLegend();
  updateDock(true);
  renderNisarCard();
  renderPhotoCard();
  renderDetailReadouts();
  dirty = true;
}

// The photos inside the details sheet are only fetched once the sheet is actually open.
function loadSheetPhotos() {
  if (!state.sheetOpen) return;
  for (const img of $$("#detail img[data-src]")) {
    img.src = img.dataset.src;
    delete img.dataset.src;
  }
}

function setSheet(open) {
  if (open) setDockMin(false);
  state.sheetOpen = open;
  if (open) loadSheetPhotos();
  $("#app").classList.toggle("sheet-open", open);
  $("#sheet").setAttribute("aria-hidden", String(!open));
  if (open) $("#detail").scrollTop = 0;
}

// ===========================================================================
// Phone gestures: the bottom card steps aside while you move the map, and both
// the card and the details sheet follow your finger
// ===========================================================================

/** On phones, slide the card and the tab bar down so only the place's name and number stay. */
function setDockMin(min) {
  if (min && (scout?.isActive() || !isPhone() || story.active || live.active || state.sheetOpen || ui.welcome || state.view !== "map")) min = false;
  if (min === ui.dockMin) return;
  if (min) ui.dockShift = dockShift();
  ui.dockMin = min;
  const app = $("#app");
  app.style.setProperty("--dock-shift", `${ui.dockShift}px`);
  app.classList.toggle("dock-min", min);
}

// How far the card has to move down to leave a 70 px strip. Uses layout offsets, which ignore the
// transform, so it is right even in the middle of a slide.
function dockShift() {
  const dock = $("#dock"), card = $("#event-card"), tabs = $("#tabbar");
  const safe = Math.max(10, window.innerHeight - (tabs.offsetTop + tabs.offsetHeight));
  return Math.max(0, Math.round(window.innerHeight - safe - 70 - (dock.offsetTop + card.offsetTop)));
}

function wireDockSheet() {
  const dock = $("#dock"), card = $("#event-card"), sheet = $("#sheet"), body = $("#detail");
  map.on("dragstart", () => setDockMin(true));
  window.addEventListener("resize", () => setDockMin(false));
  // A tap on the small card brings everything back (and does nothing else).
  dock.addEventListener("click", (ev) => {
    if (!ui.dockMin) return;
    ev.preventDefault();
    ev.stopPropagation();
    setDockMin(false);
  }, true);

  // Drag the card: it follows the finger, then settles open or small. A flick is enough.
  let dd = null;
  card.addEventListener("touchstart", (ev) => {
    if (scout?.isActive() || !isPhone() || ev.touches.length !== 1 || ev.target.closest("input, .ec-modes")) return;
    const y = ev.touches[0].clientY;
    dd = { y0: y, lastY: y, lastT: ev.timeStamp, v: 0, on: false, from: 0, pos: 0 };
  }, { passive: true });
  card.addEventListener("touchmove", (ev) => {
    if (!dd) return;
    const y = ev.touches[0].clientY;
    dd.v = (y - dd.lastY) / Math.max(1, ev.timeStamp - dd.lastT);
    dd.lastY = y;
    dd.lastT = ev.timeStamp;
    if (!dd.on) {
      if (Math.abs(y - dd.y0) < 8) return;
      dd.on = true;
      dd.y0 = y;
      if (!ui.dockMin) ui.dockShift = dockShift();
      dd.from = ui.dockMin ? ui.dockShift : 0;
      dock.style.transition = "none";
    }
    dd.pos = Math.min(ui.dockShift, Math.max(0, dd.from + y - dd.y0));
    dock.style.transform = `translateY(${dd.pos}px)`;
  }, { passive: true });
  const dockEnd = () => {
    const d = dd;
    dd = null;
    if (!d?.on) return;
    const min = d.v > 0.4 ? true : d.v < -0.4 ? false : d.pos > ui.dockShift / 2;
    dock.style.transition = "";
    dock.style.transform = "";
    ui.dockMin = !min;   // so setDockMin applies the class even when the state did not change
    setDockMin(min);
  };
  card.addEventListener("touchend", dockEnd);
  card.addEventListener("touchcancel", dockEnd);

  // Pull the details sheet down to close it (from its top edge, or anywhere once it is scrolled to the top).
  let sd = null;
  sheet.addEventListener("touchstart", (ev) => {
    if (!isPhone() || !state.sheetOpen || ev.touches.length !== 1) return;
    const y = ev.touches[0].clientY;
    sd = { y0: y, lastY: y, lastT: ev.timeStamp, v: 0, on: false, grip: y - sheet.getBoundingClientRect().top < 44 };
  }, { passive: true });
  sheet.addEventListener("touchmove", (ev) => {
    if (!sd) return;
    const y = ev.touches[0].clientY;
    sd.v = (y - sd.lastY) / Math.max(1, ev.timeStamp - sd.lastT);
    sd.lastY = y;
    sd.lastT = ev.timeStamp;
    if (!sd.on) {
      if (!sd.grip && (body.scrollTop > 0 || y - sd.y0 < -6)) { sd = null; return; }
      if (y - sd.y0 < 6) return;
      sd.on = true;
      sd.y0 = y;
      sheet.style.transition = "none";
    }
    sheet.style.transform = `translateY(${Math.max(0, y - sd.y0)}px)`;
  }, { passive: true });
  const sheetEnd = () => {
    const d = sd;
    sd = null;
    if (!d?.on) return;
    sheet.style.transition = "";
    sheet.style.transform = "";
    if (d.lastY - d.y0 > 120 || d.v > 0.5) setSheet(false);
  };
  sheet.addEventListener("touchend", sheetEnd);
  sheet.addEventListener("touchcancel", sheetEnd);

  // "Read more" under long paragraphs in the details sheet.
  body.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-more]");
    if (!b) return;
    const open = document.getElementById(b.dataset.more).classList.toggle("open");
    b.setAttribute("aria-expanded", String(open));
    b.textContent = open ? "Show less" : "Read more";
  });
}

// ===========================================================================
// HUD tools and legend
// ===========================================================================

function updateTools() {
  $("#btn-band .band-letter").textContent = state.band;
  $("#btn-band").setAttribute("aria-label", `Radar band: ${F.BANDS[state.band].label}. Click to change.`);
  $("#btn-band").title = F.BANDS[state.band].label;
  $("#btn-geom .band-letter").textContent = state.geom === "ascending" ? "ASC" : "DESC";
  $("#btn-geom").title = `${F.GEOMETRIES[state.geom].label} pass`;
}

function renderLegend() {
  const el = $("#legend");
  if (state.mode === "photos" && photos.site) { el.innerHTML = photoLegendHtml(); return; }
  if (state.mode === "fields" && gcovOf()) { el.innerHTML = fieldsLegendHtml(); return; }
  if (state.mode === "nisar" && nis.site) { el.innerHTML = nisarLegendHtml(); return; }
  const band = F.BANDS[state.band];
  el.innerHTML = `<div class="card-head"><span class="kicker">How to read the rings</span><span class="kicker amber">Model</span></div>
    <div class="legend-bar" style="background:${F.FRINGE_GRADIENT}"></div>
    <div class="legend-row"><span>One full rainbow = ${F.fmt(band.wavelengthCm / 2, 1)} cm along the radar line of sight</span></div>
    <div class="legend-note">Ideal physics model. Real phase also contains atmosphere and errors.</div>
    <div class="pin-key"><span class="coral">Sinking</span><span class="amber">Rising</span><span class="lateral">Moving sideways</span></div>`;
}

function wireTools() {
  $("#btn-base").innerHTML = icon("layers", { size: 20 });
  $("#btn-world").innerHTML = icon("globe", { size: 21 });
  $("#btn-world").addEventListener("click", () => { if (story.active) stopStory(); openWelcome(); });
  $("#btn-recenter").innerHTML = icon("locate", { size: 19 });
  $("#btn-zoom-in").innerHTML = icon("plus", { size: 19 });
  $("#btn-zoom-out").innerHTML = icon("minus", { size: 19 });
  $("#sheet-close").innerHTML = icon("x", { size: 18 });
  for (const t of $$(".tab-icon")) t.innerHTML = icon(t.dataset.icon, { size: 20 });

  $("#btn-band").addEventListener("click", () => {
    state.band = { L: "S", S: "C", C: "L" }[state.band];
    updateTools(); renderLegend(); renderDetailReadouts(); dirty = true;
  });
  $("#btn-geom").addEventListener("click", () => {
    state.geom = state.geom === "ascending" ? "descending" : "ascending";
    updateTools(); renderLegend(); renderDetailReadouts(); dirty = true;
  });
  $("#btn-base").addEventListener("click", () => setBase(state.base === "dark" ? "sat" : "dark"));
  $("#btn-recenter").addEventListener("click", () => focusEvent(byId(state.eventId)));
  $("#btn-zoom-in").addEventListener("click", () => map.zoomIn(1));
  $("#btn-zoom-out").addEventListener("click", () => map.zoomOut(1));
  $("#sheet-close").addEventListener("click", () => setSheet(false));
  $("#play").addEventListener("click", () => setPlaying(!state.playing));
  $("#scrubber").addEventListener("input", (ev) => {
    setPlaying(false);
    if (state.mode === "fields" && gcovOf()) showField(Number(ev.target.value));
    else if (state.mode === "nisar" && nis.stack) nis.t = Number(ev.target.value) / 100;
    else if (state.mode === "photos" && photos.site) { if (photos.compare) setCompare(false); showPhoto(Number(ev.target.value)); }
    else state.progress = Number(ev.target.value) / 1000;
    dirty = true;
  });
  for (const t of $$(".tab")) t.addEventListener("click", () => setView(t.dataset.view));
  $("#tabbar").addEventListener("keydown", (ev) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(ev.key)) return;
    const tabs = $$(".tab"), i = tabs.indexOf(ev.target.closest(".tab"));
    if (i < 0) return;
    ev.preventDefault();
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); setView(tabs[next].dataset.view);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.target !== document.body) return; // inputs, buttons and the map keep their own keys
    const welcome = $("#welcome");
    if (story.active || (welcome && !welcome.hidden)) return; // the story and welcome screen handle their own keys
    if (ev.key === " " && state.view === "map") { ev.preventDefault(); setPlaying(!state.playing); }
    if (ev.key === "Escape") setSheet(false);
    if (ev.key === "ArrowRight" && state.view === "map" && !scout?.isActive()) stepEvent(1);
    if (ev.key === "ArrowLeft" && state.view === "map" && !scout?.isActive()) stepEvent(-1);
  });
}

// ===========================================================================
// Pulse strip
// ===========================================================================

function renderPulse() {
  const counts = datasetCounts(data.nisar);
  const nPairs = counts.pairs;
  const anchored = Object.keys(data.proofs).filter((id) => { try { return F.parseOTS(data.proofs[id]).attestations.some((a) => a.kind === "bitcoin"); } catch { return false; } }).length;
  const stations = new Set(Object.values(data.gnss).flat().map((s) => s.station)).size;
  const human = F.EVENTS.filter((e) => F.KIND[e.kind].group === "human").length;
  const items = [
    `Estimated 12-day repeat in <b data-pulse-clock>--:--</b>`,
    nPairs ? `<b>${nPairs}</b> unique radar pairs · <b>${counts.processed}</b> processed quantitatively` : null,
    `<b>${F.EVENTS.length}</b> places: ${human} caused by people, ${F.EVENTS.length - human} by nature`,
    stations ? `<b>${stations}</b> GPS stations for historical context and separate comparisons` : null,
    anchored ? `<b>${anchored}</b> evidence records anchored in Bitcoin` : null,
    `In the ideal L-band model, one colour cycle is <b>11.9 cm</b> along the line of sight`,
  ].filter(Boolean).map((t) => `<span class="pulse-item">${t}</span>`).join("");
  $("#pulse-items").innerHTML = items + items;
}

// ===========================================================================
// Detail sheet
// ===========================================================================

function climateTag(rec) {
  if (!rec) return "";
  if (rec.climateLink === "none-claimed") return `<span class="chip-tag lateral">Natural, no climate link claimed</span>`;
  return `<span class="chip-tag">${icon("leaf", { size: 13 })}${rec.climateLink === "substantive" ? "Climate story" : "Climate link"}</span>`;
}

function renderDetail(e) {
  const rec = data.evidence[e.id];
  const k = F.KIND[e.kind];
  const band = (id, label) => `<button data-sciband="${id}" aria-pressed="${state.band === id}">${label}</button>`;
  const geom = (id, label) => `<button data-scigeom="${id}" aria-pressed="${state.geom === id}">${label}</button>`;
  $("#detail").innerHTML = `
    <div class="sheet-hero">
      <div class="tags"><span class="chip-tag ${kindColor(e.kind)}">${icon(kindIcon(e.kind), { size: 13 })}${esc(k.label)}</span>${climateTag(rec)}</div>
      <div class="kicker">${esc(e.region)}</div>
      <h2 class="sheet-title">${esc(e.name)}</h2>
      <p class="sheet-headline">${esc(e.headline)}</p>
      ${storySteps(e).length ? `<button class="pill-btn story-btn" data-story>${playIcon(14)}Tell me the story</button>` : ""}
    </div>
    <div class="stat-grid" id="readouts"></div>
    <div class="card"><h3>What happened</h3><p class="prose-p clamp" id="what-text">${esc(e.story)}</p>
      <button class="more-btn" type="button" data-more="what-text" aria-expanded="false">Read more</button>
      <p class="muted" style="margin:0;font-size:13px">Cause: ${esc(e.driver)}</p></div>
    <div class="card ground-card" id="ground-card"></div>
    <div class="card" id="coast-card"></div>
    <div class="card photo-card" id="photo-card"></div>
    <div class="card nisar-card" id="nisar-card"></div>
    <div class="card"><div class="card-head"><h3>Published measurements</h3><span class="label-pill label-MEASURED" style="padding:4px 8px">Cited</span></div>
      <ul class="facts">${e.facts.map(([v, l, s]) => `<li><span class="v">${esc(v)}</span><span>${esc(l)}<span class="s">${esc(s)}</span></span></li>`).join("")}</ul></div>
    <div class="card" id="interp-card"></div>
    <div class="card" id="gnss-card"></div>
    <details class="sci" id="sci">
      <summary><span><strong>For scientists</strong><small>Radar settings, the model, the evidence files and the integrity check</small></span>${icon("chevronRight", { size: 18 })}</summary>
      <div class="sci-body">
        <div class="card" id="radar-card">
          <h3>Radar settings</h3>
          <p class="muted" style="margin:0;font-size:13px;line-height:1.5">See how the same motion looks to different radars. These change the rings on the map.</p>
          <div class="seg wide" role="group" aria-label="Radar band">${band("L", "L-band 23.8 cm")}${band("S", "S-band 9.4 cm")}${band("C", "C-band 5.55 cm")}</div>
          <div class="seg wide" role="group" aria-label="Pass direction">${geom("ascending", "Ascending pass")}${geom("descending", "Descending pass")}</div>
          <div class="stat-grid" id="radar-stats"></div>
          <p class="muted" style="margin:0;font-size:12.5px">${esc(F.describeModel(e.model))}, seen at a 37° angle like NISAR.</p>
          <p class="muted" style="margin:0;font-size:12.5px">Estimated nominal 12-day repeat: in <b data-pulse-clock style="color:var(--text)">--:--</b>. This is not a confirmed schedule.</p>
        </div>
        <div class="card" id="evidence-card"></div>
        <div class="card" id="integrity-card"></div>
      </div>
    </details>`;
  $("#detail [data-story]")?.addEventListener("click", () => startStory(e.id));
  for (const b of $$("#detail [data-sciband]")) b.addEventListener("click", () => {
    state.band = b.dataset.sciband;
    for (const x of $$("#detail [data-sciband]")) x.setAttribute("aria-pressed", String(x === b));
    updateTools(); renderLegend(); renderDetailReadouts(); dirty = true;
  });
  for (const b of $$("#detail [data-scigeom]")) b.addEventListener("click", () => {
    state.geom = b.dataset.scigeom;
    for (const x of $$("#detail [data-scigeom]")) x.setAttribute("aria-pressed", String(x === b));
    updateTools(); renderLegend(); renderDetailReadouts(); dirty = true;
  });
  renderDetailReadouts();
  renderNisarCard();
  renderPhotoCard();
  renderGroundCard(e);
  renderCoastCard(e);
  renderGnss(e);
  renderInterpretation(e);
  renderEvidence(e);
  renderIntegrity(e);
  updateClock();
}

function renderDetailReadouts() {
  const el = $("#readouts");
  if (!el) return;
  const e = byId(state.eventId);
  const full = eventStats(e, state.geom);
  const band = F.BANDS[state.band];
  if (state.mode === "fields") el.innerHTML = `<div class="stat"><div class="v">HH / HV</div><div class="l">qualitative backscatter composite</div></div><div class="stat"><div class="v">${gcovOf()?.frames?.length || 0}</div><div class="l">dated previews, no verified water classification</div></div>`;
  else if (state.mode === "nisar") el.innerHTML = `<div class="stat"><div class="v">${nisarStack()?.pairs?.length ? "Derived LOS" : "Preview"}</div><div class="l">${nisarStack()?.pairs?.length ? "station comparison and residuals below" : "no validated displacement estimate"}</div></div><div class="stat"><div class="v">${nis.items.length}</div><div class="l">acquisition pairs in this animation</div></div>`;
  else el.innerHTML = `
    <div class="stat"><div class="v ${kindColor(e.kind)}">${esc(F.motionText(e, full))}</div><div class="l">model: ${esc(F.KIND[e.kind].word)} over ${esc(F.windowText(e))}</div></div>
    <div class="stat"><div class="v">${esc(statusText(e).replace(/^[A-Za-z ]+? (?=[0-9~])/, ""))}</div><div class="l">model rate, informed by cited studies</div></div>`;
  const sci = $("#radar-stats");
  if (sci) sci.innerHTML = `
    <div class="stat"><div class="v">${F.fmt(F.fringeCount(full, band.wavelengthCm), 1)}</div><div class="l">rainbow rings in ${esc(band.label)}</div></div>
    <div class="stat"><div class="v">${F.acquisitions(e) + 1}</div><div class="l">simulated passes on a nominal 12-day repeat</div></div>`;
}

// ---------- GNSS ----------

const SERIES = [
  { i: 1, name: "East", color: "#8FC8E0" },
  { i: 2, name: "North", color: "#7E9691" },
  { i: 3, name: "Up", color: "#FFC24D" },
];

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

function kmBetween(a, b) {
  const x = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(x, (b.lat - a.lat) * 110.574);
}

function gnssChart(series) {
  const W = 400, H = 170, ml = 44, mr = 8, mt = 10, mb = 20;
  const s = series.samples;
  const t0 = new Date(`${series.t0}T00:00:00Z`);
  const xMax = s[s.length - 1][0] || 1;
  let lo = Infinity, hi = -Infinity;
  for (const r of s) for (const c of SERIES) { lo = Math.min(lo, r[c.i]); hi = Math.max(hi, r[c.i]); }
  const pad = (hi - lo) * 0.08 || 5;
  lo -= pad; hi += pad;
  const X = (d) => ml + (d / xMax) * (W - ml - mr);
  const Y = (v) => mt + (1 - (v - lo) / (hi - lo)) * (H - mt - mb);
  const step = niceStep(hi - lo, 4);
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    grid += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(237,246,240,0.07)"/>`;
    grid += `<text x="${ml - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.abs(v) >= 1000 ? F.fmt(v / 1000, 1) + " m" : F.fmt(v, 0)}</text>`;
  }
  const y0 = t0.getUTCFullYear(), y1 = new Date(t0.getTime() + xMax * 864e5).getUTCFullYear();
  const yStep = Math.max(1, Math.ceil((y1 - y0 + 1) / 6));
  for (let y = y0 + 1; y <= y1; y += yStep) {
    const d = (Date.UTC(y, 0, 1) - t0.getTime()) / 864e5;
    if (d <= 0 || d > xMax) continue;
    grid += `<line x1="${X(d)}" x2="${X(d)}" y1="${mt}" y2="${H - mb}" stroke="rgba(237,246,240,0.07)"/><text x="${X(d)}" y="${H - 6}" text-anchor="middle">${y}</text>`;
  }
  const lines = SERIES.map((c) => `<polyline fill="none" stroke="${c.color}" stroke-width="1.7" stroke-linejoin="round" points="${s.map((r) => `${X(r[0]).toFixed(1)},${Y(r[c.i]).toFixed(1)}`).join(" ")}"/>`).join("");
  const zero = lo < 0 && hi > 0 ? `<line x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(237,246,240,0.18)" stroke-dasharray="3 3"/>` : "";
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg class="gnss-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="GNSS displacement time series for ${esc(series.station)}">
      <text x="${ml - 6}" y="${mt - 2}" text-anchor="end" style="font-size:9px">mm</text>${grid}${zero}${lines}
      <line class="cursor" y1="${mt}" y2="${H - mb}" stroke="#EDF6F0" stroke-opacity="0"/>
      <rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent"/></svg><div class="gnss-tip">&nbsp;</div>`;
  const svg = $("svg", wrap), cursor = $(".cursor", wrap), tip = $(".gnss-tip", wrap);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const d = ((((clientX - r.left) / r.width) * W - ml) / (W - ml - mr)) * xMax;
    let best = s[0];
    for (const row of s) if (Math.abs(row[0] - d) < Math.abs(best[0] - d)) best = row;
    cursor.setAttribute("x1", X(best[0]));
    cursor.setAttribute("x2", X(best[0]));
    cursor.setAttribute("stroke-opacity", "0.5");
    const date = new Date(t0.getTime() + best[0] * 864e5).toISOString().slice(0, 10);
    tip.textContent = `${date}: east ${F.fmt(best[1], 1)}, north ${F.fmt(best[2], 1)}, up ${F.fmt(best[3], 1)} mm`;
  };
  svg.addEventListener("pointermove", (ev) => show(ev.clientX));
  svg.addEventListener("pointerdown", (ev) => show(ev.clientX));
  return wrap;
}

function renderGnss(e) {
  const card = $("#gnss-card");
  const list = data.gnss[e.id] || [];
  if (!list.length) { card.remove(); return; }
  card.innerHTML = `<div class="card-head"><h3>Measured on the ground</h3><span class="label-pill label-MEASURED" style="padding:4px 8px">REAL GNSS</span></div>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">Bundled daily GNSS positions (Nevada Geodetic Lab), averaged by week. These charts provide context. A direct radar check needs matching dates, location and reference; any quantitative comparison is reported separately above. Hover over a chart to read a week.</p>
    <div class="series-key">${SERIES.map((c) => `<span style="--c:${c.color}">${c.name}</span>`).join("")}</div>`;
  for (const s of list) {
    const last = s.samples[s.samples.length - 1];
    const c = data.stations[s.station];
    const period = seriesSpan(s);
    const radarStart = nis.items[0]?.reference;
    const endsBefore = period && radarStart && period.end < radarStart;
    const block = document.createElement("div");
    block.className = "gnss-block";
    block.innerHTML = `<div class="gnss-head"><span class="st">${esc(s.station)}</span>
        <span class="mono" style="font-weight:650;color:${last[3] < 0 ? "var(--coral)" : "var(--amber)"}">Up ${F.fmt(last[3] / 10, 1)} cm</span></div>
      <div class="gnss-sub">${esc(plain(s.name))}<br>${c ? `${F.fmt(kmBetween(e, c), 0)} km from the centre, ` : ""}${period ? `${esc(period.start)} to ${esc(period.end)}` : esc(s.t0)}; ${F.fmt(Math.hypot(last[1], last[2]) / 10, 1)} cm sideways</div>${endsBefore ? `<p class="quality-note">Historical context: this series ends before the displayed NISAR acquisitions. It does not validate their motion.</p>` : ""}`;
    block.appendChild(gnssChart(s));
    if (s.corrections?.length) block.insertAdjacentHTML("beforeend", `<ul class="corrections">${s.corrections.map((n) => `<li>${esc(plain(n))}</li>`).join("")}</ul>`);
    card.appendChild(block);
  }
}

// ---------- the sea against the land ----------

const COAST_YEARS = [2030, 2050, 2075, 2100];
const COAST_NOW = 2026;
let coastYear = 2050;

function renderCoastCard(e) {
  const card = $("#coast-card");
  if (!card) return;
  if (!e.coast) { card.remove(); return; }
  const rows = e.coast.places.map((p) => ({ ...p, cm: (p.relMmYr * (coastYear - COAST_NOW)) / 10 }));
  const max = Math.max(...e.coast.places.map((p) => p.relMmYr)) * (COAST_YEARS[COAST_YEARS.length - 1] - COAST_NOW) / 10;
  card.innerHTML = `<div class="card-head"><h3>The sea against the land</h3><span class="label-pill label-DERIVED" style="padding:4px 8px">DERIVED</span></div>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">${esc(e.coast.intro)} Pick a year to see how much higher the sea would stand against the ground if today's rates simply continue.</p>
    <div class="seg wide" role="group" aria-label="Year">${COAST_YEARS.map((y) => `<button data-cyear="${y}" aria-pressed="${y === coastYear}">${y}</button>`).join("")}</div>
    <div class="coast-rows">${rows.map((r) => `<div class="coast-row">
        <div class="coast-top"><span>${esc(r.name)}</span><strong class="mono">+${F.fmt(r.cm, 0)} cm</strong></div>
        <div class="coast-bar"><i style="width:${Math.max(2, (r.cm / max) * 100)}%"></i></div>
        <div class="coast-how">${esc(r.how)}</div></div>`).join("")}</div>
    <p class="muted" style="margin:0;font-size:11.5px;line-height:1.5">Illustrative constant-rate scenario from a 2026 baseline using cited historical rates (${esc(e.coast.source)}). This is not a flood forecast or a new NISAR measurement. Future subsidence and sea-level rates can change.</p>`;
  for (const b of $$("[data-cyear]", card)) b.addEventListener("click", () => { coastYear = Number(b.dataset.cyear); renderCoastCard(e); });
}

// ---------- interpretation ----------

const DOSSIER_ICONS = { eye: "eye", lightbulb: "bulb", "exclamationmark.2": "alert", "arrow.triangle.branch": "branch", "eye.slash": "eyeOff", "arrow.forward": "arrowRight" };

function renderInterpretation(e) {
  const card = $("#interp-card");
  const rec = data.evidence[e.id];
  if (!rec) { card.remove(); return; }
  let html = `<div class="card-head"><h3>What it means</h3>${rec.dossier ? `<span class="kicker accent">Climate notes</span>` : ""}</div>`;
  if (rec.interpretation) {
    html += `<div class="seg wide" role="group" aria-label="Audience">${[["public", "Public"], ["student", "Student"], ["scientist", "Scientist"]]
      .map(([k, l]) => `<button data-aud="${k}" aria-pressed="${state.audience === k}">${l}</button>`).join("")}</div>
      <p class="prose-p" id="interp-text">${esc(plain(rec.interpretation[state.audience]))}</p>`;
  }
  if (rec.dossier) {
    html += `<p style="margin:4px 0 0;font:600 16px/1.4 var(--sans)">${esc(plain(rec.dossier.headline))}</p><div class="dossier">${rec.dossier.sections
      .map((s) => `<div class="dossier-item"><span class="badge-ico">${icon(DOSSIER_ICONS[s.icon] || "sparkle", { size: 18 })}</span><div><h4>${esc(s.title)}</h4><p>${esc(plain(s.body))}</p></div></div>`).join("")}</div>`;
  }
  if (rec.climateNote) html += `<div class="note">${esc(plain(rec.climateNote))}</div>`;
  card.innerHTML = html;
  for (const b of $$("[data-aud]", card)) {
    b.addEventListener("click", () => {
      state.audience = b.dataset.aud;
      for (const x of $$("[data-aud]", card)) x.setAttribute("aria-pressed", String(x === b));
      $("#interp-text").textContent = plain(rec.interpretation[state.audience]);
    });
  }
}

// ---------- evidence ----------

function renderEvidence(e) {
  const card = $("#evidence-card");
  const rec = data.evidence[e.id];
  if (!rec) { card.remove(); return; }
  const ds = rec.dataset || {};
  const kv = [["Mission", ds.mission], ["Dataset", ds.datasetId], ["Window", ds.window], ["Coverage", ds.coverage], ["GNSS", ds.gnss], ["Processing", ds.processing]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(plain(v))}</dd>`).join("");
  card.innerHTML = `<div class="card-head"><h3>Evidence &amp; provenance</h3><span class="kicker">${esc(rec.schema)}</span></div>
    <div class="items">${rec.items.map((it) => `<div class="item"><span class="label-pill label-${esc(it.label)}">${esc(it.label)}</span><span><strong>${esc(plain(it.kind))}.</strong> ${esc(plain(it.detail))}</span></div>`).join("")}</div>
    <dl class="kv">${kv}</dl>
    <div><div class="kicker" style="margin-bottom:6px">Limitations</div><ul class="list">${rec.limitations.map((l) => `<li>${esc(plain(l))}</li>`).join("")}</ul></div>
    <div><div class="kicker" style="margin-bottom:6px">Sources</div><ol class="list">${rec.sources
      .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(plain(s.title))}</a>` : esc(plain(s.title))}, ${esc(plain(s.publisher))}, ${esc(s.year)}</li>`).join("")}</ol></div>
    <div class="btn-row"><button class="pill-btn ghost" id="dl-json">${icon("download", { size: 15 })}Record (.json)</button><button class="pill-btn ghost" id="dl-ots">${icon("download", { size: 15 })}Proof (.ots)</button></div>`;
  const dl = (b, name, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([b], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#dl-json").addEventListener("click", () => dl(data.evidenceBytes[e.id], `evidence-${e.id}.json`, "application/json"));
  $("#dl-ots").addEventListener("click", () => dl(data.proofs[e.id], `evidence-${e.id}.ots`, "application/octet-stream"));
}

// ---------- integrity ----------

function renderIntegrity(e) {
  const card = $("#integrity-card");
  const raw = data.evidenceBytes[e.id];
  if (!raw) { card.remove(); return; }
  const digest = F.hex(F.sha256(raw));
  const entry = data.manifest?.records?.find((r) => r.eventId === e.id);
  let proof = null, proofErr = null;
  try { proof = data.proofs[e.id] ? F.parseOTS(data.proofs[e.id]) : null; } catch (err) { proofErr = err.message; }
  const btc = proof?.attestations.find((a) => a.kind === "bitcoin");
  const pending = proof?.attestations.find((a) => a.kind === "pending");
  if (!entry && !proof && !proofErr) {
    card.innerHTML = `<div class="card-head"><h3>Integrity check</h3><span class="kicker">in your browser</span></div>
      <div><div class="kicker" style="margin-bottom:4px">SHA-256 fingerprint of this record, worked out just now</div><div class="digest">${digest}</div></div>
      <div class="status"><span class="warn">${icon("clock", { size: 16 })}</span><span>This record is new and hasn't been stamped in Bitcoin yet. It joins the manifest at the next stamping.</span></div>`;
    return;
  }
  let anchor;
  if (proofErr) anchor = `<div class="status"><span class="bad">${icon("x", { size: 16 })}</span>Couldn't read the proof: ${esc(proofErr)}</div>`;
  else if (!proof || proof.digest !== digest) anchor = `<div class="status"><span class="bad">${icon("x", { size: 16 })}</span>There is no proof for this exact record</div>`;
  else if (btc) {
    anchor = `<div class="status"><span class="ok">${icon("dot", { size: 16 })}</span><span>Anchored in Bitcoin block <strong class="mono">${btc.height.toLocaleString("en-US")}</strong></span></div>
      <div><div class="kicker" style="margin-bottom:4px">Merkle root worked out from the proof</div><div class="digest">${btc.merkleRoot}</div></div>
      <div class="btn-row"><button class="pill-btn" id="verify-btc">${icon("shield", { size: 15 })}Check against live Bitcoin</button>
      <a class="pill-btn ghost" href="https://mempool.space/block-height/${btc.height}" target="_blank" rel="noopener">Open block${icon("external", { size: 14 })}</a></div>
      <div id="verify-out" class="status"></div>`;
  } else {
    anchor = `<div class="status"><span class="warn">${icon("clock", { size: 16 })}</span><span>Sent to ${esc(pending?.uri || "an OpenTimestamps calendar")}. Waiting for a Bitcoin block.</span></div>`;
  }
  card.innerHTML = `<div class="card-head"><h3>Integrity check</h3><span class="kicker">in your browser</span></div>
    <div><div class="kicker" style="margin-bottom:4px">SHA-256 fingerprint of this record, worked out just now</div><div class="digest">${digest}</div></div>
    <div class="status">${entry?.sha256 === digest ? `<span class="ok">${icon("check", { size: 16 })}</span>Matches the published manifest` : `<span class="bad">${icon("x", { size: 16 })}</span>Does not match the manifest`}</div>
    ${anchor}
    <p class="muted" style="margin:0;font-size:12px;line-height:1.5">This shows the record hasn't changed since it was time-stamped. It can't tell you whether the measurements are right. For that, check the sources above.</p>`;
  const vb = $("#verify-btc");
  vb?.addEventListener("click", async () => {
    const out = $("#verify-out");
    vb.disabled = true;
    out.innerHTML = `<span class="muted">Checking block ${btc.height} on mempool.space...</span>`;
    try {
      const hash = (await (await fetch(`https://mempool.space/api/block-height/${btc.height}`)).text()).trim();
      const block = await (await fetch(`https://mempool.space/api/block/${hash}`)).json();
      const when = new Date(block.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
      out.innerHTML = block.merkle_root === btc.merkleRoot
        ? `<span class="ok">${icon("check", { size: 16 })}</span><span>Merkle root matches block ${btc.height.toLocaleString("en-US")}, mined ${when}.</span>`
        : `<span class="bad">${icon("x", { size: 16 })}</span><span>Block ${btc.height} has a different Merkle root.</span>`;
    } catch (err) {
      out.innerHTML = `<span class="warn">${icon("alert", { size: 16 })}</span><span>Couldn't reach mempool.space (${esc(err.message)}).</span>`;
      vb.disabled = false;
    }
  });
}

// ===========================================================================
// Real NISAR, animated (web/data/nisar from pipeline/nisar_pipeline.py)
// ===========================================================================

const nisarSiteFor = (eventId) =>
  Object.values(data.nisar?.sites || {}).find((s) => s.eventId === eventId && Object.keys(s.stacks || {}).length) || null;
const nisarStack = () => nis.site?.stacks?.[nis.stackId] || null;

/** Longest run of consecutive pairs (each secondary date = next reference date). */
function chainItems(st) {
  return consecutiveRun(st);
}

function setupNisar(e) {
  nis.site = nisarSiteFor(e.id);
  nis.stack = null;
  nis.loading = null;
  nis.t = 0;
  if (!nis.site) { nis.stackId = null; nis.items = []; return; }
  const ranked = Object.entries(nis.site.stacks).sort((a, b) => chainItems(b[1]).length - chainItems(a[1]).length);
  selectNisarStack(ranked[0][0]);
}

function selectNisarStack(id) {
  nis.stackId = id;
  nis.items = chainItems(nisarStack());
  nis.stack = nis.cache.get(`${nis.site.eventId}|${id}`) || null;
  nis.loading = null;
  if (nis.stack) sizeNisarCanvas();
}

function sizeNisarCanvas() {
  if (nisarCanvas.width !== nis.stack.w || nisarCanvas.height !== nis.stack.h) {
    nisarCanvas.width = nis.stack.w;
    nisarCanvas.height = nis.stack.h;
  }
}

async function loadNisarStack() {
  if (nis.stack || !nis.items.length) return;
  const key = `${nis.site.eventId}|${nis.stackId}`;
  if (!nis.loading) {
    nis.loading = F.loadPhaseStack(nis.items.map((it) => `data/${it.phase}`)).then((s) => { nis.cache.set(key, s); return s; });
  }
  const s = await nis.loading;
  if (`${nis.site?.eventId}|${nis.stackId}` !== key) return;
  nis.stack = s;
  nis.loading = null;
  sizeNisarCanvas();
}

/** ISO date at animation time t (in pairs), interpolated inside the current pair. */
function nisarDate(t) {
  const n = nis.items.length;
  if (!n) return "";
  const k = Math.min(Math.floor(Math.max(0, t)), n - 1);
  const f = Math.min(1, Math.max(0, t - k));
  const ms = Date.parse(`${nis.items[k].reference}T00:00:00Z`) + f * nis.items[k].days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function nisarLegendHtml() {
  const start = nis.items[0]?.reference;
  const processed = !!nisarStack()?.pairs?.length;
  const wavelength = nis.items.find((p) => p.wavelengthCm)?.wavelengthCm;
  return `<div class="card-head"><span class="kicker">NISAR phase</span><span class="kicker ${processed ? "lateral" : "amber"}">${processed ? "Derived LOS" : "Qualitative preview"}</span></div>
    <div class="legend-bar" style="background:${F.FRINGE_GRADIENT}"></div>
    <div class="legend-row"><span>0</span><span>${wavelength ? `${F.fmt(wavelength / 2, 2)} cm LOS equivalent per cycle` : "one phase cycle; not a validated motion estimate"}</span></div>
    <div class="legend-note">Since ${start ? esc(fmtDay(start)) : "the first pass"}; includes atmospheric residuals. Faded = unknown. Motion between passes is interpolated.</div>`;
}

function renderNisarCard() {
  const card = $("#nisar-card");
  if (!card) return;
  if (!nis.site) { card.remove(); return; }
  const stacks = Object.entries(nis.site.stacks);
  const st = nisarStack();
  const items = nis.items;
  const dir = (s) => (s.direction === "A" ? "ascending" : "descending");
  const on = state.mode === "nisar" || state.mode === "fields";
  const processed = (st?.pairs || []).some((p) => p.phase);
  const g = processed ? st?.cumulativeGnss : null;
  const span = items.length ? `${fmtDay(items[0].reference)} to ${fmtDay(items[items.length - 1].secondary)}` : "";
  card.innerHTML = `
    <div class="card-head"><h3>Real NISAR data</h3><span class="label-pill label-${processed ? "PROCESSED" : "PREVIEW"}" style="padding:4px 8px">${processed ? "DERIVED LOS" : "BROWSE PREVIEW"}</span></div>
    <p class="muted" style="margin:0;font-size:12.5px;line-height:1.5">NASA-ISRO NISAR provisional products via ASF: ${items.length} acquisition pairs, ${esc(span)}. Nominal repeat is 12 days; actual intervals can be longer.</p>
    <button class="pill-btn" id="nisar-toggle" aria-pressed="${on}" style="justify-self:start">${icon(on ? "eyeOff" : "eye", { size: 15 })}${on ? "Back to the physics model" : "Play real NISAR on the map"}</button>
    ${stacks.length > 1 ? `<div class="seg wide" role="group" aria-label="NISAR track">${stacks
      .map(([id, s]) => `<button data-nstack="${esc(id)}" aria-pressed="${id === nis.stackId}">Track ${Number(s.track ?? id.split("_")[0])} (${dir(s)})</button>`).join("")}</div>`
      : `<div class="kicker">Track ${Number(st.track ?? nis.stackId.split("_")[0])}, ${dir(st)} pass</div>`}
    <dl class="kv">
      <dt>What you see</dt><dd>The real radar signal, added up one pair at a time. Each frame shows all the change from the first pass up to that date.</dd>
      <dt>Source</dt><dd>${processed ? "The full GUNW product, with bad pixels masked and the ionosphere corrected" : "Recovered from JPL's preview image of each GUNW product and placed on the map using its footprint"}</dd>
      <dt>Includes</dt><dd>${processed ? "Ground motion plus residual troposphere" : "Ground motion plus atmosphere and ionosphere on the first and current dates"}</dd>
    </dl>
    <p class="quality-note ${processed ? "neutral" : ""}">${processed ? "The full product provides phase-derived LOS estimates, not automatically validated ground motion. Compare against independent observations and inspect residuals below." : "This layer is recovered from a public browse image. It is useful for exploring radar patterns, but it does not provide a validated displacement rate. Its confidence mask is not measured product coherence."}</p>
    ${g ? gnssTable(g) : ""}
    ${fieldsBlockHtml()}
    <div class="observation-sources"><div class="quality-actions"><button class="pill-btn ghost" data-export-observation>${icon("download", { size: 14 })}Observation report (.json)</button>${g?.n ? `<button class="pill-btn ghost" data-export-comparison>${icon("download", { size: 14 })}All station residuals (.csv)</button>` : ""}<button class="pill-btn ghost" data-learn-evidence>${icon("sparkle", { size: 14 })}Learn to read this</button></div>
    <p class="muted" style="margin:0;font-size:11.5px;line-height:1.5">Data: NASA/JPL-Caltech &amp; ISRO NISAR, ASF DAAC (<span class="mono">NISAR_L2_GUNW_PROVISIONAL_V1</span>${gcovOf() ? `, <span class="mono">NISAR_L2_GCOV_PROVISIONAL_V1</span>` : ""}).
      <a href="https://search.asf.alaska.edu/#/?dataset=NISAR&sciProducts=GUNW" target="_blank" rel="noopener">Find it in ASF Vertex</a></p></div>`;
  $("#nisar-toggle").addEventListener("click", () => setMode(on ? "model" : "nisar"));
  card.querySelector("[data-export-observation]")?.addEventListener("click", () => downloadFile(`fringe-${state.eventId}-observation.json`, JSON.stringify(observationReport(), null, 2)));
  card.querySelector("[data-export-comparison]")?.addEventListener("click", () => downloadFile(`fringe-${state.eventId}-station-residuals.csv`, comparisonCsv(nisarStack()?.cumulativeGnss), "text/csv"));
  card.querySelector("[data-learn-evidence]")?.addEventListener("click", openJourney);
  const inspect = document.createElement("button");
  inspect.className = "pill-btn ghost";
  inspect.textContent = gcovOf() ? "Compare actual dates ↗" : "Inspect validation & methods ↗";
  inspect.addEventListener("click", () => openInvestigation({panel: gcovOf() ? "compare" : "validation"}));
  card.querySelector(".quality-actions")?.append(inspect);
  $("#fields-toggle")?.addEventListener("click", () => setMode(state.mode === "fields" ? "nisar" : "fields"));
  for (const b of $$("[data-gdate]", card)) {
    b.addEventListener("click", async () => {
      if (state.mode !== "fields") await setMode("fields");
      setPlaying(false);
      showField(Number(b.dataset.gdate));
    });
  }
  for (const b of $$("[data-nstack]", card)) {
    b.addEventListener("click", async () => {
      selectNisarStack(b.dataset.nstack);
      nis.t = 0;
      renderNisarCard();
      renderGnss(byId(state.eventId));
      renderLegend();
      if (state.mode === "nisar") { updateDock(true); await loadNisarStack(); }
      applyLayerOpacity();
      updateDock(true);
      dirty = true;
    });
  }
}

function gnssTable(g) {
  const v = validationSummary(g);
  if (!v.count) return `<div class="note">GNSS comparison unavailable: ${esc(g.note || "not enough valid station samples")}</div>`;
  const rows = g.stations.filter((s) => Number.isFinite(s.insarCm) && Number.isFinite(s.gnssCm));
  const lo = Math.min(-1, ...rows.flatMap((s) => [s.insarCm, s.gnssCm])) - 0.3;
  const hi = Math.max(1, ...rows.flatMap((s) => [s.insarCm, s.gnssCm])) + 0.5;
  const X = (a) => 46 + (a - lo) / (hi - lo) * 280, Y = (a) => 219 - (a - lo) / (hi - lo) * 190;
  const scatter = `<svg class="quality-scatter" viewBox="0 0 360 260" role="img" aria-label="Station-to-reference LOS comparison: GNSS on the horizontal axis, NISAR on the vertical axis, in centimetres. The dashed line is agreement."><path d="M46 29v190h280" fill="none" stroke="#66808c"/><path d="M${X(lo)} ${Y(lo)}L${X(hi)} ${Y(hi)}" stroke="#93b5a4" stroke-dasharray="4 5"/>${rows.map((s) => `<circle cx="${X(s.gnssCm)}" cy="${Y(s.insarCm)}" r="4" fill="#ff9e87"><title>${esc(s.station)}: GNSS ${s.gnssCm}, NISAR ${s.insarCm} cm</title></circle>`).join("")}<text x="186" y="252" text-anchor="middle" fill="#aebfca" font-size="11">GNSS (cm)</text><text x="15" y="125" text-anchor="middle" transform="rotate(-90 15 125)" fill="#aebfca" font-size="11">NISAR (cm)</text>${[lo, hi].map((p) => `<text x="${X(p)}" y="235" text-anchor="middle" fill="#9bb2be" font-size="10">${F.fmt(p, 1)}</text>`).join("")}</svg>`;
  return `<div class="quality-comparison"><div class="kicker" style="margin-bottom:6px">Independent station comparison · ${v.count} differences to ${esc(g.reference)}</div>
    <div class="quality-heading">${v.status === "unresolved" ? "Small motion not resolved by this comparison" : v.status === "insufficient" ? "Too few samples for a reliable assessment" : "A comparison, with a baseline you can inspect"}</div>
    <div class="quality-metrics"><div><b>${F.fmt(v.rmsCm, 2)} cm</b><span>Radar–GNSS residual RMS</span></div><div><b>${F.fmt(v.zeroMotionRmsCm, 2)} cm</b><span>Zero-motion baseline RMS</span></div><div><b>${v.correlation === null ? "N/A" : F.fmt(v.correlation, 2)}</b><span>Correlation; unstable when motion is small</span></div><div><b>${F.fmt(v.biasCm, 2)} cm</b><span>Mean radar–GNSS residual</span></div></div>
    <p class="quality-note">${v.status === "unresolved" ? "Predicting zero station-to-reference motion has an equal or smaller error on these same samples. These results do not demonstrate a reliable subsidence trend in this quiet station sample." : "Compare like-for-like dates and references. Beating this simple baseline alone does not certify accuracy or establish the physical cause."}</p>
    ${scatter}
    <p class="muted" style="font-size:11px;line-height:1.7">All values are LOS differences relative to ${esc(g.reference)}, not absolute vertical sinking. The shared reference creates correlated errors. This sample does not represent every pixel or the mission's overall accuracy.</p>
    ${g.note ? `<div class="note">${esc(g.note)}</div>` : ""}
    <details><summary style="cursor:pointer;font-size:12px;color:var(--lateral)">All ${v.count} station residuals</summary><table class="mini"><tr><th>Station</th><th>NISAR</th><th>GNSS</th><th>Residual</th></tr>${rows.map((s) => `<tr><td>${esc(s.station)}</td><td>${F.fmt(s.insarCm, 2)}</td><td>${F.fmt(s.gnssCm, 2)}</td><td>${F.fmt(s.insarCm - s.gnssCm, 2)} cm</td></tr>`).join("")}</table></details></div>`;
}

async function nisarProbe(latlng) {
  if (!nis.stack) return null;
  const [[s, w], [n, e]] = nis.site.bounds;
  if (latlng.lat < s || latlng.lat > n || latlng.lng < w || latlng.lng > e) return null;
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const i = Math.min(nis.stack.w - 1, Math.floor(((latlng.lng - w) / (e - w)) * nis.stack.w));
  const j = Math.min(nis.stack.h - 1, Math.floor(((my(n) - my(latlng.lat)) / (my(n) - my(s))) * nis.stack.h));
  const p = F.phaseAt(nis.stack, nis.t, j * nis.stack.w + i);
  const date = nisarDate(nis.t);
  if (p.conf < 0.2) {
    return `<div class="kicker accent">Real NISAR, ${esc(fmtDay(date))}</div><div class="muted" style="font-size:12.5px;margin-top:4px">No clear signal here (water, fields or noise).</div>`;
  }
  return `<div class="kicker accent">Real NISAR, ${esc(shortDay(nis.items[0].reference))} to ${esc(fmtDay(date))}</div>
    <div style="font:650 18px var(--mono);margin:4px 0">${F.fmt(p.cycles, 2)} <span class="muted" style="font:13px var(--sans)">of a fringe</span></div>
    <div class="muted" style="font-size:12.5px">About ${F.fmt(p.cycles * 11.9, 1)} cm toward or away from the satellite, counted in 11.9 cm steps. Signal quality ${Math.round(p.conf * 100)}%.</div>`;
}

// ===========================================================================
// Crops and water: real NISAR HH + HV backscatter over time (web/data/nisar/<site>/gcov,
// from pipeline/nisar_pipeline.py gcov). The browse colours are R = HH, G = HV, B = HH.
// ===========================================================================

const fields = { idx: 0, layer: null, nextAt: 0, holdUntil: 0, thumbKey: null };
const FIELDS_STEP_MS = 1500;
const FIELDS_HOLD_MS = 2600;
const fieldLayers = new Set();
const gcovOf = () => (nis.site?.gcov?.frames?.length > 1 ? nis.site.gcov : null);

function dropFieldLayer(layer) {
  if (!layer) return;
  fieldLayers.delete(layer);
  if (map.hasLayer(layer)) map.removeLayer(layer);
}

/** Show image i: load it on the other pane, then fade it in over the current one. */
function showField(i, { instant = false } = {}) {
  const g = gcovOf();
  if (!g) return;
  fields.idx = Math.max(0, Math.min(g.frames.length - 1, i));
  const prev = fields.layer;
  const pane = prev?.options.pane === "photosA" ? "photosB" : "photosA";
  map.getPane(pane).style.zIndex = 262;
  map.getPane(pane === "photosA" ? "photosB" : "photosA").style.zIndex = 252;
  map.getPane("photosB").style.clip = "";
  const [[s, w], [n, e]] = nis.site.bounds;
  const next = L.imageOverlay(`data/${g.frames[fields.idx].file}`, L.latLngBounds([s, w], [n, e]), {
    pane, opacity: 0, className: "wayback-layer", interactive: false,
    attribution: "NISAR GCOV: NASA/JPL-Caltech and ISRO, via ASF DAAC",
  }).addTo(map);
  fieldLayers.add(next);
  fields.layer = next;
  for (const l of [...fieldLayers]) if (l !== next && l !== prev) dropFieldLayer(l);
  let shown = false;
  const reveal = () => {
    if (shown || fields.layer !== next) return;
    shown = true;
    next.setOpacity(1);
    setTimeout(() => { if (fields.layer === next) dropFieldLayer(prev); }, 1100);
  };
  if (instant) { next.setOpacity(1); dropFieldLayer(prev); shown = true; }
  else { next.once("load", reveal); setTimeout(reveal, 1200); }
  updateDock();
  for (const b of $$("#nisar-card [data-gdate]")) b.setAttribute("aria-current", String(Number(b.dataset.gdate) === fields.idx));
}

function enterFields() {
  const g = gcovOf();
  fields.holdUntil = 0;
  showField(state.playing ? 0 : g.frames.length - 1, { instant: true });
  fields.nextAt = performance.now() + FIELDS_STEP_MS + 600;
}

function exitFields() {
  for (const l of [...fieldLayers]) dropFieldLayer(l);
  fields.layer = null;
}

function drawFieldThumb(f) {
  if (fields.thumbKey === f.file) return;
  fields.thumbKey = f.file;
  refs.thumbKey = null;
  const img = new Image();
  img.onload = () => {
    if (fields.thumbKey !== f.file || state.mode !== "fields") return;
    const c = refs.thumbCtx;
    c.fillStyle = "#0a0f12";
    c.fillRect(0, 0, 140, 140);
    // Centre crop of the scene, where the farmland is.
    const side = Math.min(img.width, img.height) * 0.6;
    c.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 140, 140);
  };
  img.src = `data/${f.file}`;
}

function fieldsLegendHtml() {
  const fr = gcovOf().frames;
  return `<div class="card-head"><span class="kicker">NISAR polarization</span><span class="kicker amber">Browse preview</span></div>
    <div class="pol-key">
      <span style="--c:#7CFF6B">Green: stronger HV echo</span>
      <span style="--c:#FF7BEA">Pink: stronger HH echo</span>
      <span style="--c:#F4F7F5">White: bright in both</span>
      <span style="--c:#1F2A2E">Dark: weak echoes</span>
    </div>
    <div class="legend-note">${esc(fmtDay(fr[0].date))} to ${esc(fmtDay(fr[fr.length - 1].date))}. Colours suggest scattering patterns; they do not uniquely identify rice, flooding or crops. Dates may have gaps.</div>`;
}

function fieldsBlockHtml() {
  const g = gcovOf();
  if (!g) return "";
  const on = state.mode === "fields";
  const e = byId(state.eventId);
  return `<div class="pol-block">
      <div class="card-head"><h3 style="font-size:15px">Crops and water</h3><span class="kicker accent">HH + HV</span></div>
      <p class="muted" style="margin:0;font-size:12.5px;line-height:1.55">These real HH/HV browse composites show different scattering patterns. Vegetation often contributes to HV; HH can respond to surface and double-bounce scattering, including some flooded vegetation and buildings. Colours alone do not identify crop type or flooding. A water-change claim needs calibrated GCOV values and independent, date-matched validation.</p>
      <button class="pill-btn" id="fields-toggle" aria-pressed="${on}" style="justify-self:start">${icon(on ? "activity" : "leaf", { size: 15 })}${on ? "Back to ground motion" : "Play crops and water on the map"}</button>
      <div class="year-chips" role="group" aria-label="Polarization image dates">${g.frames
        .map((f, i) => `<button data-gdate="${i}" aria-current="${on && i === fields.idx}">${esc(shortDay(f.date))}</button>`).join("")}</div>
    </div>`;
}

// ===========================================================================
// Then & Now — real satellite photos over time (web/data/imagery.json from
// pipeline/imagery_timeline.py; tiles from Esri World Imagery Wayback)
// ===========================================================================

const photoSiteFor = (eventId) => {
  const s = data.imagery?.sites?.[eventId];
  return s && s.versions?.length > 1 ? s : null;
};
const monthYear = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const photoUrl = (v) => data.imagery.tileUrl.replace("{release}", v.release);
const PHOTO_PANES = ["photosA", "photosB"];
const photoLayers = new Set();

function setupPhotos(e) {
  photos.site = photoSiteFor(e.id);
  photos.idx = 0;
  photos.thumbKey = null;
}

// ---------- prefetching: warm the browser cache with the tiles a photo will need ----------

const photoCache = new Map(); // view key -> { done, promise }

/** Where Then & Now looks: the photo spot, framed clear of the dock (or the current view once there). */
function photoView() {
  if (photos.arrived) return { center: map.getCenter(), zoom: map.getZoom() };
  const f = photos.site.focus;
  const box = L.latLngBounds([f.lat - 0.0005, f.lon - 0.0005], [f.lat + 0.0005, f.lon + 0.0005]);
  return map._getBoundsCenterZoom(box, { ...mapPadding(), maxZoom: f.zoom });
}

function photoKey(v, view) {
  const z = Math.round(view.zoom);
  const c = map.project(view.center, z);
  return `${v.release}|${z}|${Math.round(c.x / 256)}|${Math.round(c.y / 256)}`;
}

/** Download every tile photo v needs for the view (plus a one-tile margin) without drawing it. */
function prefetchPhoto(v, view = photoView()) {
  const key = photoKey(v, view);
  if (photoCache.has(key)) return photoCache.get(key);
  const z = Math.round(view.zoom);
  const half = map.getSize().divideBy(2);
  const c = map.project(view.center, z);
  const lo = c.subtract(half).divideBy(256).floor();
  const hi = c.add(half).divideBy(256).floor();
  const n = 2 ** z;
  const urls = [];
  for (let x = lo.x - 1; x <= hi.x + 1; x++) {
    for (let y = Math.max(0, lo.y - 1); y <= Math.min(n - 1, hi.y + 1); y++) {
      urls.push(photoUrl(v).replace("{z}", z).replace("{y}", y).replace("{x}", ((x % n) + n) % n));
    }
  }
  const entry = { done: false };
  entry.promise = Promise.all(urls.map((u) => new Promise((res) => {
    const img = new Image();
    img.onload = img.onerror = res;
    img.src = u;
  }))).then(() => { entry.done = true; });
  photoCache.set(key, entry);
  return entry;
}

/** True once photo i is in the cache for the current view; starts the download if it is not. */
function photoReady(i) {
  const v = photos.site?.versions[i];
  return v ? prefetchPhoto(v).done : true;
}

/** Keep the next two photos downloading while the current one shows. */
function prefetchAhead() {
  const vs = photos.site.versions;
  for (const k of [1, 2]) prefetchPhoto(vs[(photos.idx + k) % vs.length]);
}

function photoLayer(v, pane) {
  const layer = L.tileLayer(photoUrl(v), {
    pane, maxZoom: 19, opacity: 0, className: "wayback-layer", updateWhenZooming: false, keepBuffer: 4,
    attribution: "Photos &copy; Esri World Imagery Wayback, Vantor (Maxar), Airbus, Earthstar Geographics",
  });
  photoLayers.add(layer);
  return layer.addTo(map);
}

function dropPhotoLayer(layer) {
  if (!layer) return;
  photoLayers.delete(layer);
  if (map.hasLayer(layer)) map.removeLayer(layer);
}

/** Show photo i: load it on the other pane, then fade it in over the current one. */
function showPhoto(i, { instant = false } = {}) {
  const vs = photos.site.versions;
  photos.idx = Math.max(0, Math.min(vs.length - 1, i));
  const prev = photos.layer;
  const pane = prev?.options.pane === "photosA" ? "photosB" : "photosA";
  map.getPane(pane).style.zIndex = 262;
  map.getPane(pane === "photosA" ? "photosB" : "photosA").style.zIndex = 252;
  map.getPane("photosB").style.clip = "";
  const next = photoLayer(vs[photos.idx], pane);
  photos.layer = next;
  // Never keep more than the outgoing and incoming photo.
  for (const l of [...photoLayers]) if (l !== next && l !== prev) dropPhotoLayer(l);
  let shown = false;
  const reveal = () => {
    if (shown || photos.layer !== next) return;
    shown = true;
    next.setOpacity(1);
    setTimeout(() => { if (photos.layer === next) dropPhotoLayer(prev); }, 1100);
  };
  if (instant) { next.setOpacity(1); dropPhotoLayer(prev); shown = true; }
  else { next.once("load", reveal); setTimeout(reveal, 2500); }
  if (photos.arrived) prefetchAhead();
  updateDock();
  for (const b of $$("#photo-card [data-photo]")) b.setAttribute("aria-current", String(Number(b.dataset.photo) === photos.idx));
}

function enterPhotos() {
  map.getContainer().classList.add("wayback-on");
  const vs = photos.site.versions;
  const site = photos.site;
  const token = (photos.token = (photos.token || 0) + 1);
  photos.holdUntil = 0;
  photos.arrived = false;
  photos.nextAt = Infinity;
  photos.idx = state.playing ? 0 : vs.length - 1;
  // Start downloading the first photos for the place we are flying to, so they are ready on arrival.
  const view = photoView();
  const first = prefetchPhoto(vs[photos.idx], view);
  prefetchPhoto(vs[(photos.idx + 1) % vs.length], view);
  if (photos.site.focus.event || photos.compare) prefetchPhoto(beforeVersion(), view);
  updateDock(true);
  // Fly first, then fade the real photo in: no reloading at every zoom level on the way.
  const arrive = () => {
    if (photos.token !== token || state.mode !== "photos" || photos.site !== site || photos.arrived) return;
    photos.arrived = true;
    if (photos.compare) return;
    const show = () => {
      if (photos.token !== token || state.mode !== "photos" || photos.compare || photos.layer) return;
      showPhoto(photos.idx);
      photos.nextAt = performance.now() + PHOTO_STEP_MS + 400;
    };
    first.promise.then(show);
    setTimeout(show, 2500);
  };
  if (reduceMotion || document.hidden) { map.setView(view.center, view.zoom, { animate: false }); arrive(); }
  else {
    map.flyTo(view.center, view.zoom, { duration: 1.8, easeLinearity: 0.2 });
    map.once("moveend", arrive);
    setTimeout(arrive, 2300); // in case the flight is interrupted or the tab is in the background
  }
}

function exitPhotos() {
  photos.token = (photos.token || 0) + 1;
  photos.arrived = false;
  setCompare(false, { quiet: true });
  for (const l of [...photoLayers]) dropPhotoLayer(l);
  photos.layer = null;
  map.getContainer().classList.remove("wayback-on");
  focusEvent(byId(state.eventId));
}

function setCompare(on, { quiet = false } = {}) {
  if (!photos.site) return;
  photos.compare = on;
  $("#app").classList.toggle("comparing", on);
  const swipe = $("#swipe");
  if (on) {
    if (state.playing) setPlaying(false);
    const vs = photos.site.versions;
    const b = beforeVersion();
    for (const l of [...photoLayers]) dropPhotoLayer(l);
    map.getPane("photosA").style.zIndex = 252;
    map.getPane("photosB").style.zIndex = 262;
    photos.before = photoLayer(b, "photosA");
    photos.after = photoLayer(vs[vs.length - 1], "photosB");
    photos.before.setOpacity(1);
    photos.after.setOpacity(1);
    photos.layer = photos.after;
    photos.idx = vs.length - 1;
    swipe.hidden = false;
    const ev = photos.site.focus.event;
    $("#swipe-left").textContent = `${monthYear(b.captured)}${ev ? ", before" : ""}`;
    $("#swipe-right").textContent = `${monthYear(vs[vs.length - 1].captured)}${ev ? ", after" : ""}`;
    photos.labels = [monthYear(b.captured), monthYear(vs[vs.length - 1].captured)];
    $("#swipe-note").textContent = LOOK_FOR[state.eventId] || photos.site.focus.note || "";
    updateSwipe();
    if (!quiet) {
      const both = Promise.all([prefetchPhoto(b).promise, prefetchPhoto(vs[vs.length - 1]).promise]);
      Promise.race([both, new Promise((r) => setTimeout(r, 2500))]).then(() => { if (photos.compare && !photos.blink) sweepSwipe(); });
    }
  } else {
    stopBlink();
    swipe.hidden = true;
    map.getPane("photosB").style.clip = "";
    photos.before = photos.after = null;
    if (!quiet && state.mode === "photos") { for (const l of [...photoLayers]) dropPhotoLayer(l); photos.layer = null; showPhoto(photos.idx, { instant: true }); }
  }
  if (!quiet) { updateDock(true); renderPhotoCard(); }
}

/** "Before": the last photo taken before the site's event (eruption, earthquake), else the oldest. */
function beforeVersion() {
  const vs = photos.site.versions;
  const ev = photos.site.focus.event;
  const pre = ev ? vs.filter((v) => v.captured < ev && !v.approx) : [];
  return pre.length ? pre[pre.length - 1] : vs[0];
}

function updateSwipe() {
  if (!photos.compare) return;
  if (photos.blink) { map.getPane("photosB").style.clip = ""; return; }
  const size = map.getSize();
  const nw = map.containerPointToLayerPoint([0, 0]);
  const se = map.containerPointToLayerPoint(size);
  const x = nw.x + size.x * photos.split;
  map.getPane("photosB").style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
  $("#swipe").style.setProperty("--split", `${photos.split * 100}%`);
}

function wireSwipe() {
  const host = $("#view-map");
  host.insertAdjacentHTML("beforeend", `<div class="swipe" id="swipe" hidden>
      <div class="swipe-line"></div>
      <button class="swipe-knob" id="swipe-knob" aria-label="Drag to compare the oldest and newest photo">${icon("chevronLeft", { size: 16 })}${icon("chevronRight", { size: 16 })}</button>
      <span class="swipe-tag left" id="swipe-left"></span><span class="swipe-tag right" id="swipe-right"></span>
      <div class="swipe-top"><p class="swipe-note" id="swipe-note"></p>
        <div class="swipe-year" id="swipe-year" aria-live="polite"></div>
        <button class="pill-btn" id="swipe-blink" aria-pressed="false">${icon("eye", { size: 15 })}<span>Flick between the years</span></button></div>
    </div>`);
  $("#swipe-blink").addEventListener("click", () => (photos.blink ? stopBlink() : startBlink()));
  const knob = $("#swipe-knob");
  const move = (clientX) => {
    const r = map.getContainer().getBoundingClientRect();
    photos.split = Math.min(0.98, Math.max(0.02, (clientX - r.left) / r.width));
    updateSwipe();
  };
  knob.addEventListener("pointerdown", (ev) => { photos.sweeping = false; knob.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  knob.addEventListener("pointermove", (ev) => { if (knob.hasPointerCapture(ev.pointerId)) move(ev.clientX); });
  knob.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      photos.split = Math.min(0.98, Math.max(0.02, photos.split + (ev.key === "ArrowLeft" ? -0.05 : 0.05)));
      updateSwipe();
      ev.preventDefault();
    }
  });
  map.on("move zoom resize", updateSwipe);
}

/** Slide the divider once across the map so people see both photos and know it can be dragged. */
function sweepSwipe() {
  if (reduceMotion) return;
  photos.sweeping = true;
  const t0 = performance.now();
  const keys = [[0, 0.5], [700, 0.12], [1700, 0.88], [2500, 0.5]];
  const step = (t) => {
    if (!photos.sweeping || !photos.compare || photos.blink) return;
    const el = t - t0;
    let k = 0;
    while (k < keys.length - 2 && el > keys[k + 1][0]) k++;
    const [ta, a] = keys[k], [tb, b] = keys[k + 1];
    const f = Math.min(1, Math.max(0, (el - ta) / (tb - ta)));
    photos.split = a + (b - a) * (0.5 - Math.cos(Math.PI * f) / 2);
    updateSwipe();
    if (el < keys[keys.length - 1][0]) requestAnimationFrame(step);
    else photos.sweeping = false;
  };
  requestAnimationFrame(step);
}

/** Flick between the two years, like an astronomer's blink comparator: change jumps out at the eye. */
function startBlink() {
  if (!photos.compare || photos.blink) return;
  photos.blink = true;
  photos.sweeping = false;
  $("#swipe").classList.add("blinking");
  const pane = map.getPane("photosB");
  pane.style.clip = "";
  let after = false;
  const show = () => {
    after = !after;
    pane.style.opacity = after ? "1" : "0";
    $("#swipe-year").innerHTML = `${esc(photos.labels?.[after ? 1 : 0] || "")}<small>${after ? "after" : "before"}</small>`;
  };
  show();
  photos.blinkTimer = setInterval(show, 1200);
  const b = $("#swipe-blink");
  b.setAttribute("aria-pressed", "true");
  b.querySelector("span").textContent = "Use the slider";
}

function stopBlink() {
  if (!photos.blink) return;
  clearInterval(photos.blinkTimer);
  photos.blink = false;
  map.getPane("photosB").style.opacity = "";
  $("#swipe").classList.remove("blinking");
  const b = $("#swipe-blink");
  b.setAttribute("aria-pressed", "false");
  b.querySelector("span").textContent = "Flick between the years";
  updateSwipe();
}

// ===========================================================================
// Story mode: a guided tour of one place, a few plain sentences at a time (stories.js)
// ===========================================================================

const story = { active: false, eventId: null, steps: [], i: 0, started: 0, elapsed: 0, dur: 0, paused: false };

function storySteps(e) {
  const site = nisarSiteFor(e.id);
  const has = { model: true, nisar: !!site, fields: (site?.gcov?.frames?.length || 0) > 1, photos: !!photoSiteFor(e.id) };
  return (TOURS[e.id] || []).filter((st) => has[st.mode]);
}

function storyDuration(st) {
  return Math.min(13000, Math.max(7000, 4500 + st.text.length * 55)) + (st.compare ? 4500 : 0);
}

async function startStory(id) {
  closeWelcome();
  setDockMin(false);
  if (live.active) clearLive();
  const e = byId(id);
  const steps = storySteps(e);
  if (!steps.length) return;
  if (state.view !== "map") setView("map");
  setSheet(false);
  map.closePopup();
  story.active = true;
  story.eventId = e.id;
  story.steps = steps;
  story.paused = false;
  story.i = 0;
  $("#app").classList.add("story-on");
  $("#story").hidden = false;
  renderStoryCard(); // the card's height sets how the map frames the place
  if (state.eventId !== e.id) selectEvent(e.id, { fly: true });
  else focusEvent(e);
  if (!state.playing) setPlaying(true);
  await storyGo(0);
}

function stopStory() {
  if (!story.active) return;
  story.active = false;
  hush();
  stopBlink();
  $("#app").classList.remove("story-on");
  $("#story").hidden = true;
  setTimeout(() => { map.invalidateSize(); dirty = true; }, 50);
}

async function storyGo(i) {
  if (!story.active) return;
  story.i = Math.max(0, Math.min(story.steps.length - 1, i));
  const st = story.steps[story.i];
  story.started = performance.now();
  story.elapsed = 0;
  story.dur = storyDuration(st);
  renderStoryCard();
  speakStep(st);
  stopBlink();
  if (state.mode !== st.mode) await setMode(st.mode);
  else if (st.mode === "model") startDance();
  if (!story.active || story.steps[story.i] !== st) return;
  if (!state.playing && !st.compare) setPlaying(true);
  if (st.mode === "photos") {
    if (st.compare) {
      setCompare(true);
      // After the divider has swept across once, flick between the years so the change pops out.
      setTimeout(() => { if (story.active && story.steps[story.i] === st && photos.compare) startBlink(); }, 3000);
    } else if (photos.compare) {
      setCompare(false);
    }
  }
}

function renderStoryCard() {
  const e = byId(story.eventId);
  const st = story.steps[story.i];
  const n = story.steps.length;
  const last = story.i === n - 1;
  $("#story-kicker").textContent = `${e.name}, step ${story.i + 1} of ${n}`;
  $("#story-title").textContent = st.title;
  $("#story-text").textContent = st.text;
  const stat = $("#story-stat");
  stat.hidden = !st.stat;
  if (st.stat) stat.innerHTML = `<strong class="${esc(st.stat[2] || "accent")}">${esc(st.stat[0])}</strong><span>${esc(st.stat[1])}</span>`;
  $("#story-progress").innerHTML = story.steps.map((_, k) => `<i class="${k < story.i ? "done" : k === story.i ? "now" : ""}"><b></b></i>`).join("");
  $("#story-back").disabled = story.i === 0;
  $("#story-next").hidden = last;
  $("#story-end").hidden = !last;
  $("#story-pause").hidden = last;
  updateStoryPause();
  const next = nextStoryId();
  $("#story-another").innerHTML = `${icon("chevronRight", { size: 15 })}<span>Next story: ${esc(byId(next).name)}</span>`;
  $("#story-another").dataset.id = next;
}

function nextStoryId() {
  const order = [...FEATURED, ...F.EVENTS.map((x) => x.id).filter((id) => !FEATURED.includes(id))].filter((id) => storySteps(byId(id)).length);
  return order[(order.indexOf(story.eventId) + 1) % order.length];
}

function updateStoryPause() {
  const b = $("#story-pause");
  b.innerHTML = story.paused ? playIcon(16) : pauseIcon(16);
  b.setAttribute("aria-label", story.paused ? "Resume the story" : "Pause the story");
}

function toggleStoryPause() {
  if (story.paused) { story.paused = false; story.started = performance.now() - story.elapsed; if (canSpeak) speechSynthesis.resume(); }
  else { story.paused = true; story.elapsed = performance.now() - story.started; if (canSpeak) speechSynthesis.pause(); }
  updateStoryPause();
}

function storyTick() {
  if (!story.active) return;
  const el = story.paused ? story.elapsed : performance.now() - story.started;
  const f = Math.min(1, el / story.dur);
  const now = $("#story-progress .now b");
  if (now) now.style.width = `${f * 100}%`;
  const voiceDone = !voice.on || (voice.done && performance.now() - voice.endedAt > 600);
  if (f >= 1 && !story.paused && voiceDone && story.i < story.steps.length - 1) storyGo(story.i + 1);
}

function wireStory() {
  $("#view-map").insertAdjacentHTML("beforeend", `<section class="story glass" id="story" aria-live="polite" aria-label="Story" hidden>
      <div class="story-top"><span class="kicker accent" id="story-kicker"></span>
        <button class="icon-btn" id="story-close" aria-label="Close the story">${icon("x", { size: 16 })}</button></div>
      <div class="story-head"><h2 id="story-title"></h2><div class="story-stat" id="story-stat" hidden></div></div>
      <p id="story-text"></p>
      <div class="story-progress" id="story-progress" aria-hidden="true"></div>
      <div class="story-actions">
        <button class="pill-btn ghost" id="story-back">${icon("chevronLeft", { size: 15 })}Back</button>
        <span class="story-spacer"></span>
        <button class="round story-pause story-voice" id="story-voice" aria-pressed="false"></button>
        <button class="round story-pause" id="story-pause"></button>
        <button class="pill-btn" id="story-next">Next${icon("chevronRight", { size: 15 })}</button>
        <div class="story-end" id="story-end" hidden>
          <button class="pill-btn ghost" id="story-explore">Explore on my own</button>
          <button class="pill-btn" id="story-another"></button>
        </div>
      </div>
    </section>`);
  $("#story-close").addEventListener("click", stopStory);
  $("#story-back").addEventListener("click", () => storyGo(story.i - 1));
  $("#story-next").addEventListener("click", () => storyGo(story.i + 1));
  $("#story-pause").addEventListener("click", toggleStoryPause);
  $("#story-voice").hidden = !canSpeak;
  $("#story-voice").addEventListener("click", toggleVoice);
  updateVoiceButton();
  $("#story-explore").addEventListener("click", () => { stopStory(); setSheet(true); });
  $("#story-another").addEventListener("click", (ev) => startStory(ev.currentTarget.dataset.id));
  $("#story-cta")?.addEventListener("click", () => startStory(state.eventId));
  document.addEventListener("keydown", (ev) => {
    if (!story.active || ["INPUT", "TEXTAREA"].includes(ev.target.tagName)) return;
    if (ev.key === "Escape") stopStory();
    else if (ev.key === "ArrowRight") { ev.preventDefault(); storyGo(story.i + 1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); storyGo(story.i - 1); }
    else if (ev.key === " " && ev.target === document.body) { ev.preventDefault(); toggleStoryPause(); }
  });
  setInterval(storyTick, 100);
}

// ===========================================================================
// Welcome: pick a story, or explore on your own
// ===========================================================================

let globeApi = null;
let globeLoading = null;
const KIND_HEX = { coral: "#ff7a66", amber: "#ffc857", lateral: "#8fcdea" };

/** Build the 3D globe the first time it is needed; later just wake it up. */
function ensureGlobe() {
  if (globeApi) { globeApi.resume(); globeApi.resize(); return; }
  if (globeLoading) return;
  const el = $("#welcome-globe");
  const sites = F.EVENTS.map((e) => ({ id: e.id, name: e.name, status: statusText(e), lat: e.lat, lon: e.lon, kind: kindColor(e.kind), color: KIND_HEX[kindColor(e.kind)] }));
  globeLoading = import("./globe.js?v=10.0")
    .then((m) => m.createGlobe(el, sites, { onPick: (id) => whenReady(() => startStory(id)), reduceMotion, small: isPhone() }))
    .then((api) => {
      globeApi = api;
      el.classList.add("ready");
      if ($("#welcome").hidden) api.pause();
    })
    .catch((err) => { console.warn("3D globe unavailable", err); globeLoading = null; });
}

function openWelcome() {
  explorerTour?.stop();
  journey?.setActive(false);
  const w = $("#welcome");
  ui.welcome = true;
  setDockMin(false);
  w.hidden = false;
  $("#app").inert = true;
  document.body.classList.add("welcome-open");
  ensureGlobe();
  for (const c of $$("canvas[data-tour]", w)) {
    const e = byId(c.dataset.tour);
    const prepared = F.prepareScene({ model: e.model, extentKm: e.extentKm, geometry: F.GEOMETRIES[e.geometry], resolution: 160, seed: e.seed });
    F.renderPrepared(c.getContext("2d"), prepared, { scale: 1, wavelengthCm: F.BANDS.L.wavelengthCm, atmosphereCm: 0.6, style: "scene" });
  }
  $("#welcome-learn")?.focus();
}

function closeWelcome() {
  const w = $("#welcome");
  if (!w || w.hidden) return;
  w.hidden = true;
  $("#app").inert = false;
  ui.welcome = false;
  document.body.classList.remove("welcome-open");
  globeApi?.pause();
  // The map was waiting behind the welcome screen: start the rings from the beginning now that it shows.
  dirty = true;
  if (state.playing && state.mode === "model" && !story.active) startDance(performance.now(), 250);
  try { sessionStorage.setItem("fringe.welcome", "seen"); } catch { /* private mode */ }
}

function wireWelcome() {
  const cards = FEATURED.map(byId).map((e, i) => `<button class="w-card${i === 0 ? " lead" : ""}" data-tour-go="${esc(e.id)}">
      <canvas width="160" height="160" data-tour="${esc(e.id)}" aria-hidden="true"></canvas>
      <span class="w-body">${i === 0 ? `<span class="w-badge">Start here</span>` : ""}
        <strong>${esc(e.name)}, ${esc(e.region)}</strong>
        <span>${esc(e.headline)}</span>
        <em class="${kindColor(e.kind)}">${esc(statusText(e))}</em></span>
      ${icon("chevronRight", { size: 18 })}</button>`).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="welcome" id="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" hidden>
      <div class="welcome-globe" id="welcome-globe" aria-hidden="true"></div>
      <div class="welcome-card glass">
        <p class="kicker accent">Fringe, a NISAR radar explorer</p>
        <h1 id="welcome-title">A planet in motion.</h1>
        <p class="welcome-lede">Choose a place and follow its story through radar, photographs and the evidence on the ground.</p>
        <button class="welcome-journey" id="welcome-learn"><strong>Replay See the Unseen →</strong><small>A cinematic introduction to the explorer · 2–3 minutes</small></button>
        <div class="welcome-grid">${cards}</div>
        <div class="welcome-foot"><div class="pin-key"><span class="coral">Sinking</span><span class="amber">Rising</span><span class="lateral">Moving sideways</span></div>
          <span class="welcome-actions"><button class="pill-btn ghost" id="welcome-home">${icon("crosshair", { size: 15 })}NISAR over my home</button>
          <button class="pill-btn ghost" id="welcome-skip">Open the map${icon("chevronRight", { size: 15 })}</button></span></div>
      </div>
    </div>`);
  for (const b of $$("[data-tour-go]")) b.addEventListener("click", () => whenReady(() => startStory(b.dataset.tourGo)));
  $("#welcome-skip").addEventListener("click", closeWelcome);
  $("#welcome-learn").addEventListener("click", openJourney);
  $("#welcome-home").addEventListener("click", () => whenReady(() => { closeWelcome(); locateMe(); }));
  window.addEventListener("resize", () => { if (!$("#welcome").hidden) globeApi?.resize(); });
  $("#welcome").addEventListener("click", (ev) => { if (ev.target.id === "welcome") closeWelcome(); });
  document.addEventListener("keydown", (ev) => {
    const welcome = $("#welcome");
    if (welcome.hidden) return;
    if (ev.key === "Escape") { closeWelcome(); $("#btn-world").focus(); }
    if (ev.key === "Tab") {
      const controls = $$("button, a[href]", welcome).filter((el) => !el.disabled && !el.hidden);
      const first = controls[0], last = controls[controls.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); }
    }
  });
}

// ===========================================================================
// Read aloud: the browser's own voice reads each story step (Web Speech API)
// ===========================================================================

const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const voice = { on: false, done: true, endedAt: 0 };
try { voice.on = canSpeak && localStorage.getItem("fringe.voice") === "on"; } catch { /* private mode */ }

/** Spell out units so the voice says "11 millimetres", not "11 m m". */
function speechText(s) {
  return s
    .replace(/−/g, "minus ")
    .replace(/(\d)\s?km²/g, "$1 square kilometres")
    .replace(/(\d)\s?km\b/g, "$1 kilometres")
    .replace(/(\d)\s?mm\b/g, "$1 millimetres")
    .replace(/(\d)\s?cm\b/g, "$1 centimetres")
    .replace(/(\d)\s?m\b/g, "$1 metres")
    .replace(/%/g, " percent");
}

function pickVoice() {
  const all = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  return all.find((v) => /natural|neural|online|google/i.test(v.name)) || all.find((v) => /en-gb|en-us/i.test(v.lang)) || all[0] || null;
}

function hush() {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  voice.done = true;
  voice.endedAt = performance.now();
}

function speakStep(st) {
  if (!voice.on || !canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speechText(`${st.title}. ${st.text}`));
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
  u.rate = 0.98;
  voice.done = false;
  u.onend = u.onerror = () => { voice.done = true; voice.endedAt = performance.now(); };
  speechSynthesis.speak(u);
  if (story.paused) speechSynthesis.pause();
}

function updateVoiceButton() {
  const b = $("#story-voice");
  if (!b) return;
  b.innerHTML = icon(voice.on ? "volume" : "volumeOff", { size: 17 });
  b.setAttribute("aria-pressed", String(voice.on));
  b.setAttribute("aria-label", voice.on ? "Stop reading aloud" : "Read the story aloud");
  b.title = voice.on ? "Reading aloud" : "Read aloud";
}

function toggleVoice() {
  voice.on = !voice.on;
  try { localStorage.setItem("fringe.voice", voice.on ? "on" : "off"); } catch { /* private mode */ }
  updateVoiceButton();
  if (voice.on && story.active) speakStep(story.steps[story.i]);
  else hush();
}

// ===========================================================================
// NISAR over any place, live from NASA's catalogue (CMR). Public preview images only, no login.
// ===========================================================================

const live = { active: false, token: 0, frames: [], layers: [], blinkTimer: 0, prevBase: null, pin: null, point: null };
const CMR_GCOV = "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=NISAR_L2_GCOV_PROVISIONAL_V1";

/** One catalogue entry -> { date, track, dir, pol, full, thumb, bounds }, or null if it lacks a preview. */
function parseGcov(e) {
  const m = /_GCOV_(\d{3})_(\d{3})_([AD])_(\d{3})_\d{4}_([A-Z]{4})_/.exec(e.title || "");
  const links = (e.links || []).map((l) => l.href).filter((h) => h && h.startsWith("https"));
  const full = links.find((h) => h.endsWith("_LATLON.png"));
  const thumb = links.find((h) => h.endsWith("_LATLON_thumbnail.png"));
  const nums = String(e.polygons?.[0]?.[0] || "").trim().split(/\s+/).map(Number);
  const lats = [], lons = [];
  for (let i = 0; i + 1 < nums.length; i += 2) { lats.push(nums[i]); lons.push(nums[i + 1]); }
  if (!m || !full || lats.length < 3 || Math.max(...lons) - Math.min(...lons) > 30) return null;
  return {
    date: String(e.time_start).slice(0, 10), track: Number(m[2]), dir: m[3], frame: Number(m[4]), pol: m[5], full, thumb,
    poly: lats.map((la, k) => [la, lons[k]]),
    bounds: L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]),
  };
}

/** The newest images of this spot on one track (newest first), dual-polarization when there is any. */
async function fetchLive(lat, lon) {
  const r = await fetch(`${CMR_GCOV}&point=${lon.toFixed(4)},${lat.toFixed(4)}&sort_key=-start_date&page_size=40`);
  if (!r.ok) throw new Error(`NASA answered ${r.status}`);
  const all = ((await r.json()).feed?.entry || []).map(parseGcov).filter(Boolean);
  if (!all.length) return [];
  const pool = all.some((g) => g.pol.startsWith("DH")) ? all.filter((g) => g.pol.startsWith("DH")) : all;
  const first = pool[0];
  const seen = new Set();
  return pool.filter((g) => g.track === first.track && g.dir === first.dir && g.frame === first.frame && !seen.has(g.date) && seen.add(g.date));
}

/**
 * Place a NISAR preview exactly, the way pipeline/nisar_pipeline.py georeference_browse does: the preview is a
 * plate-carree plot of the footprint, so its four outermost painted pixels are the footprint's corners. Fit
 * x = a*lon + b and y = c*lat + d to them, then redraw the rows on the web map's Mercator grid and make the
 * black no-data area transparent. Returns { url, bounds, exact } or null if the image can't be read.
 */
async function loadPreview(url, poly) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const w = img.naturalWidth, h = img.naturalHeight;
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const sx = src.getContext("2d", { willReadFrequently: true });
  sx.drawImage(img, 0, 0);
  const px = sx.getImageData(0, 0, w, h).data;
  // The preview is a straight north-up plot of the footprint, so the box around its painted pixels is
  // exactly the footprint's latitude/longitude box: crop to it and place it there.
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (px[k] + px[k + 1] + px[k + 2] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  const lats = poly.map((q) => q[0]), lons = poly.map((q) => q[1]);
  const N = Math.max(...lats), S = Math.min(...lats), W = Math.min(...lons), E = Math.max(...lons);
  const c = -(y1 + 1 - y0) / (N - S);
  const d = y0 - c * N;
  // Quality check: pixels per degree east-west vs north-south must match the map scale at this latitude.
  const ratio = ((x1 + 1 - x0) / (E - W)) / -c;
  const exact = Math.abs(ratio - Math.cos((((N + S) / 2) * Math.PI) / 180)) < 0.08;
  // Redraw on the Mercator grid Leaflet uses, one row at a time.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const outW = x1 - x0 + 1;
  const outH = Math.max(2, Math.round((outW * (merc(N) - merc(S))) / (((E - W) * Math.PI) / 180)));
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const ox = out.getContext("2d", { willReadFrequently: true });
  for (let r = 0; r < outH; r++) {
    const m = merc(N) - ((r + 0.5) / outH) * (merc(N) - merc(S));
    const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI);
    const sy = Math.min(h - 1, Math.max(0, Math.round(c * lat + d)));
    ox.drawImage(src, x0, sy, outW, 1, 0, r, outW, 1);
  }
  const od = ox.getImageData(0, 0, outW, outH);
  for (let k = 0; k < od.data.length; k += 4) if (od.data[k] + od.data[k + 1] + od.data[k + 2] === 0) od.data[k + 3] = 0;
  ox.putImageData(od, 0, 0);
  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  return { url: URL.createObjectURL(blob), bounds: L.latLngBounds([S, W], [N, E]), exact };
}

function liveOverlay(prev, pane, { thumb = false, opacity = 0 } = {}) {
  const layer = L.imageOverlay(prev.url, prev.bounds, {
    pane, opacity, interactive: false, className: `live-layer${thumb ? " live-thumb" : ""}`,
    attribution: "NISAR preview: NASA/JPL-Caltech and ISRO, via ASF DAAC",
  }).addTo(map);
  live.layers.push(layer);
  return layer;
}

function stopLiveFlick() {
  clearInterval(live.blinkTimer);
  live.blinkTimer = 0;
  map.getPane("photosB").style.opacity = "";
}

/** Close the live view and put the map back as it was. */
function clearLive({ keepCard = false } = {}) {
  live.token++;
  stopLiveFlick();
  for (const l of live.layers) { if (map.hasLayer(l)) map.removeLayer(l); URL.revokeObjectURL(l._url); }
  live.layers = [];
  live.frames = [];
  if (live.pin) { map.removeLayer(live.pin); live.pin = null; }
  map.getContainer().classList.remove("live-blend");
  if (live.prevBase !== null) { setBase(live.prevBase); live.prevBase = null; }
  if (!keepCard) {
    live.active = false;
    $("#live").hidden = true;
    $("#app").classList.remove("live-on");
    setTimeout(() => { map.invalidateSize(); dirty = true; }, 50);
  }
}

function liveCard({ kicker = "Live from NASA, NISAR satellite", title, text, key = false, note = "", flick = null, data = null, busy = false }) {
  const card = $("#live");
  card.hidden = false;
  card.classList.toggle("busy", busy);
  $("#live-kicker").textContent = kicker;
  $("#live-title").textContent = title;
  $("#live-text").textContent = text;
  $("#live-key").hidden = !key;
  $("#live-note").textContent = note;
  $("#live-note").hidden = !note;
  const fb = $("#live-flick");
  fb.hidden = !flick;
  if (flick) { fb.querySelector("span").textContent = flick; fb.setAttribute("aria-pressed", "false"); }
  const a = $("#live-data");
  a.hidden = !data;
  if (data) a.href = data;
}

function vertexUrl(lat, lon) {
  const wkt = `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`;
  return `https://search.asf.alaska.edu/#/?dataset=NISAR&polygon=${encodeURIComponent(wkt)}&zoom=8&center=${lon.toFixed(3)},${lat.toFixed(3)}`;
}

async function openLive(lat, lon) {
  setDockMin(false);
  if (story.active) stopStory();
  closeWelcome();
  if (state.view !== "map") setView("map");
  map.closePopup();
  setSheet(false);
  if (state.mode !== "model") await setMode("model");
  clearLive({ keepCard: true });
  const token = live.token;
  live.active = true;
  live.point = [lat, lon];
  $("#app").classList.add("live-on");
  live.pin = L.marker([lat, lon], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="live-pin"></div>` }), interactive: false }).addTo(map);
  liveCard({ title: "Asking NASA...", text: "Looking for NISAR's newest images of this spot.", busy: true });
  let frames;
  try {
    frames = await fetchLive(lat, lon);
  } catch {
    if (token !== live.token) return;
    liveCard({ title: "Couldn't reach NASA right now", text: "Check the internet connection and try again, or click another spot." });
    return;
  }
  if (token !== live.token) return;
  if (!frames.length) {
    liveCard({ title: "No NISAR image here yet", text: "NISAR maps land and ice, not the open ocean, and its first year is still filling in. Click another spot on land.", data: vertexUrl(lat, lon) });
    map.flyTo([lat, lon], Math.max(map.getZoom(), 5), { duration: 1.2 });
    return;
  }
  live.frames = frames;
  const g = frames[0];
  const old = frames[frames.length - 1];
  map.getPane("photosA").style.zIndex = 252;
  map.getPane("photosB").style.zIndex = 262;
  map.getPane("photosB").style.clip = "";
  if (reduceMotion) map.fitBounds(g.bounds, { ...mapPadding(), animate: false });
  else map.flyToBounds(g.bounds, { ...mapPadding(), duration: 1.4 });
  // A 12 KB thumbnail right away, then the sharp 2000 px preview fades in over it, both placed by their corners.
  let thumb = null;
  if (g.thumb) loadPreview(g.thumb, g.poly).then((pv) => { if (pv && token === live.token && !live.sharp) thumb = liveOverlay(pv, "photosA", { thumb: true, opacity: 1 }); }).catch(() => {});
  live.sharp = false;
  loadPreview(g.full, g.poly).then((pv) => {
    if (!pv || token !== live.token) return;
    live.sharp = true;
    const full = liveOverlay(pv, "photosB");
    full.once("load", () => {
      if (token !== live.token) return;
      full.setOpacity(1);
      setTimeout(() => { if (token === live.token && thumb && map.hasLayer(thumb)) map.removeLayer(thumb); }, 1500);
    });
    if (!pv.exact) $("#live-note").textContent = `Track ${g.track}, ${g.dir === "A" ? "ascending" : "descending"} pass. Preview image, position approximate.`;
  }).catch(() => { if (token === live.token) $("#live-note").textContent = "Couldn't load NISAR's preview image just now. Try again in a moment."; });
  const dual = g.pol.startsWith("DH");
  const times = frames.length > 1 ? ` NISAR has looked here ${frames.length} times since ${monthYear(old.date)}.` : "";
  liveCard({
    title: `This spot from space, ${fmtDay(g.date)}`,
    text: dual ? `Real radar, not a photo: it sees through clouds and works at night.${times}` : `This image has one polarization, so it is grey: brighter means rougher ground or buildings.${times}`,
    key: dual,
    note: `Track ${g.track}, ${g.dir === "A" ? "ascending" : "descending"} pass. NASA's preview image, placed by its footprint.`,
    flick: frames.length > 1 ? `Flick: ${shortDay(old.date)} and ${shortDay(g.date)}` : null,
    data: vertexUrl(lat, lon),
  });
}

/** Flick between the oldest and newest image of the same track, so a season's change jumps out. */
function toggleLiveFlick() {
  const b = $("#live-flick");
  if (live.blinkTimer) {
    stopLiveFlick();
    b.setAttribute("aria-pressed", "false");
    $("#live-title").textContent = `This spot from space, ${fmtDay(live.frames[0].date)}`;
    return;
  }
  const g = live.frames[0];
  const old = live.frames[live.frames.length - 1];
  const token = live.token;
  for (const l of [...live.layers]) if (l.options.pane === "photosA" && map.hasLayer(l)) map.removeLayer(l);
  b.setAttribute("aria-pressed", "true");
  b.querySelector("span").textContent = "Loading the older image...";
  const start = () => {
    if (token !== live.token || live.blinkTimer) return;
    b.querySelector("span").textContent = "Stop flicking";
    let newer = false;
    const show = () => {
      newer = !newer;
      map.getPane("photosB").style.opacity = newer ? "1" : "0";
      $("#live-title").textContent = `This spot from space, ${fmtDay(newer ? g.date : old.date)}`;
    };
    show();
    live.blinkTimer = setInterval(show, 1300);
  };
  loadPreview(old.full, old.poly).then((pv) => {
    if (!pv || token !== live.token) return;
    const older = liveOverlay(pv, "photosA", { opacity: 1 });
    older.once("load", start);
  }).catch(() => { if (token === live.token) b.querySelector("span").textContent = "Couldn't load the older image"; });
}

/** Use the browser's location (asked only when the button is pressed). */
function locateMe() {
  if (!navigator.geolocation) {
    liveCard({ kicker: "Your location", title: "Location isn't available here", text: "Click any spot on the map instead to see NISAR there." });
    $("#app").classList.add("live-on");
    live.active = true;
    return;
  }
  live.active = true;
  $("#app").classList.add("live-on");
  liveCard({ kicker: "Your location", title: "Finding where you are...", text: "Your browser will ask first. Your location stays on this device.", busy: true });
  navigator.geolocation.getCurrentPosition(
    (pos) => openLive(pos.coords.latitude, pos.coords.longitude),
    () => liveCard({ kicker: "Your location", title: "Location not shared", text: "No problem. Click any spot on the map to see NISAR there." }),
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
  );
}

function wireLive() {
  $("#view-map").insertAdjacentHTML("beforeend", `<section class="story live glass" id="live" aria-live="polite" aria-label="NISAR at this spot" hidden>
      <div class="story-top"><span class="kicker accent" id="live-kicker"></span>
        <button class="icon-btn" id="live-close" aria-label="Close">${icon("x", { size: 16 })}</button></div>
      <h2 id="live-title"></h2>
      <p id="live-text"></p>
      <div class="pol-key" id="live-key" hidden>
        <span style="--c:#7CFF6B">Green: crops and trees</span>
        <span style="--c:#FF7BEA">Pink: wet or flooded ground</span>
        <span style="--c:#F4F7F5">White: towns</span>
        <span style="--c:#1F2A2E">Dark: water</span>
      </div>
      <p class="live-note" id="live-note" hidden></p>
      <div class="story-actions">
        <button class="pill-btn" id="live-flick" aria-pressed="false" hidden>${icon("eye", { size: 15 })}<span></span></button>
        <a class="pill-btn ghost" id="live-data" target="_blank" rel="noopener" hidden>${icon("external", { size: 14 })}Find the data</a>
        <span class="story-spacer"></span>
        <span class="live-hint">Click anywhere to look there</span>
      </div>
    </section>`);
  $("#live-close").addEventListener("click", () => clearLive());
  $("#live-flick").addEventListener("click", toggleLiveFlick);
  $("#btn-me").innerHTML = icon("crosshair", { size: 20 });
  $("#btn-me").addEventListener("click", locateMe);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && live.active) clearLive(); });
}

/** Card thumbnail: the real photo tile under the spot. */
function drawPhotoThumb(v) {
  const key = `${photos.site.eventId}|${v.release}`;
  if (photos.thumbKey === key) return;
  photos.thumbKey = key;
  refs.thumbKey = null;
  const f = photos.site.focus;
  const z = Math.min(f.zoom + 1, 18);
  const n = 2 ** z;
  const x = ((f.lon + 180) / 360) * n;
  const lr = (f.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n;
  const img = new Image();
  img.onload = () => {
    if (photos.thumbKey !== key) return;
    const c = refs.thumbCtx;
    c.fillStyle = "#0a0f12";
    c.fillRect(0, 0, 140, 140);
    // Centre the spot: crop a 128-px window of the 256-px tile around it.
    const sx = Math.max(0, Math.min(128, (x - Math.floor(x)) * 256 - 64));
    const sy = Math.max(0, Math.min(128, (y - Math.floor(y)) * 256 - 64));
    c.drawImage(img, sx, sy, 128, 128, 0, 0, 140, 140);
  };
  img.src = photoUrl(v).replace("{z}", z).replace("{y}", Math.floor(y)).replace("{x}", Math.floor(x));
}

function photoLegendHtml() {
  const vs = photos.site.versions;
  return `<div class="card-head"><span class="kicker">Real satellite photos</span><span class="kicker" style="color:var(--text)">Then &amp; Now</span></div>
    <div class="legend-note" style="color:var(--text-2)">${esc(photos.site.focus.note)}</div>
    <div class="legend-row" style="margin-top:6px"><span>${esc(monthYear(vs[0].captured))}</span><span>${esc(monthYear(vs[vs.length - 1].captured))}</span></div>
    <div class="legend-note">${vs.length} different photos from Esri World Imagery Wayback</div>`;
}

function renderPhotoCard() {
  const card = $("#photo-card");
  if (!card) return;
  if (!photos.site) { card.remove(); return; }
  const vs = photos.site.versions;
  const on = state.mode === "photos";
  card.innerHTML = `
    <div class="card-head"><h3>Then &amp; Now</h3><span class="label-pill" style="padding:4px 8px;background:rgba(255,255,255,0.08);color:var(--text)">REAL PHOTOS</span></div>
    <p class="prose-p" style="font-size:14px"><strong>${esc(photos.site.focus.label)}.</strong> ${esc(photos.site.focus.note)}</p>
    <div class="btn-row">
      <button class="pill-btn" id="photo-toggle" aria-pressed="${on}">${icon(on ? "eyeOff" : "image", { size: 15 })}${on ? "Back to the physics model" : "Watch it change"}</button>
      ${on ? `<button class="pill-btn ghost" id="photo-compare" aria-pressed="${photos.compare}">${icon("lr", { size: 15 })}${photos.compare ? "Timelapse" : "Compare first and last"}</button>` : ""}
    </div>
    <div class="year-chips" role="group" aria-label="Photo dates">${vs
      .map((v, i) => `<button data-photo="${i}" aria-current="${on && i === photos.idx}" title="${esc(fmtDay(v.captured))}, ${esc(v.source)}${v.resM ? `, ${v.resM} m detail` : ""}${v.approx ? " (rough date)" : ""}">${esc(monthYear(v.captured))}</button>`).join("")}</div>
    <p class="muted" style="margin:0;font-size:11.5px;line-height:1.5">${vs.length} real satellite photos of this spot, from ${esc(fmtDay(vs[0].captured))} to ${esc(fmtDay(vs[vs.length - 1].captured))}. We found them by checking every version of Esri World Imagery Wayback since 2014. Photos © Esri, Vantor (Maxar), Airbus, Earthstar Geographics and partners.</p>`;
  $("#photo-toggle").addEventListener("click", () => setMode(on ? "model" : "photos"));
  $("#photo-compare")?.addEventListener("click", () => setCompare(!photos.compare));
  for (const b of $$("[data-photo]", card)) {
    b.addEventListener("click", async () => {
      if (state.mode !== "photos") await setMode("photos");
      if (photos.compare) setCompare(false);
      setPlaying(false);
      showPhoto(Number(b.dataset.photo));
    });
  }
}

// ===========================================================================
// On the ground — freely licensed photos per site (web/data/photos.json from
// pipeline/ground_photos.py; Wikimedia Commons, public domain / CC BY / CC BY-SA)
// ===========================================================================

const groundFor = (eventId) => data.photos?.sites?.[eventId] || [];
const lb = { items: [], i: 0, opener: null };

function creditHtml(p) {
  const lic = p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license);
  return `Photo by ${esc(p.author)}, ${lic}, via <a href="${esc(p.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
}

function renderGroundCard(e) {
  const card = $("#ground-card");
  if (!card) return;
  const items = groundFor(e.id);
  if (!items.length) { card.remove(); return; }
  card.innerHTML = `
    <div class="card-head"><h3>On the ground</h3><span class="kicker">${items.length} photo${items.length > 1 ? "s" : ""}</span></div>
    <div class="gallery" role="list">${items.map((p, i) => `
      <figure role="listitem">
        <button class="gallery-img" data-i="${i}" aria-label="Open photo: ${esc(p.caption)}"><img data-src="data/${esc(p.file)}" alt="${esc(p.caption)}" decoding="async"></button>
        <figcaption>${esc(p.caption)}<span class="credit">${creditHtml(p)}</span></figcaption>
      </figure>`).join("")}</div>`;
  for (const b of $$(".gallery-img", card)) b.addEventListener("click", () => openLightbox(items, Number(b.dataset.i), b));
  loadSheetPhotos();
}

function wireLightbox() {
  document.body.insertAdjacentHTML("beforeend", `<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" hidden>
      <button class="round lb-close" id="lb-close" aria-label="Close">${icon("x", { size: 20 })}</button>
      <button class="round lb-nav lb-prev" id="lb-prev" aria-label="Previous photo">${icon("chevronLeft", { size: 22 })}</button>
      <figure class="lb-figure"><img id="lb-img" alt=""><figcaption><p id="lb-caption"></p><span class="credit" id="lb-credit"></span></figcaption></figure>
      <button class="round lb-nav lb-next" id="lb-next" aria-label="Next photo">${icon("chevronRight", { size: 22 })}</button>
    </div>`);
  $("#lb-close").addEventListener("click", closeLightbox);
  $("#lb-prev").addEventListener("click", () => showLightbox(lb.i - 1));
  $("#lb-next").addEventListener("click", () => showLightbox(lb.i + 1));
  $("#lightbox").addEventListener("click", (ev) => { if (ev.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (ev) => {
    if ($("#lightbox").hidden) return;
    if (ev.key === "Escape") closeLightbox();
    if (ev.key === "ArrowLeft") showLightbox(lb.i - 1);
    if (ev.key === "ArrowRight") showLightbox(lb.i + 1);
  });
}

function openLightbox(items, i, opener) {
  lb.items = items;
  lb.opener = opener;
  $("#lightbox").hidden = false;
  document.body.classList.add("lb-open");
  showLightbox(i);
  $("#lb-close").focus();
}

function showLightbox(i) {
  const n = lb.items.length;
  lb.i = (i + n) % n;
  const p = lb.items[lb.i];
  $("#lb-img").src = `data/${p.file}`;
  $("#lb-img").alt = p.caption;
  $("#lb-caption").textContent = p.caption;
  $("#lb-credit").innerHTML = creditHtml(p);
  $("#lb-prev").hidden = $("#lb-next").hidden = n < 2;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  document.body.classList.remove("lb-open");
  lb.opener?.focus();
}

// ===========================================================================
// Events page
// ===========================================================================

function renderEvents() {
  const grid = $("#event-grid");
  grid.innerHTML = "";
  let n = 0;
  for (const e of F.EVENTS) {
    const k = F.KIND[e.kind];
    const site = nisarSiteFor(e.id);
    if (state.filter === "nisar" ? !site : state.filter !== "all" && k.group !== state.filter) continue;
    const rec = data.evidence[e.id];
    const climate = rec && rec.climateLink !== "none-claimed";
    const btn = document.createElement("button");
    btn.className = "ev";
    btn.style.animationDelay = `${n++ * 45}ms`;
    btn.innerHTML = `<canvas width="232" height="232" aria-hidden="true"></canvas>
      <div class="ev-body">
        <div class="ev-tags"><span class="chip-tag ${kindColor(e.kind)}">${icon(kindIcon(e.kind), { size: 13 })}${esc(k.label)}</span>${climate
          ? `<span class="chip-tag">${icon("leaf", { size: 13 })}${rec.climateLink === "substantive" ? "Climate story" : "Climate link"}</span>` : ""}</div>
        <h3>${esc(e.name)}, ${esc(e.region)}</h3>
        <p>${esc(e.headline)}</p>
        <div class="fact">${esc(e.facts[0][0])} (${esc(e.facts[0][2])})</div>
      </div>${icon("chevronRight", { size: 20 })}`;
    btn.addEventListener("click", () => { setView("map"); selectEvent(e.id, { fly: true }); });
    grid.appendChild(btn);
    const c = $("canvas", btn);
    const prepared = F.prepareScene({ model: e.model, extentKm: e.extentKm, geometry: F.GEOMETRIES[e.geometry], resolution: 232, seed: e.seed });
    F.renderPrepared(c.getContext("2d"), prepared, { scale: 1, wavelengthCm: F.BANDS.L.wavelengthCm, atmosphereCm: 0.6, style: "scene" });
  }
}

function wireEvents() {
  for (const b of $$("#filters [data-filter]")) {
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      for (const x of $$("#filters [data-filter]")) x.setAttribute("aria-pressed", String(x === b));
      renderEvents();
    });
  }
}

// ===========================================================================
// Lab
// ===========================================================================

const LAB_PARAMS = {
  bowl: [
    ["peakCm", "Peak sinking", 1, 100, 1, 30, "cm"],
    ["sigmaKm", "Bowl radius σ", 2, 40, 0.5, 16, "km"],
    ["aspect", "Elongation", 1, 3, 0.1, 2.2, "×"],
    ["rotationDeg", "Rotation", -90, 90, 5, -50, "°"],
    ["extentKm", "Scene width", 30, 200, 10, 140, "km"],
  ],
  mogi: [
    ["depthKm", "Chamber depth", 1, 10, 0.5, 4.5, "km"],
    ["volumeM", "Magma added", 1, 60, 1, 20, "M m³"],
    ["extentKm", "Scene width", 10, 80, 5, 40, "km"],
  ],
  rupture: [
    ["slipM", "Fault slip", 0.05, 8, 0.05, 1.5, "m"],
    ["depthKm", "Locking depth", 2, 20, 1, 12, "km"],
    ["strikeDeg", "Strike", 0, 360, 5, 317, "°"],
    ["lengthKm", "Rupture length", 20, 400, 10, 150, "km"],
    ["extentKm", "Scene width", 30, 400, 10, 120, "km"],
  ],
  flank: [
    ["peakCm", "Peak motion", 5, 100, 1, 27, "cm"],
    ["sigmaKm", "Slide radius σ", 4, 30, 1, 14, "km"],
    ["azimuthDeg", "Slide direction", 0, 360, 5, 155, "°"],
    ["verticalRatio", "Vertical / horizontal", -1, 1, 0.05, -0.3, ""],
    ["extentKm", "Scene width", 20, 150, 5, 70, "km"],
  ],
};
const LAB_NAMES = { bowl: "Compaction", mogi: "Magma chamber", rupture: "Fault slip", flank: "Flank slide" };
const lab = { type: "bowl", band: "L", geom: "ascending", inc: 37, values: {} };

function labModel() {
  const v = lab.values;
  switch (lab.type) {
    case "bowl": return { type: "bowl", peakM: v.peakCm / 100, sigmaKm: v.sigmaKm, aspect: v.aspect, rotationDeg: v.rotationDeg };
    case "mogi": return { type: "mogi", depthKm: v.depthKm, volumeKm3: v.volumeM / 1000 };
    case "rupture": return { type: "rupture", slipM: v.slipM, depthKm: v.depthKm, strikeDeg: v.strikeDeg, lengthKm: v.lengthKm };
    default: return { type: "flank", peakM: v.peakCm / 100, sigmaKm: v.sigmaKm, azimuthDeg: v.azimuthDeg, verticalRatio: v.verticalRatio };
  }
}

const fillRange = (inp) => inp.style.setProperty("--fill", `${((inp.value - inp.min) / (inp.max - inp.min)) * 100}%`);

function renderLabParams() {
  lab.values = {};
  $("#lab-params").innerHTML = LAB_PARAMS[lab.type].map(([key, label, min, max, step, def, unit]) => {
    lab.values[key] = def;
    return `<div class="slider-row"><div class="slider-head"><span>${label}</span><output class="mono" data-out="${key}">${def} ${unit}</output></div>
      <input type="range" data-key="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${def}" aria-label="${label}">
      <div class="slider-range mono">${min} to ${max} ${unit}</div></div>`;
  }).join("");
  for (const inp of $$("#lab-params input")) {
    fillRange(inp);
    inp.addEventListener("input", () => {
      lab.values[inp.dataset.key] = Number(inp.value);
      $(`[data-out="${inp.dataset.key}"]`).textContent = `${inp.value} ${inp.dataset.unit}`;
      fillRange(inp);
      drawLab();
    });
  }
}

let labQueued = false;
function drawLab() {
  if (labQueued) return;
  labQueued = true;
  requestAnimationFrame(() => {
    labQueued = false;
    const canvas = $("#lab-canvas");
    const g = { ...F.GEOMETRIES[lab.geom], incidenceDeg: lab.inc };
    const model = labModel();
    const band = F.BANDS[lab.band];
    const ext = lab.values.extentKm;
    F.renderInterferogram(canvas.getContext("2d"), { model, scale: 1, extentKm: ext, wavelengthCm: band.wavelengthCm, geometry: g, resolution: canvas.width, style: "scene", atmosphereCm: 0.4, seed: 7 });
    const st = F.stats(model, ext, g);
    const peakLos = Math.abs(st.maxLOS) >= Math.abs(st.minLOS) ? st.maxLOS : st.minLOS;
    $("#lab-chip").textContent = band.label;
    const headline = { bowl: `${F.fmt(lab.values.peakCm, 1)} cm peak`, mogi: `${lab.values.volumeM} M m³ at ${lab.values.depthKm} km`, rupture: `${F.fmt(lab.values.slipM, 2)} m slip`, flank: `${lab.values.peakCm} cm slide` }[lab.type];
    $("#lab-caption").textContent = `${LAB_NAMES[lab.type]}: ${headline}`;
    $("#lab-sub").textContent = `${lab.geom === "ascending" ? "Ascending" : "Descending"} pass, ${lab.inc}°`;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100].find((v) => v >= ext / 7) || 100;
    const frameW = $(".lab-frame").clientWidth || 500;
    $("#lab-scale span").style.width = `${(nice / ext) * frameW}px`;
    $("#lab-scale em").textContent = `${nice} km`;
    $("#lab-legend").innerHTML = `<div class="legend-bar" style="background:${F.FRINGE_GRADIENT}"></div>
      <div class="legend-row"><span>One colour cycle</span><span>${F.fmt(band.wavelengthCm / 2, 2)} cm toward or away from the satellite</span></div>`;
    $("#lab-readouts").innerHTML = [
      [F.fmt(F.fringeCount(st, band.wavelengthCm), 1), `fringes in ${band.label}`],
      [`${F.fmt(peakLos * 100, 1)} cm`, "peak line-of-sight motion"],
      [`${F.fmt(st.peakVertical * 100, 1)} cm`, "peak vertical motion"],
      [`${F.fmt(st.peakHorizontal * 100, 1)} cm`, "peak horizontal motion"],
    ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  });
}

function segment(groupSel, attr, onChange) {
  for (const b of $$(`${groupSel} [data-${attr}]`)) {
    b.addEventListener("click", () => {
      for (const x of $$(`${groupSel} [data-${attr}]`)) x.setAttribute("aria-pressed", String(x === b));
      onChange(b.dataset[attr]);
    });
  }
}

function wireLab() {
  segment("#lab-type", "type", (v) => { lab.type = v; renderLabParams(); drawLab(); });
  segment("#lab-band", "band", (v) => { lab.band = v; drawLab(); });
  segment("#lab-geom", "geom", (v) => { lab.geom = v; drawLab(); });
  const inc = $("#lab-inc");
  fillRange(inc);
  inc.addEventListener("input", () => { lab.inc = Number(inc.value); $("#lab-inc-out").textContent = `${lab.inc}°`; fillRange(inc); drawLab(); });
  renderLabParams();
  window.addEventListener("resize", () => state.view === "lab" && drawLab());
}

// ===========================================================================
// Guide
// ===========================================================================

function renderGuide() {
  const rows = F.EVENTS.map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(F.KIND[e.kind].label)}</td><td>${esc(e.driver)}</td><td class="mono">${(data.gnss[e.id] || []).map((s) => esc(s.station)).join(", ") || "None"}</td></tr>`).join("");
  $("#guide").innerHTML = `
    <div class="guide-journey-cta"><h2>See the Unseen.</h2><p>Follow NISAR over an illustrated delta, reveal the radar signal, then take the controls in the real explorer. A short cinematic field guide, at your own pace.</p><button id="guide-learn">Replay Journey <span aria-hidden="true">↗</span></button><div class="guide-game-cta"><div><b>The Nile Delta: A Changing Frontier</b><span>Follow Astrounit, compare recorded NISAR visits, and explore the evidence on the map.</span></div><button id="guide-game">Replay the mission briefing ${icon("gamepad", {size:16})}</button></div></div>
    <div class="guide-hero"><div>
      <h1 class="page-title">How to read a fringe</h1>
      <p class="kicker accent">How it works and where the data comes from</p>
      <p class="page-lede">A radar satellite sends microwave pulses and listens for the echo. Differences between two visits create an interferogram. In an ideal deformation model, one full colour cycle corresponds to half a wavelength of motion along the line of sight. In real data, atmosphere and processing errors also contribute to phase.</p>
    </div><canvas id="guide-canvas" width="400" height="400" aria-hidden="true"></canvas></div>

    <h2>One ring, twelve centimetres</h2>
    <p>NISAR's L-band radar has a 23.8 cm wavelength, so one fringe is 11.9 cm of motion toward or away from the satellite. Sentinel-1's C-band has a much shorter wave, so one fringe is only 2.8 cm and the same motion shows about four times as many rings. Try the band button on the map to see the difference.</p>

    <h2>What is measured, what is modeled</h2>
    <div class="guide-table-wrap"><table>
      <tr><th>Layer</th><th>Status</th><th>Detail</th></tr>
      <tr><td>NISAR browse interferograms</td><td><span class="label-pill label-PREVIEW" style="padding:3px 8px">PREVIEW</span></td><td>Real provisional GUNW browse images from ASF. Useful for qualitative patterns; phase includes atmosphere and errors. The reconstructed confidence is not measured coherence. Smooth animation between dates is interpolated.</td></tr>
      <tr><td>Processed NISAR LOS</td><td><span class="label-pill label-PROCESSED" style="padding:3px 8px">DERIVED</span></td><td>Currently Central Valley track 114: masked, ionosphere-corrected full GUNW phase. Inspect the station residuals and zero-motion baseline in Details. These station comparisons do not yet resolve the small motion in their sample.</td></tr>
      <tr><td>NISAR crops and water</td><td><span class="label-pill label-PREVIEW" style="padding:3px 8px">PREVIEW</span></td><td>Dated HH/HV GCOV colour composites over the Nile Delta. Colours suggest scattering mechanisms; they are not a verified crop or water classification. Quantitative analysis requires the calibrated product and independent reference observations.</td></tr>
      <tr><td>Then &amp; Now photos</td><td><span class="label-pill" style="padding:3px 8px;background:rgba(255,255,255,0.08);color:var(--text)">REAL PHOTOS</span></td><td>High-resolution satellite photos of one spot per site, from every version of Esri World Imagery Wayback since 2014, with their real capture dates and sensors.</td></tr>
      <tr><td>On the ground</td><td><span class="label-pill" style="padding:3px 8px;background:rgba(255,255,255,0.08);color:var(--text)">REAL PHOTOS</span></td><td>Freely licensed photos of each site from Wikimedia Commons (USGS, NASA, VOA and others), each with its author, licence and source linked.</td></tr>
      <tr><td>GNSS time series</td><td><span class="label-pill label-MEASURED" style="padding:3px 8px">MEASURED</span></td><td>Daily positions from the Nevada Geodetic Lab, averaged by week with logged offsets removed. Historical series provide context. Only matching dates, locations and references can support a direct radar comparison.</td></tr>
      <tr><td>Published rates</td><td><span class="label-pill label-MEASURED" style="padding:3px 8px">CITED</span></td><td>Peer-reviewed and agency results, with sources.</td></tr>
      <tr><td>Animated rings</td><td><span class="label-pill label-MODELED" style="padding:3px 8px">MODELED</span></td><td>Simple physics models (a magma chamber, a slipping fault, a sinking bowl, a sliding volcano flank) tuned to match the published numbers and seen at a 37° angle like NISAR.</td></tr>
    </table></div>

    <h2>Sites and their drivers</h2>
    <div class="guide-table-wrap"><table><tr><th>Site</th><th>Change</th><th>Driver</th><th>GNSS context</th></tr>${rows}</table></div>
    <p>Sinking caused by people (groundwater pumping) is kept separate from volcanoes and faults. The natural events carry a clear "no climate link claimed" note.</p>

    <h2>Evidence you can check</h2>
    <p>Each site has an evidence record. We fingerprinted every record with SHA-256 and time-stamped the list in the Bitcoin blockchain using OpenTimestamps. The integrity panel redoes the fingerprint in your browser, follows the proof up to the Bitcoin block and checks it against the live chain. This shows the records haven't changed since they were stamped. It can't tell you whether the science is right.</p>

    <h2>Data &amp; credits</h2>
    <ul>
      <li>NISAR L-band GUNW: NASA/JPL-Caltech &amp; ISRO via the Alaska Satellite Facility DAAC.</li>
      <li>GNSS: Nevada Geodetic Laboratory, University of Nevada, Reno (Blewitt et al., 2018).</li>
      <li>NASA/JPL, California DWR, USGS, INGV, Icelandic Met Office, NOAA and peer-reviewed papers, cited for each site.</li>
      <li>Then &amp; Now photos: Esri World Imagery Wayback, with imagery from Vantor (Maxar), Airbus, Earthstar Geographics and partners.</li>
      <li>On-the-ground photos: Wikimedia Commons, public domain or CC BY / CC BY-SA, credited under each photo${data.photos ? ` (${Object.values(data.photos.sites).flat().length} photos)` : ""}.</li>
      <li>Basemaps © Esri and partners and © OpenStreetMap contributors. Built with Leaflet, OpenTimestamps and mempool.space.</li>
      <li>Open source under the MIT licence. Leaflet 1.9.4 is bundled locally with its BSD-2-Clause licence. Pipeline: <code>pipeline/nisar_pipeline.py</code>.</li>
      <li>Learning concepts: <a href="https://science.nasa.gov/mission/nisar/polarimetry/" target="_blank" rel="noopener">NASA NISAR polarimetry</a>, <a href="https://science.nasa.gov/mission/nisar/calibration-and-validation/" target="_blank" rel="noopener">calibration and validation</a>, and <a href="https://nisar-docs.asf.alaska.edu/gcov/" target="_blank" rel="noopener">ASF GCOV documentation</a>. Learning illustrations are schematic.</li>
    </ul>`;
  $("#guide-learn").addEventListener("click", openJourney);
  $("#guide-game").addEventListener("click", openBriefing);
  const desk=document.createElement("div");desk.className="guide-journey-cta";
  desk.innerHTML=`<h2>From curiosity to evidence.</h2><p>Compare actual acquisition dates, keep an observation notebook and export an illustrated brief. Inspect every station comparison, source and limitation.</p><button data-open-inspect>Open the Observation Desk ↗</button><p><a href="study.html" target="_blank" rel="noopener">Facilitator tools: run an anonymous usability session ↗</a></p>`;
  $("#guide").querySelector(".guide-journey-cta").after(desk);
  desk.querySelector("[data-open-inspect]").addEventListener("click",()=>openInvestigation());
  const c = $("#guide-canvas");
  const e = byId("central-valley");
  F.renderPrepared(c.getContext("2d"), F.prepareScene({ model: e.model, extentKm: e.extentKm, geometry: F.GEOMETRIES.ascending, resolution: 400, seed: e.seed }), { scale: 1, wavelengthCm: 23.8, atmosphereCm: 0.5, style: "scene" });
}

// ===========================================================================
// Views and boot
// ===========================================================================

function setView(view) {
  view = canonicalView(view);
  if (!["map", ...PAGE_VIEWS].includes(view)) return;
  explorerTour?.stop();
  if (view !== "map" && ui.welcome) closeWelcome();
  if (view !== "map" && story.active) stopStory();
  setDockMin(false);
  state.view = view;
  journey?.setActive(view === "journey");
  fieldMission?.setActive(view === "briefing");
  investigation?.setActive(view === "investigate");
  if (["journey", "briefing", "investigate"].includes(view)) setPlaying(false);
  $("#app").dataset.view = view;
  for (const section of $$(".view")) {
    section.inert = section.id !== `view-${view}`;
    section.setAttribute("aria-hidden", String(section.inert));
  }
  const tabs = $$(".tab"), activeTab = tabs.find(t => t.dataset.view === view) || tabs[0];
  for (const t of tabs) {
    t.setAttribute("aria-selected", String(t.dataset.view === view));
    t.setAttribute("aria-controls", `view-${t.dataset.view}`);
    t.tabIndex = t === activeTab ? 0 : -1;
  }
  if (view === "map") { setTimeout(() => { map.invalidateSize(); dirty = true; }, 30); history.replaceState(null, "", `#${state.eventId}`); }
  else history.replaceState(null, "", `#${view}`);
  if (view === "investigate") investigation?.setActive(true);
  if (view === "lab") drawLab();
  if (view !== "map") $(`#view-${view}`).scrollTop = 0;
  if (view === "briefing") fieldMission?.enter();
}

// On a developer's machine everything is re-checked; on the live site the server's cache rules apply and
// only the small index files (fresh = true) are re-checked on every visit.
let dataReady = null;
const whenReady = (fn) => (dataReady || Promise.resolve()).then(fn, () => {});

// Phone networks drop the odd request: try once more before giving up.
async function get(url, opts) {
  try { return await fetch(url, opts); }
  catch { await new Promise((r) => setTimeout(r, 700)); return fetch(url, opts); }
}

async function bytes(url, fresh = false) {
  const r = await get(url, fresh || F.DEV ? { cache: "no-cache" } : undefined);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
const decode = (b) => JSON.parse(new TextDecoder().decode(b));

async function loadData() {
  // Everything that does not depend on something else loads at the same time.
  const optional = (url) => get(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const required = (url) => get(url, { cache: "no-cache" }).then((r) => r.json());
  [data.nisar, data.imagery, data.photos, data.index, data.stations] = await Promise.all([
    optional("data/nisar/index.json"), optional("data/imagery.json"), optional("data/photos.json"),
    required("data/index.json"), required("data/stations.json"),
  ]);
  data.manifest = decode(await bytes(`data/evidence/${data.index.manifest}`, true));
  await Promise.all(Object.entries(data.index.events).map(async ([id, files]) => {
    const [rec, proof, ...gnss] = await Promise.all([
      bytes(`data/evidence/${files.evidence}`),
      files.proof ? bytes(`data/evidence/${files.proof}`).catch(() => null) : null,
      ...files.gnss.map((g) => bytes(`data/gnss/${g}`)),
    ]);
    data.evidenceBytes[id] = rec;
    data.evidence[id] = decode(rec);
    data.proofs[id] = proof;
    data.gnss[id] = gnss.map(decode).sort((a, b) => a.station.localeCompare(b.station));
  }));
}

async function main() {
  const initialHash = location.hash.slice(1);
  const hash = canonicalView(initialHash);
  const params = new URLSearchParams(location.search);
  explorerTour = createExplorerTour({ openDetails: () => setSheet(true) });
  const exploreFromIntro = async ({ guided, observationDate }) => {
    if (dataReady) await dataReady;
    journey.markVisited();
    closeWelcome(); setPlaying(false); setView("map");
    if (guided) {
      await setMode("model");
      selectEvent("nile-delta", { fly: !reduceMotion });
      await setMode(gcovOf() ? "fields" : nis.site ? "nisar" : "model");
      const frameIndex = gcovOf()?.frames.findIndex((frame) => frame.date === observationDate) ?? -1;
      if (state.mode === "fields" && frameIndex >= 0) showField(frameIndex, { instant: true });
    }
    setSheet(false);
    if (guided) setTimeout(() => { if (state.view === "map") explorerTour.start(); }, reduceMotion ? 50 : 400);
  };
  journey = initJourney({
    root: $("#journey"), getData: () => data, reducedMotion: reduceMotion,
    onExplore: exploreFromIntro, onGame: openBriefing,
  });
  fieldMission = initFieldMission({root: $("#field-mission"), onExit: () => {closeWelcome();setView("map");scout?.setActive(false);$('.tab[data-view="map"]').focus();}, onExplore: async ({eventId,robotMode}) => {
    if(dataReady) await dataReady;
    closeWelcome();setPlaying(false);setView("map");setSheet(false);
    if(robotMode&&eventId)selectEvent(eventId,{fly:false});
    scout.setActive(robotMode);$('.tab[data-view="map"]').focus();
  }});
  investigation = initInvestigation({root: $("#investigation"), getData: () => data, onMap: async ({observationDate,eventId}) => {
    await dataReady; closeWelcome(); setView("map"); setPlaying(false);
    if (eventId) { await setMode("model"); selectEvent(eventId, {fly: !reduceMotion}); await setMode("nisar"); }
    else { await setMode("model"); selectEvent("nile-delta", {fly: !reduceMotion}); await setMode(gcovOf() ? "fields" : "nisar");
      const index=gcovOf()?.frames.findIndex((f)=>f.date===observationDate)??-1;
      if(state.mode==="fields"&&index>=0)showField(index,{instant:true}); }
    setSheet(true);
  }});
  initMap();
  wireTools(); wireEvents(); wireLab(); wireSwipe(); wireLightbox(); wireStory(); wireLive(); wireWelcome(); wireDockSheet();
  scout = initScout({map,sites:F.EVENTS,tours:TOURS,getSelectedEvent:()=>byId(state.eventId),
    canInteract:()=>state.view==="map"&&!story.active&&!live.active&&!ui.welcome&&!state.sheetOpen&&$("#lightbox").hidden&&!document.querySelector("dialog[open]"),
    getCapabilities:id=>({radar:Boolean(data.nisar?.sites?.[id]),compare:id==="nile-delta"&&(data.nisar?.sites?.[id]?.gcov?.frames?.length||0)>1}),
    onTravel:id=>{selectEvent(id,{fly:!reduceMotion});},onStory:id=>startStory(id),onObserve:({lat,lon})=>openLive(lat,lon),
    onRadar:async id=>{setPlaying(false);selectEvent(id,{fly:!reduceMotion});await setMode(gcovOf()?"fields":"nisar");},
    onCompare:id=>{if(id!=="nile-delta")return;const frames=data.nisar?.sites?.[id]?.gcov?.frames;if(frames?.length>1)openInvestigation({a:frames[0].date,b:frames.at(-1).date});},
    onLayout:()=>setDockMin(false)
  });
  window.addEventListener("pagehide",e=>{if(!e.persisted)scout.destroy();});
  setPlaying(state.playing);
  const enterMission = shouldOpenMission({hash:initialHash,params,visited:fieldMission.hasVisited()});
  if (enterMission) setView("briefing");
  else if (PAGE_VIEWS.includes(hash)) setView(hash);
  else setView("map");
  renderGuide();
  dataReady = loadData().catch((err) => { data.loadError = err.message; console.warn("Observation data unavailable", err); });
  await dataReady;
  renderPulse(); renderEvents(); renderGuide(); journey.refreshData(true); fieldMission.refreshData(); investigation.refreshData();
  const start = F.EVENTS.some((e) => e.id === initialHash) ? initialHash : "nile-delta";
  if (params.get("play") === "0" || ["journey", "briefing"].includes(state.view)) setPlaying(false);
  selectEvent(start, { fly: state.view === "map" && initialHash!=="game" && !reduceMotion && !params.get("mode"), intro: true });
  if (state.view === "map") {
    if (params.get("sheet") === "1" || (window.innerWidth >= 1500 && params.get("sheet") !== "0")) setSheet(true);
    if (["nisar", "fields", "photos"].includes(params.get("mode"))) await setMode(params.get("mode"));
    if (params.get("story")) startStory(params.get("story"));
    const liveAt = (params.get("live") || "").split(",").map(Number);
    if (liveAt.length === 2 && liveAt.every(Number.isFinite)) openLive(liveAt[0], liveAt[1]);
    if (state.mode === "fields" && params.get("frame")) showField(Number(params.get("frame")), { instant: true });
  }
  if(initialHash==="game"){setSheet(false);scout.setActive(true);}
  scout.refresh();
  setInterval(updateClock, 1000);
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1), view = canonicalView(h);
    if(h==="game"){closeWelcome();setView("map");setSheet(false);scout.setActive(true);}
    else if (PAGE_VIEWS.includes(view)) { setView(view); if (view === "journey") journey.enter(); if (view === "briefing") fieldMission.enter(); }
    else if (F.EVENTS.some((e) => e.id === h)) { setView("map"); if (h !== state.eventId) selectEvent(h); }
  });
  window.addEventListener("resize", () => { dirty = true; });
  requestAnimationFrame(frame);
}

main();
