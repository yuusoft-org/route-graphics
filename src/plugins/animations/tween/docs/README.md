# Animation Model

Route Graphics uses one `animations` list for both persistent-element motion and prev/next transition effects.

## Required Fields

Every animation requires:

```yaml
animations:
  - id: "move-makkuro"
    targetId: "makkuro"
    type: "update"
```

- `targetId` always points to an element id.
- `type` is required and must be one of:
  - `update`
  - `transition`

## Update Animations

`update` animates a single display object with `tween`.

Each `tween` property can use either:

- manual `keyframes`
- shorthand `auto`

`keyframes` and `auto` are mutually exclusive on the same property.

Inline shader filter parameters use `tween.filters.<filterId>`. They use manual
keyframes and may coexist with ordinary element properties in the same update.

Position tweens support `x` / `y` and `translateX` / `translateY` in both
`update` and `transition`. `x` / `y` are absolute parent-space pixels.
`translateX` / `translateY` are subject-size multipliers, so `translateX: -1`
moves left by one subject width. A tween cannot define both `x` and
`translateX`, or both `y` and `translateY`.

Each keyframe's `easing` applies to the segment that reaches that keyframe
from the previous value. The first authored keyframe controls the segment from
the current value to that keyframe. `auto.easing` controls the single segment
from the current value to the next state value.

Use `update` only when the same target stays mounted before and after the
change. Do not use it for first-enter or final-exit. Those are `transition`
cases.

```yaml
states:
  - elements:
      - id: "makkuro"
        type: "sprite"
        x: 640
        y: 120
        src: "characters/makkuro-idle.png"
        alpha: 0.4
  - elements:
      - id: "makkuro"
        type: "sprite"
        x: 640
        y: 120
        src: "characters/makkuro-idle.png"
        alpha: 1
    animations:
      - id: "makkuro-fade-up"
        targetId: "makkuro"
        type: "update"
        tween:
          alpha:
            keyframes:
              - duration: 300
                value: 1
                easing: linear
```

Shorthand update tween:

```yaml
states:
  - elements:
      - id: "makkuro"
        type: "sprite"
        x: 640
        y: 120
        src: "characters/makkuro-idle.png"
        alpha: 1
  - elements:
      - id: "makkuro"
        type: "sprite"
        x: 220
        y: 180
        src: "characters/makkuro-idle.png"
        alpha: 1
    animations:
      - id: "makkuro-move"
        targetId: "makkuro"
        type: "update"
        tween:
          x:
            auto:
              duration: 300
              easing: easeOutQuad
          y:
            auto:
              duration: 300
              easing: easeOutQuad
```

## Transition Animations

`transition` keeps the same `targetId` but animates the previous and next visuals separately.

Use `transition` for:

- enter with `next` only
- exit with `prev` only
- replace with `prev` and `next`

Geometry-only transition:

```yaml
states:
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
    animations:
      - id: "scene-push-left"
        targetId: "scene-root"
        type: "transition"
        prev:
          tween:
            translateX:
              initialValue: 0
              keyframes:
                - duration: 500
                  value: -1
                  easing: linear
        next:
          tween:
            translateX:
              initialValue: 1
              keyframes:
                - duration: 500
                  value: 0
                  easing: linear
```

Mask-driven transition:

```yaml
states:
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
    animations:
      - id: "scene-rule-dissolve"
        targetId: "scene-root"
        type: "transition"
        mask:
          - kind: "single"
            texture: "masks/spiral-07.png"
            channel: "red"
            softness: 0.08
            delay: 200
            progress:
              initialValue: 0
              keyframes:
                - duration: 900
                  value: 1
                  easing: linear
```

Sequence mask transition:

```yaml
states:
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
  - elements:
      - id: "scene-root"
        type: "container"
        children: []
    animations:
      - id: "scene-sequence-wipe"
        targetId: "scene-root"
        type: "transition"
        mask:
          - kind: "sequence"
            progress:
              initialValue: 0
              keyframes:
                - duration: 900
                  value: 1
                  easing: linear
            sample: "linear"
            frames:
              - at: 0
                texture: "masks/wipe-a.png"
              - at: 0.5
                texture: "masks/wipe-b.png"
              - at: 1
                texture: "masks/wipe-c.png"
            channel: "alpha"
```

For sequence masks, `progress` drives frame selection. The sampled frame value
directly controls the reveal amount. `sample: hold` holds each frame until the
next `at`, while `sample: linear` blends between adjacent frames. Sequence
frames must start at `0`, end at `1`, and be sorted by unique `at` values.
Feathering belongs in the frame alpha; `softness` is not valid for sequence
masks.

`mask` accepts the existing single-object shape or a non-empty array. A single
object is normalized internally to a one-entry array. Each entry has its own
progress and optional delay. Entries combine as a per-pixel maximum reveal: the
strongest mask wins where they overlap, while delayed masks contribute no reveal
before they start.

## Current Transition Rules

- `update` is update-only. Integrations should reject `type: update` for enter, exit, and replace paths.
- `mask` is transition-only and accepts one object or a non-empty array.
- a custom shader-backed transition uses an inline `compositor` with
  `compositor.tween.progress` and optional parameter timelines.
- `prev.tween` and `next.tween` can be combined with `mask`.
- if an ancestor `transition` is active for the same change, nested child transitions are suppressed until finalize

The design notes live in:

- `docs/animation-model.md`
- `docs/animation-type-semantics.md`
- `docs/animation-implementation-plan.md`
