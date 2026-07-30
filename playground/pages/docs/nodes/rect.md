---
template: docs-documentation
title: Rect Node
tags: documentation
sidebarId: node-rect
---

`rect` renders a Pixi graphics rectangle with optional border, interaction, drag, and scroll hooks.

Try it in the [Playground](/playground/?template=basic-shapes).

## Used In

- `elements[]`

## Field Reference

| Field        | Type             | Required | Default     | Notes                                   |
| ------------ | ---------------- | -------- | ----------- | --------------------------------------- |
| `id`         | string           | Yes      | -           | Element id.                             |
| `type`       | string           | Yes      | -           | Must be `rect`.                         |
| `width`      | number           | Yes      | -           | Render width.                           |
| `height`     | number           | Yes      | -           | Render height.                          |
| `x`          | number           | No       | `0`         | Position before anchor transform.       |
| `y`          | number           | No       | `0`         | Position before anchor transform.       |
| `anchorX`    | number           | No       | `0`         | Anchor offset ratio.                    |
| `anchorY`    | number           | No       | `0`         | Anchor offset ratio.                    |
| `originX`    | number           | No       | anchor      | Transform origin X in pixels.           |
| `originY`    | number           | No       | anchor      | Transform origin Y in pixels.           |
| `alpha`      | number           | No       | `1`         | Opacity `0..1`.                         |
| `fill`       | string \| object | No       | transparent | Fill color or structured gradient fill. |
| `border`     | object           | No       | -           | Border config.                          |
| `rotation`   | number           | No       | `0`         | Degrees.                                |
| `filters`    | array            | No       | `[]`        | Ordered custom shader filters.          |
| `hover`      | object           | No       | -           | Hover event config.                     |
| `click`      | object           | No       | -           | Click event config.                     |
| `rightClick` | object           | No       | -           | Right click event config.               |
| `drag`       | object           | No       | -           | `start`/`move`/`end` payload hooks.     |
| `scrollUp`   | object           | No       | -           | Wheel-up payload hook.                  |
| `scrollDown` | object           | No       | -           | Wheel-down payload hook.                |

`filters` runs after built-in rendering effects. See
[Shaders](/docs/guides/shaders/) for source, uniform, texture, pipeline, and
filter parameter animation rules.

### `border`

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `width` | number | `0`     |
| `color` | string | `black` |
| `alpha` | number | `1`     |

### `fill`

`fill` can stay as a plain color string:

```yaml
fill: "#222222"
```

Or it can use a structured object:

```yaml
fill:
  type: solid
  color: "#222222"
```

```yaml
fill:
  type: linear-gradient
  start: { x: 0, y: 0 }
  end: { x: 1, y: 0 }
  stops:
    - offset: 0
      color: "#ff7a18"
    - offset: 1
      color: "#af002d"
  coordinateSpace: local
```

```yaml
fill:
  type: radial-gradient
  innerCenter: { x: 0.5, y: 0.5 }
  innerRadius: 0
  outerCenter: { x: 0.5, y: 0.5 }
  outerRadius: 0.5
  stops:
    - offset: 0
      color: "#ffffff"
    - offset: 1
      color: "#111111"
  coordinateSpace: local
```

Gradient notes:

- `stops` must include at least 2 items.
- Each stop `offset` must be between `0` and `1`.
- `coordinateSpace` can be `local` or `global`.
- `textureSize` and `wrapMode` are optional advanced Pixi gradient controls.

## Emitted Events

| Event Name   | Fired When                  | Payload Shape                                    |
| ------------ | --------------------------- | ------------------------------------------------ |
| `hover`      | pointer enters rect         | `{ _event: { id }, ...hover.payload }`           |
| `click`      | pointer up                  | `{ _event: { id }, ...click.payload }`           |
| `rightClick` | right click                 | `{ _event: { id }, ...rightClick.payload }`      |
| `scrollUp`   | wheel up over rect          | `{ _event: { id }, ...scrollUp.payload }`        |
| `scrollDown` | wheel down over rect        | `{ _event: { id }, ...scrollDown.payload }`      |
| `dragStart`  | pointer down                | `{ _event: { id }, ...drag.start.payload }`      |
| `dragMove`   | pointer move while dragging | `{ _event: { id, x, y }, ...drag.move.payload }` |
| `dragEnd`    | pointer up / outside        | `{ _event: { id }, ...drag.end.payload }`        |

## Example: Minimal

```yaml
elements:
  - id: panel
    type: rect
    width: 360
    height: 200
```

## Example: Interactive Panel

```yaml
elements:
  - id: settings-panel
    type: rect
    x: 120
    y: 100
    width: 520
    height: 340
    fill: "0x222222"
    border:
      width: 2
      color: "0xffffff"
      alpha: 0.7
    hover:
      cursor: pointer
      soundSrc: hover-sfx
      payload:
        action: panelHover
    click:
      soundSrc: click-sfx
      soundVolume: 90
      payload:
        action: panelClick
    rightClick:
      soundSrc: rightclick-sfx
      payload:
        action: panelContext
```

## Example: Drag + Scroll

```yaml
elements:
  - id: draggable-log
    type: rect
    x: 60
    y: 460
    width: 900
    height: 220
    fill: "0x101010"
    drag:
      start:
        payload: { action: dragStart }
      move:
        payload: { action: dragMove }
      end:
        payload: { action: dragEnd }
    scrollUp:
      payload: { action: scrollUp }
    scrollDown:
      payload: { action: scrollDown }
```

## Example: Gradient Panel

```yaml
elements:
  - id: gradient-panel
    type: rect
    x: 80
    y: 80
    width: 420
    height: 180
    fill:
      type: linear-gradient
      start: { x: 0, y: 0 }
      end: { x: 1, y: 1 }
      stops:
        - offset: 0
          color: "#1f4037"
        - offset: 1
          color: "#99f2c8"
    border:
      width: 2
      color: "#ffffff"
      alpha: 0.35
```
