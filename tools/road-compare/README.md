# Road comparer

Open `tools/road-compare/index.html` in a browser (double-click, no server needed). Left: the original road tiles from `tileset.png`;
right: roads redrawn as vector paths (asphalt, curbs, lane dashes, crosswalks) with measurements taken from the tileset. Drag to pan, wheel or
slider to zoom, checkboxes toggle the details, the corner-radius slider changes how round the road bends are.

`layout.js` holds the sample network and the original tile indices; regenerate it with `npx tsx tools/road-compare/gen-layout.mts`.
