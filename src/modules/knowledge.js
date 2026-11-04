import * as Cesium from "cesium";
import { cadastroFor } from "../data/cadastros.js";
import { Cadastro } from "./cadastro.js";
import { escapeHtml, fetchJson, formatLatLon, pickCartesian, screenCenter, storageGet, storageSet, toast, toDegrees } from "./util.js";

const WIKI = "https://pt.wikipedia.org";

/** Resumo de um artigo. Ignora páginas de desambiguação (que não descrevem o lugar). */
export async function wikiSummary(title, lang = "pt", fallback = true) {
  try {
    const s = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (s?.type === "disambiguation") throw new Error("desambiguação");
    return s;
  } catch {
    if (fallback && lang === "pt") return wikiSummary(title, "en", false);
    return null;
  }
}

/**
 * Artigo vinculado a um objeto do OpenStreetMap (tags wikidata / wikipedia).
 * Prefere a versão em português via Wikidata, garantindo que o artigo é do mesmo lugar.
 */
export async function wikiFromTags(tags) {
  if (!tags) return null;
  const qid = tags.wikidata;
  if (qid && /^Q\d+$/.test(qid)) {
    try {
      const d = await fetchJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=ptwiki%7Cenwiki&format=json&origin=*`,
      );
      const sl = d?.entities?.[qid]?.sitelinks ?? {};
      if (sl.ptwiki) return await wikiSummary(sl.ptwiki.title, "pt", false);
      if (sl.enwiki) return await wikiSummary(sl.enwiki.title, "en", false);
    } catch {
      /* segue para a tag wikipedia */
    }
  }
  if (tags.wikipedia) {
    const m = tags.wikipedia.match(/^([a-z-]+):(.+)$/);
    if (m) return wikiSummary(m[2], m[1], false);
  }
  return null;
}

export async function wikiNearby(lat, lon, radius = 10000, limit = 50) {
  const url = `${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=${radius}&gslimit=${limit}&format=json&origin=*`;
  const data = await fetchJson(url);
  return data?.query?.geosearch ?? [];
}

/** Nível de detalhe do endereço conforme a altitude da câmera (país → prédio). */
export function zoomForHeight(h) {
  if (h > 6e6) return 3;
  if (h > 1.5e6) return 5;
  if (h > 3e5) return 8;
  if (h > 6e4) return 10;
  if (h > 1.2e4) return 12;
  if (h > 3e3) return 14;
  if (h > 800) return 16;
  return 18;
}

export async function reverseGeocode(lat, lon, zoom = 18) {
  try {
    return await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1&extratags=1&namedetails=1&accept-language=pt-BR`,
    );
  } catch {
    return null;
  }
}

const TYPE_LABELS = {
  country: "País", state: "Estado", region: "Região", county: "Condado", city: "Cidade", town: "Cidade", village: "Vila",
  municipality: "Município", suburb: "Bairro", neighbourhood: "Bairro", quarter: "Bairro", road: "Via", residential: "Rua",
  primary: "Avenida/Rodovia", secondary: "Avenida", tertiary: "Rua", house: "Imóvel", building: "Edifício", yes: "Edifício",
  peak: "Pico", volcano: "Vulcão", water: "Corpo d'água", river: "Rio", lake: "Lago", bay: "Baía", beach: "Praia",
  island: "Ilha", park: "Parque", forest: "Floresta", wood: "Mata", attraction: "Atração turística", museum: "Museu",
  monument: "Monumento", church: "Igreja", place_of_worship: "Templo", stadium: "Estádio", university: "Universidade",
  school: "Escola", hospital: "Hospital", airport: "Aeroporto", aerodrome: "Aeroporto", station: "Estação",
  administrative: "Divisão administrativa", national_park: "Parque nacional", protected_area: "Área protegida",
};

function placeLabel(r) {
  return TYPE_LABELS[r?.addresstype] ?? TYPE_LABELS[r?.type] ?? null;
}

/** Cartão de conhecimento + camada "Lugares da Wikipédia". */
export class Knowledge {
  constructor(viewer, { projects }) {
    this.viewer = viewer;
    this.projects = projects;
    this.card = document.getElementById("infoCard");
    document.getElementById("infoClose").addEventListener("click", () => this.hide());
    this.bindSheet();
    this.wikiDs = new Cesium.CustomDataSource("wikipedia");
    viewer.dataSources.add(this.wikiDs);
    this.wikiOn = storageGet("ggearth.wiki", true);
    this.requestId = 0;
    this.seq = 0;
    this.extraHtml = "";
    this.cadastro = new Cadastro(viewer);
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

  /** Alça do "bottom sheet": toque expande/recolhe, arrastar para baixo fecha. */
  bindSheet() {
    const handle = document.getElementById("infoHandle");
    let startY = null;
    handle.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointerup", (e) => {
      if (startY == null) return;
      const dy = e.clientY - startY;
      startY = null;
      if (dy > 50) {
        if (this.card.classList.contains("expanded")) this.card.classList.remove("expanded");
        else this.hide();
      } else if (dy < -30) this.card.classList.add("expanded");
      else this.card.classList.toggle("expanded");
    });
  }

  hide() {
    this.seq++;
    this.extraHtml = "";
    this.cadastro.clear();
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
    document.getElementById("infoExtra").innerHTML = this.extraHtml;
    if (this.card.hidden) {
      this.card.classList.remove("expanded");
      this.card.scrollTop = 0;
    }
    this.card.hidden = false;
    this.onShow?.();
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
      ...(lat < 5.5 && lat > -34 && lon > -74 && lon < -32
        ? [
            link("🏛️ Achar cartório", "https://www.registrodeimoveis.org.br/"),
            link("📜 Certidão de matrícula (ONR)", "https://ridigital.org.br/"),
          ]
        : []),
      mk("📍 Salvar", () => this.projects.addPointAt(lat, lon, name)),
      mk("📋 Coordenadas", async () => {
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
    this.extraHtml = "";
    this.cadastro.clear();
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

  /**
   * Mostra informações de um ponto.
   * opts.name: nome conhecido · opts.tags: tags OSM (wikidata/wikipedia) do lugar · opts.address: endereço já conhecido
   * opts.zoom: nível de detalhe do endereço · opts.building: tags de um prédio clicado
   */
  async showLocation(lat, lon, opts = {}) {
    const seq = ++this.seq;
    this.marker(lat, lon);
    this.cadastro.clear();
    const zoomLevel = opts.zoom ?? zoomForHeight(this.viewer.camera.positionCartographic.height);
    const covered = !!cadastroFor(lat, lon);
    // Dados de lote só fazem sentido quando o usuário está olhando lotes (zoom de rua/prédio)
    const lotZoom = covered && zoomLevel >= 15;
    this.extraHtml = lotZoom
      ? `<p class="muted">🏛️ Consultando o cadastro da prefeitura…</p>`
      : covered
        ? `<p class="muted">🏛️ Aproxime até ver as quadras e toque num lote para ver os dados cadastrais.</p>`
        : "";
    if (lotZoom) {
      this.cadastro
        .lookup(lat, lon)
        .then((res) => {
          if (seq !== this.seq) return;
          this.extraHtml = res?.html ?? "";
          document.getElementById("infoExtra").innerHTML = this.extraHtml;
          if (res?.title) {
            this.lotTitle = res.title;
            document.getElementById("infoTitle").textContent = res.title;
          }
        })
        .catch((err) => {
          if (seq !== this.seq) return;
          this.extraHtml = `<p class="muted">Cadastro indisponível: ${escapeHtml(err.message)}</p>`;
          document.getElementById("infoExtra").innerHTML = this.extraHtml;
        });
    }
    this.lotTitle = null;
    const coords = `${formatLatLon(lat, lon)}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    this.render({ title: opts.name ?? "Local selecionado", coords, text: "<span class='muted'>Buscando informações…</span>", actions: this.locationActions(lat, lon, opts.name) });

    const zoom = zoomLevel;
    const r = opts.address ? null : await reverseGeocode(lat, lon, zoom);
    if (seq !== this.seq) return;
    const tags = opts.tags ?? r?.extratags ?? null;
    const summary = await wikiFromTags(tags);
    if (seq !== this.seq) return;

    const b = opts.building;
    const name =
      opts.name ?? b?.name ?? r?.namedetails?.["name:pt"] ?? r?.name ?? r?.address?.road ?? r?.display_name?.split(",")[0] ?? "Local selecionado";
    const kind = b ? "Edifício" : placeLabel(r);
    const address = opts.address ?? r?.display_name;

    let html = "";
    if (kind) html += `<span class="muted">${escapeHtml(kind)}</span><br/>`;
    if (b) {
      const facts = [];
      if (b.height) facts.push(`altura ≈ ${Math.round(b.height)} m`);
      if (b["building:levels"]) facts.push(`${escapeHtml(b["building:levels"])} andares`);
      const addr = [b["addr:street"], b["addr:housenumber"]].filter(Boolean).join(", ");
      if (addr) facts.push(escapeHtml(addr));
      if (facts.length) html += facts.join(" · ") + "<br/>";
    }
    if (address) html += `<b>Endereço:</b> ${escapeHtml(address)}<br/>`;
    if (summary) {
      html += `<br/>${escapeHtml(summary.extract)}`;
    } else if (zoom >= 14) {
      // Sem artigo do próprio lugar: lista artigos realmente próximos, com a distância.
      const nearby = await wikiNearby(lat, lon, 400, 5).catch(() => []);
      if (seq !== this.seq) return;
      if (nearby.length) {
        html += `<br/><span class="muted">Por perto:</span><ul style="margin:4px 0;padding-left:18px">${nearby
          .map((n) => `<li><a href="#" data-wiki="${escapeHtml(n.title)}" data-lat="${n.lat}" data-lon="${n.lon}" style="color:var(--accent)">${escapeHtml(n.title)}</a> <span class="muted">(${Math.round(n.dist)} m)</span></li>`)
          .join("")}</ul>`;
      }
    }
    this.render({
      title: this.lotTitle ?? name,
      coords,
      text: html || "Sem informações para este ponto.",
      image: summary?.thumbnail?.source,
      link: summary?.content_urls?.desktop?.page,
      actions: this.locationActions(lat, lon, name),
    });
    document.querySelectorAll("#infoText [data-wiki]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this.showWiki(a.dataset.wiki, Number(a.dataset.lat), Number(a.dataset.lon));
      }),
    );
  }

  /** Clique no mapa. */
  async handleClick(screenPos) {
    this.seq++;
    const picked = this.viewer.scene.pick(screenPos);
    let entity = picked?.id instanceof Cesium.Entity ? picked.id : null;
    // Destaque do lote e marcador do clique não são "objetos": trata como clique no chão
    if (entity && (entity.id === "info-marker" || this.cadastro.highlight.entities.contains(entity))) entity = null;
    if (entity) {
      this.extraHtml = "";
      this.cadastro.clear();
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
    if (picked?.id?.osmBuilding) {
      const t = picked.id.tags ?? {};
      return this.showLocation(lat, lon, { zoom: 18, building: { ...t, height: picked.id.height }, tags: t.wikidata || t.wikipedia ? t : undefined });
    }
    this.showLocation(lat, lon);
  }
}
