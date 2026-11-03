import * as Cesium from "cesium";
import { escapeHtml, fetchJson, toast } from "./util.js";

const WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

/** Imagens históricas: Esri World Imagery Wayback + NASA GIBS diária. */
export class HistoricalImagery {
  constructor(viewer, layers) {
    this.viewer = viewer;
    this.layers = layers;
    this.releases = [];
    const dateInput = document.getElementById("gibsDate");
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    dateInput.max = yesterday;
    dateInput.min = "2000-02-24";
    dateInput.value = yesterday;
    document.getElementById("gibsApply").addEventListener("click", () => this.showGibs(dateInput.value));
    document.getElementById("historyOff").addEventListener("click", () => this.off());
    this.loaded = false;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const box = document.getElementById("waybackBox");
    try {
      const cfg = await fetchJson(WAYBACK_CONFIG);
      this.releases = Object.entries(cfg)
        .map(([num, r]) => ({ num: Number(num), title: r.itemTitle, url: r.itemURL, date: (r.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || [""])[0] }))
        .filter((r) => r.url && r.date)
        .sort((a, b) => b.date.localeCompare(a.date));
      box.innerHTML = `<div class="wb-row"><button id="wbPrev" title="Mais antiga">◀</button>
        <select id="wbSelect">${this.releases.map((r, i) => `<option value="${i}">${escapeHtml(r.date)}</option>`).join("")}</select>
        <button id="wbNext" title="Mais recente">▶</button></div>
        <input id="wbRange" type="range" min="0" max="${this.releases.length - 1}" value="0" style="width:100%;margin-top:10px;direction:rtl" />
        <p class="muted" style="font-size:12px">${this.releases.length} versões de ${escapeHtml(this.releases.at(-1).date)} até ${escapeHtml(this.releases[0].date)}. Arraste para viajar no tempo.</p>`;
      const sel = box.querySelector("#wbSelect");
      const range = box.querySelector("#wbRange");
      const apply = (i) => {
        i = Math.max(0, Math.min(this.releases.length - 1, i));
        sel.value = i;
        range.value = i;
        this.showWayback(this.releases[i]);
      };
      sel.addEventListener("change", () => apply(Number(sel.value)));
      range.addEventListener("change", () => apply(Number(range.value)));
      box.querySelector("#wbPrev").addEventListener("click", () => apply(Number(sel.value) + 1));
      box.querySelector("#wbNext").addEventListener("click", () => apply(Number(sel.value) - 1));
    } catch (err) {
      box.innerHTML = `<p class="muted">Não foi possível carregar o catálogo Wayback (${escapeHtml(err.message)}).</p>`;
      this.loaded = false;
    }
  }

  showWayback(release) {
    const url = release.url.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
    this.layers.setHistoryLayer(
      new Cesium.UrlTemplateImageryProvider({ url, maximumLevel: 19, credit: new Cesium.Credit(`Esri World Imagery Wayback – ${release.date}`) }),
    );
    toast(`Imagem de ${release.date}`);
  }

  showGibs(date) {
    if (!date) return;
    this.layers.setHistoryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9,
        credit: new Cesium.Credit(`NASA GIBS – MODIS Terra ${date}`),
      }),
    );
    toast(`Planeta em ${new Date(date + "T12:00:00").toLocaleDateString("pt-BR")}`);
  }

  off() {
    this.layers.setHistoryLayer(null);
    toast("Imagem atual restaurada.");
  }
}
