// leaflet-rotate (see ActivityDetail.jsx) is a classic non-bundled Leaflet
// plugin: its own modules never `import` Leaflet, they just patch the bare
// global `L` (e.g. `L.Map.mergeOptions(...)`). Vite's ESM build of the
// `leaflet` package never touches `window`, so nothing puts `L` there for
// it to find. This module's only job is to do that before leaflet-rotate's
// module code runs.
//
// This only works because it's a *separate* module imported before
// "leaflet-rotate" (see ActivityDetail.jsx): ES module evaluation runs each
// import's own top-level code only after that import's own dependencies
// have fully evaluated, so splitting the `window.L = L` assignment out into
// its own file (whose only dependency is "leaflet") guarantees it runs
// before leaflet-rotate is evaluated. Doing `import L from "leaflet"; window.L
// = L; import "leaflet-rotate";` in one file would NOT work, since import
// declarations in a single file all evaluate before any of that file's own
// top-level statements run.
import L from "leaflet";

window.L = L;
