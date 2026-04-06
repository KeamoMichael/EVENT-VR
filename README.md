# Event Venue — 360° VR Tour

## How to use

1. Place your 3 rendered equirectangular panorama images inside `/images/`:
   - `pano_view1.png` — Arrival / Overview angle
   - `pano_view2.png` — Marquee Exterior angle
   - `pano_view3.png` — Overflow Lounge angle

2. Open `index.html` in a browser (use a local server for best results):
   ```
   npx serve .
   # or
   python3 -m http.server 8080
   ```

3. Open in browser: http://localhost:8080

## Tuning hotspot arrow positions

Each floor arrow is positioned using `yaw` and `pitch` values in `js/scenes.js`.

To find the right yaw for each arrow:
1. Open the browser console (F12)
2. Type: `window.DEBUG_YAW = true`
3. Look around in the viewer — current yaw is logged every 500ms
4. Look toward the destination (e.g. toward the marquee entrance)
5. Note the yaw value and copy it into scenes.js for that hotspot

## Controls
- **Drag** to look around
- **Scroll** to zoom in/out
- **Click floor arrows** to walk to next location (motion blur transition)
- **← →** buttons or keyboard arrows to cycle scenes
- **F** key or ⛶ button for fullscreen
- **Side menu** or **dot strip** to jump to any scene directly

## File structure
```
/
├── index.html
├── css/style.css
├── js/
│   ├── scenes.js   ← EDIT THIS to configure scenes and hotspots
│   └── viewer.js   ← Engine (no need to edit)
└── images/
    ├── pano_view1.png
    ├── pano_view2.png
    └── pano_view3.png
```
