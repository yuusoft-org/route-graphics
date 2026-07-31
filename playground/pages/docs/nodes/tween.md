---
template: docs-documentation
title: Animation Node
tags: documentation
sidebarId: node-tween
---

`animations[]` is the declarative state-animation surface. Each animation
targets one element id and either changes one live object or performs a
previous/next visual handoff.

Try it in the [Playground](/playground/?template=animations-showcase).

## Used In

- `animations[]`

## Animation Shape

| Field        | Type   | Required   | Default  | Notes                                                             |
| ------------ | ------ | ---------- | -------- | ----------------------------------------------------------------- |
| `id`         | string | Yes        | -        | Animation id.                                                     |
| `targetId`   | string | Yes        | -        | Element id targeted in this render state.                         |
| `type`       | string | Yes        | -        | `update` or `transition`.                                         |
| `tween`      | object | Update     | -        | Standard update properties and filter timelines grouped by id.    |
| `playback`   | object | No         | defaults | Continuity, speed, and looping controls.                          |
| `prev`       | object | Transition | -        | Motion applied to the captured previous surface.                  |
| `next`       | object | Transition | -        | Motion applied to the captured next surface.                      |
| `mask`       | object | Transition | -        | Image-driven transition reveal field.                             |
| `compositor` | object | Transition | -        | Inline shader effect with its own required `tween.progress`.      |
| `complete`   | object | No         | -        | Parsed configuration; public completion is currently render-wide. |

Every animation requires a stable `id`, `targetId`, and `type`.

## Animation Types

### `update`

`update` changes properties on one live display object. Use it for motion,
opacity, scale, rotation, blur, or independently targeted shader parameters
where the element remains the same object.

The intended authoring contract is update-only. Use `transition` for a
previous/next replacement handoff, including enter, exit, and replacement
effects. Some element plugins still execute update tweens during add/delete for
legacy compatibility; new content should not depend on that behavior.

### `transition`

`transition` captures the visual before and after a state change and hands off
between those surfaces. Use it for:

- enter from transparent
- exit to transparent
- replacing content with the same `targetId`
- pushes, slides, fades, and wipes
- single or sequence mask dissolves
- custom shader compositors

A transition may compose `prev`, `next`, `mask`, and `compositor`. Missing
previous or next content is treated as transparent. When both mask and
compositor are present, the mask executes before the custom compositor passes.

## Update Tween Properties

These properties are valid under `type: update`:

| Property       | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `x`, `y`       | Absolute position in the parent coordinate space.       |
| `translateX`   | Offset in units of the target's own width.              |
| `translateY`   | Offset in units of the target's own height.             |
| `alpha`        | Opacity.                                                |
| `scaleX`       | Horizontal scale.                                       |
| `scaleY`       | Vertical scale.                                         |
| `rotation`     | Rotation in degrees.                                    |
| `blurX`        | Horizontal `blur.x` strength.                           |
| `blurY`        | Vertical `blur.y` strength.                             |
| `width`        | Rect geometry width.                                    |
| `height`       | Rect geometry height.                                   |
| `fill`         | Rect fill color, gradient geometry, or gradient stops.  |
| `border`       | Rect border width, color, or alpha.                     |
| `cornerRadius` | Rect uniform or independent corner radii.               |
| `filters`      | Parameter timelines grouped by inline shader filter id. |

`x` cannot be combined with `translateX` in one tween, and `y` cannot be
combined with `translateY`.

`blurX` and `blurY` animate only blur strength. Static blur settings such as
`quality`, `kernelSize`, and `repeatEdgePixels` are not tween targets.

`width`, `height`, `fill`, `border`, and `cornerRadius` are valid only for
`rect` targets. See [Rect Node](/docs/nodes/rect/) for their nested timeline
shape and gradient-stop indexing.

## Shader Parameter Tweens

Put filter timelines inside the normal update `tween`, grouped by filter id:

```yaml
animations:
  - id: pulse-glow
    targetId: portrait
    type: update
    tween:
      alpha:
        keyframes:
          - duration: 500
            value: 1
      filters:
        glow:
          strength:
            keyframes:
              - duration: 500
                value: 1
                easing: easeInOutSine
          tint:
            keyframes:
              - duration: 500
                value: [0.4, 0.7, 1]
          progress:
            initialValue: 0
            keyframes:
              - duration: 500
                value: 1
```

Ordinary properties and multiple filter ids may coexist in one `tween`.
Parameter keys refer to top-level effect `parameters` (or legacy `uniforms`).
The authored `progress` key targets the selected filter's `uProgress`.

Shader values may be a finite number or a numeric array with length 2, 3, 4, 9,
or 16. Arrays interpolate and apply relative keyframes component by component.
Values must have the same shape as the target parameter.

Only one active animation may write a particular
`targetId + filterId + parameter` channel. `uTime`/`time` is a read-only
deterministic clock and cannot be tweened.

