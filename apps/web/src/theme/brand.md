# Dalmia Polypro — sampled brand tokens

- **Source:** https://www.dalmiapolypro.in (Wix site, home page, title "Waste Management Company In India - Dalmia Polypro")
- **Date sampled:** 2026-09-21
- **Status:** every value below is **sampled** from the live site unless it is explicitly marked *derived*, *from theme palette (not rendered)* or *given*.

## Method

1. Playwright 1.x driving the locally installed Google Chrome (`channel: 'chrome'`, headless, viewport 1440x900, desktop Chrome UA, `--disable-blink-features=AutomationControlled`). Playwright's bundled Chromium could not be downloaded (the machine's DNS intermittently failed for `cdn.playwright.dev`), so system Chrome was used instead; the site itself loaded normally, no bot blocking.
2. Waited for `load` + `networkidle` + 2.5 s, scrolled the page in 600 px steps to trigger lazy content, scrolled back to top.
3. Read `getComputedStyle` on header/nav, h1-h6, paragraphs, buttons, footer; walked every visible element for a frequency count of text colours, background colours, gradients, radii and font families; enumerated `@font-face` rules, `document.fonts` and font network requests; read Wix theme variables (`--color_N`, `--font_N`).
4. Hovered "Learn About Products" and re-read styles for the hover state.
5. Full-page, fold and header screenshots were taken and inspected visually; pixels were sampled from the screenshot and from the downloaded logo / gradient image with `sharp`.

All tooling lived in a scratch directory outside the project.

## Raw sampled values

| Element | Font family (computed) | Wt | Size / line-height | Letter-sp. | Transform | Colour | Background | Radius / border / padding |
|---|---|---|---|---|---|---|---|---|
| Header bar (142 px tall) | — | — | — | — | — | — | renders **#FFFFFF** (pixel-sampled; the header's inner div reports `rgb(245,245,245)` but it is not visible — screenshot shows white) | 0 / none / 0 |
| Nav links (Home, About, Offerings, ...) | `orig_century_gothic` (user-uploaded Century Gothic) | 700 | 15px / 41px | normal | none | `rgb(0,80,81)` #005051; current page `rgb(62,124,125)` #3E7C7D | transparent | 0 / none / 0 10px |
| Hero h1 "Redefining Waste / for a Better Future" | `orig_century_gothic_bold` (uploaded Century Gothic Bold) | 400 (bold face) | 104px / 130px | normal | none | line 1 #4AB861 (green, seen in screenshot), line 2 `rgb(255,255,255)` | photo | — |
| h1 "Waste Management Service Company In India" | Century Gothic Bold (uploaded) | 400 | 31px / 43.4px | normal | none | #005051 | — | — |
| h1 small card titles (People / Business / Environment) | Century Gothic Bold (uploaded) | 400 | 18px / 1.4 | normal | none | #005051 | — | — |
| Section labels h6 ("ABOUT", "PRODUCTS", "IMPACT", "EXTENDED PRODUCER RESPONSIBILITY", ...) | `avenir-lt-w01_35-light` (Avenir LT 35 Light) | 400 | 17px / normal (34px in one case) | normal | none (**the uppercase is typed in the content, not `text-transform`**) | `rgb(74,184,97)` #4AB861; white on the gradient panel | — | — |
| Section headings h5 (e.g. "Reincarnating Plastic") | `avenir-lt-w01_85-heavy` (Avenir LT 85 Heavy) | 400 (heavy face) | 42px / normal (theme: 1.4em) | normal | none | `rgb(62,124,125)` #3E7C7D; white / #F5F5F5 on dark backgrounds | — | — |
| Tile captions ("COLLECTION & SORTING WASTE ...") | Avenir LT 85 Heavy | 400 | 18px | **1.8px** (0.1em) | none (typed uppercase) | #4AB861 on #005051 tile, #FFFFFF on #4AB861 tile, #005051 on #F5F5F5 tile | tiles: #005051 / #4AB861 / #F5F5F5 | 0 |
| Body paragraphs | Avenir LT 35 Light | 400 (light face) | 15px / 27px (1.8) | normal | none | `rgb(86,86,86)` #565656 | #FFFFFF or #F5F5F5 band | — |
| Button (primary CTA: "Learn About Products", "Learn About Our Impact") | `roboto-thin, roboto` (renders as Roboto bold) | 700 | 15px | normal | none | #4AB861 | transparent | **20px** / 2px solid #4AB861 / 0 — size 214x46 |
| Button on dark/gradient ("Collaborate With Us") | Roboto | 700 | 15px | normal | none | #FFFFFF | transparent | 20px / 2px solid #FFFFFF — 214x46 |
| Form "Submit" button (footer) | `poppins-extralight` | 400 | 14px / 25px | normal | none | `rgb(30,30,30)` #1E1E1E | `rgb(245,245,245)` #F5F5F5 | 0 / none — 327x33 |
| Newsletter ">" button | Soho thin condensed | 700 | 30px | — | — | #FFFFFF | `rgb(74,184,97)` #4AB861 | 0 / 3px solid #4AB861 — 60x60 |
| Footer | — | — | — | — | — | text `rgb(245,245,245)` #F5F5F5; labels #4AB861; heading "Get in touch" Avenir Heavy 42px #F5F5F5 | **`rgb(0,80,81)` #005051** (pixel-confirmed; a #1E1E1E layer exists underneath but is fully covered) | inputs: transparent bg, bottom border only |
| `body` / site containers | Arial (Wix reset, never visible) | — | 10px | — | — | — | transparent -> page renders **#FFFFFF** | — |

