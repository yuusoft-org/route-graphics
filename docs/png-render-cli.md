# PNG Render CLI

`route-graphics-render` renders a RouteGraphics YAML document into a PNG using the local `dist/RouteGraphics.js` bundle and headless Chromium through Playwright.

This is currently a repo-local workflow, not a published npm package entrypoint.

## Prerequisites

- Install project dependencies: `bun install`
- Build the local bundle: `bun run build`
- Install Chromium if Playwright does not already have a usable browser: `npx playwright install chromium`

## Quick Start

```bash
bun run build
bun run render:png -- ./examples/hello.yaml -o ./out/hello.png
```

The CLI creates parent directories for the output file automatically and prints the output path plus render timing on success.

## Command

```bash
node ./bin/route-graphics-render.js <input.yaml> -o <output.png> [options]
```

Most local usage should go through the package script:

```bash
bun run render:png -- ./examples/hello.yaml -o ./out/hello.png
```

## Options

| Option                        | Meaning                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `-o, --output <path>`         | Required. Output PNG path.                                                |
| `--width <pixels>`            | Override the render width.                                                |
| `--height <pixels>`           | Override the render height.                                               |
| `--state <index>`             | Select a state when the YAML contains multiple states. Default: `0`.      |
| `--time <ms>`                 | Sample animations in manual mode at a specific timeline position.         |
| `--layout-report <path>`      | Write a [JSON layout snapshot](./layout-report.md) from the captured frame. |
| `--background-color <value>`  | Override the background color. Accepts `#RRGGBB`, `0xRRGGBB`, or decimal. |
| `--browser-executable <path>` | Use a system Chrome/Chromium instead of Playwright's managed browser.     |
| `--wait-for-render-complete`  | Wait for a `renderComplete` event before capture.                         |
| `--timeout <ms>`              | Timeout used by `--wait-for-render-complete`. Default: `15000`.           |
| `-h, --help`                  | Show help.                                                                |

Notes:

- If `--time` is provided, the renderer samples that time directly and does not wait for `renderComplete`.
- If `--width`, `--height`, or `--background-color` are omitted, the CLI falls back to values from the YAML document.
- If width or height are missing in both CLI flags and YAML, the CLI defaults to `1280x720`.

## Supported YAML Shapes

The renderer accepts any of these top-level YAML layouts:

- A single state object
- An array of states
- A wrapper object with `width`, `height`, `backgroundColor`, optional `assets`, and either `state` or `states`
- Multiple YAML documents separated by `---` and treated as a state list

Examples:

```yaml
width: 1280
height: 720
backgroundColor: "#101820"
elements:
  - id: title
    type: text
    x: 80
    y: 80
    content: "Hello PNG"
```

```yaml
width: 1280
height: 720
states:
  - id: intro
    elements: []
  - id: outro
    elements: []
```

```yaml
id: intro
elements: []
---
id: outro
elements: []
```

## State Selection

- `--state <index>` selects exactly one state from the parsed state list.
- Only the selected state is validated for asset aliases and loaded for rendering.
- State indexes are zero-based.

Example:

```bash
bun run render:png -- ./examples/my-sequence.yaml -o ./out/frame.png --state 1
```

## Asset Rules

The CLI does not allow direct file paths or remote URLs inside render-state fields. Asset-bearing fields inside the selected state must point to aliases declared in top-level `assets`.

Typical asset-bearing fields include:

- `src`
- `hoverSrc`
- `pressSrc`
- `thumbSrc`
- `barSrc`
- `inactiveBarSrc`
- `soundSrc`

Font loading follows the same alias model when you want the CLI to load a font file:

- Put the font file under top-level `assets`
- Reference the alias from `textStyle.fontFamily`, either directly or as an entry in an ordered fallback array
- Plain font family names that are not aliases are still allowed, but the CLI will not load a file for them

The CLI treats interaction and keyboard `payload` objects as opaque app data. Values inside `payload` are not scanned as renderer assets.

### Valid Asset Definitions

Asset entries can be:

- A relative local path
- An absolute local path
- A `file:` URL
- An HTTP(S) URL
- A `data:` URL
- An object with `path`, `url`, or `src`, plus optional `type`

Relative local asset paths are resolved relative to the input YAML file's directory.

