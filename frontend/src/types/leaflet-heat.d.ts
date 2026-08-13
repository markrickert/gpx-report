// leaflet.heat ships no types (and isn't on DefinitelyTyped in a usable
// form). It's a side-effect import that patches `L.heatLayer` onto the
// leaflet namespace, so declare just enough of its surface for the app's
// actual usage (see pages/Heatmap.tsx).
import "leaflet";

declare module "leaflet" {
  interface HeatLayerOptions {
    radius?: number;
    blur?: number;
    maxZoom?: number;
    minOpacity?: number;
    gradient?: Record<number, string>;
  }

  type HeatLatLngTuple = [number, number, number?] | any;

  class HeatLayer extends Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): this;
    addLatLng(latlng: HeatLatLngTuple): this;
    setOptions(options: HeatLayerOptions): this;
    redraw(): this;
    _reset(): void;
  }

  function heatLayer(latlngs: HeatLatLngTuple[], options?: HeatLayerOptions): HeatLayer;
}

declare module "leaflet.heat";
