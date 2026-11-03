import * as Cesium from "cesium";
import { escapeHtml, fetchJson, flyToPlace, settings, storageGet, storageSet, toast } from "./util.js";

const HISTORY_KEY = "ggearth.searchHistory";

function parseCoords(q) {
  const m = q.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", "."));
  const lon = parseFloat(m[2].replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export class Search {
  constructor(viewer, { knowledge }) {
    this.viewer = viewer;
    this.knowledge = knowledge;
    this.history = storageGet(HISTORY_KEY, []);
    this.form = document.getElementById("searchForm");
    this.input = document.getElementById("searchInput");
    this.results = document.getElementById("searchResults");
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.search(this.input.value);
    });
    let t;
    this.input.addEventListener("input", () => {
      clearTimeout(t);
      if (this.input.value.trim().length >= 3) t = setTimeout(() => this.search(this.input.value, false), 650);
    });
    this.renderHistory();
  }

  async search(q, flyFirst = true) {
    q = q.trim();
    if (!q) return;
    const coords = parseCoords(q);
    if (coords) {
      this.results.innerHTML = "";
      this.go({ name: `${coords.lat}, ${coords.lon}`, lat: coords.lat, lon: coords.lon });
      return;
    }
    this.results.innerHTML = `<li class="muted">Pesquisando…</li>`;
    try {
      const data = await fetchJson(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&accept-language=pt-BR&extratags=1&q=${encodeURIComponent(q)}`,
      );
      this.renderResults(data);
      if (flyFirst && data[0]) this.goResult(data[0]);
      if (!data.length) this.results.innerHTML = `<li class="muted">Nada encontrado para “${escapeHtml(q)}”.</li>`;
    } catch (err) {
      this.results.innerHTML = `<li class="muted">Erro na pesquisa (${escapeHtml(err.message)}).</li>`;
    }
  }

  renderResults(data) {
    this.results.innerHTML = "";
    for (const r of data) {
      const li = document.createElement("li");
      const [first, ...rest] = r.display_name.split(",");
      li.innerHTML = `<span>📍</span><span class="grow"><span class="title">${escapeHtml(first)}</span><span class="sub">${escapeHtml(rest.join(",").trim())}</span></span>`;
      li.addEventListener("click", () => this.goResult(r));
      this.results.appendChild(li);
    }
  }

  goResult(r) {
    const bbox = r.boundingbox?.map(Number);
    this.go({ name: r.display_name.split(",")[0], lat: Number(r.lat), lon: Number(r.lon), bbox, wiki: r.extratags?.wikipedia });
  }

  go(place) {
    this.addHistory(place);
    if (place.bbox) {
      let [s, n, w, e] = place.bbox;
      const span = Math.max(n - s, e - w);
      if (span > 0.02) {
        // Áreas grandes: enquadra o retângulo inteiro
        const pad = span * 0.15;
        this.viewer.camera.flyTo({
          destination: Cesium.Rectangle.fromDegrees(w - pad, s - pad, e + pad, n + pad),
          duration: settings.flySpeed,
        });
        this.afterFly(place);
        return;
      }
    }
    flyToPlace(this.viewer, { lat: place.lat, lon: place.lon, range: 1800, heading: 0, pitch: -45 });
    this.afterFly(place);
  }

  afterFly(place) {
    if (place.wiki) {
      const [lang, ...title] = place.wiki.split(":");
      if (lang === "pt" || lang === "en") {
        this.knowledge.marker(place.lat, place.lon);
        return this.knowledge.showWiki(title.join(":"), place.lat, place.lon);
      }
    }
    this.knowledge.showLocation(place.lat, place.lon, place.name);
  }

  addHistory(place) {
    this.history = [{ name: place.name, lat: place.lat, lon: place.lon, bbox: place.bbox }, ...this.history.filter((h) => h.name !== place.name)].slice(0, 12);
    storageSet(HISTORY_KEY, this.history);
    this.renderHistory();
  }

  renderHistory() {
    const ul = document.getElementById("searchHistory");
    ul.innerHTML = this.history.length ? "" : `<li class="muted" style="cursor:default">Nenhuma pesquisa ainda.</li>`;
    for (const h of this.history) {
      const li = document.createElement("li");
      li.innerHTML = `<span>🕘</span><span class="grow"><span class="title">${escapeHtml(h.name)}</span></span>`;
      li.addEventListener("click", () => this.go(h));
      ul.appendChild(li);
    }
    if (this.history.length) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="muted">Limpar histórico</span>`;
      li.addEventListener("click", () => {
        this.history = [];
        storageSet(HISTORY_KEY, []);
        this.renderHistory();
        toast("Histórico apagado.");
      });
      ul.appendChild(li);
    }
  }
}
