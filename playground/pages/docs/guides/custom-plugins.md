---
template: docs-documentation
title: Custom Plugins
tags: documentation
sidebarId: guide-custom-plugins
---

Route Graphics is built around plugin groups registered in `init(...)`:

- `plugins.elements`
- `plugins.animations`
- `plugins.audio`

## Element Plugins

Element plugins are the main extension point. They own parsing plus add/update/delete behavior for a single node type.

Element plugin implementations are an advanced, renderer-coupled extension
surface: their lifecycle receives the current Pixi application/container
objects. That boundary is separate from the stable declarative state, shader,
animation, event, and Route Graphics instance APIs. Portable consumers should
use built-in elements and inline shaders; custom element plugin implementations
must be retested when Pixi is intentionally upgraded.

```js
import { createElementPlugin } from "route-graphics";

export const badgePlugin = createElementPlugin({
  type: "badge",
  parse: ({ state }) => ({
    ...state,
    x: Math.round(state.x ?? 0),
    y: Math.round(state.y ?? 0),
    width: Math.round(state.width ?? 120),
    height: Math.round(state.height ?? 36),
    label: String(state.label ?? ""),
  }),
  add: ({ parent, element }) => {
    // create Pixi display object and add it to parent
  },
  update: ({ parent, prevElement, nextElement }) => {
    // update existing display object
  },
  delete: ({ parent, element }) => {
    // remove and destroy existing display object
  },
});
```

Register it during init:

```js
await app.init({
  width: 1280,
  height: 720,
  plugins: {
    elements: [textPlugin, badgePlugin],
    animations: [tweenPlugin],
    audio: [soundPlugin],
  },
});
```

## Audio Plugins

Audio plugins follow the same lifecycle idea for `audio[]` nodes:

- `type`
- `add`
- `update`
- `delete`

Use `createAudioPlugin(...)` when you want a custom sound source or scheduling strategy beyond the built-in `sound` node.

## Animation Plugins

`createAnimationPlugin(...)` currently registers an animation type so the runtime accepts that animation family. The built-in `tween` plugin is the reference implementation. In practice, most custom behavior today is built through element and audio plugins.

Custom element filters and transition compositors do not require a plugin.
Author single-pass or multi-pass effects, textures, and animated parameters
through the built-in [Shaders](/docs/guides/shaders/) interface.

## Design Advice

- Keep `parse(...)` deterministic. It should normalize shape, not perform side effects.
- Use element `id` as the stable lookup key for updates.
- Emit user-facing side effects through the shared `eventHandler` instead of hidden globals.
- Add focused tests around parse output and add/update/delete lifecycle when you introduce a new plugin.
