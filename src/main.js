import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { HistoricalImagery } from "./modules/history.js";
import { Knowledge } from "./modules/knowledge.js";
import { LayerManager } from "./modules/layers.js";
import { MeasureTool } from "./modules/measure.js";
import { Navigation } from "./modules/navigation.js";
import { Projects } from "./modules/projects.js";
import { Search } from "./modules/search.js";
import { saveSettings, settings, toast, toolState } from "./modules/util.js";
import { Voyager } from "./modules/voyager.js";

// ---- Chaves opcionais (Configurações ou variáveis VITE_*) ----
const ionToken = settings.ionToken || import.meta.env.VITE_CESIUM_ION_TOKEN || "";
const googleKey = settings.googleKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
settings.ionToken = ionToken;
settings.googleKey = googleKey;
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
if (googleKey) Cesium.GoogleMaps.defaultApiKey = googleKey;

// ---- Visualizador ----
const viewer = new Cesium.Viewer("cesiumContainer", {
  baseLayer: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  vrButton: false,
  creditContainer: document.getElementById("statusCredits"),
  contextOptions: { webgl: { preserveDrawingBuffer: true } },
  msaaSamples: 4,
});
window.viewer = viewer; // útil para depuração

const scene = viewer.scene;
scene.globe.depthTestAgainstTerrain = true;
scene.screenSpaceCameraController.enableCollisionDetection = true;
scene.globe.maximumScreenSpaceError = settings.highQuality ? 1.5 : 2.5;
viewer.resolutionScale = settings.highQuality ? Math.min(window.devicePixelRatio || 1, 2) : 1;
scene.verticalExaggeration = Number(settings.exaggeration) || 1;
scene.debugShowFramesPerSecond = !!settings.showFps;
viewer.clock.currentTime = Cesium.JulianDate.now();
viewer.clock.shouldAnimate = true;
// Duplo clique: aproximar (em vez de rastrear entidade)
viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

// ---- Módulos ----
const layers = new LayerManager(viewer);
const projects = new Projects(viewer);
const knowledge = new Knowledge(viewer, { projects });
const search = new Search(viewer, { knowledge });
const voyager = new Voyager(viewer, { knowledge });
const nav = new Navigation(viewer);
const measure = new MeasureTool(viewer);
const historyImg = new HistoricalImagery(viewer, layers);

layers.init().then(() => {
  layers.addOverlayToggle("Lugares da Wikipédia", "Artigos próximos ao centro da vista", knowledge.wikiOn, (on) => knowledge.setWikiLayer(on));
});

if (!nav.readHash()) {
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-50, -15, 2.2e7) });
}

// ---- Cliques no mapa ----
const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
handler.setInputAction((e) => {
  if (toolState.active || nav.flying) return;
  knowledge.handleClick(e.position);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
handler.setInputAction((e) => {
  if (toolState.active) return;
  const ray = viewer.camera.getPickRay(e.position);
  const target = scene.globe.pick(ray, scene) ?? scene.pickPosition(e.position);
  if (!target) return;
  const dist = Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
    offset: new Cesium.HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, dist * 0.4),
    duration: 0.8,
  });
}, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

// ---- Painel lateral ----
const panel = document.getElementById("panel");
const titles = {
  search: "Pesquisar",
  voyager: "Voyager",
  projects: "Projetos",
  layers: "Estilo do mapa",
  history: "Imagens históricas",
  settings: "Configurações",
  help: "Ajuda",
};
let currentPanel = null;
function openPanel(name) {
  if (currentPanel === name) return closePanel();
  currentPanel = name;
  panel.hidden = false;
  document.getElementById("panelTitle").textContent = titles[name];
  document.querySelectorAll("#panelBody section").forEach((s) => s.classList.toggle("active", s.dataset.section === name));
  document.querySelectorAll(".rail-btn[data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  if (name === "search") setTimeout(() => document.getElementById("searchInput").focus(), 50);
  if (name === "history") historyImg.ensureLoaded();
}
function closePanel() {
  currentPanel = null;
  panel.hidden = true;
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.remove("active"));
}
document.querySelectorAll(".rail-btn[data-panel]").forEach((b) => b.addEventListener("click", () => openPanel(b.dataset.panel)));
document.getElementById("panelClose").addEventListener("click", closePanel);
document.getElementById("luckyBtn").addEventListener("click", () => voyager.lucky());
document.getElementById("measureBtn").addEventListener("click", () => measure.start());
document.getElementById("shareBtn").addEventListener("click", () => nav.share());
document.getElementById("screenshotBtn").addEventListener("click", () => nav.screenshot());

// ---- Configurações ----
const $ = (id) => document.getElementById(id);
document.querySelectorAll('input[name="units"]').forEach((r) => {
  r.checked = r.value === settings.units;
  r.addEventListener("change", () => {
    settings.units = r.value;
    saveSettings();
    projects.renderList();
  });
});
$("exaggeration").value = settings.exaggeration;
$("exaggerationVal").textContent = `${settings.exaggeration}×`;
$("exaggeration").addEventListener("input", (e) => {
  settings.exaggeration = Number(e.target.value);
  scene.verticalExaggeration = settings.exaggeration;
  $("exaggerationVal").textContent = `${settings.exaggeration}×`;
  saveSettings();
});
$("flySpeed").value = settings.flySpeed;
$("flySpeed").addEventListener("input", (e) => {
  settings.flySpeed = Number(e.target.value);
  saveSettings();
});
$("googleKey").value = settings.googleKey;
$("ionToken").value = settings.ionToken;
$("saveKeys").addEventListener("click", () => {
  settings.googleKey = $("googleKey").value.trim();
  settings.ionToken = $("ionToken").value.trim();
  saveSettings();
  location.reload();
});
$("showFps").checked = !!settings.showFps;
$("showFps").addEventListener("change", (e) => {
  settings.showFps = e.target.checked;
  scene.debugShowFramesPerSecond = settings.showFps;
  saveSettings();
});
$("highQuality").checked = !!settings.highQuality;
$("highQuality").addEventListener("change", (e) => {
  settings.highQuality = e.target.checked;
  scene.globe.maximumScreenSpaceError = settings.highQuality ? 1.5 : 2.5;
  viewer.resolutionScale = settings.highQuality ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  saveSettings();
});

// ---- Atalhos de teclado ----
document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (e.key === "Escape") {
    if (toolState.active) toolState.active.cancel();
    else if (nav.flying) nav.toggleFly();
    else measure.clearResult();
    voyager.stop();
    knowledge.hide();
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (nav.flying && "wasdqe".includes(e.key.toLowerCase()) && e.key.length === 1) return;
  switch (e.key.toLowerCase()) {
    case "/":
      e.preventDefault();
      if (currentPanel !== "search") openPanel("search");
      else $("searchInput").focus();
      break;
    case "n": nav.north(); break;
    case "u": nav.toggleTilt(); break;
    case "r": nav.home(); break;
    case "+": case "=": nav.zoom(0.5); break;
    case "-": nav.zoom(-1); break;
    case "f": nav.toggleFly(); break;
    case "m": measure.start(); break;
  }
});

if (!localStorage.getItem("ggearth.welcomed")) {
  toast("Bem-vindo ao GGEarth! Clique em qualquer lugar do globo para explorar. Pressione / para pesquisar.", 6000);
  try { localStorage.setItem("ggearth.welcomed", "1"); } catch { /* ignora */ }
}

export { viewer, search, layers };
