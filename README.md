# RouteGraphics

A 2D graphics rendering interface that takes JSON input and renders pixels using PixiJS.

⚠️ **Warning: This library is under active development and will have breaking changes in future versions.**

## Installation

```bash
npm install route-graphics
```

## Usage

```javascript
import RouteGraphics, {
  SpriteRendererPlugin,
  TextRendererPlugin,
  ContainerRendererPlugin,
  TextRevealingRendererPlugin,
  GraphicsRendererPlugin,
  AudioPlugin,
  SliderRendererPlugin,
  KeyframeTransitionPlugin,
  createAssetBufferManager,
} from 'route-graphics';

// Load assets
const assets = {
  "file:bg1": {
    url: "/public/background-1-1.png",
    type: "image/png",
  },
  "file:circle-red": {
    url: "/public/circle-red.png",
    type: "image/png",
  },
  "file:bgm-1": {
    url: "/public/bgm-1.mp3",
    type: "audio/mpeg",
  },
};

const assetBufferManager = createAssetBufferManager();
await assetBufferManager.load(assets);
const assetBufferMap = assetBufferManager.getBufferMap();

// Initialize RouteGraphics
const app = new RouteGraphics();
await app.init({
  width: 1920,
  height: 1080,
  eventHandler: (event, data) => {
    // Handle events
  },
  plugins: [
    new SpriteRendererPlugin(),
    new TextRendererPlugin(),
    new ContainerRendererPlugin(),
    new TextRevealingRendererPlugin(),
    new GraphicsRendererPlugin(),
    new AudioPlugin(),
    new SliderRendererPlugin(),
    new KeyframeTransitionPlugin(),
  ],
});

// Load assets and render
await app.loadAssets(assetBufferMap);
document.body.appendChild(app.canvas);

// Render frame with elements and transitions
app.render({
  elements: [
    {
      id: "sprite1",
      type: "sprite",
      texture: "file:circle-red",
      x: 100,
      y: 100,
    }
  ],
  transitions: []
});
```

## Features

- 2D graphics rendering
- Sprite management
- Text rendering with reveal effects
- Container layouts
- Transitions and animations
- Interactive elements
- Audio playback

## Development

```bash
# Install dependencies
bun install

# Build
bun run vt:generate

# Lint
bun run lint

# to test it
bun run test

```


