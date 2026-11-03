import * as Cesium from "cesium";
import { formatAltitude, formatLatLon, pickCartesian, screenCenter, settings, toast, toDegrees } from "./util.js";

const HOME = { lon: -50, lat: -15, height: 2.2e7 };

export class Navigation {
  constructor(viewer) {
    this.viewer = viewer;
    this.flying = false;
    this.keys = new Set();
    this.flySpeed = 0;
    this.bindControls();
    this.bindStatus();
    this.bindFlyMode();
    viewer.camera.moveEnd.addEventListener(() => this.writeHash());
  }

  /** Gira/inclina a câmera ao redor do ponto central da tela. */
  orbitTo(heading, pitch, duration = 0.9) {
    const camera = this.viewer.camera;
    const center = screenCenter(this.viewer);
    if (!center) {
      camera.setView({ orientation: { heading, pitch, roll: 0 } });
      return;
    }
    const range = Cesium.Cartesian3.distance(camera.positionWC, center);
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), {
      offset: new Cesium.HeadingPitchRange(heading, pitch, range),
      duration,
    });
  }

  north() {
    this.orbitTo(0, this.viewer.camera.pitch);
  }

  toggleTilt() {
    const pitch = this.viewer.camera.pitch;
    const topDown = pitch < Cesium.Math.toRadians(-80);
    this.orbitTo(this.viewer.camera.heading, Cesium.Math.toRadians(topDown ? -40 : -90));
  }

  zoom(factor) {
    const camera = this.viewer.camera;
    const h = Math.max(camera.positionCartographic.height, 50);
    if (factor > 0) camera.zoomIn(h * factor);
    else camera.zoomOut(h * -factor);
  }

  home() {
    this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height), duration: settings.flySpeed });
  }

  myLocation() {
    if (!navigator.geolocation) return toast("Geolocalização não suportada pelo navegador.");
    toast("Obtendo sua localização…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        this.viewer.entities.removeById("my-location");
        this.viewer.entities.add({
          id: "my-location",
          name: "Você está aqui",
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#4285f4"), outlineColor: Cesium.Color.WHITE, outlineWidth: 3,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          ellipse: { semiMajorAxis: accuracy, semiMinorAxis: accuracy, material: Cesium.Color.fromCssColorString("#4285f4").withAlpha(0.15) },
        });
        this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(1500, accuracy * 6)), duration: settings.flySpeed });
      },
      (err) => toast("Não foi possível obter a localização: " + err.message, 4000),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  bindControls() {
    const $ = (id) => document.getElementById(id);
    $("compass").addEventListener("click", () => this.north());
    $("tiltBtn").addEventListener("click", () => this.toggleTilt());
    $("zoomIn").addEventListener("click", () => this.zoom(0.5));
    $("zoomOut").addEventListener("click", () => this.zoom(-1));
    $("homeBtn").addEventListener("click", () => this.home());
    $("myLocation").addEventListener("click", () => this.myLocation());
    $("fullscreenBtn").addEventListener("click", () => this.fullscreen());

    const needle = $("compassNeedle");
    const tilt = $("tiltBtn");
    let lastHeading = null;
    let lastTilt = null;
    this.viewer.scene.postRender.addEventListener(() => {
      const cam = this.viewer.camera;
      const deg = Math.round(Cesium.Math.toDegrees(cam.heading));
      if (deg !== lastHeading) {
        needle.style.transform = `rotate(${-90 - deg}deg)`;
        lastHeading = deg;
      }
      const t = cam.pitch < Cesium.Math.toRadians(-80) ? "2D" : "3D";
      if (t !== lastTilt) {
        tilt.textContent = t;
        lastTilt = t;
      }
    });
  }

  bindStatus() {
    const coordsEl = document.getElementById("statusCoords");
    const elevEl = document.getElementById("statusElev");
    const camEl = document.getElementById("statusCam");
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    let pending = false;
    handler.setInputAction((e) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const cart = pickCartesian(this.viewer, e.endPosition);
        if (!cart) {
          coordsEl.textContent = "—";
          elevEl.textContent = "";
          return;
        }
        const d = toDegrees(cart);
        coordsEl.textContent = `${formatLatLon(d.lat, d.lon)}  (${d.lat.toFixed(5)}, ${d.lon.toFixed(5)})`;
        const h = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(d.lon, d.lat)) ?? d.height;
        elevEl.textContent = `Elevação ${formatAltitude(h ?? 0)}`;
      });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.viewer.camera.changed.addEventListener(() => {
      camEl.textContent = `Câmera ${formatAltitude(this.viewer.camera.positionCartographic.height)}`;
    });
    this.viewer.camera.percentageChanged = 0.01;
  }

  bindFlyMode() {
    const hud = document.getElementById("flyHud");
    const hudSpeed = document.getElementById("flySpeedHud");
    document.addEventListener("keydown", (e) => this.flying && this.keys.add(e.key.toLowerCase()));
    document.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    let last = performance.now();
    this.viewer.scene.preRender.addEventListener(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.flying) return;
      const cam = this.viewer.camera;
      const k = this.keys;
      const height = cam.positionCartographic.height;
      const accel = Math.max(20, height * 0.6);
      if (k.has("w")) this.flySpeed += accel * dt;
      if (k.has("s")) this.flySpeed = Math.max(0, this.flySpeed - accel * dt * 1.5);
      if (k.has("a")) cam.setView({ orientation: { heading: cam.heading - 0.9 * dt, pitch: cam.pitch, roll: 0 } });
      if (k.has("d")) cam.setView({ orientation: { heading: cam.heading + 0.9 * dt, pitch: cam.pitch, roll: 0 } });
      if (k.has("arrowup")) cam.lookUp(0.7 * dt);
      if (k.has("arrowdown")) cam.lookDown(0.7 * dt);
      if (k.has("arrowleft")) cam.lookLeft(0.7 * dt);
      if (k.has("arrowright")) cam.lookRight(0.7 * dt);
      if (k.has("q")) cam.moveUp(Math.max(5, height * 0.8) * dt);
      if (k.has("e")) cam.moveDown(Math.max(5, height * 0.8) * dt);
      cam.moveForward(this.flySpeed * dt);
      // Não deixa atravessar o chão
      const ground = this.viewer.scene.globe.getHeight(cam.positionCartographic) ?? 0;
      if (cam.positionCartographic.height < ground + 10) cam.moveUp(ground + 10 - cam.positionCartographic.height);
      hudSpeed.textContent = Math.round(this.flySpeed * 3.6).toLocaleString("pt-BR");
    });
    this.toggleFly = () => {
      this.flying = !this.flying;
      this.flySpeed = 0;
      this.keys.clear();
      hud.hidden = !this.flying;
      if (this.flying) {
        const cam = this.viewer.camera;
        cam.setView({ orientation: { heading: cam.heading, pitch: Cesium.Math.toRadians(-10), roll: 0 } });
        toast("Modo voo: W acelera, S freia, A/D vira, Q/E sobe/desce, setas olham.", 4500);
      }
    };
  }

  writeHash() {
    const c = this.viewer.camera;
    const p = c.positionCartographic;
    const hash = `#@${Cesium.Math.toDegrees(p.latitude).toFixed(6)},${Cesium.Math.toDegrees(p.longitude).toFixed(6)},${Math.round(p.height)}a,${Cesium.Math.toDegrees(c.heading).toFixed(1)}h,${Cesium.Math.toDegrees(c.pitch).toFixed(1)}t`;
    history.replaceState(null, "", hash);
  }

  readHash() {
    const m = location.hash.match(/^#@(-?[\d.]+),(-?[\d.]+),(\d+)a(?:,(-?[\d.]+)h)?(?:,(-?[\d.]+)t)?/);
    if (!m) return false;
    const [, lat, lon, h, heading = 0, pitch = -90] = m;
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), Number(h)),
      orientation: { heading: Cesium.Math.toRadians(Number(heading)), pitch: Cesium.Math.toRadians(Number(pitch)), roll: 0 },
    });
    return true;
  }

  async share() {
    this.writeHash();
    const url = location.href;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "GGEarth", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link desta vista copiado!");
      }
    } catch {
      toast(url, 6000);
    }
  }

  screenshot() {
    const scene = this.viewer.scene;
    const remove = scene.postRender.addEventListener(() => {
      remove();
      scene.canvas.toBlob((blob) => {
        if (!blob) return toast("Não foi possível capturar a imagem.");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `ggearth-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast("Imagem salva.");
      }, "image/png");
    });
    scene.requestRender();
  }
}
