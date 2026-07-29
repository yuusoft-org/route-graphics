---
template: docs-documentation
title: Input Node
tags: documentation
sidebarId: node-input
---

`input` renders an editable text field. Route Graphics draws the visible text, placeholder, caret, selection, fill, border, and focus ring while a hidden native input or textarea provides browser editing behavior.

Try it in the [Playground](/playground/).

## Used In

- `elements[]`

## Field Reference

| Field         | Type             | Required | Default       | Notes                                                                                        |
| ------------- | ---------------- | -------- | ------------- | -------------------------------------------------------------------------------------------- |
| `id`          | string           | Yes      | -             | Element id.                                                                                  |
| `type`        | string           | Yes      | -             | Must be `input`.                                                                             |
| `x`           | number           | Yes      | -             | Position before anchor transform.                                                            |
| `y`           | number           | Yes      | -             | Position before anchor transform.                                                            |
| `width`       | number           | Yes      | -             | Field width.                                                                                 |
| `height`      | number           | Yes      | -             | Field height.                                                                                |
| `anchorX`     | number           | No       | `0`           | Anchor offset ratio.                                                                         |
| `anchorY`     | number           | No       | `0`           | Anchor offset ratio.                                                                         |
| `originX`     | number           | No       | anchor        | Transform origin X in pixels.                                                                |
| `originY`     | number           | No       | anchor        | Transform origin Y in pixels.                                                                |
| `rotation`    | number           | No       | `0`           | Degrees.                                                                                     |
| `value`       | string           | No       | `""`          | Initial value.                                                                               |
| `placeholder` | string           | No       | `""`          | Placeholder text when value is empty.                                                        |
| `multiline`   | boolean          | No       | `false`       | Uses textarea-style editing.                                                                 |
| `disabled`    | boolean          | No       | `false`       | Disables focus and editing.                                                                  |
| `maxLength`   | number           | No       | -             | Maximum character count.                                                                     |
| `alpha`       | number           | No       | `1`           | Opacity `0..1`.                                                                              |
| `fill`        | string \| object | No       | `"#FFFFFF"`   | Field fill. Matches `rect.fill`.                                                             |
| `border`      | object           | No       | see below     | Field border. Matches `rect.border`.                                                         |
| `focusRing`   | object           | No       | see below     | Stroke drawn while focused.                                                                  |
| `textStyle`   | object           | No       | default text  | Text style for value and placeholder; `fontFamily` accepts a string or ordered string array. |
| `padding`     | number \| object | No       | `10 12 10 12` | Inner content padding.                                                                       |
| `change`      | object           | No       | -             | Change event config.                                                                         |
| `submit`      | object           | No       | -             | Submit event config.                                                                         |
| `focusEvent`  | object           | No       | -             | Focus event config.                                                                          |
| `blurEvent`   | object           | No       | -             | Blur event config.                                                                           |

### `border`

| Field   | Type   | Default     |
| ------- | ------ | ----------- |
| `width` | number | `1`         |
| `color` | string | `"#2E2E2E"` |
| `alpha` | number | `1`         |

### `focusRing`

| Field   | Type   | Default     |
| ------- | ------ | ----------- |
| `width` | number | `2`         |
| `color` | string | `"#4A89FF"` |
| `alpha` | number | `1`         |

### `fill`

`fill` accepts the same values as `rect.fill`, including plain colors, `transparent`, solid objects, linear gradients, and radial gradients.

```yaml
fill: "#111827"
```

```yaml
fill:
  type: linear-gradient
  start: { x: 0, y: 0 }
  end: { x: 1, y: 0 }
  stops:
    - offset: 0
      color: "#1D4ED8"
    - offset: 1
      color: "#0F766E"
```

## Example

```yaml
elements:
  - id: name
    type: input
    x: 60
    y: 60
    width: 320
    height: 56
    placeholder: Your name
    fill: "#111827"
    border:
      width: 2
      color: "#64748B"
      alpha: 1
    focusRing:
      width: 4
      color: "#38BDF8"
      alpha: 1
    textStyle:
      fill: "#F8FAFC"
      fontSize: 22
    padding:
      top: 12
      right: 16
      bottom: 12
      left: 16
```
