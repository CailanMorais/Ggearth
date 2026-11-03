import * as Cesium from "cesium";
import { cadastroFor } from "../data/cadastros.js";
import { sphericalArea } from "./draw.js";
import { escapeHtml, formatArea } from "./util.js";

// Campos técnicos que não interessam ao usuário
const HIDDEN = /^(objectid|fid|shape|shape[._].*|st_area.*|st_length.*|globalid|gdb_.*|created_.*|last_edited_.*|symbolid|ruleid|override)$/i;

let jsonpSeq = 0;
function jsonp(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cb = `__ggearth_jsonp_${++jsonpSeq}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => done(new Error("tempo esgotado")), timeoutMs);
    function done(err, data) {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb] = (data) => done(null, data);
    script.onerror = () => done(new Error("falha de rede"));
    script.src = `${url}&callback=${cb}`;
    document.head.appendChild(script);
  });
}

/** Requisição ao ArcGIS Server: tenta fetch (CORS) e, se o servidor não permitir, usa JSONP. */
async function arcgis(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "erro do servidor");
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      const data = await jsonp(url);
      if (data?.error) throw new Error(data.error.message || "erro do servidor");
      return data;
    }
    throw err;
  }
}

function identifyUrl(base, lat, lon) {
  const d = 0.0015;
  const p = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: "all",
    tolerance: "2",
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    imageDisplay: "600,600,96",
    returnGeometry: "true",
    f: "json",
  });
  return `${base}/identify?${p}`;
}

function formatValue(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(null|<null>|0\.0+)$/i.test(s)) return null;
  // Datas em milissegundos (ArcGIS)
  if (/^\d{12,13}$/.test(s)) {
    const d = new Date(Number(s));
    if (!isNaN(d) && d.getFullYear() > 1900) return d.toLocaleDateString("pt-BR");
  }
  return s;
}

function prettyKey(k) {
  return k.replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
}

function ringsArea(rings) {
  // Área total (anéis externos menos buracos já vêm com orientação ESRI; soma absoluta do externo maior é suficiente)
  let best = 0;
  for (const r of rings) {
    const a = sphericalArea(r.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
    best = Math.max(best, a);
  }
  return best;
}

export class Cadastro {
  constructor(viewer) {
    this.viewer = viewer;
    this.highlight = new Cesium.CustomDataSource("lote-selecionado");
    viewer.dataSources.add(this.highlight);
  }

  clear() {
    this.highlight.entities.removeAll();
  }

  drawPolygon(rings) {
    this.clear();
    for (const ring of rings) {
      const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
      this.highlight.entities.add({
        polyline: { positions, width: 4, material: Cesium.Color.fromCssColorString("#00e5ff"), clampToGround: true },
      });
    }
    this.highlight.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(rings[0].flat())),
        material: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.18),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    });
  }

  /** Consulta os serviços da prefeitura no ponto e devolve HTML pronto (ou null se fora de cobertura). */
  async lookup(lat, lon) {
    const src = cadastroFor(lat, lon);
    if (!src) return null;
    const results = await Promise.all(
      src.servicos.map(async (svc) => {
        try {
          const data = await arcgis(identifyUrl(`${src.servidor}/${svc.path}`, lat, lon));
          return { svc, items: data.results ?? [] };
        } catch (err) {
          return { svc, error: err.message };
        }
      }),
    );

    let html = `<div class="cad"><h3 style="margin:14px 0 6px">🏛️ Dados cadastrais – ${escapeHtml(src.nome)}</h3>`;
    let drew = false;
    let any = false;
    const errors = [];
    for (const { svc, items, error } of results) {
      if (error) {
        errors.push(`${svc.titulo}: ${error}`);
        continue;
      }
      for (const it of items) {
        const rows = Object.entries(it.attributes ?? {})
          .filter(([k]) => !HIDDEN.test(k))
          .map(([k, v]) => [prettyKey(k), formatValue(v)])
          .filter(([, v]) => v != null);
        const rings = it.geometry?.rings;
        let areaRow = "";
        if (rings?.length) {
          areaRow = `<tr><td>Área calculada do polígono</td><td><b>${formatArea(ringsArea(rings))}</b></td></tr>`;
          if (svc.principal && !drew) {
            this.drawPolygon(rings);
            drew = true;
          }
        }
        if (!rows.length && !areaRow) continue;
        any = true;
        html += `<details ${svc.principal ? "open" : ""} style="margin:6px 0"><summary><b>${escapeHtml(svc.titulo)}</b> <span class="muted">· ${escapeHtml(it.layerName ?? "")}</span></summary>
          <table class="attr">${areaRow}${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table></details>`;
      }
    }
    if (!drew) this.clear();
    if (!any) {
      html += errors.length
        ? `<p class="muted">Não foi possível consultar o servidor da prefeitura agora (${escapeHtml(errors[0])}).</p>`
        : `<p class="muted">Nenhum lote cadastrado exatamente neste ponto. Toque dentro de um lote.</p>`;
    }
    html += `<p class="muted" style="font-size:12px">${escapeHtml(src.cartorios)} Proprietário e ônus constam apenas na matrícula, emitida pelo cartório.</p></div>`;
    return html;
  }
}
