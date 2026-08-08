---
template: docs-documentation
title: Rect Node
tags: documentation
sidebarId: node-rect
---

`rect` renders a rectangle with solid or gradient fill, independent corner
radii, optional border and blur, shader filters, animation, and pointer hooks.

Try it in the [Playground](/playground/?template=basic-shapes).

## Used In

- `elements[]`

## Field Reference

| Field          | Type             | Required | Default     | Notes                                    |
| -------------- | ---------------- | -------- | ----------- | ---------------------------------------- |
| `id`           | string           | Yes      | -           | Element id.                              |
| `type`         | string           | Yes      | -           | Must be `rect`.                          |
| `width`        | number           | Yes      | -           | Render width.                            |
| `height`       | number           | Yes      | -           | Render height.                           |
| `x`            | number           | No       | `0`         | Position before anchor transform.        |
| `y`            | number           | No       | `0`         | Position before anchor transform.        |
| `anchorX`      | number           | No       | `0`         | Anchor offset ratio.                     |
| `anchorY`      | number           | No       | `0`         | Anchor offset ratio.                     |
| `originX`      | number           | No       | anchor      | Transform origin X in pixels.            |
| `originY`      | number           | No       | anchor      | Transform origin Y in pixels.            |
| `alpha`        | number           | No       | `1`         | Opacity `0..1`.                          |
| `fill`         | string \| object | No       | transparent | Fill color or structured gradient fill.  |
| `border`       | object           | No       | -           | Border config.                           |
| `cornerRadius` | number \| object | No       | `0`         | Uniform or per-corner radii.             |
| `rotation`     | number           | No       | `0`         | Degrees.                                 |
| `scaleX`       | number           | No       | `1`         | Horizontal geometry scale.               |
| `scaleY`       | number           | No       | `1`         | Vertical geometry scale.                 |
| `blur`         | object           | No       | -           | Directional Gaussian blur.               |
| `filters`      | array            | No       | `[]`        | Ordered custom shader filters.           |
| `hover`        | object           | No       | -           | Hover appearance and event config.       |
| `click`        | object           | No       | -           | Primary-press appearance/event config.   |
| `rightClick`   | object           | No       | -           | Secondary-press appearance/event config. |
| `drag`         | object           | No       | -           | `start`/`move`/`end` payload hooks.      |
| `scrollUp`     | object           | No       | -           | Wheel-up payload hook.                   |
| `scrollDown`   | object           | No       | -           | Wheel-down payload hook.                 |

`filters` runs after built-in rendering effects. See
[Shaders](/docs/guides/shaders/) for source, uniform, texture, pipeline, and
filter parameter animation rules.

### `border`

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `width` | number | `0`     |
| `color` | string | `black` |
| `alpha` | number | `1`     |

The stroke is centered on the rect outline.

### `cornerRadius`

A number applies the same radius to every corner:

```yaml
cornerRadius: 20
```

Use an object to control all four corners independently:

```yaml
cornerRadius:
  topLeft: 32
  topRight: 8
  bottomRight: 32
  bottomLeft: 8
```

Missing corners default to `0`. If adjacent radii are too large for the
rectangle, they are reduced proportionally so they never overlap.

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
- Stop offsets must be strictly increasing values between `0` and `1`.
- `coordinateSpace` can be `local` or `global`.
- `resolution` optionally controls gradient sampling resolution in pixels.
- `spread` can be `pad` (default) or `repeat`.

The public fill contract is renderer-independent. Renderer resources and
sampling objects are managed internally.

## Interaction Appearance

`hover`, `click`, and `rightClick` can override `fill` and `alpha` while their
pointer state is active. The same objects continue to carry event metadata.

| Field         | `hover` | `click` | `rightClick` |
| ------------- | ------- | ------- | ------------ |
| `fill`        | Yes     | Yes     | Yes          |
| `alpha`       | Yes     | Yes     | Yes          |
| `soundSrc`    | Yes     | Yes     | Yes          |
| `soundVolume` | Yes     | Yes     | Yes          |
| `payload`     | Yes     | Yes     | Yes          |
| `cursor`      | Yes     | No      | No           |

```yaml
fill: "#202020"
alpha: 0.8
hover:
  fill: "#303030"
  alpha: 0.9
  cursor: pointer
click:
  fill: "#101010"
  alpha: 0.7
  payload:
    action: select
rightClick:
  fill: "#401010"
  alpha: 0.75
```

The visual lifecycle is:

- hover appearance applies while the pointer is over the rect
- click appearance applies while the primary pointer is held down
- right-click appearance applies while the secondary pointer is held down
- releasing outside clears pressed appearance without emitting a successful
  click event

When states overlap, each field resolves independently in this order:

1. active `rightClick`
2. active `click`
3. active `hover`
4. current base value

This means a click state that defines only `alpha` keeps the active hover fill.
Base fill and alpha animations continue underneath interaction overrides;
releasing an override reveals the latest animated value.

Route Graphics uses `alpha` as its canonical renderer field. It does not accept
`opacity`, `colorId`, or other embedding-layer aliases in interaction objects.
Embedding layers must resolve those values before rendering. Keys inside
`payload` are arbitrary event data and are never interpreted as appearance.

## Rect Style Animation

Rect style timelines live directly below `tween`, beside normal transform
timelines. Numeric properties support manual keyframes or `auto`. Color
timelines accept color strings and interpolate their RGBA channels.

```yaml
animations:
  - id: reshape-panel
    targetId: panel
    type: update
    tween:
      width:
        auto: { duration: 600, easing: easeInOutCubic }
      height:
        auto: { duration: 600, easing: easeInOutCubic }
      fill:
        color:
          keyframes:
            - duration: 600
              value: "#7c3aed"
              easing: easeInOutCubic
      border:
        width:
          auto: { duration: 600 }
        color:
          auto: { duration: 600 }
        alpha:
          auto: { duration: 600 }
      cornerRadius:
        topLeft:
          auto: { duration: 600 }
        topRight:
          auto: { duration: 600 }
        bottomRight:
          auto: { duration: 600 }
        bottomLeft:
          auto: { duration: 600 }
```

Gradient geometry and stops can also be animated:

```yaml
tween:
  fill:
    start:
      x:
        auto: { duration: 800 }
    end:
      y:
        auto: { duration: 800 }
    stops:
      - index: 0
        offset:
          auto: { duration: 800 }
        color:
          auto: { duration: 800 }
```

The current and destination fills must have compatible types. `fill.color`
requires a solid fill; gradient point/radius properties require the matching
gradient type; and stop indices must exist in the destination.

## Validation and Pixel Alignment

Rect input is validated before rendering. Unknown properties, invalid colors,
non-positive dimensions or scales, malformed gradients, invalid event shapes,
and non-finite numbers fail with a field-specific error.

Computed rect geometry is aligned to whole logical pixels. Fractional authored
dimensions, positions, origins, and scaled dimensions are rounded during
parsing; animation samples may still be fractional between frames.

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
      fill: "0x303030"
      alpha: 0.9
      cursor: pointer
      soundSrc: hover-sfx
      payload:
        action: panelHover
    click:
      fill: "0x101010"
      alpha: 0.7
      soundSrc: click-sfx
      soundVolume: 90
      payload:
        action: panelClick
    rightClick:
      fill: "0x401010"
      alpha: 0.75
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
