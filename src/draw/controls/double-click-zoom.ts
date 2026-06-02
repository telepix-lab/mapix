import type { DoubleClickZoomControl, DrawCustomModeThis } from '../../types';

export const doubleClickZoom: DoubleClickZoomControl = {
  enable(ctx: DrawCustomModeThis) {
    setTimeout(() => {
      if (!ctx.drawConfig.displayControlsDefault) return;
      ctx.map.doubleClickZoom.enable();
    }, 0);
  },
  disable(ctx: DrawCustomModeThis) {
    setTimeout(() => {
      ctx.map.doubleClickZoom.disable();
    }, 0);
  },
};
