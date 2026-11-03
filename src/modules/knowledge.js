import * as Cesium from "cesium";
import { escapeHtml, fetchJson, formatLatLon, pickCartesian, screenCenter, storageGet, storageSet, toast, toDegrees } from "./util.js";

const WIKI = "https://pt.wikipedia.org";

export async function wikiSummary(title, lang = "pt") {
  try {
    return await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  } catch {
    if (lang === "pt") return wikiSummary(title, "en");
    return null;
  }
}

export async function wikiNearby(lat, lon, radius = 10000, limit = 50) {
  const url = `${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=${radius}&gslimit=${limit}&format=json&origin=*`;
  const data = await fetchJson(url);
  return data?.query?.geosearch ?? [];
}

export async function reverseGeocode(lat, lon) {
  try {
    const data = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=pt-BR`,
    );
    return data?.display_name ?? null;
  } catch {
    return null;
  }
}

/** Cartão de conhecimento + camada "Lugares da Wikipédia". */
export class Knowledge {
  constructor(viewer, { projects }) {
    this.viewer = viewer;
    this.projects = projects;
    this.card = document.getElementById("infoCard");
    document.getElementById("infoClose").addEventListener("click", () => this.hide());
    this.wikiDs = new Cesium.CustomDataSource("wikipedia");
    viewer.dataSources.add(this.wikiDs);
    this.wikiOn = storageGet("ggearth.wiki", true);
    this.requestId = 0;
    this.seq = 0;
    this.loaded = new Set();
    this.icon = new Cesium.PinBuilder().fromText("W", Cesium.Color.fromCssColorString("#5f6368"), 30).toDataURL();
    viewer.camera.moveEnd.addEventListener(() => this.refreshWiki());
  }

  setWikiLayer(on) {
    this.wikiOn = on;
    storageSet("ggearth.wiki", on);
    this.wikiDs.show = on;
    if (on) this.refreshWiki();
  }

  async refreshWiki() {
    if (!this.wikiOn) return;
    const height = this.viewer.camera.positionCartographic.height;
    if (height > 60000) return;
    const center = screenCenter(this.viewer);
    if (!center) return;
    const { lat, lon } = toDegrees(center);
    const id = ++this.requestId;
    try {
      const places = await wikiNearby(lat, lon);
      if (id !== this.requestId) return;
      for (const p of places) {
        if (this.loaded.has(p.pageid)) continue;
        this.loaded.add(p.pageid);
        this.wikiDs.entities.add({
          id: `wiki-${p.pageid}`,
          name: p.title,
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
          properties: { wikiTitle: p.title },
          billboard: {
            image: this.icon,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
          },
          label: {
            text: p.title,
            font: "13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -36),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
          },
        });
      }
      // Evita acumular milhares de entidades
      if (this.wikiDs.entities.values.length > 1500) {
        this.wikiDs.entities.removeAll();
        this.loaded.clear();
      }
    } catch (err) {
      console.warn("Wikipédia indisponível", err);
    }
  }

  hide() {
    this.seq++;
    this.card.hidden = true;
    this.viewer.entities.removeById("info-marker");
  }

  marker(lat, lon) {
    this.viewer.entities.removeById("info-marker");
    this.viewer.entities.add({
      id: "info-marker",
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString("#ea4335"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
  }

  render({ title, coords, text, image, actions, link }) {
    document.getElementById("infoTitle").textContent = title;
    document.getElementById("infoCoords").textContent = coords ?? "";
    const textEl = document.getElementById("infoText");
    textEl.innerHTML = text ?? "";
    const img = document.getElementById("infoImg");
    img.hidden = !image;
    if (image) img.src = image;
    const act = document.getElementById("infoActions");
    act.innerHTML = "";
    if (link) {
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "📖 Wikipédia";
      act.appendChild(a);
    }
    for (const a of actions ?? []) act.appendChild(a);
    this.card.hidden = false;
  }

  locationActions(lat, lon, name) {
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    const link = (label, href) => {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      return a;
    };
    return [
      link("🚶 Street View", `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`),
      link("📸 Mapillary", `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17`),
      link("🧭 Rotas", `https://www.openstreetmap.org/directions?to=${lat}%2C${lon}`),
      mk("📍 Salvar no projeto", () => {
        this.projects.addPointAt(lat, lon, name);
        toast("Marcador adicionado ao projeto.");
      }),
      mk("📋 Copiar coordenadas", async () => {
        try {
          await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
          toast("Coordenadas copiadas.");
        } catch {
          toast(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        }
      }),
    ];
  }

  async showWiki(title, lat, lon) {
    const seq = ++this.seq;
    this.render({ title, coords: lat != null ? formatLatLon(lat, lon) : "", text: "<span class='muted'>Carregando…</span>", actions: [] });
    const s = await wikiSummary(title);
    if (seq !== this.seq) return;
    if (s && lat == null && s.coordinates) {
      lat = s.coordinates.lat;
      lon = s.coordinates.lon;
    }
    this.render({
      title: s?.title ?? title,
      coords: lat != null ? `${formatLatLon(lat, lon)}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}` : "",
      text: s ? escapeHtml(s.extract) : "Sem informações disponíveis.",
      image: s?.thumbnail?.source,
      link: s?.content_urls?.desktop?.page,
      actions: lat != null ? this.locationActions(lat, lon, s?.title ?? title) : [],
    });
  }

  async showLocation(lat, lon, knownName) {
    const seq = ++this.seq;
    this.marker(lat, lon);
    const coords = `${formatLatLon(lat, lon)}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    this.render({ title: knownName ?? "Local selecionado", coords, text: "<span class='muted'>Buscando informações…</span>", actions: this.locationActions(lat, lon, knownName) });
    const [address, nearby] = await Promise.all([reverseGeocode(lat, lon), wikiNearby(lat, lon, 2000, 5).catch(() => [])]);
    if (seq !== this.seq) return;
    let html = address ? `<b>Endereço:</b> ${escapeHtml(address)}` : "";
    let image;
    let link;
    let title = knownName ?? address?.split(",")[0] ?? "Local selecionado";
    if (nearby.length) {
      const s = await wikiSummary(nearby[0].title);
      if (seq !== this.seq) return;
      if (s) {
        html += `<br/><br/><b>${escapeHtml(s.title)}</b> <span class="muted">(${Math.round(nearby[0].dist)} m)</span><br/>${escapeHtml(s.extract)}`;
        image = s.thumbnail?.source;
        link = s.content_urls?.desktop?.page;
      }
      if (nearby.length > 1) {
        html += `<br/><br/><span class="muted">Por perto: ${nearby.slice(1).map((n) => escapeHtml(n.title)).join(" · ")}</span>`;
      }
    }
    this.render({ title, coords, text: html || "Sem informações para este ponto.", image, link, actions: this.locationActions(lat, lon, title) });
  }

  /** Clique no mapa. */
  async handleClick(screenPos) {
    this.seq++;
    const picked = this.viewer.scene.pick(screenPos);
    const entity = picked?.id instanceof Cesium.Entity ? picked.id : null;
    if (entity) {
      const props = entity.properties;
      const wikiTitle = props?.wikiTitle?.getValue();
      if (wikiTitle) {
        const d = toDegrees(entity.position.getValue(Cesium.JulianDate.now()));
        return this.showWiki(wikiTitle, d.lat, d.lon);
      }
      const desc = entity.description?.getValue(Cesium.JulianDate.now());
      const pos = entity.position?.getValue(Cesium.JulianDate.now());
      const d = pos ? toDegrees(pos) : null;
      return this.render({
        title: entity.name ?? "Elemento",
        coords: d ? formatLatLon(d.lat, d.lon) : "",
        // Descrições podem vir de arquivos KML importados: exibe apenas como texto.
        text: desc ? escapeHtml(String(desc).replace(/<[^>]*>/g, " ")) : "",
        actions: d ? this.locationActions(d.lat, d.lon, entity.name) : [],
      });
    }
    const cart = pickCartesian(this.viewer, screenPos);
    if (!cart) return this.hide();
    const { lat, lon } = toDegrees(cart);
    this.showLocation(lat, lon);
  }
}
