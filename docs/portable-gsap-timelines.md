# Portable GSAP-Style Timelines

Route Graphics supports two animation authoring frontends:

- `tween` remains the compact format for ordinary property tracks.
- `gsap` is the richer, structured timeline format.

Both compile to the same renderer-neutral `route.timeline/v1` program and run
through the same binder, player, and property adapters. The PixiJS/JavaScript
backend executes numeric interpolation and native easing with the pinned GSAP
runtime. A separate pure evaluator remains the portable reference used by the
conformance package and future native backends.

`gsap` still does not mean arbitrary GSAP JavaScript compatibility. It names a
closed JSON-safe authoring profile. Route Graphics owns scheduling, target
resolution, conflicts, composition, events, lifecycle, and the millisecond
clock; detached paused GSAP tweens operate on internal plain-object proxies and
are scrubbed by that clock. GSAP never owns a second ticker or writes directly
to Pixi objects. This also means both the compact `tween` frontend and the rich
`gsap` frontend use GSAP after they compile to a TimelineProgram.

The internal tween drives a scaled normalized progress proxy. This preserves
GSAP easing and tween behavior without allowing GSAP's six-decimal generic
property-write rounding to alter a later portable `round`, `snap`, or boundary
decision. Route then maps that progress to the TimelineProgram's declared
scalar, vector, matrix, or color value.

All authored durations, delays, overlaps, starts, repeat delays, and event
times use non-negative integer milliseconds. Structured start offsets may be
negative, but the resolved action start may not precede the containing group.

## Basic Interface

```yaml
animations:
  - id: card-entrance
    targetId: card
    type: update
    gsap:
      profile: portable-v1
      defaults:
        duration: 300
        easing: power2.out
        overwrite: auto
      steps:
        - kind: set
          values: { alpha: 0, scaleX: 0.8, scaleY: 0.8 }
        - kind: parallel
          steps:
            - kind: to
              values: { alpha: 1 }
            - kind: to
              values: { scaleX: 1, scaleY: 1 }
        - kind: to
          values: { y: { by: -12 } }
          duration: 120
          easing: power1.out
        - kind: to
          values: { y: { by: 12 } }
          duration: 220
          easing: easeOutBounce
```

An update action without `targets` uses the animation owner (`targetId`). A
transition value action always names a synthetic transition target.

`tween` and `gsap` are mutually exclusive in one animation record. Separate
records are also forbidden from writing the same concrete target/channel in
one activation. Put intentional overlap in one `gsap` program and select an
explicit overwrite policy.

## Steps

| Kind        | Purpose                                     | Required data                     |
| ----------- | ------------------------------------------- | --------------------------------- |
| `set`       | Immediate assignment                        | `values`                          |
| `to`        | Current value to authored values            | `values`; duration or default     |
| `from`      | Authored values to scheduled-start value    | `values`; duration or default     |
| `fromTo`    | Explicit endpoints                          | `from`, `to`; duration or default |
| `keyframes` | Sequential per-frame values                 | non-empty `frames`                |
| `sequence`  | Children placed one after another           | non-empty `steps`                 |
| `parallel`  | Children share a group origin               | non-empty `steps`                 |
| `wait`      | Advance a sequence without writes           | `duration`                        |
| `mark`      | Name an instant for later structured starts | `name`                            |
| `emit`      | Declare a named runtime event               | `event`                           |

Every step may have `id`, `delay`, and a structured `start`. `overlap` is
allowed only on sequence children and starts the child that many milliseconds
before the previous sibling ends. `start` and `overlap` cannot be combined.

```yaml
steps:
  - kind: mark
    name: reveal
  - kind: to
    id: move-in
    values: { x: 200 }
    duration: 500
  - kind: to
    values: { alpha: 1 }
    duration: 200
    overlap: 150
  - kind: emit
    event: cardReady
    start: { anchor: reveal, offset: 700 }
```

Valid anchors are earlier marks or step ids plus the reserved
`group.start`, `timeline.start`, `previous.start`, and `previous.end` names.
An anchor object chooses `edge: start | end` and an integer `offset`. References
are lexical and backward-only; children of transformed/repeated groups are not
exported as external anchors.

## Targets And Stagger

Top-level target aliases can select one element, an explicit ordered list, or
text units inside the update animation's owned subtree:

```yaml
gsap:
  profile: portable-v1
  targets:
    cards: { elements: [card-a, card-b, card-c] }
    letters:
      textUnits:
        elementId: title
        unit: grapheme
        order: logical
  steps:
    - kind: fromTo
      targets: letters
      from: { alpha: 0, y: 16 }
      to: { alpha: 1, y: 0 }
      duration: 320
      stagger: { each: 28, from: center, easing: power2.out }
```

Text `unit` is `grapheme`, `word`, or `line`. Grapheme and word segmentation
requires Unicode 17.0.0/UAX #29 support and fails closed on an older runtime.
Whitespace is not emitted as a word target. A binding fingerprint includes the
text, shaping style inputs, segmentation version, unit, and order; a changed
fingerprint restarts instead of silently retargeting units.

The Pixi adapter currently maps units to independent `Text` objects only when
their measured advances preserve the original layout. It fails closed for
automatic wrapping, contextual/bidirectional scripts, and kerning or ligature
shaping that crosses a unit boundary. Backends with glyph-cluster geometry can
support those layouts without this restriction.

Stagger defines exactly one of `each` or `amount`. `from` accepts `start`,
`center`, `end`, `edges`, `random`, or a target index. A `grid` with explicit
`columns` may optionally select `axis: x | y`. Target order and seeded random
ordering are deterministic.

## Values, Expressions, And Modifiers

