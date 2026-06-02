import { Map } from 'mapbox-gl';

/**
 * Synchronizes movement across the given maps and returns a cleanup function.
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

    clones.forEach((clone) => {
      clone.jumpTo({
        center,
        zoom,
        bearing,
        pitch,
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

  // Activate initial sync
  onAll();

  return () => {
    offAll();
    fns.length = 0;
    maps.length = 0;
  };
}
