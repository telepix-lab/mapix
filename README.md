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
  minRatio: 0.2, // keep at least 20% for each side (default 0)
  initialRatio: 0.35, // where the divider starts (default 0.5)
});

compare.getPosition(); // px along the split axis
compare.setPosition(240); // clamped to the bounds

compare.on('slideend', (e) => {
  console.log('slider position:', e.currentPosition);
});

// later
compare.remove();
```

`minRatio` reserves the same share at both ends. A layout obstructed on one side
only, a panel over the left half say, can set the two ends independently with
`bounds`, which supersedes `minRatio` when both are given:

```ts
new Compare(beforeMap, afterMap, container, {
  bounds: { min: 0.25, max: 0.95 }, // ratios of the container extent
  initialRatio: 0.6,
});
```

Positions are px offsets from the container's start edge (left for a vertical
split, top for a horizontal one). `setPosition` clamps to the bounds and fires
no event, since `slideend` reports the end of a user gesture and a caller moving
the divider already knows where it put it. Prefer `initialRatio` over a
`setPosition` call straight after construction, so the divider does not show at
the centre for a frame first.

The divider is driven by Pointer Events, so mouse, touch and pen all work
through one path. The handle captures the pointer on press: the drag survives
the cursor leaving the handle, a second pointer can neither take it over nor end
it, and only a primary press starts one. The handle is given
`touch-action: none` inline so the browser does not claim touch drags for
panning.

`remove()` writes back the inline styles each map container had at construction
time and drops every listener the slider added, so a map reused elsewhere
(typically the "before" map) is left as it was found — even if removal happens
mid-drag. Resizing the container keeps the current split ratio rather than the
pixel offset, including across a resize to zero size (a hidden tab or panel).

The two maps are camera-synced for the lifetime of the instance. The second map
adopts the first one's camera at construction, so it does not have to be created
already pointing at the right place. `padding` travels with the rest of the
camera: padding shifts the projection centre, so two maps holding the same
`center` under different padding would render it at different screen positions.
Pad the "before" map to keep a UI panel off the subject and the "after" map
follows.

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
- Geometry utils: `isRectangle`, `isRectangleGeometry`, `getPolygonInfo`,
  `getOppositeVertexIndex`, `scalePolygonFromVertex`, `constrainToRectangle`
- Formatting: `formatArea`
- Style constants: `AOI_FILL_COLOR`, `AOI_FILL_OPACITY`, `AOI_LINE_COLOR`,
  `AOI_LINE_WIDTH`
- Map helpers: `removeLayerIfExists`, `removeSourceIfExists`

Types for all of the above are exported, including the GeoJSON types
(`Feature`, `FeatureCollection`, `Polygon`, `MultiPolygon`, `Position`, and the
`PointFeature` alias for `Feature<Point>`) re-exported for convenience.

## License

MIT © TelePIX
