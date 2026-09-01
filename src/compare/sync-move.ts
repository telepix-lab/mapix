import { Map } from 'mapbox-gl';

/**
 * Synchronizes movement across the given maps and returns a cleanup function.
 *
 * The clones adopt the first map's camera immediately and then follow every
 * later move.
 *
 * @param maps Map instances (two or more recommended)
 * @returns cleanup function
 */
export function syncMove(...maps: Map[]): () => void {
  if (maps.length < 2) {
    console.warn('[syncMove] Expected at least two map instances.');
  }

  const fns: ((e?: unknown) => void)[] = [];

  maps.forEach((map, index) => {
    const others = maps.filter((_, i) => i !== index);
    fns[index] = () => {
      offAll();
      moveTo(map, others);
      onAll();
    };
  });

  function moveTo(master: Map, clones: Map[]) {
    const center = master.getCenter();
    const zoom = master.getZoom();
    const bearing = master.getBearing();
    const pitch = master.getPitch();
    // Padding is camera state, not a rendering detail: it shifts the
    // projection centre, so the same `center` renders at a different screen
    // position on a map padded differently. Two maps meant to sit exactly on
    // top of each other drift apart by roughly the padding difference:
    // hundreds of pixels for a viewport-sized UI panel.
    const padding = master.getPadding();

    clones.forEach((clone) => {
      clone.jumpTo({
        center,
        zoom,
        bearing,
        pitch,
        padding,
      });
    });
  }

  function onAll() {
    maps.forEach((map, index) => {
      map.on('move', fns[index]);
    });
  }

  function offAll() {
    maps.forEach((map, index) => {
      map.off('move', fns[index]);
    });
  }

  // Align the clones once before any handler exists. `moveTo` otherwise runs
  // only from inside those handlers, so a clone constructed elsewhere stays
  // where it is until the master happens to move. A view that opens the
  // comparison after its camera flight has already finished never gets that
  // move. Doing it here rather than after `onAll` also keeps the jump from
  // propagating back into the master through the sync being set up.
  if (maps.length > 0) {
    moveTo(maps[0], maps.slice(1));
  }

  onAll();

  return () => {
    offAll();
    fns.length = 0;
    maps.length = 0;
  };
}