## Manual Keyframes

Each update property accepts:

| Field          | Type   | Required | Default                | Notes                                   |
| -------------- | ------ | -------- | ---------------------- | --------------------------------------- |
| `initialValue` | number | No       | current property value | Value sampled before the first segment. |
| `keyframes`    | array  | Yes      | -                      | Ordered animation segments.             |

Each keyframe accepts:

| Field      | Type    | Required | Default  | Notes                                              |
| ---------- | ------- | -------- | -------- | -------------------------------------------------- |
| `value`    | number  | Yes      | -        | Target value for this segment.                     |
| `duration` | number  | Yes      | -        | Milliseconds used to reach this value.             |
| `easing`   | string  | No       | `linear` | Easing used by the segment reaching this keyframe. |
| `relative` | boolean | No       | `false`  | Treat `value` as a delta from the preceding value. |

```yaml
animations:
  - id: card-shift
    targetId: card
    type: update
    tween:
      x:
        initialValue: 100
        keyframes:
          - duration: 450
            value: 800
            easing: easeOutQuad
      alpha:
        keyframes:
          - duration: 300
            value: 1
            easing: linear
```

## Automatic End Value

Update properties also support `auto`, which generates one segment from the
current live value to the value in the next render state:

```yaml
animations:
  - id: card-shift
    targetId: card
    type: update
    tween:
      x:
        auto:
          duration: 450
          easing: easeOutQuad
      y:
        auto:
          duration: 450
          easing: easeOutQuad
```

| Field      | Type   | Required | Default  |
| ---------- | ------ | -------- | -------- |
| `duration` | number | Yes      | -        |
| `easing`   | string | No       | `linear` |

`auto` and `keyframes` are mutually exclusive for one property. `auto` is not
supported on `prev.tween` or `next.tween`.

## Easing

Supported easing names are:

- `linear`
- `easeInQuad`, `easeOutQuad`, `easeInOutQuad`
- `easeInCubic`, `easeOutCubic`, `easeInOutCubic`
- `easeInQuart`, `easeOutQuart`, `easeInOutQuart`
- `easeInQuint`, `easeOutQuint`, `easeInOutQuint`
- `easeInSine`, `easeOutSine`, `easeInOutSine`
- `easeInExpo`, `easeOutExpo`, `easeInOutExpo`
- `easeInCirc`, `easeOutCirc`, `easeInOutCirc`
- `easeInBack`, `easeOutBack`, `easeInOutBack`
- `easeInBounce`, `easeOutBounce`, `easeInOutBounce`
- `easeInElastic`, `easeOutElastic`, `easeInOutElastic`

## Playback

```yaml
playback:
  continuity: persistent
  speed: 1
  loop: true
```

| Field        | Type    | Default  | Notes                                               |
| ------------ | ------- | -------- | --------------------------------------------------- |
| `continuity` | string  | `render` | `render` or `persistent`.                           |
| `speed`      | number  | `1`      | Finite multiplier greater than zero.                |
| `loop`       | boolean | `false`  | Infinite repetition; valid only for `type: update`. |

`speed: 2` runs twice as fast and `speed: 0.5` runs at half authored speed.

### Render-Scoped Playback

`continuity: render`, or omitting `playback`, ties the animation to the current
render. A later changed render may cancel it. If the animation is authored
again later, it starts from the beginning.

Finite render-scoped animations contribute to the global `renderComplete`
event.

### Persistent Playback

`continuity: persistent` allows the same in-flight animation to continue across
unrelated later renders instead of restarting.

For an update, continuity requires:

- unchanged animation `id`
- unchanged `targetId`
- unchanged normalized `tween`, filter timelines, and `playback`
- the same live target object and ownership path

For a transition, continuity additionally requires unchanged `prev`, `next`,
`mask`, inline `compositor` including its tween, and `playback` configuration,
plus the same owned target subtree.

Persistent transitions keep their original captured handoff. They do not
retarget or rebuild snapshots when unrelated content changes.

Persistent animations do not contribute to `renderComplete`.

### Looping Updates

`playback.loop: true` repeats the complete update timeline indefinitely.
Looping transitions are rejected.

Loops:

- require a finite authored duration greater than zero
- compose with `playback.speed`
- do not contribute to `renderComplete`
- do not emit completion after each iteration
- cannot define `complete`
- restart if their tween or playback configuration changes

```yaml
animations:
  - id: background-breathe
    targetId: background
    type: update
    playback:
      continuity: persistent
      loop: true
    tween:
      scaleX:
        initialValue: 1
        keyframes:
          - duration: 3000
            value: 1.05
            easing: easeInOutSine
          - duration: 3000
            value: 1
            easing: easeInOutSine
      scaleY:
        initialValue: 1
        keyframes:
          - duration: 3000
            value: 1.05
            easing: easeInOutSine
          - duration: 3000
            value: 1
            easing: easeInOutSine
```

