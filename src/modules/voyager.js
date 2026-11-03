import * as Cesium from "cesium";
import { LUCKY_PLACES, TOURS } from "../data/voyager.js";
import { escapeHtml, flyToPlace, toast } from "./util.js";

export class Voyager {
  constructor(viewer, { knowledge }) {
    this.viewer = viewer;
    this.knowledge = knowledge;
    this.playing = null;
    this.render();
  }

  render() {
    const host = document.getElementById("voyagerTours");
    host.innerHTML = "";
    for (const tour of TOURS) {
      const el = document.createElement("div");
      el.className = "tour";
      el.innerHTML = `<div class="tour-head"><h4>${escapeHtml(tour.title)}</h4><p>${escapeHtml(tour.desc)} · ${tour.stops.length} paradas</p></div>
        <div class="toolbar"><button data-act="play">▶ Iniciar passeio</button><button data-act="list">☰ Paradas</button></div>
        <ul class="list small" hidden></ul>`;
      const ul = el.querySelector("ul");
      tour.stops.forEach((stop, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="muted">${i + 1}</span><span class="grow"><span class="title">${escapeHtml(stop.name)}</span></span>`;
        li.addEventListener("click", () => this.visit(stop));
        ul.appendChild(li);
      });
      el.querySelector('[data-act="play"]').addEventListener("click", (e) => this.toggleTour(tour, e.target));
      el.querySelector('[data-act="list"]').addEventListener("click", () => (ul.hidden = !ul.hidden));
      host.appendChild(el);
    }
  }

  async visit(stop) {
    this.knowledge.showWiki(stop.wiki ?? stop.name, stop.lat, stop.lon);
    return flyToPlace(this.viewer, stop, { duration: 4 });
  }

  /** Gira lentamente ao redor do ponto central (efeito do passeio). */
  orbit(seconds) {
    return new Promise((resolve) => {
      const start = performance.now();
      const camera = this.viewer.camera;
      const canvas = this.viewer.scene.canvas;
      const ray = camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      const center = this.viewer.scene.globe.pick(ray, this.viewer.scene);
      if (!center) return setTimeout(resolve, seconds * 1000);
      const range = Cesium.Cartesian3.distance(camera.positionWC, center);
      const pitch = camera.pitch;
      let heading = camera.heading;
      let last = start;
      const tick = () => {
        if (!this.playing) {
          camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          return resolve();
        }
        const now = performance.now();
        heading += ((now - last) / 1000) * Cesium.Math.toRadians(6);
        last = now;
        camera.lookAt(center, new Cesium.HeadingPitchRange(heading, pitch, range));
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else {
          camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async toggleTour(tour, button) {
    if (this.playing) {
      this.playing = null;
      document.querySelectorAll('[data-act="play"]').forEach((b) => (b.textContent = "▶ Iniciar passeio"));
      return;
    }
    const token = {};
    this.playing = token;
    button.textContent = "■ Parar passeio";
    toast(`Passeio: ${tour.title}`);
    for (const stop of tour.stops) {
      if (this.playing !== token) break;
      await this.visit(stop);
      if (this.playing !== token) break;
      await this.orbit(7);
    }
    if (this.playing === token) this.playing = null;
    button.textContent = "▶ Iniciar passeio";
  }

  stop() {
    this.playing = null;
  }

  lucky() {
    const place = LUCKY_PLACES[Math.floor(Math.random() * LUCKY_PLACES.length)];
    toast(`🎲 ${place.name}`);
    this.visit(place);
  }
}
