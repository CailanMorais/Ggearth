import * as Cesium from "cesium";
import { DrawSession, geodesicLength, sphericalArea } from "./draw.js";
import { download, escapeHtml, formatArea, formatDistance, storageGet, storageSet, toast, toDegrees } from "./util.js";

const KEY = "ggearth.project";
const COLORS = ["#ea4335", "#4285f4", "#34a853", "#fbbc04", "#a142f4", "#ff6d01", "#24c1e0"];
const ICONS = { point: "📍", line: "〰️", polygon: "⬠" };

export class Projects {
  constructor(viewer) {
    this.viewer = viewer;
    this.items = storageGet(KEY, []);
    this.ds = new Cesium.CustomDataSource("projeto");
    viewer.dataSources.add(this.ds);
    this.pins = new Cesium.PinBuilder();
    this.imported = [];
    this.renderAll();
    this.bindUI();
  }

  save() {
    storageSet(KEY, this.items);
  }

  nextName(type) {
    const base = { point: "Marcador", line: "Caminho", polygon: "Polígono" }[type];
    return `${base} ${this.items.filter((i) => i.type === type).length + 1}`;
  }

  draw(type) {
    const color = COLORS[this.items.length % COLORS.length];
    new DrawSession(this.viewer, {
      mode: type,
      color: Cesium.Color.fromCssColorString(color),
      text: (p) =>
        type === "point"
          ? "📍 Clique no mapa para posicionar o marcador"
          : `${ICONS[type]} ${p.length} ponto(s) · clique para adicionar, duplo clique para concluir, botão direito desfaz`,
      onFinish: (positions) => {
        const name = window.prompt("Nome:", this.nextName(type));
        if (name === null) return;
        this.add({ type, name: name || this.nextName(type), desc: "", color, coords: positions.map((p) => {
          const d = toDegrees(p);
          return [d.lon, d.lat, Math.max(0, d.height)];
        }) });
      },
    }).start();
  }

  add(item) {
    item.id = item.id ?? crypto.randomUUID();
    this.items.push(item);
    this.save();
    this.renderAll();
    return item;
  }

  addPointAt(lat, lon, name) {
    return this.add({ type: "point", name: name || this.nextName("point"), desc: "", color: COLORS[0], coords: [[lon, lat, 0]] });
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
    this.renderAll();
  }

  edit(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    const name = window.prompt("Nome:", item.name);
    if (name === null) return;
    const desc = window.prompt("Descrição:", item.desc ?? "");
    item.name = name || item.name;
    if (desc !== null) item.desc = desc;
    this.save();
    this.renderAll();
  }

