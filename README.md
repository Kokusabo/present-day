# present day

An English-language dark ASCII site: an eye that follows the cursor, flowers,
two original girls (a doll silhouetted against the moon and a listener in
headphones), power lines under a white sky, an apartment block in the snow.
There is no real content, only fragments.

All the graphics are drawn in code in real time. A scene is painted onto a small
canvas (one pixel = one character cell) and turned into characters every frame
(`js/ascii.js`). Contours can also be "inked" straight into cells as
`/ | \ _ -`, so line drawings stay crisp. No images, libraries or build step.

## Running it

Open `index.html` in a browser, or:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Files

| File | What it does |
|---|---|
| `index.html` | six parts: see, bloom, doll, wired, snow, ∅ |
| `css/style.css` | layout without boxes, scanlines, grain, vignette; Courier Prime + Noto Serif JP |
| `js/ascii.js` | renderer: brightness → character density, inked lines, masking |
| `js/scenes.js` | scenes: eye, bouquet, moon, doll, listener, wires, snow |
| `js/main.js` | boot screen, clock, terminal, player, hum, small eyes |
