/**
 * Common helpers for manipulating a mapbox-gl Map instance.
 *
 * Removes a source/layer only if one with that id is already registered.
 * `removeLayer` / `removeSource` throw when called with a non-existent id, so
 * callers would otherwise have to guard every time. These wrap that guard into
 * one line to keep caller `if` chains readable.
 */

import type { Map } from 'mapbox-gl';

export const removeLayerIfExists = (map: Map, id: string): void => {
  if (map.getLayer(id)) map.removeLayer(id);
};

export const removeSourceIfExists = (map: Map, id: string): void => {
  if (map.getSource(id)) map.removeSource(id);
};
