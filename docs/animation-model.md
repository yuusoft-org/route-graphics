# Animation Model

Last updated: 2026-08-06

See also:

- `docs/animation-type-semantics.md`
- `docs/animation-implementation-plan.md`
- `docs/keyframe-start-value-design.md`
- `docs/portable-gsap-timelines.md`
- `docs/shader-interface.md`

## Goal

Define one public animation model that can express both:

- motion on an element that persists across a state change
- visual transitions between previous and next rendered state

## Status

This document describes the current public model.

The runtime now exposes:

- top-level `animations`
- required `type: update | transition`
- mutually exclusive `tween` and portable `gsap` motion payloads
- `mask` only inside `transition`
- optional `playback.continuity: render | persistent` on `update` and `transition`
- optional positive `playback.speed` on `update` and `transition`
- finite/infinite repeat, repeat delay, yoyo, and the `loop` compatibility alias
- integer-millisecond duration, delay, overlap, and start values
- independently targeted shader parameter timelines
- inline single-pass and multi-pass transition compositors
- composable mask plus compositor transitions

Current known runtime limitations are tracked in
`docs/animation-implementation-plan.md`.

## Naming

Use `animations` as the top-level public field.

Reason:

- `animations` covers both persistent-element motion and scene/element transitions
- `transitions` is too narrow because not every animation is a prev/next handoff
- `effects` is too vague and easy to confuse with post-processing or side effects

## Core Shape

```yaml
animations:
  - id: "move-makkuro"
    targetId: "makkuro"
    type: "update"
    tween:
      x:
        initialValue: 640
        keyframes:
          - duration: 600
            value: 220
            easing: "linear"
```

## Required Fields

Every animation must define:

- `id`
- `targetId`
- `type`

### `targetId`

`targetId` always points to an element id.

That id may be:

- a leaf element such as a sprite or text node
- a stable container/root subtree such as `scene-root`

Whole-scene transitions should target a stable root container id.

## Types

`type` must be one of:

- `update`
- `transition`

### `update`

`update` means one continuing object.

Use it for:

- moving a character that remains on screen
- fading a persistent element
- scaling a portrait in place
- changing properties on an already-mounted element

Do not use `update` for:

- prev/next replacement handoffs
- authored enter or exit lifecycles

Use `transition` instead when the animation needs a previous/next visual
handoff, including masked reveals, dissolves, exits, and replacements.

Some current element plugins still dispatch `update` animations during add and
delete paths for legacy compatibility. New authoring should not rely on that
behavior; lifecycle tightening remains tracked in
`docs/animation-implementation-plan.md`.

`update` supports:

- exactly one of `tween` or `gsap`
- `playback.continuity`
- `playback.speed`
- `playback.loop`
- ordinary properties and `filters.<filterId>` parameter timelines inside
  `tween`
- structured sequences, parallel groups, target aliases, text units, stagger,
  expressions, modifiers, events, and controls through `gsap`

In the PixiJS/JavaScript renderer, both `tween` and `gsap` compile to the same
renderer-neutral TimelineProgram and use the pinned GSAP backend for numeric
interpolation and native easing. Route Graphics retains the millisecond clock,
playback lifecycle, conflict rules, and renderer writes. The `gsap` field does
not accept arbitrary JavaScript or plugins, and native renderers use the same
TimelineProgram through their own conforming evaluator.

`update` does not support:

- `mask`
- inline compositor source
- `prev`
- `next`

### `transition`

`transition` means a visual handoff between up to two surfaces:

- `prev`
- `next`

It has two exclusive authoring modes: existing shorthand fields
(`prev.tween`, `next.tween`, mask progress, and compositor tween) or one
top-level portable `gsap` timeline that coordinates synthetic previous/next,
mask, and compositor targets. See `docs/portable-gsap-timelines.md`.

Use it for:

- push
- slide
- wipe
- rule dissolve
- replacing one portrait with another while keeping the same `targetId`
- opening from empty into a scene
- closing from a scene to empty
- any enter, exit, or replace lifecycle

`transition` supports:

- `prev.tween`
- `next.tween`
- `mask`
- `playback.continuity`
- `playback.speed`
- `compositor`
- `compositor.tween` for progress and custom compositor parameters

`transition` may define:

- `prev` only
- `next` only
- both `prev` and `next`
- `mask` with no explicit `prev`/`next` tween overrides
- `compositor` with no explicit `prev`/`next` tween overrides
- `mask` followed by a `compositor`

The missing side is treated as transparent.

## Tween Payload

> **Accepted future extension:** `docs/keyframe-start-value-design.md` defines
> optional keyframe-level `startValue` semantics for an explicit segment start.
> It is not implemented; the current schema and runtime continue to accept only
> the endpoint-style keyframes described below.

