# Event API Guidelines

This document is the authoritative specification for the public Route Graphics event interface.

If code, examples, tests, or generated docs disagree with this file, this file is the intended contract and the rest of the repo should be aligned to it.

## Purpose

Route Graphics should expose its own stable interaction model instead of leaking PixiJS, browser, or renderer-specific event APIs.

This gives us:

- a renderer-agnostic public contract
- consistent naming across elements
- a predictable payload shape for apps consuming Route Graphics
- a clear rule for when an API change is breaking

## Stability Rule

The names and shapes documented here are part of the public API.

After this migration:

- event names are frozen unless there is an explicit major-version decision
- config key names for event handlers are frozen unless there is an explicit major-version decision
- renderer-specific native event names must stay internal

Additive changes are allowed. Renames are not.

## Naming Rules

All public Route Graphics event-related names use `camelCase`.

This applies to:

- element config keys
- global config keys
- semantic event names passed to `eventHandler(eventName, payload)`
- event-specific config objects such as `rightClick`, `scrollUp`, `dragStart`, and `dragEnd`
- the user-defined event data field `payload`

These forms are not public API and must not appear in docs, schemas, or examples:

- Pixi event names such as `pointerdown`, `pointerup`, `rightdown`, `rightup`, `rightclick`
- browser event names such as `contextmenu`, `mousedown`, `mouseup`, `wheel`
- lower-case concatenations such as `rightclick`, `scrollup`, `dragstart`
- nested public scroll handler shapes such as `scroll.up` and `scroll.down`
- legacy user payload field names such as `actionPayload`

## Public Event Names

The public semantic event names are:

- `hover`
- `click`
- `rightClick`
- `scrollUp`
- `scrollDown`
- `dragStart`
- `dragMove`
- `dragEnd`
- `change`
- `keydown`
- `keyup`
- `renderComplete`
- `rendererContextLost`
- `rendererContextRestored`

These are the names Route Graphics consumers should listen for in `eventHandler`.

### Proposed Event Names

The unimplemented command-controlled sound proposal reserves these candidate
event names:

- `soundReady`
- `soundProgress`
- `soundComplete`
- `soundError`

They are not part of the current stable public event set. Their proposed
payloads and lifecycle rules are documented in
[Command-Controlled Sound Playback Proposal](./audio-playback-commands.md).

## Semantic Meaning

Event names are semantic Route Graphics events, not native input events.

### `hover`

- Fired when a pointer enters a hover-capable interactive element.
- Intended for desktop / hover-capable pointer scenarios.
- Touch-only devices may not emit it.

### `click`

- Fired for the primary pointer activation of an element.
- Today this maps to the standard primary click/tap interaction path used by the runtime.
- Public meaning is primary activation, even if the renderer implementation changes later.

### `rightClick`

- Fired for the secondary mouse activation of an element.
- This is intentionally web-style terminology because that is the chosen public language.
- It should not be implemented as a public alias for renderer-native `rightclick`; the renderer adapter should translate native input into this semantic event.

### `scrollUp` / `scrollDown`

- Fired as directional semantic scroll events.
- Public API is flat: `scrollUp` and `scrollDown`.
- Public API must not use nested config such as `scroll.up` and `scroll.down`.
- Public API must not expose raw wheel delta names as event names.

### `dragStart` / `dragMove` / `dragEnd`

- Fired for the semantic drag lifecycle.
- Public API should not expose low-level pointer press/release names instead of these.

### `change`

- Fired when a control emits a value change.
- Current canonical example is `slider`.

### `keydown` / `keyup`

- Fired for Route Graphics global keyboard bindings.
- The public event names remain `keydown` and `keyup` even though the keyboard library is an internal implementation detail.
- Route Graphics does not expose browser `keypress` as a public event.

### `renderComplete`

- Fired when the current render has finished all tracked asynchronous work.
- This is a lifecycle event, not an element interaction event.

### `rendererContextLost` / `rendererContextRestored`

- Fired when the active renderer loses or restores the graphics context needed
  to present frames.
- These are renderer lifecycle events, not element interaction events.
- Consumers should use them to show renderer-independent fallback UI and
  rebuild renderer-owned assets.
- WebGL can emit both events. WebGPU device loss emits `rendererContextLost`,
  but a lost WebGPU device cannot be restored; recreate the Route Graphics
  instance instead of waiting for `rendererContextRestored`.
- Browser-native names such as `webglcontextlost` and `webglcontextrestored`
  remain internal implementation details.

## Config Shape

### Core Rule

Whenever a public Route Graphics event handler config carries app-defined data, that data lives under `payload`.

Example:

```yaml
click:
  payload:
    action: menuSelect
    target: start
```