  measureText(item) {
    const pos = item.coords.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2]));
    if (item.type === "line") return formatDistance(geodesicLength(pos));
    if (item.type === "polygon") return formatArea(sphericalArea(pos));
    const [lon, lat] = item.coords[0];
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  renderAll() {
    this.ds.entities.removeAll();
    for (const item of this.items) {
      const color = Cesium.Color.fromCssColorString(item.color);
      const positions = item.coords.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2]));
      const common = { id: item.id, name: item.name, description: item.desc, properties: { projectId: item.id } };
      if (item.type === "point") {
        this.ds.entities.add({
          ...common,
          position: positions[0],
          billboard: {
            image: this.pins.fromColor(color, 40).toDataURL(),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: item.name,
            font: "500 14px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -46),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.5e6),
          },
        });
      } else if (item.type === "line") {
        this.ds.entities.add({ ...common, polyline: { positions, width: 4, material: color, clampToGround: true } });
      } else {
        this.ds.entities.add({
          ...common,
          polygon: { hierarchy: positions, material: color.withAlpha(0.35) },
          polyline: { positions: [...positions, positions[0]], width: 3, material: color, clampToGround: true },
        });
      }
    }
    this.renderList();
  }

  renderList() {
    const ul = document.getElementById("projectItems");
    ul.innerHTML = this.items.length
      ? ""
      : `<li class="muted" style="cursor:default">Nenhum item ainda. Use as ferramentas acima para criar marcadores, linhas e polígonos – eles ficam salvos no navegador.</li>`;
    for (const item of this.items) {
      const li = document.createElement("li");
      li.innerHTML = `<span style="color:${item.color}">${ICONS[item.type]}</span>
        <span class="grow"><span class="title">${escapeHtml(item.name)}</span><span class="sub">${escapeHtml(this.measureText(item))}</span></span>
        <button class="icon-btn" data-act="edit" title="Editar">✎</button>
        <button class="icon-btn" data-act="del" title="Excluir">🗑</button>`;
      li.addEventListener("click", (e) => {
        const act = e.target.dataset?.act;
        if (act === "edit") return this.edit(item.id);
        if (act === "del") return this.remove(item.id);
        this.flyTo(item.id);
      });
      ul.appendChild(li);
    }
  }

  flyTo(id) {
    const entity = this.ds.entities.getById(id);
    if (entity) this.viewer.flyTo(entity, { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 1500) });
  }

  bindUI() {
    document.querySelectorAll("[data-draw]").forEach((b) => b.addEventListener("click", () => this.draw(b.dataset.draw)));
    document.getElementById("exportKml").addEventListener("click", () => download("ggearth-projeto.kml", this.toKml(), "application/vnd.google-earth.kml+xml"));
    document.getElementById("exportGeojson").addEventListener("click", () =>
      download("ggearth-projeto.geojson", JSON.stringify(this.toGeoJson(), null, 2), "application/geo+json"),
    );
    document.getElementById("clearProject").addEventListener("click", () => {
      if (this.items.length && confirm("Excluir todos os itens do projeto?")) {
        this.items = [];
        this.save();
        this.renderAll();
      }
    });
    document.getElementById("importFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) await this.importFile(file);
    });
  }

  async importFile(file) {
    try {
      let ds;
      const name = file.name.toLowerCase();
      if (name.endsWith(".kml") || name.endsWith(".kmz")) {
        ds = await Cesium.KmlDataSource.load(file, {
          camera: this.viewer.scene.camera,
          canvas: this.viewer.scene.canvas,
          clampToGround: true,
          sourceUri: file.name,
        });
      } else {
        const json = JSON.parse(await file.text());
        ds = await Cesium.GeoJsonDataSource.load(json, { clampToGround: true, markerColor: Cesium.Color.fromCssColorString("#4285f4") });
      }
      ds.name = file.name;
      await this.viewer.dataSources.add(ds);
      this.imported.push(ds);
      this.renderImported();
      this.viewer.flyTo(ds);
      toast(`"${file.name}" importado (${ds.entities.values.length} elementos).`);
    } catch (err) {
      console.error(err);
      toast("Falha ao importar arquivo: " + err.message, 5000);
    }
  }

  renderImported() {
    const ul = document.getElementById("importedList");
    ul.innerHTML = this.imported.length ? "" : `<li class="muted" style="cursor:default">Nenhum arquivo.</li>`;
    for (const ds of this.imported) {
      const li = document.createElement("li");
      li.innerHTML = `<input type="checkbox" ${ds.show ? "checked" : ""}/><span class="grow"><span class="title">${escapeHtml(ds.name)}</span></span>
        <button class="icon-btn" data-act="del" title="Remover">🗑</button>`;
      li.querySelector("input").addEventListener("click", (e) => {
        e.stopPropagation();
        ds.show = e.target.checked;
      });
      li.addEventListener("click", (e) => {
        if (e.target.dataset?.act === "del") {
          this.viewer.dataSources.remove(ds, true);
          this.imported = this.imported.filter((d) => d !== ds);
          return this.renderImported();
        }
        if (e.target.tagName !== "INPUT") this.viewer.flyTo(ds);
      });
      ul.appendChild(li);
    }
  }

  toGeoJson() {
    return {
      type: "FeatureCollection",
      features: this.items.map((i) => ({
        type: "Feature",
        properties: { name: i.name, description: i.desc, stroke: i.color, fill: i.color, "marker-color": i.color },
        geometry:
          i.type === "point"
            ? { type: "Point", coordinates: i.coords[0] }
            : i.type === "line"
              ? { type: "LineString", coordinates: i.coords }
              : { type: "Polygon", coordinates: [[...i.coords, i.coords[0]]] },
      })),
    };
  }

  toKml() {
    const kmlColor = (hex, alpha = "ff") => {
      const h = hex.replace("#", "");
      return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
    };
    const coords = (cs) => cs.map((c) => `${c[0]},${c[1]},${c[2] ?? 0}`).join(" ");
    const placemarks = this.items
      .map((i) => {
        const style = `<Style><IconStyle><color>${kmlColor(i.color)}</color></IconStyle><LineStyle><color>${kmlColor(i.color)}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(i.color, "59")}</color></PolyStyle></Style>`;
        const geom =
          i.type === "point"
            ? `<Point><coordinates>${coords(i.coords)}</coordinates></Point>`
            : i.type === "line"
              ? `<LineString><tessellate>1</tessellate><coordinates>${coords(i.coords)}</coordinates></LineString>`
              : `<Polygon><outerBoundaryIs><LinearRing><tessellate>1</tessellate><coordinates>${coords([...i.coords, i.coords[0]])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        return `  <Placemark><name>${escapeHtml(i.name)}</name><description>${escapeHtml(i.desc)}</description>${style}${geom}</Placemark>`;
      })
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Projeto GGEarth</name>\n${placemarks}\n</Document></kml>\n`;
  }
}
