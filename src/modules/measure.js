import * as Cesium from "cesium";
import { DrawSession, geodesicLength, sphericalArea } from "./draw.js";
import { formatArea, formatDistance, toast } from "./util.js";

export class MeasureTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.result = [];
    this.mode = "line";
  }

  clearResult() {
    for (const e of this.result) this.viewer.entities.remove(e);
    this.result = [];
  }

  text(positions, mouse) {
    const pts = mouse ? [...positions, mouse] : positions;
    const toggle = `<button id="measureMode" style="margin-right:8px">${this.mode === "line" ? "⬠ Medir área" : "〰️ Medir distância"}</button>`;
    if (this.mode === "line") {
      return `${toggle}📏 Distância: <b>${formatDistance(geodesicLength(pts))}</b> <span class="muted">· clique para adicionar pontos</span>`;
    }
    const closed = pts.length > 2 ? [...pts, pts[0]] : pts;
    return `${toggle}⬠ Área: <b>${formatArea(sphericalArea(pts))}</b> · Perímetro: <b>${formatDistance(geodesicLength(closed))}</b>`;
  }

  start(mode = this.mode) {
    this.mode = mode;
    this.clearResult();
    const session = new DrawSession(this.viewer, {
      mode,
      color: Cesium.Color.fromCssColorString("#fbbc04"),
      text: (p, m) => this.text(p, m),
      onFinish: (positions) => this.showResult(positions),
    });
    session.start();
    this.bindToggle(session);
    const observer = new MutationObserver(() => this.bindToggle(session));
    observer.observe(document.getElementById("toolText"), { childList: true });
    this.observer?.disconnect();
    this.observer = observer;
  }

  bindToggle(session) {
    const btn = document.getElementById("measureMode");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.onclick = (e) => {
        e.stopPropagation();
        session.cancel();
        this.start(this.mode === "line" ? "polygon" : "line");
      };
    }
  }

  showResult(positions) {
    this.observer?.disconnect();
    const color = Cesium.Color.fromCssColorString("#fbbc04");
    const closed = this.mode === "polygon" ? [...positions, positions[0]] : positions;
    this.result.push(this.viewer.entities.add({ polyline: { positions: closed, width: 3, material: color, clampToGround: true } }));
    let label;
    if (this.mode === "polygon") {
      this.result.push(this.viewer.entities.add({ polygon: { hierarchy: positions, material: color.withAlpha(0.25) } }));
      label = `${formatArea(sphericalArea(positions))}\n${formatDistance(geodesicLength(closed))}`;
    } else {
      label = formatDistance(geodesicLength(positions));
    }
    this.result.push(
      this.viewer.entities.add({
        position: positions[positions.length - 1],
        label: {
          text: label,
          font: "600 15px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    toast(`Resultado: ${label.replace("\n", " · perímetro ")}  (Esc limpa)`, 5000);
  }
}
