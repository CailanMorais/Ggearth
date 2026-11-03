import * as Cesium from "cesium";
import { sampleHeights } from "./terrain.js";

const SETTINGS_KEY = "ggearth.settings";
const DEFAULT_SETTINGS = {
  units: "metric",
  exaggeration: 1,
  flySpeed: 3,
  googleKey: "",
  ionToken: "",
  showFps: false,
  highQuality: true,
};

export function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: ignora */
  }
}

export const settings = { ...DEFAULT_SETTINGS, ...storageGet(SETTINGS_KEY, {}) };
export function saveSettings() {
  storageSet(SETTINGS_KEY, settings);
}

let toastTimer;
export function toast(message, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function formatDistance(meters) {
  if (settings.units === "imperial") {
    const ft = meters * 3.28084;
    return ft < 5280 ? `${ft.toFixed(0)} ft` : `${(ft / 5280).toFixed(2)} mi`;
  }
  return meters < 1000 ? `${meters.toFixed(meters < 10 ? 1 : 0)} m` : `${(meters / 1000).toFixed(2)} km`;
}

export function formatArea(m2) {
  if (settings.units === "imperial") {
    const acres = m2 / 4046.856;
    return acres < 640 ? `${acres.toFixed(2)} acres` : `${(m2 / 2589988.11).toFixed(2)} mi²`;
  }
  return m2 < 1e6 ? `${m2.toFixed(0)} m²` : `${(m2 / 1e6).toFixed(2)} km²`;
}

export function formatAltitude(meters) {
  if (settings.units === "imperial") return `${Math.round(meters * 3.28084).toLocaleString("pt-BR")} ft`;
  return meters >= 10000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters).toLocaleString("pt-BR")} m`;
}

function dms(value, pos, neg) {
  const hemi = value >= 0 ? pos : neg;
  const v = Math.abs(value);
  const d = Math.floor(v);
  const m = Math.floor((v - d) * 60);
  const s = ((v - d - m / 60) * 3600).toFixed(1);
  return `${d}°${String(m).padStart(2, "0")}'${String(s).padStart(4, "0")}"${hemi}`;
}

export function formatLatLon(lat, lon) {
  return `${dms(lat, "N", "S")} ${dms(lon, "L", "O")}`;
}

export function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Converte um Cartesian3 em {lat, lon, height} em graus. */
export function toDegrees(cartesian) {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), height: c.height };
}

/** Pega a posição no mundo sob um ponto da tela (3D Tiles, relevo ou elipsoide). */
export function pickCartesian(viewer, windowPosition) {
  const scene = viewer.scene;
  if (scene.pickPositionSupported && !scene.globe.show) {
    const p = scene.pickPosition(windowPosition);
    if (Cesium.defined(p)) return p;
  }
  if (scene.pickPositionSupported) {
    const picked = scene.pick(windowPosition);
    // Prédios (3D Tiles ou primitivas extrudadas): usa a posição real na superfície do objeto
    if (picked && (picked.primitive instanceof Cesium.Cesium3DTileset || picked.id?.osmBuilding)) {
      const p = scene.pickPosition(windowPosition);
      if (Cesium.defined(p)) return p;
    }
  }
  const ray = viewer.camera.getPickRay(windowPosition);
  if (ray && scene.globe.show) {
    const p = scene.globe.pick(ray, scene);
    if (Cesium.defined(p)) return p;
  }
  return viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
}

/** Ponto do globo no centro da tela. */
export function screenCenter(viewer) {
  const canvas = viewer.scene.canvas;
  return pickCartesian(viewer, new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
}

/** Altitude do terreno em um ponto (fonte aberta; funciona mesmo antes de carregar os tiles). */
export async function groundHeight(viewer, lat, lon) {
  const tp = viewer.terrainProvider;
  if (!tp || tp instanceof Cesium.EllipsoidTerrainProvider) return 0;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  try {
    if (tp instanceof Cesium.CustomHeightmapTerrainProvider) {
      const [h] = (await Promise.race([sampleHeights([{ lat, lon }]), timeout])) ?? [0];
      return h * (viewer.scene.verticalExaggeration || 1);
    }
    const r = await Promise.race([Cesium.sampleTerrainMostDetailed(tp, [Cesium.Cartographic.fromDegrees(lon, lat)]), timeout]);
    return r?.[0]?.height ?? 0;
  } catch {
    return 0;
  }
}

/** Voa até um lugar no formato do Voyager ({lat, lon, range, heading, pitch}). */
export async function flyToPlace(viewer, place, options = {}) {
  const h = await groundHeight(viewer, place.lat, place.lon);
  const center = Cesium.Cartesian3.fromDegrees(place.lon, place.lat, h);
  return new Promise((resolve) => {
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(place.heading ?? 0),
        Cesium.Math.toRadians(place.pitch ?? -35),
        place.range ?? 3000,
      ),
      duration: options.duration ?? settings.flySpeed,
      complete: () => resolve(true),
      cancel: () => resolve(false),
    });
  });
}

/** Ferramenta ativa (desenho/medição) — recebe os cliques do mapa antes do cartão de informações. */
export const toolState = { active: null };
