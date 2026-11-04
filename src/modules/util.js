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

/** Layout de celular (barra inferior + cartão em "bottom sheet"). */
export const isMobile = () => window.matchMedia("(max-width: 640px)").matches;

function openDialog(html, onReady) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "gg";
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    const close = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    onReady(dlg, close);
    dlg.showModal();
  });
}

export const PALETTE = ["#ea4335", "#4285f4", "#34a853", "#fbbc04", "#a142f4", "#ff6d01", "#24c1e0", "#ffffff"];

/** Formulário de nome/descrição/cor. Resolve com {name, desc, color} ou null se cancelado. */
export function editDialog({ title, name = "", desc = "", color = PALETTE[0], okLabel = "Salvar" }) {
  return openDialog(
    `<form method="dialog">
      <h2>${escapeHtml(title)}</h2>
      <label>Nome<input type="text" name="name" maxlength="120" value="${escapeHtml(name)}" required /></label>
      <label>Descrição (opcional)<textarea name="desc" maxlength="2000">${escapeHtml(desc)}</textarea></label>
      <label>Cor<div class="swatches">${PALETTE.map((c) => `<button type="button" data-c="${c}" style="background:${c}" class="${c === color ? "sel" : ""}" aria-label="Cor ${c}"></button>`).join("")}</div></label>
      <div class="actions"><button type="button" data-act="cancel">Cancelar</button><button type="submit" class="primary">${escapeHtml(okLabel)}</button></div>
    </form>`,
    (dlg, close) => {
      let chosen = color;
      const form = dlg.querySelector("form");
      dlg.querySelectorAll(".swatches button").forEach((b) =>
        b.addEventListener("click", () => {
          chosen = b.dataset.c;
          dlg.querySelectorAll(".swatches button").forEach((x) => x.classList.toggle("sel", x === b));
        }),
      );
      dlg.querySelector('[data-act="cancel"]').addEventListener("click", () => close(null));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const n = form.name.value.trim();
        if (!n) return form.name.focus();
        close({ name: n, desc: form.desc.value.trim(), color: chosen });
      });
      setTimeout(() => {
        form.name.focus();
        form.name.select();
      }, 50);
    },
  );
}

/** Confirmação simples (substitui window.confirm). */
export function confirmDialog(message, okLabel = "Confirmar") {
  return openDialog(
    `<h2>${escapeHtml(message)}</h2><div class="actions"><button data-act="no">Cancelar</button><button data-act="yes" class="primary">${escapeHtml(okLabel)}</button></div>`,
    (dlg, close) => {
      dlg.querySelector('[data-act="no"]').addEventListener("click", () => close(false));
      dlg.querySelector('[data-act="yes"]').addEventListener("click", () => close(true));
    },
  );
}

/** Boas-vindas na primeira visita. */
export function welcomeDialog() {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  return openDialog(
    `<h2>🌍 Bem-vindo ao GGEarth</h2>
    <ul class="tips">
      <li><span class="ic">🔍</span><div><b>Pesquise qualquer lugar</b><span class="muted">Cidades, endereços ou coordenadas na barra do topo.</span></div></li>
      <li><span class="ic">${touch ? "👆" : "🖱️"}</span><div><b>${touch ? "Toque" : "Clique"} no mapa</b><span class="muted">Veja o que há ali: Wikipédia, endereço e, em Londrina, os dados do lote.</span></div></li>
      <li><span class="ic">${touch ? "✌️" : "⌨️"}</span><div><b>Veja em 3D</b><span class="muted">${touch ? "Arraste dois dedos para cima para inclinar a vista e ver relevo e prédios." : "Segure Ctrl e arraste (ou use o botão direito) para inclinar a vista."}</span></div></li>
      <li><span class="ic">🧭</span><div><b>Explore o Voyager</b><span class="muted">Passeios guiados pelas maravilhas do mundo e do Brasil.</span></div></li>
    </ul>
    <div class="actions"><button data-act="ok" class="primary">Começar a explorar</button></div>`,
    (dlg, close) => dlg.querySelector('[data-act="ok"]').addEventListener("click", () => close(true)),
  );
}

/** "Toque" em telas de toque, "Clique" com mouse. */
export const tapWord = (cap = false) => {
  const w = window.matchMedia("(pointer: coarse)").matches ? "toque" : "clique";
  return cap ? w[0].toUpperCase() + w.slice(1) : w;
};
