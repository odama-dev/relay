import "server-only";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { COUNTRY_POINTS } from "@/lib/geo/pure";

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 440;

export type WorldMap = {
  countries: { name: string; d: string }[];
  points: Record<string, [number, number]>;
};

let cached: WorldMap | null = null;

/** Country outlines as SVG paths (Natural Earth projection, Antarctica left out), built once per server. */
export function worldMap(): WorldMap {
  if (cached) return cached;
  const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const all = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
  const land = { ...all, features: all.features.filter((f) => f.properties.name !== "Antarctica") };
  const projection = geoNaturalEarth1().fitSize([MAP_WIDTH, MAP_HEIGHT], land);
  const path = geoPath(projection).digits(1);
  cached = {
    countries: land.features.map((f) => ({ name: f.properties.name, d: path(f) ?? "" })).filter((c) => c.d),
    points: Object.fromEntries(Object.entries(COUNTRY_POINTS).map(([name, lonLat]) => [name, projection(lonLat) as [number, number]])),
  };
  return cached;
}
