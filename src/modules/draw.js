import * as Cesium from "cesium";
import { pickCartesian, toolState } from "./util.js";

const toolBar = () => document.getElementById("toolBar");

/**
 * Sessão de desenho interativo (ponto, linha ou polígono) usada por Projetos e pela Régua.
 * Cliques adicionam vértices, duplo clique / "Concluir" termina, Esc / "Cancelar" aborta.
 */
export class DrawSession {
  constructor(viewer, { mode, color = Cesium.Color.YELLOW, text, onChange, onFinish, onCancel }) {
    this.viewer = viewer;
    this.mode = mode;
    this.color = color;
    this.positions = [];
    this.mouse = null;
    this.text = text;
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.onCancel = onCancel;
    this.entities = [];
  }

  start() {
    if (toolState.active) toolState.active.cancel();
    toolState.active = this;
    const v = this.viewer;
    this.handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    this.handler.setInputAction((e) => this.addPoint(e.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction(() => this.finish(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.handler.setInputAction((e) => {
      this.mouse = pickCartesian(v, e.endPosition) ?? this.mouse;
      if (this.positions.length) this.changed();
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => {
      this.positions.pop();
      this.changed();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    const dynamic = () => (this.mouse && this.mode !== "point" ? [...this.positions, this.mouse] : this.positions);
    if (this.mode !== "point") {
      this.entities.push(
        v.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const p = dynamic();
              return this.mode === "polygon" && p.length > 2 ? [...p, p[0]] : p;
            }, false),
            width: 3,
            material: this.color,
            clampToGround: true,
          },
        }),
      );
    }
    if (this.mode === "polygon") {
      this.entities.push(
        v.entities.add({
          polygon: {
            hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(dynamic()), false),
            material: this.color.withAlpha(0.3),
          },
        }),
      );
    }
    this.vertexEntities = [];
    v.scene.canvas.style.cursor = "crosshair";
    this.showBar();
  }

  showBar() {
    const bar = toolBar();
    bar.hidden = false;
    document.getElementById("toolText").innerHTML = this.text?.(this.positions, this.mouse) ?? "";
    document.getElementById("toolFinish").hidden = this.mode === "point";
    document.getElementById("toolFinish").onclick = () => this.finish();
    document.getElementById("toolCancel").onclick = () => this.cancel();
  }

  addPoint(screenPos) {
    const p = pickCartesian(this.viewer, screenPos);
    if (!p) return;
    const last = this.positions[this.positions.length - 1];
    if (last && Cesium.Cartesian3.distance(last, p) < 0.01) return;
    this.positions.push(p);
    this.vertexEntities.push(
      this.viewer.entities.add({
        position: p,
        point: { pixelSize: 8, color: Cesium.Color.WHITE, outlineColor: this.color, outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }),
    );
    this.changed();
    if (this.mode === "point") this.finish();
  }

  changed() {
    // Remove marcadores de vértices órfãos (após clique direito)
    while (this.vertexEntities.length > this.positions.length) this.viewer.entities.remove(this.vertexEntities.pop());
    document.getElementById("toolText").innerHTML = this.text?.(this.positions, this.mouse) ?? "";
    this.onChange?.(this.positions, this.mouse);
    this.viewer.scene.requestRender();
  }

  cleanup() {
    this.handler?.destroy();
    for (const e of [...this.entities, ...this.vertexEntities]) this.viewer.entities.remove(e);
    this.viewer.scene.canvas.style.cursor = "";
    if (toolState.active === this) toolState.active = null;
    toolBar().hidden = true;
  }

  finish() {
    const min = this.mode === "polygon" ? 3 : this.mode === "line" ? 2 : 1;
    const positions = [...this.positions];
    this.cleanup();
    if (positions.length >= min) this.onFinish?.(positions);
    else this.onCancel?.();
  }

  cancel() {
    this.cleanup();
    this.onCancel?.();
  }
}

export function geodesicLength(positions) {
  let total = 0;
  const g = new Cesium.EllipsoidGeodesic();
  for (let i = 1; i < positions.length; i++) {
    g.setEndPoints(Cesium.Cartographic.fromCartesian(positions[i - 1]), Cesium.Cartographic.fromCartesian(positions[i]));
    total += g.surfaceDistance;
  }
  return total;
}

/** Área de um polígono sobre a esfera (m²). */
export function sphericalArea(positions) {
  if (positions.length < 3) return 0;
  const R = 6371008.8;
  const pts = positions.map((p) => Cesium.Cartographic.fromCartesian(p));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    let dLon = b.longitude - a.longitude;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    if (dLon < -Math.PI) dLon += 2 * Math.PI;
    sum += dLon * (2 + Math.sin(a.latitude) + Math.sin(b.latitude));
  }
  return Math.abs((sum * R * R) / 2);
}