The existing keyframe format stays the standard:

```yaml
x:
  initialValue: 640
  keyframes:
    - duration: 450
      value: 180
      easing: "easeOutQuad"
    - delay: 300
      duration: 150
      value: 220
      easing: "easeInQuad"
```

This format is preferred because:

- it matches the current tween engine
- it is better for authoring multi-stage motion
- total duration can be derived from the keyframes
- easing supports `linear` plus the common Quad/Cubic/Quart/Quint/Sine/Expo/Circ/Back/Bounce/Elastic `In`, `Out`, and `InOut` families

Each keyframe's `easing` applies to the segment that reaches that keyframe
from the previous value. The first authored keyframe controls the segment from
`initialValue` or the current live value to that keyframe. `auto.easing` follows
the same rule for the single segment from the current live value to the next
state value.

Each keyframe may define a non-negative integer `delay` in milliseconds. The
runtime holds the previous value for that delay and then interpolates for the
keyframe's `duration`. A first-keyframe delay holds `initialValue` or the
current live value; a later delay creates a gap between segments. Total track
duration is the sum of every `delay + duration`. Delays scale with
`playback.speed` and repeat with the rest of a loop. Omitting `delay`, or
setting it to `0`, starts the segment immediately.

The same payload is reused in two places:

- manual `update.tween`
- `prev.tween` / `next.tween`

Position tweens support two addressing modes in both `update` and `transition`:

- `x` / `y` are absolute pixel positions in the parent coordinate space
- `translateX` / `translateY` are relative offsets in units of the animated
  subject's own width or height

For example, `translateX: -1` moves the subject left by one subject width, and
`translateY: 0.5` moves it down by half its height. A single tween cannot define
both `x` and `translateX`, or both `y` and `translateY`, because that would make
the final position ambiguous.

`update` also supports a shorthand for the common "animate this property from
its current live value to the next state's value" case:

```yaml
x:
  auto:
    delay: 200
    duration: 450
    easing: "easeOutQuad"
```

`auto.delay` holds the current live value before its generated segment starts.

`keyframes` and `auto` are mutually exclusive on the same property.

## Update Example

```yaml
animations:
  - id: "move-makkuro"
    targetId: "makkuro"
    type: "update"
    tween:
      x:
        initialValue: 640
        keyframes:
          - duration: 600
            value: 220
            easing: "linear"
```

## Update Auto Example

```yaml
animations:
  - id: "move-makkuro"
    targetId: "makkuro"
    type: "update"
    tween:
      x:
        auto:
          duration: 600
          easing: "easeOutQuad"
      y:
        auto:
          duration: 600
          easing: "easeOutQuad"
```

## Playback

```yaml
animations:
  - id: "bg-breathe"
    targetId: "bg"
    type: "update"
    playback:
      continuity: "persistent"
      speed: 1
      loop: true
    tween:
      scaleX:
        keyframes:
          - duration: 3000
            value: 1.05
            easing: "easeInOutSine"
          - duration: 3000
            value: 1
            easing: "easeInOutSine"
      scaleY:
        keyframes:
          - duration: 3000
            value: 1.05
            easing: "easeInOutSine"
          - duration: 3000
            value: 1
            easing: "easeInOutSine"
```

### Shape

- `playback` is optional
- `playback` is valid on `type: update` and `type: transition`
- `playback.continuity` currently supports two values:
  - `render`
  - `persistent`
- `playback.speed` is an optional finite number greater than zero:
  - `1` is authored speed
  - `2` is twice as fast
  - `0.5` is half speed
- `playback.loop` is an optional boolean that defaults to `false`
- `playback.loop: true` is valid only on `type: update`
- `render` is explicit render-scoped behavior and is equivalent to omitting
  `playback`

### Looping Updates

`playback.loop: true` repeats the complete update timeline indefinitely. Speed
is applied before the timeline wraps, so looping and playback speed compose
deterministically.

A looping update is ambient playback:

- it is considered settled as soon as it starts
- it never blocks the render's `renderComplete` event
- it does not emit animation completion after an iteration
- removing, replacing, or invalidating it cancels the loop without turning
  cancellation into completion
- changing its tween or playback configuration restarts it from the beginning

Looping transitions are rejected. A transition owns a previous/next visual
handoff and must settle into the next render state; repeating that handoff would
leave ownership and completion ambiguous.

A looping animation also cannot define `complete`. Infinite playback has no
reachable completion point. A future finite repetition contract, if needed,
must use a separate iteration count and complete only after its last iteration.

Looping requires a finite authored duration greater than zero.

### Meaning For `update`

Without `playback`, or with `playback.continuity: render`, `update` keeps the current
render-scoped behavior:

