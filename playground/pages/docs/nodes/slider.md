---
template: docs-documentation
title: Slider Node
tags: documentation
sidebarId: node-slider
---

`slider` renders an interactive value selector with thumb and bar textures.

Try it in the [Playground](/playground/?template=slider-demo).

## Used In

- `elements[]`

## Field Reference

| Field            | Type                       | Required      | Default      | Notes                                                                            |
| ---------------- | -------------------------- | ------------- | ------------ | -------------------------------------------------------------------------------- |
| `id`             | string                     | Yes           | -            | Element id.                                                                      |
| `type`           | string                     | Yes           | -            | Must be `slider`.                                                                |
| `x`              | number                     | Yes           | -            | Position before anchor transform.                                                |
| `y`              | number                     | Yes           | -            | Position before anchor transform.                                                |
| `width`          | number                     | Yes (runtime) | -            | Required by parser.                                                              |
| `height`         | number                     | Yes (runtime) | -            | Required by parser.                                                              |
| `direction`      | `horizontal` \| `vertical` | Yes           | `horizontal` | Track direction.                                                                 |
| `thumbSrc`       | string                     | Yes           | `""`         | Thumb texture alias.                                                             |
| `barSrc`         | string                     | Yes           | `""`         | Bar texture alias. If `inactiveBarSrc` is set, this is the active track texture. |
| `inactiveBarSrc` | string                     | No            | -            | Optional inactive track texture rendered underneath `barSrc`.                    |
| `initialValue`   | number                     | Yes (runtime) | -            | Must be between `min` and `max`.                                                 |
| `min`            | number                     | No            | `0`          | Range min.                                                                       |
| `max`            | number                     | No            | `100`        | Must be `>` `min`.                                                               |
| `step`           | number                     | No            | `1`          | If `> 0`, value snaps by step.                                                   |
| `anchorX`        | number                     | No            | `0`          | Anchor offset ratio.                                                             |
| `anchorY`        | number                     | No            | `0`          | Anchor offset ratio.                                                             |
| `originX`        | number                     | No            | anchor       | Transform origin X in pixels.                                                    |
| `originY`        | number                     | No            | anchor       | Transform origin Y in pixels.                                                    |
| `rotation`       | number                     | No            | `0`          | Degrees.                                                                         |
| `alpha`          | number                     | No            | `1`          | Opacity `0..1`.                                                                  |
| `filters`        | array                      | No            | `[]`         | Ordered inline shader effects.                                                   |
| `hover`          | object                     | No            | -            | Hover textures/sound/cursor.                                                     |
| `change`         | object                     | No            | -            | Event payload on value changes.                                                  |

`filters` post-processes the complete track and thumb container. See
[Shaders](/docs/guides/shaders/).

## Runtime Validation

- `max` must be strictly larger than `min`.
- `initialValue` is required by parser and must be a valid number.
- `initialValue` must be within `[min, max]`.
- When `inactiveBarSrc` is set, the active track reveal follows the current slider value.

## Emitted Events

| Event Name | Fired When                            | Payload Shape                                  |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| `change`   | value changes while dragging/clicking | `{ _event: { id, value }, ...change.payload }` |

## Example: Minimal

```yaml
elements:
  - id: volume
    type: slider
    x: 80
    y: 560
    width: 360
    height: 40
    direction: horizontal
    thumbSrc: horizontal-idle-thumb
    barSrc: horizontal-idle-bar
    initialValue: 50
```

## Example: Hover + Value Action

```yaml
elements:
  - id: sfx-volume
    type: slider
    x: 90
    y: 620
    width: 420
    height: 44
    direction: horizontal
    thumbSrc: horizontal-idle-thumb
    barSrc: horizontal-idle-bar
    min: 0
    max: 100
    step: 5
    initialValue: 65
    hover:
      thumbSrc: horizontal-hover-thumb
      barSrc: horizontal-hover-bar
      cursor: pointer
      soundSrc: hover-sfx
    change:
      payload:
        action: setSfxVolume
```

## Example: Split Track

```yaml
elements:
  - id: music-volume
    type: slider
    x: 90
    y: 680
    width: 420
    height: 44
    direction: horizontal
    thumbSrc: horizontal-idle-thumb
    barSrc: horizontal-hover-bar
    inactiveBarSrc: horizontal-idle-bar
    min: 0
    max: 100
    step: 5
    initialValue: 35
    hover:
      thumbSrc: horizontal-hover-thumb
      barSrc: horizontal-idle-bar
      inactiveBarSrc: horizontal-hover-bar
      cursor: pointer
```

## Example: Vertical Slider

```yaml
elements:
  - id: brightness
    type: slider
    x: 1120
    y: 120
    width: 42
    height: 300
    direction: vertical
    thumbSrc: vertical-idle-thumb
    barSrc: vertical-idle-bar
    min: 0
    max: 10
    step: 1
    initialValue: 7
```
