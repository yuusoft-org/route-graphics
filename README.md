# Route Graphics

Route Graphics is a declarative 2D UI/rendering system built on PixiJS. You describe states with JSON, then Route Graphics handles element lifecycle, animations, audio, and interaction events for you.

This README stays intentionally short. The hosted docs are the source of truth for setup guides, node reference pages, events, asset loading, plugin authoring, and live examples.

## Start Here

- [Documentation](http://route-graphics.routevn.com/docs/introduction/introduction/)
- [Playground](http://route-graphics.routevn.com/playground/)
- [Tasks & Roadmap](http://route-graphics.routevn.com/tasks)

## Installation

```bash
bun install route-graphics
```

## Minimal Usage

```javascript
import createRouteGraphics, {
  createAssetBufferManager,
  textPlugin,
  rectPlugin,
  spritePlugin,
  containerPlugin,
  tweenPlugin,
  soundPlugin,
} from "route-graphics";

const assets = {
  "circle-red": { url: "/public/circle-red.png", type: "image/png" },
  "bgm-1": { url: "/public/bgm-1.mp3", type: "audio/mpeg" },
};

const assetBufferManager = createAssetBufferManager();
await assetBufferManager.load(assets);

const app = createRouteGraphics();
await app.init({
  width: 1280,
  height: 720,
  backgroundColor: 0x000000,
  plugins: {
    elements: [textPlugin, rectPlugin, spritePlugin, containerPlugin],
    animations: [tweenPlugin],
    audio: [soundPlugin],
  },
  eventHandler: (eventName, payload) => {
    console.log(eventName, payload);
  },
});

await app.loadAssets(assetBufferManager.getBufferMap());
document.body.appendChild(app.canvas);

app.render({
  id: "hello-state",
  elements: [
    {
      id: "title",
      type: "text",
      x: 40,
      y: 40,
      content: "Hello Route Graphics",
      textStyle: {
        fill: "#ffffff",
        fontSize: 36,
      },
    },
  ],
  animations: [],
  audio: [],
});
```

`createAssetBufferManager()` may keep image and video assets as direct source
URLs when possible, while audio and font assets remain buffer-backed.

Assets loaded by an app instance can be released after no rendered or
transitioning element still references them:

```javascript
await app.unloadAssets(["circle-red", "bgm-1"]);
```

`unloadAssets()` removes renderer cache entries and releases texture, video,
audio, and font resources owned by that Route Graphics instance. Unknown or
already-unloaded keys are ignored, shared resources remain alive until their
last Route Graphics consumer unloads them, and released keys can be loaded
again.

The event handler also receives `rendererContextLost` and
`rendererContextRestored` lifecycle events. Fallback UI should live outside the
renderer so it remains available while the graphics context is unavailable.
WebGPU device loss emits `rendererContextLost`; because a lost WebGPU device is
not restorable, consumers must recreate the Route Graphics instance rather than
wait for `rendererContextRestored`.

### Semantic bounds hit testing

`hitTestElementBounds({ x, y })` accepts renderer-space coordinates and returns
all hit branches from front to back. Each branch contains a root-to-deepest
`path`; every path entry includes the semantic element `id`, `type`, and live
world-space bounds. `bounds.corners` preserves rotation and
`x`/`y`/`width`/`height` is the enclosing axis-aligned rectangle. Container
scroll offsets and viewport clipping are applied, while opacity and transparent
pixels do not create click-through holes.

```javascript
const hits = app.hitTestElementBounds({ x: pointerX, y: pointerY });
const frontmostPath = hits[0]?.path ?? [];
```

Route Graphics deliberately returns rendered semantic identities rather than
editor document identities, and it does not apply consumer-specific filtering.
Consumers remain responsible for mapping each render occurrence to an authored
selection owner and ignoring any renderer elements they do not want to select.

Bounds queries are observational. They do not alter or suppress existing
hover, click, drag, keyboard, input, slider, or scroll behavior. A consumer can
therefore observe a pointer gesture for selection while Route Graphics
continues processing the same authored interaction.

For complete usage details, go to:

- [Getting Started](http://route-graphics.routevn.com/docs/introduction/getting-started/)
- [Assets & Loading](http://route-graphics.routevn.com/docs/guides/assets-loading/)
- [Events & Render Complete](http://route-graphics.routevn.com/docs/guides/events-render-complete/)
- [Custom Plugins](http://route-graphics.routevn.com/docs/guides/custom-plugins/)

Design notes:

- [Audio Effects](./docs/audio-effects.md)
- [Command-Controlled Sound Playback Proposal](./docs/audio-playback-commands.md)
- [Shader Interface](./docs/shader-interface.md)

## Render CLI

This repo includes a CLI that renders RouteGraphics YAML into PNG or MP4 output by:

1. reading YAML in Node,
2. launching headless Chromium through Playwright,
3. rendering with the bundled `dist/RouteGraphics.js`, and
4. exporting either a still frame or an autoplayed state sequence.

Full CLI reference: [`docs/render-cli.md`](./docs/render-cli.md)

The legacy PNG-only reference is still available at
[`docs/png-render-cli.md`](./docs/png-render-cli.md).

```bash
# one-time browser install if Chromium is not already available
npx playwright install chromium

# render a YAML file to PNG or MP4
route-graphics render ./examples/hello.yaml -o ./out/hello.png
route-graphics render ./examples/storyboard.yaml -o ./out/storyboard.mp4
```

Supported top-level YAML shapes:

- A single state object
- An array of states
- A wrapper object with `width`, `height`, `backgroundColor`, optional `assets`, and either `state` or `states`
- Multiple YAML documents separated by `---` (treated as a state list)

Minimal example:

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
  - id: bar
    type: rect
    x: 80
    y: 160
    width: 320
    height: 24
    fill: "#4fd1c5"
```

Asset handling:

- Asset-bearing render-state fields such as `src`, `thumbSrc`, `barSrc`, `inactiveBarSrc`, and `soundSrc` must reference top-level `assets` aliases.
- Direct file paths and URLs are allowed inside top-level `assets` values.
- Direct asset references inside `elements`, `audio`, or nested interaction config are rejected.

Example with asset aliases:

```yaml
width: 1280
height: 720
assets:
  hero: ./assets/hero.png
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
```

Invalid example:

```yaml
elements:
  - id: avatar
    type: sprite
    x: 60
    y: 140
    width: 128
    height: 128
    src: ./assets/hero.png # rejected by the CLI
```

Useful PNG flags:

- `--state <index>` selects a state from an array or multi-document YAML file.
- `--time <ms>` samples animations at a specific manual timeline position.
- `--wait-for-render-complete` waits for a `renderComplete` event before capture.

Useful MP4 flags:

- `--states <list>` selects state indexes/ranges such as `0,2-5`.
- `--fps <number>` controls output frame rate.
- `--hold`, `--initial-hold`, and `--final-hold` control state dwell time.
- `--browser-executable <path>` uses a system Chrome/Chromium instead of Playwright's managed browser.

## Development

```bash
# Run tests
bun run test

# Render a YAML file into a PNG or MP4
route-graphics render ./examples/hello.yaml -o ./out/hello.png
route-graphics render ./examples/hello.yaml -o ./out/hello.mp4

# Ensure VT assets are real binaries, not Git LFS pointer files
git lfs pull
git lfs checkout

# Build the local docs/playground site
cd playground
bun install
bun run build
```

The docs site and playground source live under `playground/`.

Visual regression assets under `vt/static/public` and `vt/reference` are stored in Git LFS. If those files are not checked out, VT pages will render blank and browser logs will show image/audio decode errors.

## Community

Join us on [Discord](https://discord.gg/8J9dyZSu9C) to ask questions, report bugs, and stay up to date.

## License

This project is licensed under the [MIT License](LICENSE).
