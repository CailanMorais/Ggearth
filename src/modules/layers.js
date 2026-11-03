import * as Cesium from "cesium";
import { createOpenTerrainProvider } from "./terrain.js";
import { settings, storageGet, storageSet, toast } from "./util.js";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

const esri = (path, maximumLevel = 19) =>
  new Cesium.UrlTemplateImageryProvider({
    url: `${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel,
    credit: new Cesium.Credit("Esri, Maxar, Earthstar Geographics, USDA, USGS, GIS User Community"),
  });

export const BASE_LAYERS = [
  { id: "satellite", name: "Satélite", sub: "Esri World Imagery – até ~30 cm", create: () => esri("World_Imagery") },
  { id: "streets", name: "Mapa de ruas", sub: "Esri World Street Map", create: () => esri("World_Street_Map") },
  { id: "topo", name: "Topográfico", sub: "Esri World Topographic", create: () => esri("World_Topo_Map") },
  {
    id: "osm",
    name: "OpenStreetMap",
    sub: "Mapa colaborativo mundial",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maximumLevel: 19,
        credit: new Cesium.Credit("© colaboradores do OpenStreetMap"),
      }),
  },
  {
    id: "opentopo",
    name: "Relevo (OpenTopoMap)",
    sub: "Curvas de nível e sombreamento",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        subdomains: ["a", "b", "c"],
        maximumLevel: 17,
        credit: new Cesium.Credit("© OpenTopoMap (CC-BY-SA), © OpenStreetMap"),
      }),
  },
  { id: "ocean", name: "Oceanos", sub: "Batimetria Esri Ocean Basemap", create: () => esri("Ocean/World_Ocean_Base", 13) },
  {
    id: "night",
    name: "Terra à noite",
    sub: "NASA Black Marble (luzes das cidades)",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
        maximumLevel: 8,
        credit: new Cesium.Credit("NASA Earth Observatory / GIBS"),
      }),
  },
  {
    id: "bluemarble",
    name: "Blue Marble",
    sub: "Mosaico NASA sem nuvens",
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
        maximumLevel: 8,
        credit: new Cesium.Credit("NASA Blue Marble / GIBS"),
      }),
  },
];

const OVERLAYS = [
  {
    id: "lotesLondrina",
    name: "Lotes – Londrina",
    sub: "Contorno dos lotes (Prefeitura) ao aproximar",
    default: true,
    minimumTerrainLevel: 13,
    create: () =>
      new Cesium.UrlTemplateImageryProvider({
        url:
          "https://geo.londrina.pr.gov.br/server/rest/services/Gerais/Lotes_e_Glebas/MapServer/export" +
          "?bbox={westProjected},{southProjected},{eastProjected},{northProjected}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image",
        rectangle: Cesium.Rectangle.fromDegrees(-51.45, -23.8, -50.8, -23.0),
        maximumLevel: 20,
        credit: new Cesium.Credit("Lotes: Prefeitura de Londrina / IPPUL"),
      }),
  },
  { id: "labels", name: "Fronteiras e rótulos", sub: "Países, estados, cidades", default: true, create: () => esri("Reference/World_Boundaries_and_Places") },
  { id: "roads", name: "Estradas", sub: "Rodovias e ruas", default: false, create: () => esri("Reference/World_Transportation") },
  {
    id: "clouds",
    name: "Nuvens de hoje",
    sub: "NASA VIIRS – ontem/hoje",
    default: false,
    alpha: 0.55,
    create: () => {
      const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      return new Cesium.UrlTemplateImageryProvider({
        url: `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9,
        credit: new Cesium.Credit("NASA GIBS"),
      });
    },
  },
  {
    id: "fires",
    name: "Focos de incêndio",
    sub: "NASA MODIS – últimas 24 h",
    default: false,
    create: () => {
      const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      return new Cesium.UrlTemplateImageryProvider({
        url: `${GIBS}/MODIS_Terra_Thermal_Anomalies_All/default/${d}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
        maximumLevel: 7,
        credit: new Cesium.Credit("NASA FIRMS / GIBS"),
      });
    },
  },
];

export class LayerManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.layers = viewer.imageryLayers;
    this.state = storageGet("ggearth.layers", { base: "satellite", overlays: {}, globe: {} });
    this.overlayLayers = {};
    this.historyLayer = null;
    this.tilesets = {};
    this.graticule = null;
  }

  async init() {
    this.setBase(this.state.base, false);
    for (const o of OVERLAYS) {
      const on = this.state.overlays[o.id] ?? o.default;
      if (on) this.setOverlay(o.id, true, false);
    }
    this.renderUI();
    await this.applyTerrain();
    this.applyGlobeOptions();
  }

  save() {
    storageSet("ggearth.layers", this.state);
  }

  setBase(id, persist = true) {
    const def = BASE_LAYERS.find((b) => b.id === id) ?? BASE_LAYERS[0];
    if (this.baseLayer) this.layers.remove(this.baseLayer, true);
    this.baseLayer = new Cesium.ImageryLayer(def.create());
    this.layers.add(this.baseLayer, 0);
    this.state.base = def.id;
    if (persist) this.save();
  }

  setOverlay(id, on, persist = true) {
    const def = OVERLAYS.find((o) => o.id === id);
    if (!def) return;
    if (on && !this.overlayLayers[id]) {
      const layer = new Cesium.ImageryLayer(def.create(), { alpha: def.alpha ?? 1, minimumTerrainLevel: def.minimumTerrainLevel });
      this.layers.add(layer);
      this.overlayLayers[id] = layer;
    } else if (!on && this.overlayLayers[id]) {
      this.layers.remove(this.overlayLayers[id], true);
      delete this.overlayLayers[id];
    }
    this.state.overlays[id] = on;
    if (persist) this.save();
  }

  /** Camada histórica fica logo acima da base e abaixo das sobreposições. */
  setHistoryLayer(provider) {
    if (this.historyLayer) {
      this.layers.remove(this.historyLayer, true);
      this.historyLayer = null;
    }
    if (provider) {
      this.historyLayer = new Cesium.ImageryLayer(provider);
      this.layers.add(this.historyLayer, 1);
    }
  }

  globeOpt(key, fallback) {
    return this.state.globe[key] ?? fallback;
  }

  async applyTerrain() {
    const viewer = this.viewer;
    const want = this.globeOpt("terrain", true);
    try {
      if (!want) {
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      } else if (settings.ionToken) {
        viewer.terrainProvider = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
      } else {
        viewer.terrainProvider = createOpenTerrainProvider();
      }
    } catch (err) {
      console.warn("Terreno indisponível", err);
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      toast("Relevo 3D indisponível no momento – usando globo liso.");
    }
  }

  applyGlobeOptions() {
    const { scene } = this.viewer;
    scene.globe.enableLighting = this.globeOpt("lighting", false);
    scene.skyAtmosphere.show = this.globeOpt("atmosphere", true);
    scene.globe.showGroundAtmosphere = this.globeOpt("atmosphere", true);
    scene.skyBox.show = this.globeOpt("stars", true);
    scene.fog.enabled = this.globeOpt("atmosphere", true);
    scene.globe.showWaterEffect = true;
    this.viewer.shadows = this.globeOpt("shadows", false);
    this.setGraticule(this.globeOpt("grid", false));
  }

  setGraticule(on) {
    if (on && !this.graticule) {
      const ds = new Cesium.CustomDataSource("grade");
      const color = Cesium.Color.WHITE.withAlpha(0.35);
      for (let lon = -180; lon < 180; lon += 15) {
        const pts = [];
        for (let lat = -89; lat <= 89; lat += 2) pts.push(lon, lat);
        ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts), width: 1, material: color } });
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 2) pts.push(lon, lat);
        const special = lat === 0;
        ds.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(pts),
            width: special ? 2 : 1,
            material: special ? Cesium.Color.YELLOW.withAlpha(0.6) : color,
            arcType: Cesium.ArcType.RHUMB,
          },
        });
      }
      // Trópicos e círculos polares
      for (const [lat, name] of [[23.44, "Trópico de Câncer"], [-23.44, "Trópico de Capricórnio"], [66.56, "Círculo Polar Ártico"], [-66.56, "Círculo Polar Antártico"]]) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 2) pts.push(lon, lat);
        ds.entities.add({
          name,
          polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts), width: 1, arcType: Cesium.ArcType.RHUMB,
            material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.ORANGE.withAlpha(0.6) }) },
        });
      }
      this.viewer.dataSources.add(ds);
      this.graticule = ds;
    } else if (!on && this.graticule) {
      this.viewer.dataSources.remove(this.graticule, true);
      this.graticule = null;
    }
  }

  async setTileset(id, on) {
    const viewer = this.viewer;
    if (!on) {
      if (this.tilesets[id]) {
        viewer.scene.primitives.remove(this.tilesets[id]);
        delete this.tilesets[id];
      }
      if (id === "google3d") viewer.scene.globe.show = true;
      return true;
    }
    try {
      let tileset;
      if (id === "google3d") {
        if (!settings.googleKey && !settings.ionToken) {
          toast("Informe uma chave do Google Maps (ou token Cesium ion) em Configurações.", 4500);
          return false;
        }
        tileset = await Cesium.createGooglePhotorealistic3DTileset(
          { key: settings.googleKey || undefined, onlyUsingWithGoogleGeocoder: true },
          {},
        );
        viewer.scene.globe.show = false;
      } else if (id === "osmBuildings") {
        if (!settings.ionToken) {
          toast("Prédios 3D exigem um token gratuito do Cesium ion (Configurações).", 4500);
          return false;
        }
        tileset = await Cesium.createOsmBuildingsAsync();
      }
      viewer.scene.primitives.add(tileset);
      this.tilesets[id] = tileset;
      return true;
    } catch (err) {
      console.error(err);
      toast("Não foi possível carregar a camada 3D: " + err.message, 5000);
      if (id === "google3d") viewer.scene.globe.show = true;
      return false;
    }
  }

  renderUI() {
    const base = document.getElementById("baseLayers");
    base.innerHTML = "";
    for (const b of BASE_LAYERS) {
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="base" value="${b.id}" ${b.id === this.state.base ? "checked" : ""}/> <span>${b.name}<small>${b.sub}</small></span>`;
      label.querySelector("input").addEventListener("change", () => this.setBase(b.id));
      base.appendChild(label);
    }

    const ov = document.getElementById("overlayLayers");
    ov.innerHTML = "";
    for (const o of OVERLAYS) {
      const on = this.state.overlays[o.id] ?? o.default;
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" ${on ? "checked" : ""}/> <span>${o.name}<small>${o.sub}</small></span>`;
      label.querySelector("input").addEventListener("change", (e) => this.setOverlay(o.id, e.target.checked));
      ov.appendChild(label);
    }
    // A camada da Wikipédia é registrada pelo módulo de conhecimento.
    this.extraOverlayHost = ov;

    const globe = document.getElementById("globeOptions");
    globe.innerHTML = "";
    const globeOpts = [
      { key: "terrain", name: "Relevo 3D", sub: "Montanhas e vales reais", def: true, apply: () => this.applyTerrain() },
      { key: "atmosphere", name: "Atmosfera", sub: "Céu e névoa", def: true },
      { key: "stars", name: "Estrelas", sub: "Fundo espacial", def: true },
      { key: "lighting", name: "Sol e noite", sub: "Iluminação conforme a hora", def: false },
      { key: "grid", name: "Linhas de grade", sub: "Latitude/longitude, Equador e trópicos", def: false },
    ];
    for (const g of globeOpts) {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" ${this.globeOpt(g.key, g.def) ? "checked" : ""}/> <span>${g.name}<small>${g.sub}</small></span>`;
      label.querySelector("input").addEventListener("change", async (e) => {
        this.state.globe[g.key] = e.target.checked;
        this.save();
        if (g.apply) await g.apply();
        this.applyGlobeOptions();
      });
      globe.appendChild(label);
    }
    const timeRow = document.createElement("label");
    timeRow.className = "row";
    timeRow.innerHTML = `Data/hora <input type="datetime-local" id="sunTime" style="flex:1"/>`;
    globe.appendChild(timeRow);
    const sunInput = timeRow.querySelector("input");
    const now = new Date();
    sunInput.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    sunInput.addEventListener("change", () => {
      const d = new Date(sunInput.value);
      if (!isNaN(d)) this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
    });

    const td = document.getElementById("threeDOptions");
    td.innerHTML = "";
    const tdOpts = [
      { id: "google3d", name: "Cidades 3D fotorrealistas", sub: "Google Photorealistic 3D Tiles (requer chave)" },
      { id: "osmBuildings", name: "Prédios 3D (Cesium OSM Buildings)", sub: "Versão otimizada, requer token Cesium ion" },
    ];
    for (const t of tdOpts) {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox"/> <span>${t.name}<small>${t.sub}</small></span>`;
      const input = label.querySelector("input");
      input.addEventListener("change", async () => {
        const ok = await this.setTileset(t.id, input.checked);
        if (!ok) input.checked = false;
      });
      td.appendChild(label);
    }
    const shadows = document.createElement("label");
    shadows.innerHTML = `<input type="checkbox" ${this.globeOpt("shadows", false) ? "checked" : ""}/> <span>Sombras<small>Sombras projetadas pelo sol em 3D</small></span>`;
    shadows.querySelector("input").addEventListener("change", (e) => {
      this.state.globe.shadows = e.target.checked;
      this.save();
      this.applyGlobeOptions();
    });
    td.appendChild(shadows);
  }

  addOverlayToggle(name, sub, initial, onChange) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" ${initial ? "checked" : ""}/> <span>${name}<small>${sub}</small></span>`;
    label.querySelector("input").addEventListener("change", (e) => onChange(e.target.checked));
    this.extraOverlayHost.appendChild(label);
  }
}