- a later changed render may cancel the current update animation
- if the same animation appears again in that later render, it starts again

With `playback.continuity: persistent`, the runtime lets the same update
animation continue across later renders instead of restarting, as long as all
of these remain true:

- the animation `id` is the same
- the `targetId` is the same
- the canonical compiled timeline (from `tween` or `gsap`) and `playback`
  semantics are the same
- the target element still exists as the same live display object

### Meaning For `transition`

Without `playback`, or with `playback.continuity: render`, `transition` keeps the current
render-scoped behavior:

- a later changed render cancels the in-flight transition
- if the same transition appears again in that later render, it starts again

With `playback.continuity: persistent`, the runtime lets the same in-flight
transition continue across later renders instead of restarting, as long as all
of these remain true:

- the animation `id` is the same
- the `targetId` is the same
- the normalized `prev`, `next`, `mask`, `compositor`, and `playback` config are
  the same
- the transition still owns the same target subtree handoff

This is continuity of one already-started transition.

It is not a live retargeting model.

That means:

- the runtime does not rebuild the transition's snapshots just because a later unrelated render happened
- the runtime does not reinterpret the active transition against newly changed target content mid-flight

### Restart And Stop Rules

- if a later render omits that animation, it stops
- if a later render changes that animation's `tween` or `playback` config, it
  restarts from the beginning
- if a later render changes a persistent transition's `prev`, `next`, `mask`,
  or `compositor` config, it restarts from the beginning
- if the target element or target subtree is deleted, replaced, or otherwise no longer matches the active handoff, it stops or restarts

### Transition Ownership Rule

Persistent transition continuity follows the same subtree ownership rule as
normal `transition`:

- the active transition continues to own the target subtree surface while it is running
- later unrelated renders may proceed around that target
- later renders that need to change that same target must cancel or restart the transition rather than mutate it in place

### Render Completion Rule

Persistent and looping playback must not keep a render open indefinitely.

So the contract is:

- finite render-scoped animations contribute to `renderComplete`
- persistent animations do not contribute to `renderComplete`
- looping animations do not contribute to `renderComplete`, regardless of
  continuity mode
- `renderComplete` fires after all other tracked work settles while ambient
  animations continue independently

## Transition Examples

### Open From Empty

Useful when first opening the scene.

```yaml
animations:
  - id: "scene-open"
    targetId: "scene-root"
    type: "transition"
    next:
      tween:
        alpha:
          initialValue: 0
          keyframes:
            - duration: 500
              value: 1
              easing: "linear"
```

### Close To Empty

```yaml
animations:
  - id: "scene-close"
    targetId: "scene-root"
    type: "transition"
    prev:
      tween:
        alpha:
          initialValue: 1
          keyframes:
            - duration: 500
              value: 0
              easing: "linear"
```

### Push Left

```yaml
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
              easing: "linear"
    next:
      tween:
        translateX:
          initialValue: 1
          keyframes:
            - duration: 500
              value: 0
              easing: "linear"
```

### Rule Dissolve

```yaml
animations:
  - id: "scene-rule-dissolve"
    targetId: "scene-root"
    type: "transition"
    mask:
      - kind: "single"
        texture: "masks/spiral-07.png"
        channel: "red"
        softness: 0.08
        invert: false
        delay: 200
        progress:
          initialValue: 0
          keyframes:
            - duration: 900
              value: 1
              easing: "linear"
```

## Parent Transition Rule

When an ancestor `transition` is active for a state change:

- that ancestor owns the subtree surface for the visible transition
- nested child `transition`s for the same change are suppressed
- descendant autoplay-like behaviors start after finalize

This keeps transition composition aligned with the current snapshot-based runtime.

## Masks

`mask` is always a transition primitive. It accepts either a single mask object
for backward compatibility or a non-empty array. The single-object shape is
normalized internally to a one-entry array, so the timeline and renderer use
one implementation. New multi-mask authoring uses the array shape.

Each normalized entry defines an independently timed reveal field that controls
how previous and next visuals hand off over time.

When entries overlap, their reveal values are combined with a per-pixel
`max`. This is union behavior: the strongest reveal wins, and overlapping soft
edges do not compound. A delayed entry contributes `0` until it becomes active.

```yaml
mask:
  - kind: single
    texture: masks/from-left.png
    progress:
      keyframes: [{ duration: 800, value: 1 }]
  - kind: single
    texture: masks/from-right.png
    delay: 250
    progress:
      keyframes: [{ duration: 550, value: 1 }]
```

Supported kinds:

- `single`
- `sequence`

### Common Mask Entry Fields

- `channel`
- optional `delay`
- `progress`
- optional `invert`
- `softness` for `single` masks only