### Button hover (sampled by hovering "Learn About Products")

| State | Background | Border | Label colour |
|---|---|---|---|
| Rest | `rgba(255,255,255,0)` (transparent) | 2px solid #4AB861 | #4AB861 |
| Hover | **#4AB861 (solid fill)** | 2px solid transparent | **#FFFFFF** |

So: outline ("ghost") button that inverts to a solid green fill with white text on hover. Note that white on #4AB861 is only 2.52:1 — the site itself fails WCAG AA here; do not copy that pairing for text.

**Button shape:** rounded rectangle, `border-radius: 20px` on a 46 px tall button (almost, but not quite, a full pill — a full pill would be 23px). 2 px outline, no shadow. All other surfaces on the site (tiles, image panels, form button, inputs) are **square, 0px**. `20px` was the only non-zero radius found on the page (3 elements).

### Frequency counts (visible elements with own text / non-transparent background)

Text colours: #565656 x29, #F5F5F5 x18, #4AB861 x12, #005051 x11, #FFFFFF x7, #3E7C7D x6, #1E1E1E x1.

Background colours (count, summed area): #FFFFFF x8 (largest area), #F5F5F5 x8, #005051 x5, #4AB861 x2, #1E1E1E x1 (hidden under footer teal).

CSS gradients: **none** — no `linear-gradient`/`radial-gradient` in any computed `background-image`. The one gradient on the page is a bitmap (see below).

### Wix theme palette (CSS variables `--color_N`, sampled)

- Greens: #B9E7C3, #92D09F, **#4AB861**, **#317B41**, #193D20
- Teals: #9FD3D3, #70A7A8, **#3E7C7D**, **#005051**, **#002829**
- Greys: #FFFFFF, #F5F5F5, #DBDBDB, #C7C7C7, #8F8F8F, #565656, #1E1E1E
- Reds (Wix defaults, unused on page): #FC8B8B, #FC3535, #C92828, #961818, #670E0E
- Browns (Wix template leftovers, unused on page): #ECCDB2, #DA9B66, #B46A2C, #78471D, #3C230F

#317B41, #002829 and #DBDBDB are in the site's theme palette but are **not rendered** on the home page.

## Gradient

- The "Amplifying Impact" panel uses a **bitmap** background, file `dalmia logo_gradient_edited.jpg` (`static.wixstatic.com/media/b954fc_a5e29036def344e0b7b98941032217f2~mv2.jpg`, 1080x1080).
- Pixel-sampled from the original file: left edge **#00AA9F** -> centre #02A179 -> right edge **#079446**; top and bottom identical, i.e. a plain horizontal (90deg) teal-to-green linear gradient. The rendered screenshot gives the same values (#00AA9F ... #079447).
- White text on this gradient is 2.90:1 (left) to 3.94:1 (right): OK for large headings (>= 24px / 19px bold needs 3:1 — passes only toward the right side) and decoration, **not** AA for body-size text. Prefer the solid #005051 for surfaces carrying small white text.

## Logo

- Header `<img>`: `https://static.wixstatic.com/media/5011e6_4d96a4fcbf01499ab25896eb5b388072~mv2.png/v1/fill/w_260,h_85,.../dpipl_new_logo.png` (displayed at 260x85).
- Original fetched without the resize suffix and saved to `apps/web/public/brand/dpipl_new_logo.png`: **2400x800 PNG, RGBA, transparent background** (all four corners alpha 0; ~91% of pixels transparent). Artwork bounding box is x 169-2230, y 226-573, so there is generous built-in padding (about 7% left/right, 28% top/bottom) — size it by height accordingly or crop in CSS.
- **The logo mark is NOT a gradient.** It is two flat colours (exact pixel values): **#13AC8E** (teal-green, main arrows) and **#105870** (dark blue-teal, the folds). The per-column colour variation measured is only the mix of those two flats. Wordmark ("Dalmia" bold + "POLYPRO" light, Century Gothic-style) is near-black **#040707**.
- Legibility: reads very well on white / #F5F5F5. On the green brand gradient (or on #005051) it reads **poorly** — the #13AC8E mark all but disappears and the black wordmark is low-contrast. Use it on white/light surfaces only; the site does the same (white header). No white/reversed variant was found on the site — ask the client for one if a dark header is wanted.

