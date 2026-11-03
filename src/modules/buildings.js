import * as Cesium from "cesium";
import { screenCenter, storageGet, storageSet, toDegrees } from "./util.js";

// Prédios 3D gerados a partir do OpenStreetMap (Overpass API) – não precisa de chave.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const CELL = 0.006; // ~650 m
const MAX_CELLS = 36;
const MAX_CAMERA_HEIGHT = 3500; // m acima do solo

function parseMeters(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(",", "."));
  return /ft|'/.test(String(v)) ? n * 0.3048 : n;
}

function buildingHeight(tags) {
  let h = parseMeters(tags.height);
  if (!(h > 0)) {
    const levels = parseFloat(tags["building:levels"]);
    const roof = parseFloat(tags["roof:levels"]) || 0;
    if (levels > 0) h = (levels + roof) * 3.2;
  }
  if (!(h > 0)) {
    const t = tags.building;
    h = ["house", "detached", "garage", "garages", "shed", "hut", "residential", "terrace", "bungalow", "semidetached_house"].includes(t) ? 6.5 : t === "church" || t === "cathedral" ? 18 : 9;
  }
  let min = parseMeters(tags.min_height);
  if (!(min > 0)) min = (parseFloat(tags["building:min_level"]) || 0) * 3.2;
  return { height: Math.min(h, 900), min: Math.min(min, h - 1) };
}

function buildingColor(tags, seed) {
  const c = tags["building:colour"] || tags["building:color"];
  if (c) {
    try {
      const color = Cesium.Color.fromCssColorString(c);
      if (color) return color;
    } catch {
      /* cor inválida */
    }
  }
  // Tons claros levemente variados (como as maquetes do Google Earth)
  const v = 0.82 + ((seed * 9301 + 49297) % 233280) / 233280 * 0.14;
  return new Cesium.Color(v, v * 0.98, v * 0.94, 1);
}

export class OsmBuildings {
  constructor(viewer) {
    this.viewer = viewer;
    this.enabled = storageGet("ggearth.osm3d", true);
    this.cells = new Map(); // key -> { primitive, ts }
    this.loading = new Set();
    this.seen = new Set(); // ids OSM já desenhados (prédios na borda de duas células)
    this.collection = new Cesium.PrimitiveCollection();
    viewer.scene.primitives.add(this.collection);
    viewer.camera.moveEnd.addEventListener(() => this.update());
  }

  setEnabled(on) {
    this.enabled = on;
    storageSet("ggearth.osm3d", on);
    this.collection.show = on;
    if (on) this.update();
  }

  cameraHeightAboveGround() {
    const carto = this.viewer.camera.positionCartographic;
    const ground = this.viewer.scene.globe.getHeight(carto) ?? 0;
    return carto.height - ground;
  }

  async update() {
    if (!this.enabled || !this.viewer.scene.globe.show) return;
    if (this.cameraHeightAboveGround() > MAX_CAMERA_HEIGHT) return;
    const center = screenCenter(this.viewer);
    if (!center) return;
    const { lat, lon } = toDegrees(center);
    const ci = Math.floor(lat / CELL);
    const cj = Math.floor(lon / CELL);
    // Célula central primeiro, depois as vizinhas
    const order = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [di, dj] of order) {
      const key = `${ci + di}_${cj + dj}`;
      const cell = this.cells.get(key);
      if (cell) {
        cell.ts = Date.now();
        continue;
      }
      if (this.loading.has(key)) continue;
      await this.loadCell(ci + di, cj + dj, key);
    }
    this.evict();
  }

  evict() {
    if (this.cells.size <= MAX_CELLS) return;
    const sorted = [...this.cells.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (const [key, cell] of sorted.slice(0, this.cells.size - MAX_CELLS)) {
      if (cell.primitive) this.collection.remove(cell.primitive);
      for (const id of cell.ids ?? []) this.seen.delete(id);
      this.cells.delete(key);
    }
  }

  async query(s, w, n, e) {
    const q = `[out:json][timeout:25];way["building"](${s},${w},${n},${e});out geom tags;`;
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).elements ?? [];
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async loadCell(i, j, key) {
    this.loading.add(key);
    try {
      const s = i * CELL;
      const w = j * CELL;
      const ways = (await this.query(s, w, s + CELL, w + CELL)).filter(
        (el) => el.type === "way" && el.geometry?.length >= 4 && !this.seen.has(el.id),
      );
      const ids = ways.map((wy) => wy.id);
      ids.forEach((id) => this.seen.add(id));
      if (!ways.length) {
        this.cells.set(key, { primitive: null, ids, ts: Date.now() });
        return;
      }
      // Altura do terreno no centro de cada prédio
      const centroids = ways.map((wy) => {
        let la = 0;
        let lo = 0;
        for (const p of wy.geometry) {
          la += p.lat;
          lo += p.lon;
        }
        return Cesium.Cartographic.fromDegrees(lo / wy.geometry.length, la / wy.geometry.length);
      });
      const tp = this.viewer.terrainProvider;
      if (tp && !(tp instanceof Cesium.EllipsoidTerrainProvider)) {
        try {
          await Cesium.sampleTerrainMostDetailed(tp, centroids);
        } catch {
          centroids.forEach((c) => (c.height = 0));
        }
      } else centroids.forEach((c) => (c.height = 0));

      const instances = [];
      ways.forEach((wy, idx) => {
        const tags = wy.tags ?? {};
        if (tags["building"] === "roof" && !tags.min_height) return;
        const { height, min } = buildingHeight(tags);
        const base = (centroids[idx].height || 0) - 1.5;
        const flat = [];
        for (const p of wy.geometry) flat.push(p.lon, p.lat);
        try {
          instances.push(
            new Cesium.GeometryInstance({
              geometry: new Cesium.PolygonGeometry({
                polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
                height: base + min,
                extrudedHeight: base + height + 1.5,
                vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(buildingColor(tags, wy.id)) },
              id: { osmBuilding: true, osmId: wy.id, tags, height },
            }),
          );
        } catch {
          /* polígono inválido */
        }
      });
      const primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
        shadows: Cesium.ShadowMode.ENABLED,
        asynchronous: true,
      });
      this.collection.add(primitive);
      this.cells.set(key, { primitive, ids, ts: Date.now() });
    } catch (err) {
      console.warn("Prédios OSM indisponíveis", err);
    } finally {
      this.loading.delete(key);
    }
  }
}