### `delay`

Defines how many milliseconds the mask remains completely inactive before its
progress timeline begins. While inactive, the previous surface passes through
unchanged, including for sequence masks whose first frame already contains
revealed pixels.

`delay` defaults to `0`, contributes to transition duration, follows playback
speed and authored repeat/yoyo mapping, and is added before any delay on the
first `progress` keyframe. A progress-keyframe delay still means “hold the
current progress value”; mask-level `delay` means “do not apply this mask yet.”

Top-level orchestrated `gsap` transitions cannot use an entry's `delay`, because
the GSAP timeline is their sole timing authority. Put the delay or start
position on the action targeting that indexed `transitionMask` instead.

### `channel`

Defines which texture channel drives the reveal:

- `red`
- `green`
- `blue`
- `alpha`

`red` is usually enough for grayscale rule images.

### `softness`

Defines how sharp or feathered the reveal edge is.

- lower value: harder edge
- higher value: softer edge

`softness` is not valid for sequence masks. Sequence feathering should be
authored into the sequence frame alpha.

### Sequence Masks

`kind: sequence` uses an ordered set of authored reveal frames over a normalized
`progress` timeline. For sequence masks, `progress` chooses or interpolates the
frame; the sampled frame value is then used directly as the next-visual reveal
amount.

```yaml
mask:
  - kind: "sequence"
    progress:
      initialValue: 0
      keyframes:
        - duration: 1000
          value: 1
          easing: "linear"
    sample: "linear"
    frames:
      - at: 0
        texture: "masks/a.png"
      - at: 0.5
        texture: "masks/b.png"
      - at: 1
        texture: "masks/c.png"
    channel: "alpha"
```

Sequence rules:

- `progress` controls which mask frame is sampled.
- the sampled sequence frame value directly controls how much of the next visual
  is revealed.
- `progress` is clamped to `0..1` at runtime.
- `progress` may move forward or backward through keyframes.
- `frames[].at` is a normalized point on the progress ruler.
- `sample: hold` holds a frame from its `at` point until the next frame.
- `sample: linear` blends between adjacent frames.
- `frames` must contain at least two entries.
- `frames` must be sorted by ascending unique `at` values.
- the first frame must use `at: 0`.
- the last frame must use `at: 1`.
- `sample` defaults to `hold`.
- sequence frame textures should include their own feathering/alpha softness;
  `softness` is not valid on `kind: sequence`.

## Shader Compositor

Inline shader compositor source is `transition`-only. A compositor can be one
pass or an ordered multi-pass chain. It lives next to `mask`; the two can be
combined, with the built-in mask pass executing before custom compositor
passes.

Element shader filter source lives on `elements[].filters[]`. An update
animation targets filters by id inside its normal `tween`:

```yaml
tween:
  filters:
    glow:
      strength:
        keyframes:
          - duration: 500
            value: 1
      progress:
        initialValue: 0
        keyframes:
          - duration: 500
            value: 1
```

An update may combine ordinary properties and multiple filter ids in the same
`tween`. Filter `progress` maps to that filter's `uProgress`.

A transition compositor owns `compositor.tween`. Its required `progress` track
maps to `uProgress`; other tracks target declared compositor parameters.
Missing initial values are inferred from the current filter or compositor
parameter.

Scalar, vector, and matrix values interpolate through the same manual-keyframe
model. `uTime` is a deterministic read-only clock, not an animation property.
The complete shader contract is in `docs/shader-interface.md`.

## Validation Rules

- `update` requires `tween`
- `update` may optionally define `playback.continuity: render | persistent`
- `update` and `transition` may define a positive `playback.speed`
- `update` may define `playback.loop: true`
- `transition` cannot loop
- looping animations cannot define `complete`
- `update` cannot define `prev`, `next`, or `mask`
- `transition` may optionally define `playback.continuity: render | persistent`
- `transition` requires at least one of:
  - `prev`
  - `next`
  - `mask`
  - `compositor`
- `mask` is transition-only
- transition `compositor` is transition-only
- transition `compositor` may follow `mask`
- top-level `transition.tween` is not valid; surface motion stays under
  `prev.tween` and `next.tween`
- `compositor` requires `compositor.tween.progress`
- update filter tracks live under `tween.filters.<filterId>`
- `uTime`/`time` cannot be tweened

## Summary

- keep `animations` as the top-level field
- use required `type: update | transition`
- use `tween` instead of generic `properties`
- allow optional playback continuity and speed on both animation types
- allow non-blocking infinite loops on `update`
- let `transition` define `prev` and/or `next`
- keep `mask` as a transition-only primitive
- keep transition `compositor` transition-only as well
- allow filter and compositor parameters to use the animation timeline model
