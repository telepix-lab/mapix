/**
 * TileJSON response type.
 * @see https://github.com/mapbox/tilejson-spec
 */
export interface TileJsonResponse {
  tiles: string[];
  attribution?: string;
  bounds?: [number, number, number, number];
}