Ordinary values are numbers or fixed numeric arrays. Portable colors use
`#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Nested `filters`, `parameters`,
`fill`, `border`, and `cornerRadius` objects compile to semantic channels.

Closed data expressions replace JavaScript callback values:

```yaml
values:
  x: { by: 40 }
  rotation:
    random: { min: -8, max: 8, step: 2, seed: tilt }
  alpha:
    expr:
      kind: clamp
      value:
        {
          kind: divide,
          left: { kind: targetIndex },
          right: { kind: targetCount },
        }
      min: { kind: constant, value: 0 }
      max: { kind: constant, value: 1 }
modifiers:
  x:
    - { kind: snap, increment: 5 }
    - { kind: clamp, min: 0, max: 500 }
```

Expression kinds are `constant`, `underlying`, `targetState`, `subjectBase`,
`subjectDimension`, `targetIndex`, `targetCount`, `iteration`, `add`,
`subtract`, `multiply`, `divide`, `min`, `max`, `clamp`, `randomNumber`, and
`randomChoice`. Expressions are serializable, statically shape-checked where
possible, depth/node limited, deterministically seeded, and cannot access
renderer objects, global state, source code, or wall-clock time.

Modifier pipelines run in authored order. Supported modifiers are `snap`,
`round`, `clamp`, `wrap`, and `wrapYoyo`.

## Easing And Playback

Legacy easing names and GSAP-style `power1` through `power4` aliases are
supported. Structured easing kinds are `linear`, `power`, `sine`, `expo`,
`circ`, `back`, `bounce`, `elastic`, `steps`, `cubicBezier`, and `sampled`.
Sampled curves must begin at normalized time 0, end at 1, and have strictly
increasing sample times.

Tween actions and sequence/parallel groups support `repeat`, `repeatDelay`,
`yoyo`, `repeatRefresh`, and `speed`. `repeat` counts additional iterations or
is `infinite`. Infinite nested actions are allowed only when later sequence
siblings are not made unreachable. Refresh is finite and capped at 10,000
iterations.

Animation-level `playback` supports `speed`, finite/infinite `repeat`,
`repeatDelay`, `yoyo`, and the legacy `loop: true` alias. Infinite animations
are update-only and do not block `renderComplete`.

## Events And Player Controls

`emit` stores a name and JSON payload in the program. `direction` is
`forward`, `reverse`, or `both`; `occurrence` is `once` or `eachIteration`;
`seekPolicy` is `suppress` or `crossed`. Manual render sampling suppresses
events by default. Event batches have a hard per-operation limit and are
ordered by crossing time and source priority.

Pause, resume, seek, progress, reverse, and runtime speed are player controls,
not executable YAML steps. They do not mutate the immutable program.

The renderer exposes them as `pauseAnimation(id)`, `resumeAnimation(id)`,
`seekAnimation(id, elapsedMS, options)`,
`setAnimationProgress(id, progress, options)`,
`reverseAnimation(id, enabled)`, `setAnimationDirection(id, direction)`, and
`setAnimationSpeed(id, speed)`. `getAnimationState(id)` returns the active
player state, or `null` when that player is not active. Transition players
reject runtime reverse control; authored transition yoyo remains supported.

Authored `emit` steps are delivered to the renderer's configured
`eventHandler` as `eventHandler("timelineEvent", payload)`. The payload includes
the animation `id`, authored `event` name and JSON `payload`, resolved `time`,
crossing `direction`, and domain `iteration` tuple.

## Orchestrated Transitions

A transition can use top-level `gsap` to coordinate `prev`/`next` surfaces,
mask progress, and compositor progress/parameters. Target aliases use
`transitionSurface: prev | next`, `transitionMask: true`, or
`transitionCompositor: true`. The timeline must be finite, and configured mask
or compositor progress must resolve to exactly 1 at the terminal millisecond.
Static mask/compositor resources remain outside the timeline and are validated
before overlay allocation.

## Inspection, Performance, And Portability

Inspect compilation without launching a renderer:

```bash
route-graphics inspect-timeline scene.yaml --state 0 --animation card-entrance
```

The JSON report includes normalized authoring, the complete immutable program,
duration, marks, target queries, requirements, semantic signature, source
paths, and visualization lanes. `--compact` emits one-line JSON.

Run `bun run benchmark:timeline [target-count] [sample-count]` to measure
compile, bind, GSAP evaluator initialization, reusable-buffer sampling, apply
time, and heap use separately.
Portable minimum and larger JavaScript runtime limits reject excessive queries,
domains, clips, events, resolved targets, tracks, or event deliveries before
activation rather than truncating them.

The versioned native-runtime package lives in
`conformance/timeline/v1/`. It contains a JSON Schema, canonical bytes, mock
bindings, programs, samples, domain/easing/expression/modifier/random/text/event
vectors, and an independent reference evaluator that imports no production
runtime code.

The JavaScript package pins `gsap` to the reviewed runtime version. Runtime
state reports `backend: gsap` for active shared-timeline animations. Numeric
GSAP samples are compared with the pure evaluator using a narrow tolerance for
ordinary cross-runtime floating-point differences. The scaled progress proxy
prevents generic-object write rounding from being amplified by discontinuous
modifiers, and authored endpoints remain exact.

## Compatibility Boundary

Portable-v1 deliberately rejects JavaScript callbacks, DOM selectors, arbitrary
GSAP plugins, CSS parsing, dynamic code, and renderer objects. Importing GSAP in
the JavaScript backend does not place GSAP instances or seconds-based values in
the portable program. Motion paths,
physics, text scramble/replacement, geometry morphing, and path drawing are not
part of the core profile; each requires a future closed sampler schema and
native conformance vectors. The system therefore remains portable to WebGPU,
WebGL, Vulkan, Rust, or C++ backends without embedding a JavaScript engine or
GSAP itself.
