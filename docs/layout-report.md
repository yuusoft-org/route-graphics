# Layout report v1

After initializing Route Graphics, loading fonts/assets, and rendering a state,
call `app.getLayoutReport()` to obtain a JSON-serializable snapshot. This is a
read-only companion to `parse(state)`: it uses the committed parser output and
actual mounted text, including changes from interaction styling and reveal.
It does not render, advance clocks, complete animations, or dispatch events.

The PNG CLI can capture the report in the same browser task as the image:

```sh
node bin/route-graphics-render.js scene.yaml -o scene.png \
  --time 150 --layout-report scene.layout.json
```

The caller remains responsible for waiting for a settled state. In particular,
manual animation time does not yet control wall-clock typewriter and particles.
Adding a report does not make those systems deterministic.

## Contract

- `schema`: `route-graphics-layout-report-v1`.
- `coordinateSpace`: `logical-pixels`. `viewport` contains logical width/height
  and renderer resolution, not downsampled device capture dimensions.
- `elements`: committed parsed nodes in preorder, with zero-based `index`,
  nullable `parentIndex`, authored `id`, and `type`. Indices refer to the parsed
  tree, not necessarily the original project's source tree.
- `layout`: computed box/transform properties and available anchor, fixed-width,
  measured-width, and layout-size metadata normally lost in JSON serialization
  of parser internals. This describes committed targets, not animated positions.
- `mountStatus`: `mounted`, `absent`, or `ambiguous`. Render-state metadata
  distinguishes authored mounts from generated labels, with label lookup as a
  fallback for unmarked displays under their authored parent. Missing or
  duplicate mounts are not selected arbitrarily. `display` is null unless
  mounted.
- `display`: current position/pivot/scale, rotation in radians, local and global
  axis-aligned bounds, world affine transform `{a,b,c,d,tx,ty}`, alpha and global
  alpha, local visible/renderable flags, mask presence, and filter count.
- `textRuns`: currently mounted Pixi Text objects owned by this element, not its
  nested authored elements. `path` is a child-index path relative to its mounted
  owner. Plain text uses `[]`; rich/revealing text may have multiple runs,
  including furigana. Each run contains text, display geometry, anchor, selected
  resolved layout style, and Canvas line widths/heights/font ascent/descent.

While a timeline text-unit proxy is mounted, `display` and `textRuns` describe
that proxy in place of the hidden source Text. Run paths are relative to the
proxy container. This also applies when units remain mounted after completion;
their runs belong to the authored text element, not its parent container.

All values are independent plain data. No Pixi objects, asset buffers, parser
references, callbacks, or internal symbols escape. Geometry queries may refresh
Pixi's bounds/transform caches, but do not change logical presentation state.

## Limits

This is a layout diagnostic, not a portable rasterizer or serialized live scene.
Bounds are Pixi geometry bounds, not final masked/filtered/alpha-tested pixels.
Visibility flags are local; ancestor clipping/visibility and shader effects
still require a pixel comparison. `fontFamily` is the resolved style's family
list, not proof of which fallback font the browser used. Pin and load font
bytes separately. Widths/ascent/descent come from the renderer's Canvas metrics;
they are not per-glyph shaping results or final baseline/draw commands.

Run paths describe the current display tree and may change during replacement
or reveal. They are not persistent glyph IDs or an authored UTF-16 reveal map.
Custom plugins that do not mount Pixi Text cannot expose text through this v1
report. Their element geometry can still be reported when labels are unique.

Reports contain visible story text and element IDs. Treat them as project
content: keep private projects' reports and screenshots out of public fixtures.

## Verification

`npm run test:layout-report -- /path/to/chromium` builds the bundle and checks
the public API in a real browser, including unchanged pixels/events, rich text,
furigana, revealed text, and live style changes. The executable argument is
optional when Playwright's bundled browser is installed.

For the existing PNG/MP4 CLI suite, `ROUTE_GRAPHICS_TEST_BROWSER` optionally
selects an installed browser. This leaves the default CI browser unchanged.