### Flat Scroll Rule

Rect directional scroll handlers are configured as:

```yaml
scrollUp:
  payload:
    action: listUp

scrollDown:
  payload:
    action: listDown
```

### Drag Rule

Drag remains grouped by lifecycle because the grouping expresses one semantic feature:

```yaml
drag:
  start:
    payload:
      action: dragStart
  move:
    payload:
      action: dragMove
  end:
    payload:
      action: dragEnd
```

This is acceptable because the nested keys are still semantic drag phases, not a separate naming convention.

### Global Keyboard Rule

Global keyboard mappings use:

```yaml
global:
  keyboard:
    shift+s:
      keydown:
        payload:
          action: save
```

## Event Handler Contract

All public events flow through:

```js
eventHandler(eventName, payload)
```

Where:

- `eventName` is one of the public semantic event names from this document
- `payload` is an object composed of Route Graphics runtime metadata plus any configured user `payload`

## Payload Contract

### Reserved Runtime Metadata

`_event` is reserved for runtime-provided metadata.

Examples:

```js
{ _event: { id: "start-button" } }
```

```js
{ _event: { id: "slider-1", value: 42 } }
```

```js
{ _event: { id: "rect-1", x: 320, y: 240 } }
```

### User Data

User-configured `payload` is merged alongside `_event`:

```yaml
click:
  payload:
    action: startGame
```

Runtime callback:

```js
eventHandler("click", {
  _event: { id: "start-button" },
  action: "startGame",
});
```

### Payload Design Guidance

User payloads should be:

- small
- serializable
- semantic
- app-level

User payloads should not try to mirror renderer-native event objects.

## Renderer Boundary

Renderer-native and browser-native input events are implementation details.

Examples of internal-only event names:

- `pointerdown`
- `pointerup`
- `pointerover`
- `pointerout`
- `rightdown`
- `rightup`
- `rightclick`
- `wheel`
- `contextmenu`

These names may appear in adapter/plugin implementation code, but they must not be treated as the Route Graphics public API.

If Route Graphics swaps PixiJS for another renderer in the future:

- the adapter layer may change
- the public event names in this document must stay the same
- the public payload contract in this document must stay the same

## Platform Guidance

This API uses straightforward web terminology as the public surface.

That means:

- `hover` is still the public name, even if some devices do not support hover
- `click` is still the public primary activation name
- `rightClick` is still the public secondary mouse activation name

This is a deliberate product decision for simplicity and readability.

Platform differences should be handled by the runtime adapter, not pushed into consumer-facing naming.

## Per-Feature Summary

### Text / Sprite / Rect / Container interactions

- `hover`
- `click`
- `rightClick`
- configured via `payload`

### Text / Sprite / Rect / Container directional wheel interactions

- `scrollUp`
- `scrollDown`
- configured via `scrollUp.payload` and `scrollDown.payload`

### Rect drag interactions

- `dragStart`
- `dragMove`
- `dragEnd`
- configured via `drag.start.payload`, `drag.move.payload`, `drag.end.payload`

### Slider interactions

- `change`
- configured via `change.payload`

### Global keyboard interactions

- `keydown`
- `keyup`
- configured via `global.keyboard[key].keydown.payload` and `global.keyboard[key].keyup.payload`

### Render lifecycle

- `renderComplete`
- `rendererContextLost`
- `rendererContextRestored`

## Authoring Rules

When adding or reviewing Route Graphics event-related code:

1. Start from this document, not from Pixi docs.
2. Check that config keys are public Route Graphics names.
3. Check that emitted event names are public Route Graphics names.
4. Check that user-defined event data lives under `payload`.
5. Check that tests assert semantic event names, not renderer-native names.
6. Check that docs and examples do not use legacy names.

## Breaking Change Test

A change is breaking if it does any of the following:

- renames a public event name
- renames a public event config key
- renames `payload`
- changes `_event` meaning incompatibly
- changes `scrollUp` / `scrollDown` back to nested public naming
- exposes renderer-native event names as public API

If a change matches any of those, it must be treated as a major-version decision.

## Canonical Examples

### Text click

```yaml
click:
  payload:
    action: menuClick
    target: start
```

### Element scroll

```yaml
scrollUp:
  payload:
    action: inventoryUp

scrollDown:
  payload:
    action: inventoryDown
```

### Rect drag

```yaml
drag:
  start:
    payload:
      action: dragStart
  move:
    payload:
      action: dragMove
  end:
    payload:
      action: dragEnd
```

### Global keyboard

```yaml
global:
  keyboard:
    enter:
      keydown:
        payload:
          action: confirm
      keyup:
        payload:
          action: confirmReleased
```
