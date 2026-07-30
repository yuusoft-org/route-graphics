---
template: docs-documentation
title: Particles Node
tags: documentation
sidebarId: node-particles
---

`particles` renders one particle emitter. The public authoring model is organized through high-level `modules` instead of raw emitter behaviors.

Try it in the [Playground](/playground/?template=particles-demo).

Need the exhaustive field reference? See `src/plugins/elements/particles/docs/SCHEMA.md` in the repository.

## Used In

- `elements[]`

## Top-Level Fields

| Field      | Type   | Required | Default | Notes                                              |
| ---------- | ------ | -------- | ------- | -------------------------------------------------- |
| `id`       | string | Yes      | -       | Element id.                                        |
| `type`     | string | Yes      | -       | Must be `particles`.                               |
| `width`    | number | Yes      | -       | Effect area width.                                 |
| `height`   | number | Yes      | -       | Effect area height.                                |
| `modules`  | object | Yes      | -       | Structured particle configuration.                 |
| `x`        | number | No       | `0`     | Container x.                                       |
| `y`        | number | No       | `0`     | Container y.                                       |
| `anchorX`  | number | No       | `0`     | Emitter-container anchor ratio on the X axis.      |
| `anchorY`  | number | No       | `0`     | Emitter-container anchor ratio on the Y axis.      |
| `originX`  | number | No       | anchor  | Element-level transform origin X in pixels.        |
| `originY`  | number | No       | anchor  | Element-level transform origin Y in pixels.        |
| `rotation` | number | No       | `0`     | Element-level rotation in degrees.                 |
| `alpha`    | number | No       | `1`     | Container alpha.                                   |
| `seed`     | number | No       | -       | Deterministic randomness for testing and previews. |
| `filters`  | array  | No       | `[]`    | Ordered inline shader effects.                     |

`filters` post-processes the emitter container after particle rendering. See
[Shaders](/docs/guides/shaders/).

## Modules

`particles` exposes four public modules:

- `emission`
- `movement`
- `appearance`
- `bounds`

### `modules.emission`

Controls when particles are created, how many can exist, how long they live, and where they come from.

| Field              | Type                    | Required        | Notes                          |
| ------------------ | ----------------------- | --------------- | ------------------------------ |
| `mode`             | `continuous` \| `burst` | Yes             | Emission behavior.             |
| `rate`             | number                  | Continuous only | Particles per second.          |
| `burstCount`       | number                  | Burst only      | Particles spawned immediately. |
| `maxActive`        | number                  | No              | Maximum active particles.      |
| `duration`         | number \| `infinite`    | No              | Emitter lifetime.              |
| `particleLifetime` | number \| range         | Yes             | Per-particle lifetime.         |
| `source`           | object                  | Yes             | Spawn source definition.       |

`source.kind` may be `point`, `rect`, `circle`, or `line`.

### `modules.movement`

Controls initial velocity and ongoing forces.

| Field          | Type    | Required | Notes                                       |
| -------------- | ------- | -------- | ------------------------------------------- |
| `velocity`     | object  | No       | Initial velocity definition.                |
| `acceleration` | object  | No       | Ongoing acceleration vector.                |
| `maxSpeed`     | number  | No       | Optional speed clamp.                       |
| `faceVelocity` | boolean | No       | Rotate particles to match travel direction. |

`velocity.kind` may be:

- `directional`
- `radial`

### `modules.appearance`

Controls how particles look.

| Field      | Type                        | Required | Notes                            |
| ---------- | --------------------------- | -------- | -------------------------------- |
| `texture`  | string \| shape \| selector | Yes      | Base sprite or texture selector. |
| `scale`    | object                      | No       | Size control.                    |
| `alpha`    | object                      | No       | Opacity control.                 |
| `color`    | object                      | No       | Tint control.                    |
| `rotation` | object                      | No       | Rotation control.                |

`appearance.texture` may be:

- a single texture alias, such as `snowflake`
- an inline shape texture
- a selector with `mode: single | random | cycle`

Texture selectors support:

- `pick: perParticle | perWave`
- weighted items for `mode: random`

### `modules.bounds`

Controls what happens when particles leave the allowed region.

| Field     | Type                | Required     | Notes                                 |
| --------- | ------------------- | ------------ | ------------------------------------- |
| `mode`    | `none` \| `recycle` | No           | Bounds behavior.                      |
| `source`  | `area` \| `custom`  | Recycle only | Area-derived or explicit bounds.      |
| `padding` | number \| object    | No           | Extra area around the element bounds. |
| `custom`  | object              | Custom only  | Explicit local-space bounds.          |

## Range Values And Distributions

Many numeric module fields accept either:

- a single number
- or a range object

Example:

```yaml
speed:
  min: 50
  max: 150
  distribution:
    kind: normal
    mean: 90
    deviation: 20
```

Supported distribution kinds:

- `uniform`
- `normal`
- `bias`

## Example: Snow

```yaml
elements:
  - id: snow
    type: particles
    width: 1280
    height: 720
    seed: 12345
    modules:
      emission:
        mode: continuous
        rate: 40
        maxActive: 180
        duration: infinite
        particleLifetime:
          min: 4
          max: 8
        source:
          kind: rect
          data:
            x: 0
            y: -20
            width: 1280
            height: 10
      movement:
        velocity:
          kind: directional
          direction: 90
          speed:
            min: 50
            max: 150
      appearance:
        texture: snowflake
        scale:
          mode: range
          min: 0.3
          max: 1
        alpha:
          mode: curve
          keys:
            - { time: 0, value: 0 }
            - { time: 0.1, value: 0.8 }
            - { time: 0.8, value: 0.8 }
            - { time: 1, value: 0 }
        rotation:
          mode: spin
          start:
            min: 0
            max: 360
          speed:
            min: -45
            max: 45
      bounds:
        mode: recycle
        source: area
        padding: 50
```

## Example: Sparkle With Multiple Textures

```yaml
elements:
  - id: sparkles
    type: particles
    width: 1280
    height: 720
    seed: 42
    modules:
      emission:
        mode: continuous
        rate: 10
        maxActive: 24
        particleLifetime:
          min: 0.3
          max: 0.8
        source:
          kind: rect
          data:
            x: 100
            y: 100
            width: 1080
            height: 520
      movement:
        velocity:
          kind: directional
          direction: 0
          speed: 0
      appearance:
        texture:
          mode: random
          pick: perParticle
          items:
            - src: sparkle-a
              weight: 3
            - src: sparkle-b
              weight: 1
        scale:
          mode: curve
          keys:
            - { time: 0, value: 0 }
            - { time: 0.3, value: 1.5 }
            - { time: 0.7, value: 1.5 }
            - { time: 1, value: 0 }
        alpha:
          mode: curve
          keys:
            - { time: 0, value: 0 }
            - { time: 0.2, value: 1 }
            - { time: 0.8, value: 1 }
            - { time: 1, value: 0 }
```

## Notes

- One `particles` element represents one emitter.
- Compose more complex effects by combining multiple `particles` elements, usually in a `container`.
- The older raw `texture + behaviors + emitter` surface may still be accepted internally for compatibility, but `modules` is the public authoring model.