Examples:

```yaml
assets:
  hero: ./assets/hero.png
  uiFont:
    path: ./assets/fonts/NotoSans-Regular.ttf
    type: font/ttf
  introVideo:
    url: https://cdn.example.com/intro.mp4
    type: video/mp4
```

### Invalid State-Level Asset Usage

This is rejected:

```yaml
elements:
  - id: avatar
    type: sprite
    src: ./assets/hero.png
```

Use this instead:

```yaml
assets:
  hero: ./assets/hero.png
elements:
  - id: avatar
    type: sprite
    src: hero
```

### Multiple Asset Types for One Alias

If the same alias is referenced as more than one asset type and the CLI cannot infer the type from the asset path or URL, define `assets.<alias>.type` explicitly.

Example:

```yaml
assets:
  shared:
    url: https://cdn.example.com/blob?id=123
    type: image/png
```

## Examples

### Minimal Render

```yaml
width: 1280
height: 720
backgroundColor: "#101820"
elements:
  - id: title
    type: text
    x: 80
    y: 80
    content: "Hello PNG"
    textStyle:
      fill: "#ffffff"
      fontSize: 48
```

```bash
bun run render:png -- ./examples/hello.yaml -o ./out/hello.png
```

### Alias-Backed Assets

```yaml
width: 1280
height: 720
assets:
  hero: ./assets/hero.png
  heroHover: ./assets/hero-hover.png
  uiFont:
    path: ./assets/fonts/NotoSans-Regular.ttf
    type: font/ttf
  fallbackFont:
    path: ./assets/fonts/Fallback-Regular.ttf
    type: font/ttf
elements:
  - id: title
    type: text
    x: 60
    y: 60
    content: "Alias-backed render"
    textStyle:
      fill: "#ffffff"
      fontSize: 42
      fontFamily: [uiFont, fallbackFont]
  - id: avatar
    type: sprite
    x: 60
    y: 140
    width: 128
    height: 128
    src: hero
    hover:
      src: heroHover
```

### Scrollbar Hover and Press Assets

```yaml
width: 1280
height: 720
assets:
  track: ./assets/track.png
  trackHover: ./assets/track-hover.png
  trackPress: ./assets/track-press.png
  thumb: ./assets/thumb.png
  thumbHover: ./assets/thumb-hover.png
  thumbPress: ./assets/thumb-press.png
elements:
  - id: list
    type: container
    width: 480
    height: 320
    scroll: true
    scrollbar:
      vertical:
        thickness: 12
        track:
          src: track
          hoverSrc: trackHover
          pressSrc: trackPress
        thumb:
          src: thumb
          hoverSrc: thumbHover
          pressSrc: thumbPress
```

### Multi-State Capture

```bash
bun run render:png -- ./examples/storyboard.yaml -o ./out/scene-02.png --state 1
```

### Manual Animation Sampling

```bash
bun run render:png -- ./examples/animated.yaml -o ./out/frame-1500ms.png --time 1500
```

### Wait for `renderComplete`

```bash
bun run render:png -- ./examples/async.yaml -o ./out/async.png --wait-for-render-complete --timeout 30000
```

## Common Errors

### `dist/RouteGraphics.js is missing`

Run:

```bash
bun run build
```

### `An input YAML file is required`

Pass the YAML file as the positional argument:

```bash
bun run render:png -- ./examples/hello.yaml -o ./out/hello.png
```

### `An output PNG path is required`

Pass `-o` or `--output`.

### `State index X is out of range`

Use a zero-based state index that exists in the parsed state list.

### `Direct asset references are not supported`

Move the file path or URL into top-level `assets` and reference the alias from the state.

### `Asset alias "..." referenced ... is not defined in top-level assets`

Add the alias under `assets` or correct the alias name in the selected state.

### `Timed out waiting for renderComplete`

- Increase `--timeout`
- Confirm that your render path actually emits `renderComplete`
- Use `--time` instead if you want a deterministic animation snapshot rather than an event-driven capture

## Current Behavior Notes

- The CLI validates and loads assets only for the selected state.
- Local assets are served through a temporary local HTTP server so browser-side loaders can resolve them consistently.
- Remote assets are passed through to the browser as-is.
- Output directories are created automatically.
