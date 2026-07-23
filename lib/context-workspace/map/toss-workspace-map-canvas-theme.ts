/**
 * Toss Workspace 2D map palette — quiet paper, soft water, pins own attention.
 * Cleaner / lower chroma than generic Liberty defaults.
 */

export const TOSS_WORKSPACE_MAP_CANVAS = {
  /** Soft paper — Toss gray-50. */
  background: "#f7f8fa",
  /** Calm water — soft blue, not cyan. */
  waterFill: "#dceaf7",
  waterOpacity: 1,
  /** Parks — whisper green. */
  parkFill: "#e6f0e8",
  parkOpacity: 0.42,
  /** Residential / landuse — almost paper. */
  residentialFill: "#f3f4f6",
  /** Roads — white fill, hairline gray casing. */
  roadMinor: "#ffffff",
  roadMid: "#f0f2f5",
  roadMajor: "#e5e8ec",
  roadCasing: "#d5dae0",
  roadOpacity: 0.95,
  /** Buildings — flat pale, low contrast. */
  buildingFill: "#eceef2",
  buildingOpacity: 0.32,
  building3dOpacity: 0.22,
  /** Labels — barely there; pins win. */
  labelMuted: "#b0b8c1",
  waterLabel: "#9eb0c0",
  labelHalo: "rgba(255,255,255,0.95)",
} as const;

/** Extra Liberty noise — hide so Workspace pins read first. */
export const TOSS_WORKSPACE_HIDDEN_LAYERS = [
  "housenumber",
  "place_label",
  "place_city",
  "place_town",
  "place_village",
  "place_other",
  "place_hamlet",
  "place_suburb",
  "airport_label",
  "rail_station_label",
  "transit_stop_label",
  "park_outline",
  "boundary_country",
  "boundary_state",
  /** Extrusion is GPU-heavy on phones — keep flat building fill only. */
  "building-3d",
] as const;