## Transition Surface Motion

`prev.tween` and `next.tween` independently animate captured surfaces.

Supported properties:

- `x`, `y`
- `translateX`, `translateY`
- `alpha`
- `scaleX`, `scaleY`
- `rotation`

`x` and `y` use absolute parent coordinates. `translateX: 1` moves by one
animated subject width, while `translateY: -1` moves by one subject height
upward.

Transition sides use manual keyframes:

```yaml
animations:
  - id: scene-push-left
    targetId: scene-root
    type: transition
    prev:
      tween:
        translateX:
          initialValue: 0
          keyframes:
            - duration: 500
              value: -1
              easing: easeInOutCubic
    next:
      tween:
        translateX:
          initialValue: 1
          keyframes:
            - duration: 500
              value: 0
              easing: easeInOutCubic
```

## Transition Masks

`mask` is valid only on `type: transition`. It can be combined with `prev` and
`next` surface motion.

Common fields:

| Field      | Type    | Default   | Notes                                     |
| ---------- | ------- | --------- | ----------------------------------------- |
| `kind`     | string  | -         | Required: `single` or `sequence`.         |
| `channel`  | string  | `red`     | `red`, `green`, `blue`, or `alpha`.       |
| `invert`   | boolean | `false`   | Reverses the sampled reveal field.        |
| `progress` | object  | immediate | Manual keyframe timeline from `0` to `1`. |

### Single Mask

```yaml
mask:
  kind: single
  texture: spiral-mask
  channel: red
  softness: 0.08
  progress:
    initialValue: 0
    keyframes:
      - duration: 900
        value: 1
        easing: linear
```

`texture` is required. `softness` controls the feathered reveal threshold.

### Sequence Mask

```yaml
mask:
  kind: sequence
  channel: alpha
  sample: linear
  progress:
    initialValue: 0
    keyframes:
      - duration: 1000
        value: 1
        easing: linear
  frames:
    - at: 0
      texture: masks/frame-0
    - at: 0.5
      texture: masks/frame-1
    - at: 1
      texture: masks/frame-2
```

Sequence rules:

- at least two frames
- unique ascending `at` values
- first frame at `0` and last frame at `1`
- `sample: hold` by default, or `sample: linear`
- feathering belongs in frame alpha; `softness` is not supported

## Shader Compositors

`compositor` is a transition-only inline shader effect that receives the
captured previous and next surfaces. It may define one `source` or an ordered
`passes` chain.

When a compositor is present:

- `compositor.tween.progress` is required and maps to `uProgress`
- `prev.tween` and `next.tween` may still animate the captured surfaces
- the compositor may provide a subdivided `mesh.grid`
- `mask` may be used and executes before custom compositor passes
- custom compositor parameter timelines live beside `progress`

```yaml
animations:
  - id: shader-crossfade
    targetId: scene-root
    type: transition
    compositor:
      type: shader
      parameters:
        vignette: 0.15
      source:
        webgl:
          fragment: |
            // GLSL fragment source
        webgpu:
          source: |
            // WGSL source with mainVertex and mainFragment
      tween:
        progress:
          initialValue: 0
          keyframes:
            - duration: 800
              value: 1
              easing: easeInOutCubic
        vignette:
          keyframes:
            - duration: 800
              value: 0.35
```

See [Shaders](/docs/guides/shaders/) for source layouts, built-in inputs,
multi-pass rules, parameter and texture binding, deterministic time, mesh
behavior, and alpha requirements.

## Enter And Exit Examples

### Enter Fade

```yaml
animations:
  - id: title-enter
    targetId: title
    type: transition
    next:
      tween:
        alpha:
          initialValue: 0
          keyframes:
            - duration: 300
              value: 1
              easing: linear
```

### Exit Fade

```yaml
animations:
  - id: title-exit
    targetId: title
    type: transition
    prev:
      tween:
        alpha:
          initialValue: 1
          keyframes:
            - duration: 300
              value: 0
              easing: linear
```

## Relative Keyframes

```yaml
animations:
  - id: chip-pulse
    targetId: chip
    type: update
    tween:
      x:
        keyframes:
          - duration: 120
            value: 20
            easing: linear
            relative: true
          - duration: 120
            value: -20
            easing: linear
            relative: true
          - duration: 120
            value: 0
            easing: linear
            relative: true
```

## Coordination And Completion

- Animations targeting one element cannot mix `update` and `transition` in the
  same render state.
- A parent transition owns its captured subtree while active. Descendant
  animations for the same state change are deferred until the parent
  transition finalizes.
- A later render interruption cancels pending render-scoped animations and
  emits `renderComplete` for the interrupted state with `aborted: true`.
- Public per-animation completion callbacks are not currently emitted through
  `eventHandler`.
- Use the global `renderComplete` event to know when finite tracked tweens,
  text reveals, and non-looping video have settled.
