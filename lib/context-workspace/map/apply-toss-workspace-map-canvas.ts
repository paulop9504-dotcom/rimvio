/**
 * Toss-style 2D Workspace map canvas — cleaner paper, soft water, quiet roads.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { applyRimvioVectorMapCanvas } from "@/lib/globe/apply-rimvio-vector-map-canvas";
import {
  isRimvioVectorRoadLayerId,
  RIMVIO_VECTOR_GREEN_FILL_LAYERS,
  RIMVIO_VECTOR_MUTED_LABEL_LAYERS,
  RIMVIO_VECTOR_WATER_LINE_LAYERS,
} from "@/lib/globe/rimvio-vector-map-canvas-theme";
import {
  TOSS_WORKSPACE_HIDDEN_LAYERS,
  TOSS_WORKSPACE_MAP_CANVAS as C,
} from "@/lib/context-workspace/map/toss-workspace-map-canvas-theme";

function hideLayer(map: MapLibreMap, layerId: string): void {
  if (!map.getLayer(layerId)) {
    return;
  }
  map.setLayoutProperty(layerId, "visibility", "none");
}

function setPaint(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (!map.getLayer(layerId)) {
    return;
  }
  map.setPaintProperty(layerId, property, value);
}

function roadColor(layerId: string): string {
  if (layerId.includes("_casing")) {
    return C.roadCasing;
  }
  if (
    layerId.includes("motorway") ||
    layerId.includes("trunk") ||
    layerId.includes("primary")
  ) {
    return C.roadMajor;
  }
  if (
    layerId.includes("secondary") ||
    layerId.includes("tertiary") ||
    layerId.includes("rail") ||
    layerId.includes("transit")
  ) {
    return C.roadMid;
  }
  return C.roadMinor;
}

/**
 * Apply Rimvio quiet base + Toss Workspace polish
 * (softer paper · cleaner water · muted labels · hide POI clutter).
 */
export function applyTossWorkspaceMapCanvas(map: MapLibreMap): void {
  applyRimvioVectorMapCanvas(map);

  setPaint(map, "background", "background-color", C.background);

  setPaint(map, "water", "fill-color", C.waterFill);
  setPaint(map, "water", "fill-opacity", C.waterOpacity);
  setPaint(map, "water", "fill-outline-color", "rgba(0,0,0,0)");
  for (const layerId of RIMVIO_VECTOR_WATER_LINE_LAYERS) {
    setPaint(map, layerId, "line-color", C.waterFill);
    setPaint(map, layerId, "line-opacity", 0.7);
  }

  for (const layerId of RIMVIO_VECTOR_GREEN_FILL_LAYERS) {
    setPaint(map, layerId, "fill-color", C.parkFill);
    setPaint(map, layerId, "fill-opacity", C.parkOpacity);
    setPaint(map, layerId, "fill-outline-color", "rgba(0,0,0,0)");
  }

  setPaint(map, "landuse_residential", "fill-color", C.residentialFill);
  setPaint(map, "landuse_residential", "fill-opacity", 0.85);

  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "line" || !isRimvioVectorRoadLayerId(layer.id)) {
      continue;
    }
    setPaint(map, layer.id, "line-color", roadColor(layer.id));
    setPaint(map, layer.id, "line-opacity", C.roadOpacity);
  }

  setPaint(map, "building", "fill-color", C.buildingFill);
  setPaint(map, "building", "fill-opacity", C.buildingOpacity);
  setPaint(map, "building", "fill-outline-color", "rgba(0,0,0,0)");
  hideLayer(map, "building-3d");

  for (const layerId of RIMVIO_VECTOR_MUTED_LABEL_LAYERS) {
    const isWater = layerId.startsWith("water");
    setPaint(
      map,
      layerId,
      "text-color",
      isWater ? C.waterLabel : C.labelMuted,
    );
    setPaint(map, layerId, "text-halo-color", C.labelHalo);
    setPaint(map, layerId, "text-halo-width", 1.2);
    setPaint(map, layerId, "text-opacity", 0.72);
  }

  for (const layerId of TOSS_WORKSPACE_HIDDEN_LAYERS) {
    hideLayer(map, layerId);
  }

  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if (
      id.startsWith("poi") ||
      id.startsWith("place_") ||
      id.includes("shield") ||
      id.includes("housenumber") ||
      id.includes("housenum") ||
      id.includes("boundary")
    ) {
      hideLayer(map, id);
    }
  }
}
