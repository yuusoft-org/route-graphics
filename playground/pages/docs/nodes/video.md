---
template: docs-documentation
title: Video Node
tags: documentation
sidebarId: node-video
---

`video` renders an HTML video as a Pixi texture.

Try it in the [Playground](/playground/?template=video-demo).

## Used In

- `elements[]`

## Field Reference

| Field      | Type    | Required            | Default        | Notes                             |
| ---------- | ------- | ------------------- | -------------- | --------------------------------- |
| `id`       | string  | Yes                 | -              | Element id.                       |
| `type`     | string  | Yes                 | -              | Must be `video`.                  |
| `x`        | number  | Yes (public schema) | `0` at runtime | Position before anchor transform. |
| `y`        | number  | Yes (public schema) | `0` at runtime | Position before anchor transform. |
| `width`    | number  | Yes                 | -              | Render width.                     |
| `height`   | number  | Yes                 | -              | Render height.                    |
| `src`      | string  | Yes                 | -              | Video source alias/URL.           |
| `anchorX`  | number  | No                  | `0`            | Anchor offset ratio.              |
| `anchorY`  | number  | No                  | `0`            | Anchor offset ratio.              |
| `originX`  | number  | No                  | anchor         | Transform origin X in pixels.     |
| `originY`  | number  | No                  | anchor         | Transform origin Y in pixels.     |
| `rotation` | number  | No                  | `0`            | Degrees.                          |
| `alpha`    | number  | No                  | `1`            | Opacity `0..1`.                   |
| `volume`   | number  | No                  | `100`          | Runtime uses `volume / 100`.      |
| `loop`     | boolean | No                  | `false`        | Replay video on end.              |
| `blur`     | object  | No                  | -              | Directional Gaussian blur.        |

## Blur

`blur` requires explicit horizontal and vertical axes. There is no scalar shorthand.

| Field              | Type    | Required | Default | Notes                                             |
| ------------------ | ------- | -------- | ------- | ------------------------------------------------- |
| `x`                | number  | Yes      | -       | Horizontal blur strength in pixels.               |
| `y`                | number  | Yes      | -       | Vertical blur strength in pixels.                 |
| `quality`          | number  | No       | `4`     | Number of blur passes. Higher is smoother/slower. |
| `kernelSize`       | number  | No       | `5`     | One of `5`, `7`, `9`, `11`, `13`, `15`.           |
| `repeatEdgePixels` | boolean | No       | `false` | Clamp edge pixels instead of padding blur bounds. |

## Behavior Notes

- Video starts playing on add.
- On `src` update, previous video is paused and reset, then new source is loaded and played.
- No element-level interaction events are emitted by `video`.

## Example: Minimal

```yaml
elements:
  - id: intro
    type: video
    x: 0
    y: 0
    width: 1280
    height: 720
    src: video-sample
```

## Example: Looping Background Video

```yaml
elements:
  - id: bg-video
    type: video
    x: 0
    y: 0
    width: 1280
    height: 720
    src: background-loop.mp4
    loop: true
    volume: 20
    alpha: 0.9
```

## Example: Video Fade In

```yaml
elements:
  - id: cutscene
    type: video
    x: 80
    y: 60
    width: 1120
    height: 630
    src: chapter-1.mp4
    volume: 70

animations:
  - id: cutscene-fade
    targetId: cutscene
    type: live
    tween:
      alpha:
        initialValue: 0
        keyframes:
          - value: 1
            duration: 400
            easing: linear
```