## Favicon

- The site does **not** have its own favicon: all `<link rel="icon">` tags point to Wix's generic `https://static.parastorage.com/client/pfavico.ico` (1150 bytes, Wix's default icon). That is Wix's asset, not Dalmia's, so it was deliberately **not** copied into the project.
- `apps/web/public/brand/favicon.png` is therefore ***derived*, not sampled**: the icon mark cropped from the official logo PNG (x 169-522, y 226-573), centred on a transparent square, resized to **256x256 PNG, transparent**. Same client-approval caveat as the logo applies.

## Fonts

| Role on site | Family actually loaded | Source | Licence |
|---|---|---|---|
| Hero h1, nav, small card titles | **Century Gothic** Regular + Bold (`orig_century_gothic`, `orig_century_gothic_bold`) | user-uploaded to Wix: `static.wixstatic.com/ufonts/b954fc_3a24.../woff2/file.woff2`, `.../b954fc_a11d.../woff2/file.woff2` | Commercial (Monotype) |
| Section headings (h5), tile captions | **Avenir LT 85 Heavy** | Wix CDN `static.parastorage.com/fonts/v2/.../avenir-lt-w01_85-heavy1475544.woff2` | Commercial (Linotype/Monotype), licensed to Wix only |
| Body text, section labels (h6), footer text, inputs | **Avenir LT 35 Light** | Wix CDN `static.parastorage.com/fonts/v2/.../avenir-lt-w01_35-light1475496.woff2` | Commercial, licensed to Wix only |
| CTA button labels | Roboto (bold) | Google Font, served via Wix cache `static.parastorage.com/tag-bundler/api/v1/fonts-cache/googlefont/...` and `fonts.gstatic.com` | Open (Apache 2.0) |
| Footer "Submit" button | Poppins ExtraLight | Google Font via Wix cache | Open (OFL) |
| Newsletter ">" glyph | Soho Thin Condensed | Wix CDN | Commercial |

66 `@font-face` rules are declared (Wix ships its whole catalogue); only the eight files above were actually downloaded. Nothing is loaded from `fonts.googleapis.com` stylesheets.

Usage frequency (text-bearing elements): Avenir Light x35, Avenir Heavy x30, Century Gothic x7, Century Gothic Bold x7, Roboto x3, Poppins x1, Soho x1. **Avenir is the brand's working typeface; Century Gothic is display/nav only.**

### Substitutions (neither brand font can be self-hosted legally)

- **Avenir -> Nunito Sans** (SIL OFL, Google Fonts). Closest widely used open equivalent of Avenir: same humanist-geometric skeleton, similar x-height, and a variable weight axis covering both Light and Heavy. This is a *substitute*, not the sampled font.
  - Package: **`@fontsource-variable/nunito-sans`** (verified on npm, 5.3.0).
  - Weights needed: **400** (body; the site uses Light/300, but 300 at 13-15px on a data-dense QC app is too thin — use 300 only for large marketing-style copy), **600** (UI labels, table headers, buttons), **700/800** (headings; 800 is the closest to Avenir 85 Heavy). With the variable package all of these come in one file; if the static package `@fontsource/nunito-sans` is preferred, import `400.css`, `600.css`, `700.css`, `800.css`.
- **Century Gothic -> Jost** (SIL OFL) — *optional*, only for the text-wordmark fallback or a large display title. Package **`@fontsource-variable/jost`** (5.3.0), weights 400 + 700. (`@fontsource/questrial` is an even closer Century Gothic look-alike but has a single weight, 400, so it cannot do the bold "Dalmia".) Not needed if you keep a single-family UI.
- **Numeric / mono:** `@fontsource-variable/jetbrains-mono` (5.3.0) — *given*, not from the site. Weights 400, 500, 600.

## Resolved tokens

