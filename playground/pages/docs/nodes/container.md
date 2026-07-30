---
template: docs-documentation
title: Container Node
tags: documentation
sidebarId: node-container
---

`container` groups child elements and optionally applies layout + clipping scroll behavior.

Try it in the [Playground](/playground/?template=container-layout).

## Used In

- `elements[]`

## Field Reference

| Field        | Type                                     | Required            | Default        | Notes                                                             |
| ------------ | ---------------------------------------- | ------------------- | -------------- | ----------------------------------------------------------------- |
| `id`         | string                                   | Yes                 | -              | Element id.                                                       |
| `type`       | string                                   | Yes                 | -              | Must be `container`.                                              |
| `x`          | number                                   | Yes (public schema) | `0` at runtime | Position before anchor transform.                                 |
| `y`          | number                                   | Yes (public schema) | `0` at runtime | Position before anchor transform.                                 |
| `width`      | number                                   | No                  | auto           | Derived from children if omitted.                                 |
| `height`     | number                                   | No                  | auto           | Derived from children if omitted.                                 |
| `anchorX`    | number                                   | No                  | `0`            | For containers, use `0`, `0.5`, or `1`.                           |
| `anchorY`    | number                                   | No                  | `0`            | For containers, use `0`, `0.5`, or `1`.                           |
| `originX`    | number                                   | No                  | anchor         | Transform origin X in pixels.                                     |
| `originY`    | number                                   | No                  | anchor         | Transform origin Y in pixels.                                     |
| `alpha`      | number                                   | No                  | `1`            | Opacity `0..1`.                                                   |
| `blur`       | object                                   | No                  | -              | Directional Gaussian blur applied to the whole subtree.           |
| `filters`    | array                                    | No                  | `[]`           | Ordered custom shader filters applied to the composed subtree.    |
| `children`   | array                                    | No                  | `[]`           | Any registered element plugin type can be nested.                 |
| `direction`  | `absolute` \| `horizontal` \| `vertical` | No                  | `absolute`     | Auto-positioning for children in non-absolute modes.              |
| `gapX`       | number                                   | No                  | `0`            | Horizontal spacing between children, and between wrapped columns. |
| `gapY`       | number                                   | No                  | `0`            | Vertical spacing between children, and between wrapped rows.      |
| `rotation`   | number                                   | No                  | `0`            | Degrees.                                                          |
| `scroll`     | boolean                                  | No                  | `false`        | Enables clipping and wheel scrolling for overflow.                |
| `scrollbar`  | object                                   | No                  | -              | Optional custom vertical scrollbar chrome for overflow.           |
| `hover`      | object                                   | No                  | -              | Hover event config. Supports `inheritToChildren`.                 |
| `click`      | object                                   | No                  | -              | Click event config. Supports `inheritToChildren`.                 |
| `rightClick` | object                                   | No                  | -              | Right click event config. Supports `inheritToChildren`.           |
| `scrollUp`   | object                                   | No                  | -              | Wheel-up payload hook.                                            |
| `scrollDown` | object                                   | No                  | -              | Wheel-down payload hook.                                          |

Container `filters` post-process the composed child surface after built-in
blur. See [Shaders](/docs/guides/shaders/) for the shader interface.

## Layout Behavior Notes

- `absolute`: child `x`/`y` are used as-is.
- `horizontal` / `vertical`: parser repositions children and can wrap by container `width`/`height` when provided and `scroll` is false.
- `gapX` controls horizontal spacing. `gapY` controls vertical spacing. Legacy `gap` is not supported.
- Child nodes are parsed with the active parser plugin set.
- `scrollbar.vertical` renders on top of the viewport edge. It syncs with wheel scrolling, thumb dragging, track clicks, and optional start/end buttons.
- `scrollUp` and `scrollDown` emit semantic wheel events. They are independent of `scroll: true`, which controls overflow clipping and content movement.

## Blur

`blur` applies to the rendered output of the whole container subtree. It requires explicit horizontal and vertical axes.

| Field              | Type    | Required | Default | Notes                                             |
| ------------------ | ------- | -------- | ------- | ------------------------------------------------- |
| `x`                | number  | Yes      | -       | Horizontal blur strength in pixels.               |
| `y`                | number  | Yes      | -       | Vertical blur strength in pixels.                 |
| `quality`          | number  | No       | `4`     | Number of blur passes. Higher is smoother/slower. |
| `kernelSize`       | number  | No       | `5`     | One of `5`, `7`, `9`, `11`, `13`, `15`.           |
| `repeatEdgePixels` | boolean | No       | `false` | Clamp edge pixels instead of padding blur bounds. |

## Scrollbar Notes

- Custom scrollbar chrome is currently available for the vertical axis only.
- `scrollbar` is only used when `scroll: true` and the container actually overflows.
- `thickness` is the scrollbar width for the vertical axis.
- The scrollbar overlays the container's right edge; it does not reserve extra layout width.
- Clicking the track scrolls by one viewport page toward the click position.
- `startButton.step` and `endButton.step` control how many pixels each arrow/button press moves the content.
- `thumb.length` fixes the thumb height. If omitted, the thumb height is computed from the viewport/content ratio.

## Scrollbar Interface

`scrollbar.vertical` supports these fields:

