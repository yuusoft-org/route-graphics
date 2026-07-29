---
template: docs-documentation
title: Text Node
tags: documentation
sidebarId: node-text
---

`text` renders static text with styling and interaction handlers. `content` may be a string or an array of rich text segments.

Try it in the [Playground](/playground/?template=interactive-elements).

## Used In

- `elements[]`

## Field Reference

| Field        | Type            | Required            | Default         | Notes                                                                            |
| ------------ | --------------- | ------------------- | --------------- | -------------------------------------------------------------------------------- |
| `id`         | string          | Yes                 | -               | Element id.                                                                      |
| `type`       | string          | Yes                 | -               | Must be `text`.                                                                  |
| `x`          | number          | Yes (public schema) | `0` at runtime  | Position before anchor transform.                                                |
| `y`          | number          | Yes (public schema) | `0` at runtime  | Position before anchor transform.                                                |
| `content`    | string \| array | No                  | `""`            | Strings render as one Pixi text object. Arrays render static rich text segments. |
| `width`      | number          | No                  | auto            | Fixed layout box width. Also enables wrapping (`wordWrapWidth = width`).         |
| `anchorX`    | number          | No                  | `0`             | Can be outside `0..1`.                                                           |
| `anchorY`    | number          | No                  | `0`             | Can be outside `0..1`.                                                           |
| `originX`    | number          | No                  | anchor          | Transform origin X in pixels from the layout box.                                |
| `originY`    | number          | No                  | anchor          | Transform origin Y in pixels from the layout box.                                |
| `rotation`   | number          | No                  | `0`             | Degrees.                                                                         |
| `alpha`      | number          | No                  | `1`             | Opacity `0..1`.                                                                  |
| `textStyle`  | object          | No                  | engine defaults | See table below.                                                                 |
| `hover`      | object          | No                  | -               | Hover style, cursor, sound, payload.                                             |
| `click`      | object          | No                  | -               | Press style, sound, payload.                                                     |
| `rightClick` | object          | No                  | -               | Right-press style, sound, payload.                                               |
| `scrollUp`   | object          | No                  | -               | Wheel-up payload hook.                                                           |
| `scrollDown` | object          | No                  | -               | Wheel-down payload hook.                                                         |

### `textStyle`

| Field           | Type                          | Default       |
| --------------- | ----------------------------- | ------------- |
| `fill`          | string                        | `black`       |
| `fontFamily`    | string \| string[]            | `Arial`       |
| `fontSize`      | number                        | `16`          |
| `align`         | `left` \| `center` \| `right` | `left`        |
| `lineHeight`    | number                        | `1.2`         |
| `wordWrap`      | boolean                       | `false`       |
| `breakWords`    | boolean                       | `false`       |
| `wordWrapWidth` | number                        | `0`           |
| `strokeColor`   | string                        | `transparent` |
| `strokeWidth`   | number                        | `0`           |
| `shadow`        | object \| null                | -             |

`fontFamily` arrays are ordered fallback lists. Pixi uses the first available family, so one project font alias can fall back to another, such as `[uiFont, fallbackFont]`.

### `textStyle.shadow`

`shadow` enables a single text shadow. Omit it for no shadow. Set it to `null` inside an interaction style to remove a base shadow for that state.

| Field     | Type   | Default |
| --------- | ------ | ------- |
| `color`   | string | `black` |
| `alpha`   | number | `1`     |
| `blur`    | number | `0`     |
| `offsetX` | number | `2`     |
| `offsetY` | number | `2`     |

### `content[]` item shape

Array content uses the same static rich text segment shape as `text-revealing`, without reveal timing, indicators, or completion behavior.

| Field       | Type   | Required | Notes                                                              |
| ----------- | ------ | -------- | ------------------------------------------------------------------ |
| `text`      | string | Yes      | Segment text.                                                      |
| `textStyle` | object | No       | Overrides root style for this segment.                             |
| `furigana`  | object | No       | `{ text, textStyle, placement, gap }` rendered beside the segment. |

### `content[].furigana`

| Field       | Type              | Required | Default |
| ----------- | ----------------- | -------- | ------- |
| `text`      | string            | Yes      | -       |
| `textStyle` | object            | No       | segment |
| `placement` | `top` \| `bottom` | No       | `top`   |
| `gap`       | number `>= 0`     | No       | `0`     |

## Layout Notes

- When `width` is omitted, the text box width matches the rendered text width.
- When `width` is provided, the text box width stays fixed to that value.
- `align: center` and `align: right` place the rendered text inside that fixed-width box.
- String content uses one Pixi text object. Array content uses a container with one Pixi text object per segment part.
- Interaction `textStyle` overrides apply to every rendered rich text part. Rich text wrapping is calculated from the base state, so avoid layout-changing interaction styles on segmented content.

## Emitted Events

| Event Name   | Fired When               | Payload Shape                               |
| ------------ | ------------------------ | ------------------------------------------- |
| `hover`      | pointer enters text      | `{ _event: { id }, ...hover.payload }`      |
| `click`      | pointer up on text       | `{ _event: { id }, ...click.payload }`      |
| `rightClick` | right pointer up on text | `{ _event: { id }, ...rightClick.payload }` |
| `scrollUp`   | wheel up over text       | `{ _event: { id }, ...scrollUp.payload }`   |
| `scrollDown` | wheel down over text     | `{ _event: { id }, ...scrollDown.payload }` |

## Example: Minimal

```yaml
elements:
  - id: title
    type: text
    x: 40
    y: 32
    content: "Route Graphics"
```

## Example: Static Rich Text

```yaml
elements:
  - id: rich-label
    type: text
    x: 40
    y: 96
    width: 480
    textStyle:
      fill: "#FFFFFF"
      fontSize: 28
      fontFamily: Arial
    content:
      - text: "Route "
      - text: "Graphics"
        textStyle:
          fill: "#D9D9D9"
          fontWeight: bold
      - text: " supports inline segments."
        textStyle:
          fill: "#A6A6A6"
```

## Example: Interactive Styled Text

```yaml
elements:
  - id: menu-title
    type: text
    x: 100
    y: 80
    content: "Start Game"
    textStyle:
      fill: "#ffffff"
      fontFamily: Arial
      fontSize: 42
      strokeColor: "#000000"
      strokeWidth: 4
      shadow:
        color: "#000000"
        alpha: 0.45
        blur: 6
        offsetX: 0
        offsetY: 4
    hover:
      cursor: pointer
      soundSrc: hover-sfx
      textStyle:
        fill: "#ffdd55"
        shadow:
          alpha: 0.8
          blur: 8
      payload:
        action: menuHover
        target: start
    click:
      soundSrc: click-sfx
      soundVolume: 85
      textStyle:
        fill: "#66ff99"
      payload:
        action: menuClick
        target: start
    rightClick:
      soundSrc: rightclick-sfx
      textStyle:
        fill: "#ff7777"
      payload:
        action: menuAlt
        target: start
    scrollUp:
      payload:
        action: menuPrevious
        target: start
    scrollDown:
      payload:
        action: menuNext
        target: start
```

## Example: Text With Enter Fade

```yaml
elements:
  - id: status
    type: text
    x: 60
    y: 640
    content: "Loading..."
    textStyle:
      fill: "#ffffff"
      fontSize: 24

animations:
  - id: status-fade
    targetId: status
    type: live
    tween:
      alpha:
        initialValue: 0
        keyframes:
          - value: 1
            duration: 300
            easing: linear
```