```css
:root {
  /* Brand */
  --brand-primary: #005051;        /* sampled: footer bg, nav links, tiles, heading text. White on it = 9.27:1 (AA/AAA) */
  --brand-primary-dark: #002829;   /* site theme palette (--color_30); not rendered on home page. Hover/active for primary */
  --brand-primary-light: #3E7C7D;  /* sampled: section headings, active nav link. White on it = 4.79:1 (AA) */
  --brand-accent: #4AB861;         /* sampled: section labels, CTA outline + hover fill, hero h1. White on it = 2.52:1 -> never small white text on this */
  --brand-gradient: linear-gradient(90deg, #00AA9F 0%, #079446 100%); /* pixel-sampled from the site's gradient bitmap */

  /* Text */
  --text-primary: #1E1E1E;         /* sampled: site theme dark (--color_1/15), used on form button. 16.67:1 on white */
  --text-secondary: #565656;       /* sampled: all body paragraphs. 7.34:1 on white */

  /* Surfaces */
  --bg-page: #F5F5F5;              /* sampled: the site's light band colour */
  --bg-surface: #FFFFFF;           /* sampled: header + main page background */
  --border: #DBDBDB;               /* site theme palette (--color_12/38); not rendered on home page */

  /* Semantic (given; the site offers nothing better — its reds are unused Wix defaults, #C92828 is near-identical) */
  --success: #2E7D32;
  --warning: #F9A825;
  --danger: #C62828;

  /* Shape */
  --radius: 20px;                  /* sampled: CTA buttons (46px tall). Everything else on the site is square (0px) */

  /* Type */
  --font-heading: "Nunito Sans Variable", "Nunito Sans", "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; /* substitute for Avenir LT 85 Heavy -> use weight 700-800 */
  --font-body: "Nunito Sans Variable", "Nunito Sans", "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif;    /* substitute for Avenir LT 35 Light -> use weight 400 */
  --font-numeric: "JetBrains Mono", ui-monospace, monospace; /* given */
}
```

### Notes on the resolution

- **Primary vs. accent.** The most "visible" brand colour, green #4AB861, fails WCAG AA under white text (2.52:1), and so do the logo teal #13AC8E (2.87:1) and both gradient stops (2.90 / 3.94:1). Per the brief it is kept as `--brand-accent`. For `--brand-primary` no shade had to be invented: the site's own dominant solid colour, deep teal **#005051** (footer, nav, tiles, headings), passes at 9.27:1 and was used as-is.
  - If the product owner wants *green* primary buttons instead of teal, the site's theme palette already contains a darker shade of the same green hue: **#317B41** (5.20:1 with white, AA) — use that rather than deriving a new one; its darker step is #193D20.
- `--bg-page` / `--bg-surface`: the marketing site is white with #F5F5F5 bands. For an app shell the two were assigned the usual way round (grey page, white cards). Swap them to mirror the site exactly.
- `--radius: 20px` is the button radius. It is large for cards/inputs/tables; the site uses 0px for those. If a separate surface radius is introduced, that value is a design decision, **not** a sampled one.
- Uppercase section labels on the site are typed in capitals — there is no `text-transform` and no letter-spacing on them (only the tile captions carry `letter-spacing: 1.8px` at 18px = 0.1em). If the app uses `text-transform: uppercase` for labels, 0.1em tracking is the sampled precedent.
- Site button hover = outline inverts to solid fill. App equivalent with accessible contrast: solid `--brand-primary` with white text, hover `--brand-primary-dark`; secondary = 2px `--brand-primary` outline that fills on hover.

## Logo usage — approval required

**The client's written OK is required before shipping their logo (and the favicon derived from it) in the app.** Until that is on file, use the text wordmark **"Dalmia Polypro"** as the fallback (suggested: "Dalmia" at weight 700-800 + "Polypro" at weight 400, colour `--brand-primary` or `--text-primary`, in `--font-heading` or Jost). Keep the logo on white / light surfaces only.

## How the app applies these tokens (added during build)

- The implemented values live in `tokens.ts` (single source for the MUI theme and the `:root` CSS variables) and are shown to the client under Admin → Settings → Appearance.
- `--bg-page` / `--bg-surface` are applied the way the website uses them: **white page (#FFFFFF), #F5F5F5 for bands and zebra rows** — i.e. swapped relative to the "Resolved tokens" block above.
- `--radius: 20px` is used for buttons only. Cards, inputs and tables use `--radius-surface: 4px`, which is a design decision, not a sampled value (the site uses 0px).
- `--brand-primary-light` in the app is `#E0EDED`, a derived tint for active nav / selected rows. The sampled mid teal `#3E7C7D` is kept as `--brand-primary-mid`.
- Primary buttons are solid `--brand-primary` with `--brand-primary-dark` on hover; the website's own white-on-#4AB861 hover fails contrast (2.52:1) and is not copied.
- The logo is only ever placed on white (on the login gradient it sits on a white plate) because no reversed variant exists.
