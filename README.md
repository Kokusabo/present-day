# present day

An English-language dark ASCII site: an eye that follows the cursor, flowers,
tonight's real moon, power lines with crows under a white sky, an apartment
block in the snow.
There is no real content, only fragments.

All the graphics are drawn in code in real time. A scene is painted onto a small
canvas (one pixel = one character cell) and turned into characters every frame
(`js/ascii.js`). Each cell is supersampled, and the characters are picked by
how much ink they really put on screen in the loaded font, so gradients stay
smooth. No images, libraries or build step.

## Running it

Open `index.html` in a browser, or:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Files

| File | What it does |
|---|---|
| `index.html` | six parts: see, bloom, moon, wired, snow, ∅ |
| `css/style.css` | layout without boxes, scanlines, grain, vignette |
| `fonts/` | self-hosted Courier Prime and a Noto Serif JP subset, with their OFL licences |
| `favicon.svg` | the eye |
| `.nojekyll` | tells GitHub Pages to serve the files as they are |
| `js/ascii.js` | renderer: supersampling, font-calibrated ramp, edge characters |
| `js/scenes.js` | scenes: eye, bouquet, moon, wires, snow |
| `js/main.js` | boot screen, clock, terminal, player, hum, small eyes |

## Publishing on GitHub Pages

1. Create a public repository and upload everything in this folder, keeping
   the folders (`css/`, `js/`, `fonts/`) and `.nojekyll`.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder
   `/ (root)` → Save.
3. When the site is live, tick **Enforce HTTPS** on the same page.

## Security

The site is static: no server code, no database, no logins, no forms that send
anything anywhere, no cookies, no analytics. Nothing a visitor types (the
terminal) leaves the browser or is ever inserted as HTML.

- **Content Security Policy** (in `index.html`): the browser only runs
  scripts, styles and fonts from this site. Inline scripts, `eval`, external
  scripts, frames, plugins, forms and network requests are all refused, so
  even a malicious link or injected text cannot run code here.
- **No third parties**: fonts are served from `fonts/`, so the page makes no
  request to any other domain and leaks no visitor data.
- **`referrer` = `no-referrer`**: links out don't reveal where the visitor came from.

GitHub Pages cannot send custom HTTP headers, so `frame-ancestors` (blocking
other sites from embedding the page) is not available. The page has no
buttons that do anything harmful, so being embedded elsewhere is not a risk.

The real way in is the GitHub account itself:

- turn on two-factor authentication (Settings → Password and authentication);
- don't give anyone write access to the repository;
- optional: Settings → Rules → add a branch ruleset for `main` that blocks
  force pushes and deletion.