| Field         | Type   | Required | Notes                                           |
| ------------- | ------ | -------- | ----------------------------------------------- |
| `thickness`   | number | Yes      | Width of the vertical scrollbar lane in pixels. |
| `track`       | object | Yes      | Track visuals. Must include `src`.              |
| `thumb`       | object | Yes      | Thumb visuals. Must include `src`.              |
| `startButton` | object | No       | Optional top button/arrow visuals.              |
| `endButton`   | object | No       | Optional bottom button/arrow visuals.           |

Each visual object supports:

| Field      | Type   | Required | Notes                      |
| ---------- | ------ | -------- | -------------------------- |
| `src`      | string | Yes      | Base image asset id.       |
| `hoverSrc` | string | No       | Image shown while hovered. |
| `pressSrc` | string | No       | Image shown while pressed. |

`thumb` also supports:

| Field    | Type   | Required | Notes                                                                                  |
| -------- | ------ | -------- | -------------------------------------------------------------------------------------- |
| `length` | number | No       | Fixed thumb height in pixels. When omitted, the runtime sizes the thumb automatically. |

`startButton` and `endButton` also support:

| Field  | Type   | Required | Notes                                                                    |
| ------ | ------ | -------- | ------------------------------------------------------------------------ |
| `size` | number | No       | Button height in pixels. Defaults to scrollbar `thickness` when omitted. |
| `step` | number | No       | Pixel distance scrolled when the button is clicked.                      |

## Emitted Events

| Event Name   | Fired When                | Payload Shape                               |
| ------------ | ------------------------- | ------------------------------------------- |
| `hover`      | pointer enters container  | `{ _event: { id }, ...hover.payload }`      |
| `click`      | pointer up                | `{ _event: { id }, ...click.payload }`      |
| `rightClick` | right click               | `{ _event: { id }, ...rightClick.payload }` |
| `scrollUp`   | wheel up over container   | `{ _event: { id }, ...scrollUp.payload }`   |
| `scrollDown` | wheel down over container | `{ _event: { id }, ...scrollDown.payload }` |

## Hover Inheritance

Set `hover.inheritToChildren: true` to apply hover visuals from the container to descendants that support hover state, such as `text`, `sprite`, and `slider`.

- This affects hover visuals, not child hover payloads or hover sounds.
- Child direct hover still works normally while the container hover is active.

Set `click.inheritToChildren: true` to apply pressed/click visuals from the container to descendants that support click state, such as `text` and `sprite`.

- This affects pressed visuals, not child click payloads or click sounds.
- Child direct click still works normally while the container pressed state is active.

Set `rightClick.inheritToChildren: true` to apply right-pressed visuals from the container to descendants that support right-click state, such as `text` and `sprite`.

- This affects right-click visuals, not child rightClick payloads or right-click sounds.
- Child direct right-click still works normally while the container right-pressed state is active.

## Example: Minimal Group

```yaml
elements:
  - id: hud
    type: container
    x: 40
    y: 40
    children:
      - id: hp-label
        type: text
        x: 0
        y: 0
        content: "HP"
```

## Example: Vertical Menu Layout

```yaml
elements:
  - id: menu
    type: container
    x: 120
    y: 120
    direction: vertical
    gapX: 10
    gapY: 10
    children:
      - id: btn-start
        type: rect
        width: 260
        height: 56
        fill: "0x2a2a2a"
      - id: btn-options
        type: rect
        width: 260
        height: 56
        fill: "0x2a2a2a"
      - id: btn-exit
        type: rect
        width: 260
        height: 56
        fill: "0x2a2a2a"
```

## Example: Scrollable Container

```yaml
elements:
  - id: inventory
    type: container
    x: 760
    y: 80
    width: 420
    height: 560
    direction: vertical
    gapX: 8
    gapY: 8
    scroll: true
    scrollUp:
      payload:
        action: inventoryWheelUp
    scrollDown:
      payload:
        action: inventoryWheelDown
    children:
      - id: item-1
        type: text
        x: 0
        y: 0
        content: "Potion"
      - id: item-2
        type: text
        x: 0
        y: 0
        content: "Ether"
      - id: item-3
        type: text
        x: 0
        y: 0
        content: "Elixir"
```

## Example: Custom Vertical Scrollbar

```yaml
elements:
  - id: inventory
    type: container
    x: 760
    y: 80
    width: 420
    height: 560
    direction: vertical
    gapX: 8
    gapY: 8
    scroll: true
    scrollbar:
      vertical:
        thickness: 16
        track:
          src: scroll-track
          hoverSrc: scroll-track-hover
          pressSrc: scroll-track-press
        thumb:
          src: scroll-thumb
          hoverSrc: scroll-thumb-hover
          pressSrc: scroll-thumb-press
          length: 32
        startButton:
          src: scroll-arrow-up
          hoverSrc: scroll-arrow-up-hover
          pressSrc: scroll-arrow-up-press
          size: 16
          step: 24
        endButton:
          src: scroll-arrow-down
          hoverSrc: scroll-arrow-down-hover
          pressSrc: scroll-arrow-down-press
          size: 16
          step: 24
    children:
      - id: item-1
        type: text
        x: 0
        y: 0
        content: "Potion"
      - id: item-2
        type: text
        x: 0
        y: 0
        content: "Ether"
      - id: item-3
        type: text
        x: 0
        y: 0
        content: "Elixir"
      - id: item-4
        type: text
        x: 0
        y: 0
        content: "Phoenix Down"
      - id: item-5
        type: text
        x: 0
        y: 0
        content: "Antidote"
```
