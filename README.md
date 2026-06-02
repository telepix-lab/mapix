# @telepix-lab/mapix

A [mapbox-gl](https://github.com/mapbox/mapbox-gl-js) toolkit for building
area-of-interest (AOI) workflows:

- **Draw modes** for `@mapbox/mapbox-gl-draw`: rectangle and freehand polygon
  with real-time self-intersection detection, plus a `direct_select` variant
  that validates edits.
- **Compare slider** to swipe between two synchronized maps.
- **File parsing** for GeoJSON, KML, and Shapefile (`.zip`) into a normalized
  polygon `FeatureCollection`, with automatic structural corrections.
- Small helpers: area formatting, AOI style constants, source/layer cleanup.

> **Status:** `0.x`. The public API may change between minor versions until
> `1.0`.

## Compatibility

| Feature | mapbox-gl v3 | MapLibre GL |
| --- | --- | --- |
| Draw modes | ✅ | ❌ not supported¹ |
| Compare slider | ✅ | ❌ (uses `mapbox-gl` types) |
| File parsing (`parseFile`, `countVertices`) | ✅ engine-agnostic | ✅ engine-agnostic |

¹ The draw modes build on `@mapbox/mapbox-gl-draw`, whose default theme uses a
`line-dasharray` literal that MapLibre rejects. Engine-neutral drawing is on the
`1.0` roadmap. File parsing has no engine dependency and works anywhere.

## Install

```bash
pnpm add @telepix-lab/mapix
# peer dependencies
pnpm add mapbox-gl @mapbox/mapbox-gl-draw
```

Peer dependencies:

| Package | Range |
| --- | --- |
| `mapbox-gl` | `^3.0.0` |
| `@mapbox/mapbox-gl-draw` | `^1.4.0` |

## Usage

### Draw modes

```ts
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import {
  DrawPolygon,
  DrawRectangle,
  DirectSelectWithIntersection,
} from '@telepix-lab/mapix';

const draw = new MapboxDraw({
  displayControlsDefault: false,
  modes: {
    ...MapboxDraw.modes,
    draw_polygon: DrawPolygon,
    draw_rectangle: DrawRectangle,
    direct_select: DirectSelectWithIntersection,
  },
});

map.addControl(draw);

// Optional vertex cap is injected per mode entry.
draw.changeMode('draw_polygon', { maxVertices: 1000 });
```

Rectangle drawing supports modifier keys while dragging: `Shift` (square),
`Alt`/`Option` (draw from center), `Space` (move), and `Ctrl/Cmd+Z` /
`Ctrl/Cmd+Shift+Z` (undo / redo).

### Compare slider

```ts
import { Compare } from '@telepix-lab/mapix';

const compare = new Compare(beforeMap, afterMap, '#comparison-container', {
  orientation: 'vertical', // or 'horizontal'
});

compare.on('slideend', (e) => {
  console.log('slider position:', e.currentPosition);
});

// later
compare.remove();
```

### File parsing

```ts
import {
  parseFile,
  countVertices,
  SUPPORTED_FILE_ACCEPT, // ".geojson,.json,.kml,.shp,.zip"
} from '@telepix-lab/mapix';

const result = await parseFile(file);

if (result.success && result.data) {
  // result.data is a GeoJSON FeatureCollection of Polygon / MultiPolygon
  const vertexCount = countVertices(result.data);
  // result.correction (optional) signals an applied structural fix
} else {
  // result.errorCode is a stable machine code; map it to your own i18n.
  console.error(result.errorCode, result.error);
}
```

The library handles parsing and structural validation only. Upload policy
(file size, vertex limits, etc.) is the consumer's responsibility; use
`countVertices` to enforce your own limits.

### Area formatting

```ts
import { formatArea } from '@telepix-lab/mapix';

formatArea(8500); // { value: '8,500', unit: 'm²' }
formatArea(12345); // { value: '0.01', unit: 'km²' }
formatArea(8500, { thresholdSquareMeters: 1000 }); // switch unit earlier
```

## API

- Draw modes: `DrawPolygon`, `DrawRectangle`, `DirectSelectWithIntersection`
- Compare: `Compare`
- File: `parseFile`, `getSupportedFileType`, `SUPPORTED_FILE_ACCEPT`,
  `countVertices`
- Geometry utils: `isRectangle`, `getPolygonInfo`, `getOppositeVertexIndex`,
  `scalePolygonFromVertex`, `constrainToRectangle`
- Formatting: `formatArea`
- Style constants: `AOI_FILL_COLOR`, `AOI_FILL_OPACITY`, `AOI_LINE_COLOR`,
  `AOI_LINE_WIDTH`
- Map helpers: `removeLayerIfExists`, `removeSourceIfExists`

Types for all of the above are exported, including the GeoJSON types
(`Feature`, `FeatureCollection`, `Polygon`, `MultiPolygon`, `Position`)
re-exported for convenience.

## License

MIT © TelePIX
