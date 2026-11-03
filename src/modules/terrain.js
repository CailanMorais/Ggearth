import * as Cesium from "cesium";

// Relevo mundial aberto e sem chave: AWS Terrain Tiles (formato Terrarium, ~30 m no Brasil, SRTM/ASTER/etc.).
// Cada pixel PNG codifica a altitude: h = R*256 + G + B/256 - 32768.
const URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const MAX_Z = 15;
const SIZE = 65; // amostras por lado de cada tile do Cesium
const CACHE_MAX = 400;

const cache = new Map(); // "z/x/y" -> Promise<Uint8ClampedArray | null>

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key);
    cache.set(key, p); // LRU
    return p;
  }
  p = (async () => {
    try {
      const res = await fetch(URL.replace("{z}", z).replace("{x}", x).replace("{y}", y));
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      return ctx.getImageData(0, 0, 256, 256).data;
    } catch {
      return null;
    }
  })();
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

function mercator(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return { fx, fy, n };
}

function decode(data, px, py) {
  const i = (py * 256 + px) * 4;
  return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
}

/** Altitude (m) de vários pontos {lon, lat} usando o nível z. */
export async function sampleHeights(points, z = 14) {
  const tiles = new Map();
  const refs = points.map(({ lon, lat }) => {
    const { fx, fy, n } = mercator(lon, lat, z);
    const tx = Math.min(n - 1, Math.max(0, Math.floor(fx)));
    const ty = Math.min(n - 1, Math.max(0, Math.floor(fy)));
    const key = `${tx}/${ty}`;
    if (!tiles.has(key)) tiles.set(key, loadTile(z, tx, ty));
    return { key, px: Math.min(255, Math.floor((fx - tx) * 256)), py: Math.min(255, Math.floor((fy - ty) * 256)) };
  });
  const loaded = new Map();
  await Promise.all([...tiles].map(async ([k, p]) => loaded.set(k, await p)));
  return refs.map((r) => {
    const data = loaded.get(r.key);
    return data ? Math.max(-500, decode(data, r.px, r.py)) : 0;
  });
}

export function createOpenTerrainProvider() {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  return new Cesium.CustomHeightmapTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme,
    credit: new Cesium.Credit("Relevo: Mapzen/AWS Terrain Tiles (SRTM, GMTED, ETOPO1, outros)"),
    callback: async (x, y, level) => {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = Cesium.Math.toDegrees(rect.west);
      const east = Cesium.Math.toDegrees(rect.east);
      const north = Cesium.Math.toDegrees(rect.north);
      const south = Cesium.Math.toDegrees(rect.south);
      // Nível Mercator com resolução equivalente (um pouco mais fino para não perder detalhe)
      const z = Math.max(0, Math.min(MAX_Z, level + 2));
      const points = [];
      for (let r = 0; r < SIZE; r++) {
        const lat = north - ((north - south) * r) / (SIZE - 1);
        for (let c = 0; c < SIZE; c++) points.push({ lon: west + ((east - west) * c) / (SIZE - 1), lat });
      }
      const heights = await sampleHeights(points, z);
      // Oceanos: valores negativos (batimetria) ficam no nível do mar para não "afundar" a imagem
      return new Float32Array(heights.map((h) => Math.max(0, h)));
    },
  });
}
