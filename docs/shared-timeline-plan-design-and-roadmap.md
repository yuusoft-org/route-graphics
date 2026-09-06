# Shared Timeline Plan Design And Roadmap

Status: portable-v1 implementation integrated and checkpoint-audited; see
`shared-timeline-implementation-review.md` for evidence and recorded boundaries
Last updated: 2026-08-01

Related documents:

- `docs/animation-model.md`
- `docs/animation-type-semantics.md`
- `docs/shader-interface.md`
- `src/schemas/animations/animation.yaml`

## Decision Summary

Route Graphics should have one animation execution model with two public
authoring frontends:

- the existing compact `tween` frontend
- a richer, portable `gsap` frontend

Both frontends compile into the same renderer-neutral `TimelineProgram`. A
program is bound to live targets and values to create a `TimelineInstance`, and
the existing animation bus remains responsible for clocks, cancellation,
continuity, completion, and deterministic manual sampling.

```txt
existing tween YAML -----\
                         +-> TimelineProgram -> bind -> TimelineInstance
portable gsap YAML ------/                              |
                                                        v
                          backend timeline evaluator -> frame patch
                                                        |
                                                        v
                                             channel adapters/renderers
```

The PixiJS/JavaScript backend uses pinned GSAP for numeric interpolation and
native easing. It scrubs detached paused tweens on internal plain-object
proxies; Route Graphics continues to own the millisecond clock, scheduling,
composition, events, lifecycle, and renderer writes. The pure evaluator remains
the normative portable reference for Rust/C++/Vulkan backends.

The `gsap` field is still a versioned, GSAP-inspired portable authoring profile,
not a promise that arbitrary GSAP JavaScript or every GSAP plugin will execute.

## Review Outcome

The architecture is complete enough to begin Milestone 0 contract sign-off and
Milestone 1 characterization. The review found and resolved blocking ambiguity
around the two animation lifecycles, activation atomicity, separate-animation
conflicts, pre-start fill, dynamic text/stagger scheduling, player time,
same-frame batching, event ordering, repeat-refresh seeking, canonical
serialization, and text segmentation.

The remaining work is deliberately assigned to checkpoints rather than left as
an implementation guess:

- inventory any legacy content relying on duplicate ids or last-writer behavior
- publish exact easing tolerances/test vectors in Milestone 3
- choose and benchmark the Pixi text-unit representation in Milestone 13
- publish portable minimum resource limits and production budgets in Milestone
  18
- prove independent-runtime equivalence in Milestone 19

These items block their respective release gates, but none requires changing
the public authoring shape or the program/binder/evaluator architecture.

## Locked Decisions

The following decisions should be treated as constraints unless a later design
review explicitly changes them:

1. Authored and compiled durations, delays, repeat delays, stagger amounts,
   absolute times, starts, and ends use non-negative integer milliseconds.
   Relative anchor offsets are signed integer milliseconds, but may not resolve
   to a negative start.
2. Runtime playheads may contain fractional milliseconds because browser frame
   deltas and playback speed are not necessarily integers, but authored
   boundaries remain integer milliseconds.
3. `tween` and `gsap` are authoring formats, not executor selections. Both use
   the GSAP backend in the PixiJS renderer after compilation.
4. There is one TimelineProgram evaluation contract for updates, transition
   surface motion, masks, compositor progress, compositor parameters, and
   filter parameters. JavaScript uses GSAP; portable conformance uses the pure
   reference evaluator.
5. The animation bus owns lifecycle. The plan owns only deterministic
   time-to-value behavior and named timeline events.
6. Renderer objects, DOM objects, functions, closures, and GSAP instances never
   appear in a `TimelineProgram`.
7. Target and channel resolution happens through explicit registries and
   adapters.
8. Arbitrary JavaScript callbacks and arbitrary function-valued properties are
   not portable. Named events and a closed value-expression language replace
   them.
9. Seeking is side-effect-free by default. Manual `setTime()` samples visuals
   without emitting timeline events.
10. Unknown target kinds, channels, easing kinds, modifiers, samplers, or
    capabilities fail validation instead of silently degrading.
11. Animation ids are unique within one normalized render state. A target may
    have multiple update records, but only one transition record.
12. Portable-v1 does not permit two separately owned animation records to write
    the same bound target/channel while both are active. Rich same-channel
    overlap belongs inside one `gsap` program, where ordering is fully known.
13. Binding is a staged transaction. Target resolution, captures, scheduling,
    channel validation, capability checks, and conflict checks all complete
    before time-zero values become visible.
14. All integer time arithmetic uses checked JSON-safe integers. Overflow is a
    validation or binding error, never a wrapped or rounded value.
15. `portable-v1` is not advertised as production-ready with a partly
    implemented field set. Development builds may reject deferred features,
    but the public profile release gate requires every portable-v1 field to
    pass its roadmap checkpoint.

## Current Runtime That Must Be Preserved

The migration must preserve all of the following behavior:

- absolute-time sampling through `setTime()`
- real-time delta playback through the Pixi ticker
- current `initialValue`, `auto`, `delay`, `relative`, and easing behavior
- scalar, vector, and matrix parameter interpolation
- rect geometry, fill, border, gradient, and corner-radius batching
- element filter parameter animation
- transition `prev` and `next` surface motion
- single and sequence masks
- custom single-pass and multi-pass compositor progress and parameters
- deterministic shader `uTime`
- transition snapshot ownership and deferred descendant behavior
- render-scoped and persistent continuity
- non-blocking infinite update loops
- cancellation settlement into the requested target state
- render completion rules
- manual/offline rendering

The first implementation phases deliberately place the new program beside the
old evaluator and compare their outputs before changing production execution.

## Goals

- Provide one semantic animation model that can be implemented in JavaScript,
  Rust, or C++.
- Preserve the existing public `tween` interface as a compact shorthand.
- Add GSAP-style orchestration while keeping the program and native-runtime
  contract independent of the JavaScript-only GSAP backend.
- Make every finite animation sampleable at an arbitrary absolute time.
- Support nested sequence, parallel, repeat, yoyo, stagger, and time scaling.
- Support multiple elements and text units through stable target queries.
- Keep property application separate from interpolation.
- Make timing, boundaries, conflicts, event delivery, and cancellation fully
  specified and testable.
- Produce useful compiler diagnostics that point to the authored YAML path.
- Provide cross-runtime conformance fixtures before starting a native port.

## Non-Goals

- Executing arbitrary JavaScript from YAML.
- Serializing live GSAP timelines.
- Exact compatibility with every undocumented GSAP edge case.
- Supporting CSS selectors or DOM query semantics.
- Making ScrollTrigger, Draggable, Observer, or browser layout behavior part of
  the portable core.
- Replacing transition texture ownership or the compositor render pipeline.
- Baking an animation into per-frame samples. The plan remains resolution- and
  frame-rate-independent.
- Allowing unknown plugin payloads to pass through to only some backends.

## Terminology

| Term               | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| Authoring document | User-facing YAML or JSON containing `tween` or `gsap`                          |
| Authoring AST      | Validated and normalized representation of one frontend                        |
| TimelineProgram    | Immutable, serializable, renderer-neutral compiled program                     |
| TimelineInstance   | Runtime-bound program with concrete target/channel handles and captured values |
| Domain             | A local clock with start, speed, repetitions, repeat delay, and direction      |
| Clip template      | A program-level value operation targeting a query or target set                |
| Bound clip         | A concrete clip targeting one runtime channel                                  |
| Track              | Ordered bound clips for one target/channel pair                                |
| Channel            | Semantic animatable property such as `transform.x` or `filter.glow.strength`   |
| Frame patch        | Values produced by sampling an instance at one time                            |
| Player             | Stateful bus context that advances an instance and detects event crossings     |

## Public Animation Envelope

The common envelope remains:

```yaml
animations:
  - id: hero-entrance
    targetId: scene-root
    type: update
    playback:
      continuity: persistent
      speed: 1
    gsap:
      profile: portable-v1
      steps:
        - kind: set
          values:
            alpha: 1
```

### `targetId`

`targetId` remains required. For a simple update, it is both the ownership root
and the default animation target. For a multi-target update, every element
target must be the ownership root or one of its descendants.

This restriction preserves lifecycle and cancellation ownership. Animating
unrelated roots requires separate animations or a stable common ancestor.

For transitions, `targetId` continues to identify the subtree whose previous
and next visual surfaces are owned by the transition.

### Authoring Mode Exclusivity

An `update` must define exactly one of:

- `tween`
- `gsap`

A transition has two modes:

1. Shorthand mode uses the existing `prev.tween`, `next.tween`,
   `mask.progress`, and `compositor.tween` fields.
2. Orchestrated mode defines a top-level `gsap` and forbids nested tween fields.
   Static `mask` and `compositor` resource configuration remains valid.

Mixing both modes within one animation is rejected so two frontends cannot
silently compete for the same channel.

## Animation Selection, Activation, And Ownership

`update` and `transition` remain separate lifecycle types even though they use
the same compiled timing model.

| Concern            | `update`                                                                                            | `transition`                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Selection          | Selected for a live element by `targetId` during its renderer update/add path                       | Selected by `targetId` for an add, remove, or replacement handoff                       |
| Owned object       | The live owner element and declared descendants                                                     | Captured previous/next subtree surfaces and transition resources                        |
| Binding moment     | After the owner subtree and required text layout exist                                              | After snapshots/resources are preflighted, before the overlay is shown                  |
| Natural completion | Leave the exact final frame applied and release the player                                          | Apply the terminal frame, reveal the live next subtree, then release overlay resources  |
| Cancellation       | Settle to the current renderer target state when one exists; otherwise retain the last valid sample | Remove the overlay, reveal the current live state, and release each owned resource once |

Activation rules are normative:

- Animation ids must be unique across the normalized animation list. The id is
  the bus/player identity across renders.
- A target may have multiple `update` records only when their bound
  target/channel sets are disjoint. At most one `transition` may target a given
  owner in one state.
- The current prohibition on mixing update and transition records on the same
  `targetId` remains. An ancestor transition may coexist in source with
  descendant animations, but it owns the visible subtree handoff; descendant
  updates and transitions are deferred until the ancestor finalizes.
- A continued persistent player is matched before new players start. Matching
  uses animation id, type, owner, semantic program signature, and bound-target
  identity. Changed or omitted players are cancelled and settled before their
  replacements commit time-zero values.
- Update binding occurs after the renderer can provide an ordered owner-subtree
  target registry, per-target next-state data, and completed text shaping.
  This is required for multi-target `auto` expressions and text-unit queries.
- Transition binding occurs only after resource configuration, target
  availability, program terminal conditions, and backend capabilities pass
  preflight. Any snapshots or GPU resources allocated during preflight are
  released if binding fails.
- Asynchronous layout, snapshot, texture, or shader preparation carries the
  render-state version and cancellation signal. It rechecks both after every
  asynchronous boundary; stale work may clean up its own resources but can
  never commit a frame or register a player. Cleanup is idempotent.

Binding and activation are staged as one transaction:

1. Validate and compile every authored record in the affected ownership scope.
2. Resolve targets, channels, target-state values, timing, and capabilities.
3. Detect duplicate ids and cross-record target/channel conflicts.
4. Capture activation base values without writing renderer state.
5. Create all instances and transition resources needed by the scope.
6. Commit time-zero frame patches and register players in stable animation-list
   order.

Failure before step 6 produces no visible animation writes. Resource allocation
that cannot be delayed is guarded by cleanup ownership established before the
allocation occurs.

The binder receives an explicit context rather than reaching into Pixi or
global state:

| Input                                         | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| `ownerHandle` and `ownerId`                   | Lifecycle root and ownership validation                  |
| ordered target registry                       | Resolve element and text-unit queries                    |
| per-target activation state                   | Capture live/base values and dimensions                  |
| per-target next-state registry                | Resolve legacy `auto`/internal `targetState` expressions |
| backend capabilities and channel registry     | Validate and bind semantic channels                      |
| render-state version and activation ordinal   | Continuity and deterministic commit ordering             |
| transition synthetic handles, when applicable | Bind previous/next surfaces, mask, and compositor        |

Natural completion, cancellation, and continuation are mutually exclusive
terminal paths. Completion/event callbacks run only after final frame
application succeeds. Cancellation never emits completion or authored timeline
events. Adapter failure closes all opened batch hooks, cancels the affected
player, and lets normal renderer reconciliation settle the live state; expected
validation failures must already have been caught before commit.

If any required bound target becomes invalid or is destroyed mid-playback, the
whole owning player is cancelled; individual fan-out clips are not silently
dropped. `allowEmpty` applies only to an empty result at binding time and does
not weaken bound-target identity afterward.

## Playback Interface

The final playback shape is:

```yaml
playback:
  continuity: render
  speed: 1
  repeat: 0
  repeatDelay: 0
  yoyo: false
```

| Field         | Type                                | Default  | Meaning                                    |
| ------------- | ----------------------------------- | -------- | ------------------------------------------ |
| `continuity`  | `render \| persistent`              | `render` | Existing lifecycle behavior                |
| `speed`       | finite number greater than zero     | `1`      | Root playback rate                         |
| `repeat`      | integer at least zero or `infinite` | `0`      | Additional iterations after the first      |
| `repeatDelay` | integer milliseconds at least zero  | `0`      | Hold between iterations                    |
| `yoyo`        | boolean                             | `false`  | Alternate direction on repeated iterations |

Public `repeat` deliberately follows GSAP's meaning: `repeat: 1` plays twice.
The compiled program removes this ambiguity by storing `iterations: 2`.

Existing `playback.loop: true` remains a compatibility alias for
`repeat: infinite` during migration. `loop` and `repeat` cannot appear together.
After a documented deprecation window, `loop` may be removed from new
authoring while remaining readable by the compatibility normalizer.

Root infinite repetition remains update-only and never contributes to
`renderComplete`. Root transition repetition remains unsupported in v1 because
repeating the entire previous/next ownership handoff makes final settlement
ambiguous. Finite repeats and yoyo remain valid on individual transition clips
and groups as long as the overall transition has a finite duration and its
required reveal/compositor progress reaches its terminal next-state value.

## Existing `tween` Frontend

The existing syntax remains valid:

```yaml
animations:
  - id: move-hero
    targetId: hero
    type: update
    tween:
      x:
        initialValue: 100
        keyframes:
          - duration: 300
            value: 500
            easing: easeOutQuad
          - delay: 100
            duration: 200
            value: 600
            easing: easeInQuad
```

The compatibility compiler converts this into one target query, one root time
domain, and one clip chain per property. Existing behavior is preserved:

- a first delay holds `initialValue` or the captured live value
- a later delay holds the previous segment's final value
- omitted `initialValue` captures the live value
- `relative: true` adds to the preceding value
- `auto` captures the live value and reads the next target-state value
- the longest property track determines duration
- other tracks hold their final value until the animation completes

All authored `duration` and `delay` fields become non-negative integer
milliseconds. This tightens the existing validation, which currently permits
some fractional or negative duration values.

## Portable `gsap` Frontend

The new frontend is intentionally structured data rather than a transliteration
of JavaScript function calls.

```yaml
gsap:
  profile: portable-v1
  defaults:
    duration: 400
    easing: easeOutCubic
    overwrite: auto
  targets: {}
  steps:
    - kind: set
      values:
        alpha: 1
```

### Profile

`profile` is required and initially has one value:

- `portable-v1`

This makes compatibility claims explicit and gives future schema changes a
clean migration boundary.

### Defaults

Defaults inherit lexically into nested groups. A child overrides a parent
default by defining the field itself.

Supported v1 defaults are:

- `duration`
- `easing`
- `overwrite`
- `repeat`
- `repeatDelay`
- `yoyo`
- `repeatRefresh`

Defaults do not include `targets`, values, ids, explicit start positions, or
events.

The profile's base defaults, before lexical overrides, are:

| Field                | Base value |
| -------------------- | ---------- |
| `easing`             | `linear`   |
| `overwrite`          | `auto`     |
| `repeat`             | `0`        |
| `repeatDelay`        | `0`        |
| `yoyo`               | `false`    |
| `repeatRefresh`      | `false`    |
| action/group `speed` | `1`        |
| scheduling `delay`   | `0`        |

There is deliberately no implicit base `duration`: every positive-duration
action must obtain one from its own field or a lexical `defaults.duration`.
This avoids a hidden timing difference between the legacy tween frontend, GSAP,
and native ports.

## Target Definitions

`self` is an implicit target alias for the animation's top-level `targetId`.
Additional targets are declared by alias:

```yaml
gsap:
  profile: portable-v1
  targets:
    hero:
      element: hero

    cards:
      elements:
        - card-a
        - card-b
        - card-c

    titleCharacters:
      textUnits:
        elementId: title
        unit: grapheme
        order: visual
```

Target definitions are a closed union:

### Single Element

```yaml
hero:
  element: hero
```

### Explicit Element List

```yaml
cards:
  elements: [card-a, card-b, card-c]
```

List order is significant and drives index-based stagger behavior.

### Text Units

```yaml
titleCharacters:
  textUnits:
    elementId: title
    unit: grapheme
    order: visual
```

Initial text-unit kinds are:

- `grapheme`
- `word`
- `line`

`grapheme` is the correct character-animation unit. It prevents combining
marks, emoji sequences, and surrogate pairs from being incorrectly split.

Initial ordering modes are:

- `logical`
- `visual`

Text-unit targets require a backend text-unit capability. They never compile
to CSS selectors or DOM spans. A renderer may implement them as glyph-cluster
objects, per-unit meshes, or another stable render abstraction.

Portable-v1 pins grapheme and word segmentation to Unicode 17.0.0 data and its
corresponding UAX #29 rules, not whichever `Intl.Segmenter` behavior happens to
be installed. The compiled query records that segmentation capability version.
`line` and `visual` ordering are layout-dependent and bind only after shaping;
their bound identity includes text content, font/layout fingerprint, line-break
result, and ordered shaping-cluster identities. A backend may render graphemes
with multiple glyphs or a ligature spanning logical units, but it must expose a
stable unit-to-geometry mapping or reject the capability. Any fingerprint
change invalidates persistent continuity and triggers a documented rebind or
restart rather than retargeting indices in place.

An action's `targets` is either one alias or an ordered array of aliases:

```yaml
targets: hero
```

```yaml
targets: [hero, cards]
```

Omitting `targets` means `self` for updates. Transition value actions require an
explicit synthetic alias. Alias expansion preserves alias-list order and query
order. Resolving the same runtime target more than once for one action is an
error rather than an implicit duplicate animation.

Text-unit target definitions may set `allowEmpty: true`; it defaults to false.
Portable-v1 does not allow it on `element` or `elements`, so missing explicit
element ids always remain errors. Even with `allowEmpty`, the text element must
exist; only its resolved unit list may be empty.

## Step Union

Every step has a required `kind`. Supported core kinds are:

| Kind        | Purpose                                          |
| ----------- | ------------------------------------------------ |
| `set`       | Assign values at an instant                      |
| `to`        | Captured underlying values to authored values    |
| `from`      | Authored values to captured underlying values    |
| `fromTo`    | Explicit authored start and end values           |
| `keyframes` | Consecutive value stages for the same targets    |
| `sequence`  | Consecutive child scheduling                     |
| `parallel`  | Same-origin child scheduling                     |
| `wait`      | Advance a sequence cursor without writing values |
| `mark`      | Define a named timeline position                 |
| `emit`      | Define a named serializable event                |

Arbitrary `call` callbacks are not supported. `emit` is their portable
replacement.

Top-level and nested group `steps` arrays are non-empty. An update program must
compile at least one value clip or named event; a tree containing only waits and
marks is rejected as an accidental render blocker. Transition programs are
subject to the stronger resource/terminal-write rules below.

### Step Field Validity

| Kind        | Required fields    | Duration rule                                    |
| ----------- | ------------------ | ------------------------------------------------ |
| `set`       | `values`           | always zero; authored duration invalid           |
| `to`        | `values`           | required directly or through defaults            |
| `from`      | `values`           | required directly or through defaults            |
| `fromTo`    | `from`, `to`       | required directly or through defaults            |
| `keyframes` | non-empty `frames` | derived from required frame durations and delays |
| `sequence`  | non-empty `steps`  | derived from child schedule                      |
| `parallel`  | non-empty `steps`  | maximum child end                                |
| `wait`      | `duration`         | required non-negative integer                    |
| `mark`      | `name`             | zero                                             |
| `emit`      | `event`            | zero                                             |

Accepted fields are closed by kind:

| Kind                   | Additional accepted fields                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `set`                  | `targets`, `values`, `stagger`, `overwrite`, `modifiers`                                                    |
| `to`, `from`, `fromTo` | `targets`, value payload, `duration`, `easing`, `stagger`, `overwrite`, `modifiers`, repeat fields, `speed` |
| `keyframes`            | `targets`, `frames`, default `easing`, `stagger`, `overwrite`, `modifiers`, repeat fields, `speed`          |
| `sequence`, `parallel` | `steps`, nested `defaults`, repeat fields, `speed`                                                          |
| `wait`                 | `duration`                                                                                                  |
| `mark`                 | `name`                                                                                                      |
| `emit`                 | `event`, `payload`, `direction`, `occurrence`, `seekPolicy`                                                 |

Every kind may additionally use the scheduling fields `id`, `delay`, `start`,
and `overlap`, subject to the placement rules below. This permits a delayed
`set`, mark, or event without requiring an otherwise meaningless tween.
`set`, `wait`, `mark`, and `emit` cannot repeat independently; they repeat
naturally when their containing domain repeats. A staggered `set` still has
zero-duration writes, but its action envelope ends at its latest staggered
write. Defaults are consumed only by compatible child kinds; for example, a
parent `duration` default does not make `duration` valid on `set` and does not
replace the required per-frame durations of `keyframes`.

## Common Step Fields

Value actions and groups may use:

| Field           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `id`            | Optional unique step id for diagnostics and anchoring                      |
| `delay`         | Non-negative integer milliseconds after the normal start                   |
| `overlap`       | Non-negative integer milliseconds before the preceding sequence child ends |
| `start`         | Structured absolute or anchored start override                             |
| `repeat`        | Additional iterations or `infinite`                                        |
| `repeatDelay`   | Non-negative integer milliseconds between iterations                       |
| `yoyo`          | Alternate iteration direction                                              |
| `repeatRefresh` | Re-resolve declared refreshable expressions on repeated forward iterations |
| `speed`         | Positive local time multiplier                                             |

Rules:

- `start` and `overlap` are mutually exclusive.
- `overlap` is valid only for a child in a sequence.
- `wait` is valid only in a sequence. In a parallel group, use an explicitly
  started child or set the timing on the containing sequence instead.
- `delay` is added after default, overlap, or explicit-start resolution.
- `repeatDelay`, `yoyo`, and `repeatRefresh` require a non-zero or infinite
  `repeat`; meaningless repeat controls are rejected.
- A computed start earlier than zero is rejected.
- An infinite child makes its containing group infinite. A sequence cannot have
  reachable siblings after an infinite child.
- Local `speed` may be fractional. Authored boundaries remain integer
  milliseconds; a containing duration is rounded upward to the next whole
  millisecond so completion never occurs early. Specifically, a child's
  occupied parent-time span is `ceil(localOccupiedDuration / speed)`; sampling
  multiplies elapsed parent time by `speed` and clamps at the exact local
  endpoint during any rounded remainder.

## Scheduling Semantics

### Sequence

The top-level `steps` list is a sequence. A nested sequence is explicit:

```yaml
- kind: sequence
  steps:
    - kind: to
      targets: hero
      values:
        x: 500
      duration: 300

    - kind: to
      targets: hero
      values:
        y: 200
      duration: 300
```

The sequence cursor begins at zero. An ordinary child starts at the cursor, and
the cursor becomes the greater of its previous value and the child's end. This
`max` rule keeps explicitly anchored children from moving later siblings
backward in time.

### Parallel

```yaml
- kind: parallel
  steps:
    - kind: to
      targets: hero
      values:
        x: 500
      duration: 400

    - kind: to
      targets: hero
      values:
        alpha: 1
      duration: 250
```

Parallel children use the group's local origin. The parallel group's duration
is the maximum child end.

### Wait

```yaml
- kind: wait
  duration: 200
```

`wait` is valid in a sequence and advances its cursor. It produces no clip.

### Overlap

```yaml
- kind: to
  targets: hero
  overlap: 120
  values:
    alpha: 1
```

This starts 120 milliseconds before the preceding sequence child ends. It is
the readable replacement for common GSAP position strings such as `-=0.12`.

### Marks And Anchors

```yaml
- kind: mark
  name: reveal

- kind: to
  targets: hero
  start:
    anchor: reveal
    offset: 300
  values:
    alpha: 1
```

An explicit start is one of:

```yaml
start:
  time: 800
```

or:

```yaml
start:
  anchor: hero-entrance
  edge: end
  offset: -120
```

`edge` is `start` or `end` and defaults to `start`. Marks have only a start
edge. `start.time` is relative to the containing group's origin, not wall-clock
time.

Anchor names use lexical group scope. Step ids and mark names share one anchor
namespace among direct children of a group and must be unique in that scope. A
named anchor can refer only to an earlier direct sibling step or mark. A nested
group exposes its own id/start/end to its parent, but its internal ids do not
leak outward; authors anchor the group envelope instead. This prevents an
anchor from accidentally depending on a particular iteration inside a
repeated child domain. Forward references and cycles are rejected.

Special anchors are:

- `group.start`
- `timeline.start`
- `previous.start`
- `previous.end`

`previous.*` refers to the immediately preceding sibling in source order.
`group.start` is normally preferred inside nested groups. `timeline.start`
refers to the root origin and is intended only when an explicit root-relative
placement is clearer than anchoring a containing group.

Structured groups should be preferred over explicit starts. Explicit anchors
exist for layouts that cannot be expressed clearly with sequence, parallel,
delay, and overlap.

## Value Actions

### Set

```yaml
- kind: set
  targets: hero
  values:
    alpha: 0
    scaleX: 0.8
    scaleY: 0.8
```

A set writes at its scheduled time and holds forward until superseded or the
animation settles. `duration`, `easing`, and `yoyo` are invalid on a set.

### To

```yaml
- kind: to
  targets: hero
  values:
    x: 500
    alpha: 1
  duration: 400
  easing: easeOutCubic
```

The start value is the underlying channel value at the clip's scheduled start.

### From

```yaml
- kind: from
  targets: hero
  values:
    y: 260
    alpha: 0
  duration: 500
```

The end value is the underlying channel value captured at the scheduled start.
Unlike GSAP's historical `immediateRender` behavior, a portable `from` does not
modify the target before its scheduled start. Authors who need an earlier
assignment use an explicit `set`.

### From-To

```yaml
- kind: fromTo
  targets: hero
  from:
    y: 260
    alpha: 0
  to:
    y: 180
    alpha: 1
  duration: 500
```

Both ends are explicit. `from` and `to` must contain compatible channel sets
unless a future profile explicitly defines partial behavior.

### Keyframes

```yaml
- kind: keyframes
  targets: hero
  frames:
    - duration: 100
      easing: easeOutQuad
      values:
        scaleX: 1.2
        scaleY: 1.2

    - delay: 50
      duration: 200
      easing: easeInOutQuad
      values:
        scaleX: 0.9
        scaleY: 0.9

    - duration: 150
      easing: easeOutBack
      values:
        scaleX: 1
        scaleY: 1
```

Frames are consecutive. Each frame's easing applies to the interpolation that
reaches that frame. A frame may omit channels; omitted channels retain their
previous value.

## Value Shapes And Expressions

Values may be:

- finite scalar numbers
- supported color strings
- numeric vectors and matrices with supported shapes
- discrete strings or booleans on channels that declare discrete behavior
- one closed expression object

Public update value paths initially match the existing animation surface:

- `x`, `y`, `translateX`, `translateY`
- `scaleX`, `scaleY`, `rotation`, `alpha`
- `blurX`, `blurY`
- rect-only `width`, `height`, `fill`, `border`, and `cornerRadius`
- `filters.<filterId>.<parameter>` and filter `progress`

The compiler normalizes these paths into semantic channels. When an action
targets heterogeneous element kinds, every resolved target must support every
authored channel. Validation/binding reports all incompatible target/channel
pairs before applying any initial value.

Public units and ranges are renderer-neutral:

| Public value                      | Meaning before canonicalization                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `x`, `y`                          | Local coordinates in the target parent's Route Graphics coordinate space                             |
| `translateX`, `translateY`        | Fractions of the captured subject width/height, added to its captured base `x`/`y`                   |
| `scaleX`, `scaleY`                | Unitless scale factors                                                                               |
| `rotation`                        | Unwrapped degrees; interpolation does not choose a shortest arc                                      |
| `alpha`                           | Finite scalar, normally authored in `[0, 1]`; the evaluator does not secretly clamp easing overshoot |
| `blurX`, `blurY`                  | Logical pixel radii interpreted by the target adapter                                                |
| rect dimensions and radii         | Local Route Graphics coordinate units                                                                |
| mask/compositor/filter `progress` | Unitless scalar, normally authored in `[0, 1]`; terminal transition validation requires exact one    |

Portable-v1 color literals use `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`.
They compile immediately to straight, normalized RGBA components plus an
explicit color-space value type. Browser CSS names and renderer-specific color
parsers are not part of the portable frontend. The legacy tween compiler may
accept its existing color strings, but it must canonicalize them before they
enter a program.

`progress` maps to the shader's `uProgress` channel. `time`, `uTime`, and raw
`uProgress` are not authorable property paths. Shader `uTime` remains a
deterministic read-only clock supplied by the renderer integration. It remains
seconds since Route Graphics initialization, or the bus-wide manual time in
offline mode; it is not scaled, repeated, or reversed by an individual
animation player's speed/domain mapping.

### Relative Value

```yaml
x:
  by: 20
```

This is evaluated from the underlying value at the clip's scheduled start.

### Deterministic Random Number

```yaml
rotation:
  random:
    min: -10
    max: 10
    step: 1
    seed: card-rotation
```

### Deterministic Random Choice

```yaml
fill:
  color:
    random:
      choices:
        - "#ff8080"
        - "#80ff80"
        - "#8080ff"
      seed: card-fill
```

Random seed material always includes the animation id, stable step path, target
identity, channel, and iteration. An authored `seed` is an additional stable
salt; it does not remove the per-target/channel coordinates. Components are
UTF-8 encoded with their byte lengths so concatenation is unambiguous.

Portable-v1 uses FNV-1a 64-bit over those seed bytes, followed by SplitMix64 for
sample generation, with all integer operations modulo `2^64`. A uniform value
uses the high 53 output bits divided by `2^53`, producing `[0, 1)`. Random choice
uses `floor(u * choiceCount)`. A stepped numeric range has
`floor((max - min) / step) + 1` choices and never exceeds `max`; an unstepped
range uses `min + (max - min) * u`. `min <= max`, positive finite `step`, and a
non-empty choice list are required. Published hexadecimal state/output vectors
make the algorithm checkable without JavaScript integer behavior.

Random expressions resolve during binding or iteration refresh and never run
per frame. A repeated evaluation consumes a descriptor-specific counter rather
than depending on traversal or object-key order.

### Advanced Closed Expression

Portable function-style values use an explicit `expr` object:

```yaml
x:
  expr:
    kind: add
    left:
      kind: multiply
      left:
        kind: targetIndex
      right:
        kind: constant
        value: 24
    right:
      kind: randomNumber
      min: -4
      max: 4
      step: 1
      seed: x-jitter
```

Public expression leaves are `constant`, `targetIndex`, `targetCount`,
`iteration`, `subjectDimension` (`width` or `height`), `randomNumber`, and
`randomChoice`. Arithmetic nodes are binary `add`, `subtract`, `multiply`, and
`divide`; non-empty-list `min` and `max`; and `clamp` with `value`, `min`, and
`max` children. Literal children must still be wrapped as `constant`, keeping
the grammar unambiguous and easy to validate in every language.

`underlying` and `targetState` remain internal compiler expression kinds rather
than public escape hatches. Authors select underlying behavior with `to`,
`from`, `by`, and explicit action structure. An authored value expression is
limited to depth 32 and 256 nodes; limits are checked before binding so hostile
or accidental input cannot create unbounded recursive work.

`iteration` is valid only inside a domain with `repeatRefresh: true`; otherwise
it is rejected rather than misleadingly remaining zero. Iterations are
zero-based. A reverse yoyo pass retains the values generated for its preceding
forward iteration and does not evaluate a new iteration expression.

### Automatic Target-State Value

The existing `tween.auto` compiles to an internal target-state expression. The
portable `gsap` profile does not expose `auto` initially because an ordinary
`to` normally provides its destination explicitly. A future shorthand may
expose it if there is a demonstrated authoring need.

### Subject-Relative Translation

Existing `translateX` and `translateY` compile into expressions using the
subject's captured base position and dimensions. They still conflict with `x`
and `y` respectively. The core plan ultimately writes canonical
`transform.x`/`transform.y` channels rather than renderer-specific translation
properties.

## Modifiers

Portable modifiers form a closed per-channel pipeline:

```yaml
- kind: to
  targets: cards
  values:
    rotation:
      by: 360
  modifiers:
    rotation:
      - kind: snap
        increment: 15
      - kind: clamp
        min: -360
        max: 360
```

Reserved portable modifier kinds are:

- `snap` by increment or explicit values
- `round` with a decimal precision
- `clamp`
- `wrap`
- `wrapYoyo`

Modifier order is authored order. Arbitrary function modifiers are rejected.
Modifier support is scheduled after the core compiler and evaluator are stable.

Portable-v1 modifiers operate on scalar/angle/integer channels. Vector or
matrix component modification requires a future explicitly typed modifier
rather than implicit mapping. Exact scalar rules are:

- `snap.increment` is finite and positive, uses origin zero, and rounds a tie
  away from zero. `snap.values` is a non-empty finite list; nearest value wins,
  with authored list order breaking an exact tie. The two snap forms are
  mutually exclusive.
- `round.precision` is an integer from 0 through 15 and decimal-quantizes with
  ties away from zero.
- `clamp` requires finite `min <= max` and returns the nearest endpoint outside
  the inclusive interval.
- `wrap` requires finite `min < max` and maps into `[min, max)` using Euclidean
  modulo.
- `wrapYoyo` uses the same bounds and reflects over a period of
  `2 * (max - min)`, including both turn endpoints.

Each modifier receives the prior modifier's output. Modifiers apply after
interpolation on interior and terminal samples; any non-finite result is a
player error handled through the documented cancellation path.

## Easing Interface

Existing easing names remain accepted. The `gsap` frontend may additionally
accept documented GSAP aliases, but all names compile into structured easing
descriptors.

Examples:

```yaml
easing: easeOutCubic
```

```yaml
easing:
  kind: back
  direction: out
  overshoot: 1.8
```

```yaml
easing:
  kind: cubicBezier
  points: [0.22, 1, 0.36, 1]
```

```yaml
easing:
  kind: steps
  count: 5
  position: end
```

```yaml
easing:
  kind: sampled
  samples:
    - [0, 0]
    - [0.25, 0.08]
    - [0.5, 0.5]
    - [0.75, 0.92]
    - [1, 1]
```

Canonical easing kinds are:

- `linear`
- `power`
- `sine`
- `expo`
- `circ`
- `back`
- `bounce`
- `elastic`
- `steps`
- `cubicBezier`
- `sampled`

The structured descriptor fields are closed:

| Kind                             | Fields                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linear`                         | no additional fields                                                                                                                                    |
| `power`                          | required `direction: in \| out \| inOut`; required integer `exponent` from 1 through 5                                                                  |
| `sine`, `expo`, `circ`, `bounce` | required `direction: in \| out \| inOut`                                                                                                                |
| `back`                           | required `direction`; optional finite non-negative `overshoot`, default `1.70158`                                                                       |
| `elastic`                        | required `direction`; optional finite `amplitude >= 1`; optional positive finite normalized `period`; defaults are captured in the canonical descriptor |
| `steps`                          | required positive integer `count`; optional `position: start \| end`, default `end`                                                                     |
| `cubicBezier`                    | required four-number `points: [x1, y1, x2, y2]`                                                                                                         |
| `sampled`                        | required array of at least two `[time, value]` pairs                                                                                                    |

Structured easings are preferred for parameterized behavior. Sampled easing
is the portable escape hatch for CustomEase-like curves. Samples must begin at
time zero, end at time one, and use strictly increasing normalized time.
Sampling between adjacent points is linear in normalized time. Cubic-bezier x
control values must remain in `[0, 1]` so input-time inversion is single-valued;
its y values may overshoot. `steps.count` is a positive integer and
`steps.position` is `start` or `end`. Every parameterized ease has a closed
field set and finite-number validation in the authoring and program schemas.

GSAP alias mapping includes:

| GSAP alias            | Canonical existing name |
| --------------------- | ----------------------- |
| `none`                | `linear`                |
| `power1.in/out/inOut` | Quad in/out/in-out      |
| `power2.in/out/inOut` | Cubic in/out/in-out     |
| `power3.in/out/inOut` | Quart in/out/in-out     |
| `power4.in/out/inOut` | Quint in/out/in-out     |

## Stagger

Stagger expands one action into one scheduled clip set per resolved target.

Exactly one of `each` and `amount` is required:

```yaml
stagger:
  each: 40
  from: start
  easing: easeInOutQuad
```

```yaml
stagger:
  amount: 500
  from: center
```

Supported `from` values are:

- `start`
- `center`
- `end`
- `edges`
- `random`
- a non-negative target index

`from` defaults to `start`; stagger distribution easing defaults to `linear`.

`random` uses the deterministic program seed. Stagger easing affects the
distribution of start offsets, not the value interpolation easing.

Grid distribution is an extension of the same object:

```yaml
stagger:
  amount: 600
  from: center
  grid:
    columns: 4
  axis: x
```

`axis` is `x`, `y`, or omitted. Portable-v1 requires an authored positive
integer column count. Automatic layout-derived grids are reserved for a future
explicit backend layout capability.

Portable-v1 fixes the distribution algorithm so JS and native binders cannot
produce subtly different schedules. For an ordered one-dimensional result of
length `n`, target `i` receives a non-negative distance `d(i)`:

- `start`: `i`
- `end`: `n - 1 - i`
- `center`: distance from `(n - 1) / 2`, shifted so the nearest target(s) have
  distance zero
- `edges`: the inverse of the `center` distance, so outer target(s) have
  distance zero
- numeric index `k`: `abs(i - k)`; `k` must be in range after binding
- `random`: the target's rank in a seeded permutation of `0..n-1`

For a grid, aliases are placed row-major using the authored positive integer
`columns`. `start`, `end`, `center`, and numeric-index origins use their grid
coordinates. `axis: x` or `axis: y` uses absolute distance on that axis. To
avoid cross-runtime square-root drift, the no-axis metric is specifically
squared Euclidean distance in doubled integer grid coordinates, not an
implementation-selected distance function.
Grid `edges` uses distance from the nearest outer grid edge. `random` continues
to use a seeded permutation rather than layout distance.

Let `dMax` be the maximum generated distance. The normalized distribution is
`u = d / dMax`, or zero when `dMax` is zero. A stagger easing must map zero to
zero, one to one, and remain within `[0, 1]`; overshooting value eases are not
valid as distribution eases. Portable distribution easing is limited to
`linear`, the canonical integer-power in/out/in-out eases, or a validated
sampled piecewise-linear ease. Implementations use the specified binary64
operation order without fused operations before integer rounding. The action
span is `amount` when `amount` is used,
or `each * dMax` when `each` is used. Each start offset is
`floor(span * ease(u) + 0.5)` milliseconds. This non-negative half-up rounding
rule is part of conformance, and the maximum-distance target is forced to the
rounded span endpoint.

For zero resolved targets with `allowEmpty: true`, the action produces no
writes but still occupies its authored base delay and duration, with a zero
stagger span. For one target the stagger offset is zero. These rules keep an
optional target from unpredictably collapsing the rest of a sequence.

## Repeat, Yoyo, And Refresh

Actions and groups accept:

```yaml
repeat: 2
repeatDelay: 80
yoyo: true
repeatRefresh: false
```

The public repeat count is additional iterations. The compiled domain stores
total iterations:

```txt
repeat 0 -> iterations 1
repeat 2 -> iterations 3
repeat infinite -> iterations null
```

`repeatRefresh: true` reevaluates underlying captures, relative expressions,
and deterministic random expressions at the beginning of each repeated forward
iteration. A reverse yoyo pass does not refresh. Refresh is a pure function of
the activation base state, target identity, prior program-produced terminal
values, and iteration index; it never rereads arbitrary external renderer state
or wall-clock time. It does not change authored duration, delay, or stagger
offsets. Iteration is included in default random seed derivation so refreshed
random values remain deterministic. Direct seeking may populate an iteration
cache, but the result may not depend on the order in which iterations were
visited.

Because refreshed relative/underlying values can form a recurrence through the
previous terminal frame, portable-v1 permits `repeatRefresh: true` only on
finite domains with at most 10,000 total iterations. Direct seeking evaluates
the required prefix deterministically or reuses a verified prefix cache;
infinite refreshed domains are rejected. The large-delta constant-time skipping
guarantee applies to non-refreshed domains. This bound prevents an apparently
valid arbitrary seek from requiring unbounded historical work.

Repeat refresh is an advanced milestone. Internal development builds may reject
it until that milestone lands, but portable-v1 is not publicly declared
complete until the field works and passes conformance fixtures.

## Overwrite And Composition

Authoring overwrite modes are:

| Mode    | Meaning                                                 |
| ------- | ------------------------------------------------------- |
| `auto`  | Supersede only conflicting channels on the same targets |
| `all`   | Supersede all earlier clips affecting the same targets  |
| `none`  | Keep both using stable document-order priority          |
| `error` | Reject an overlap during compilation or binding         |

`auto` is the recommended default for `gsap`. The existing `tween` compiler
produces non-conflicting tracks and does not change behavior.

The plan reserves these composition modes:

- `replace`
- `add`
- `multiply`

Only `replace` needs to be public in portable-v1. Reserving the others avoids a
future plan-format break when additive animation is needed.

Within one program, overwrite takes effect at the incoming action's scheduled
start. `auto` trims earlier contributions only on channels written by that
action. `all` trims every earlier channel contribution on its resolved targets
from that time onward. `none` retains layers and uses source order as the final
replace-composition priority. `error` rejects any occupied-interval overlap and
reports both source paths. Endpoint contact where one positive-duration clip
ends exactly when another begins is not an overlap.

Source priority is a compiler-assigned depth-first preorder of authored steps;
parallel siblings retain list order, keyframe segments retain frame order, and
fan-out retains resolved target order. The ordinal is stored explicitly in the
program/instance, so no backend relies on map iteration or traversal accidents.

Across separately owned animation records, portable-v1 deliberately has no
implicit last-writer or cross-player overwrite. Staged binding rejects an
intersection between their concrete `(target identity, channel)` write sets
while both players can be active. Different channels on one target remain
valid. A complex choreography that intentionally overlaps one channel belongs
in one `gsap` record, where direct seeking can reproduce its complete ordering.

This strict cross-record rule also applies when one record uses `tween` and the
other uses `gsap`. Milestone 1 inventories existing ordinary-property overlaps;
if legacy content relies on current dispatch order, it receives an explicit
temporary compatibility path and migration diagnostic rather than silently
changing output. Ancestor-transition suppression is not treated as concurrent
overlap because descendant players are deferred until the owner transition
releases the subtree.

## Named Events

`emit` replaces serializable callbacks:

```yaml
- kind: emit
  event: hero-ready
  payload:
    character: hero
  direction: forward
  occurrence: eachIteration
  seekPolicy: suppress
```

| Field        | Values                       | Default         |
| ------------ | ---------------------------- | --------------- |
| `direction`  | `forward`, `reverse`, `both` | `forward`       |
| `occurrence` | `once`, `eachIteration`      | `eachIteration` |
| `seekPolicy` | `suppress`, `crossed`        | `suppress`      |

The player emits events only when its playhead crosses an event boundary under
the configured policy. The pure evaluator never emits events.

`setTime()` and offline screenshot sampling use `seekPolicy: suppress` unless
the caller explicitly requests event replay. This prevents rendering a frame
from causing application side effects.

`seekPolicy` governs non-contiguous player seeks, not ordinary tick/reverse
playback. Explicit replay is only a caller-level permission: an event authored
with `suppress` still does not replay, while `crossed` becomes eligible for the
crossed seek interval.

Event payloads must be JSON values with string object keys; functions, runtime
handles, YAML-specific tagged values, and cyclic references are rejected.
Events sharing a resolved timestamp are delivered in compiled source order.
For forward playback the crossing interval is `(previousTime, currentTime]`;
for reverse playback it is `[currentTime, previousTime)`, delivered in reverse
chronological order while retaining source order among ties. The initial
time-zero frame does not emit unless playback actually crosses time zero from
outside the domain or explicit replay is requested.

`once` means once for the lifetime of that player, including all repeats and
direction changes. `eachIteration` is keyed by the containing domain iteration
tuple and direction, including outer and inner repeated-domain indices, so a
yoyo return may emit only when `direction` includes reverse.
A large tick enumerates crossed event occurrences in time order without
sampling intermediate visual frames. Cancellation emits none. At natural
completion, terminal authored events are delivered after the final frame patch
succeeds and before the bus-level `completed` notification.

The currently reserved top-level `complete` configuration remains an inert
legacy envelope field in v1 and does not compile into an event. It is retained
only so migration does not silently assign it new behavior. New portable
content uses `emit` or the runtime bus/player completion API. Giving `complete`
meaning requires a future public-schema decision rather than a timeline-plan
implementation detail.

## Complete Update Example

```yaml
animations:
  - id: hero-presentation
    type: update
    targetId: scene-root

    playback:
      continuity: persistent
      speed: 1

    gsap:
      profile: portable-v1

      defaults:
        duration: 400
        easing: easeOutCubic
        overwrite: auto

      targets:
        hero:
          element: hero

        cards:
          elements: [card-a, card-b, card-c]

        titleCharacters:
          textUnits:
            elementId: title
            unit: grapheme
            order: visual

      steps:
        - kind: set
          targets: hero
          values:
            alpha: 0
            scaleX: 0.8
            scaleY: 0.8
            filters:
              glow:
                strength: 0

        - kind: parallel
          id: hero-entrance
          steps:
            - kind: fromTo
              targets: hero
              from:
                y: 260
                alpha: 0
                scaleX: 0.8
                scaleY: 0.8
              to:
                y: 180
                alpha: 1
                scaleX: 1
                scaleY: 1
              duration: 700
              easing:
                kind: back
                direction: out
                overshoot: 1.8

            - kind: keyframes
              targets: hero
              frames:
                - duration: 250
                  values:
                    filters:
                      glow:
                        strength: 1

                - duration: 450
                  easing: easeInOutSine
                  values:
                    filters:
                      glow:
                        strength: 0.25

        - kind: mark
          name: title-reveal

        - kind: from
          targets: titleCharacters
          values:
            y:
              random:
                min: 15
                max: 35
                seed: title-y
            rotation:
              random:
                min: -8
                max: 8
                seed: title-rotation
            alpha: 0
            scaleX: 0.6
            scaleY: 0.6
          duration: 500
          easing: easeOutBack
          stagger:
            each: 35
            from: center
            easing: easeOutQuad

        - kind: to
          targets: cards
          values:
            alpha: 1
            y:
              by: -20
          duration: 350
          stagger:
            amount: 300
            from: start

        - kind: to
          targets: hero
          overlap: 120
          values:
            scaleX: 1.05
            scaleY: 1.05
          duration: 250

        - kind: to
          targets: hero
          values:
            scaleX: 1
            scaleY: 1
          duration: 350
          easing: easeOutElastic

        - kind: emit
          event: hero-ready
          payload:
            character: hero
```

## Orchestrated Transition Interface

Existing transition shorthand remains supported and compiles to the same
program. The richer mode uses synthetic transition targets:

```yaml
animations:
  - id: scene-handoff
    targetId: scene-root
    type: transition

    mask:
      - kind: single
        texture: masks/spiral.png
        channel: red
        softness: 0.08

    compositor:
      type: shader
      source:
        webgl:
          fragment: "..."
        webgpu:
          source: "..."
      parameters:
        glow: 0

    gsap:
      profile: portable-v1

      targets:
        previous:
          transitionSurface: prev

        next:
          transitionSurface: next

        revealMask:
          transitionMask: true

        effect:
          transitionCompositor: true

      steps:
        - kind: parallel
          steps:
            - kind: fromTo
              targets: previous
              from:
                translateX: 0
              to:
                translateX: -1
              duration: 700

            - kind: fromTo
              targets: next
              from:
                translateX: 1
              to:
                translateX: 0
              duration: 700

            - kind: fromTo
              targets: revealMask
              from:
                progress: 0
              to:
                progress: 1
              duration: 700

            - kind: keyframes
              targets: effect
              frames:
                - duration: 250
                  values:
                    progress: 0.5
                    parameters:
                      glow: 1

                - duration: 450
                  values:
                    progress: 1
                    parameters:
                      glow: 0
```

Transition target kinds and channels are restricted:

| Target kind            | Channels                                                                      |
| ---------------------- | ----------------------------------------------------------------------------- |
| `transitionSurface`    | `x`, `y`, `translateX`, `translateY`, `alpha`, `scaleX`, `scaleY`, `rotation` |
| `transitionMask`       | `progress`                                                                    |
| `transitionCompositor` | `progress`, declared `parameters.*`                                           |

An orchestrated transition value action must reference an explicitly declared
synthetic transition alias. The implicit `self` target and ordinary
`element`/`elements`/`textUnits` queries are update-only and are rejected in a
transition program. Live descendant animation remains deferred rather than
being mixed into snapshot orchestration.

`transitionMask: true` requires at least one mask entry and targets all of them;
`transitionMask: <zero-based-index>` targets one existing entry.
`transitionCompositor` requires a compositor configuration. Missing previous or
next content remains a transparent surface as in the current transition model.

In orchestrated mode, every configured mask entry must have an effective
terminal `progress: 1` write and a configured compositor must have an effective
terminal `progress: 1` write. The compiler does not silently generate an
independent progress tween because that would create timing outside the
authored timeline. Surface motion is optional. Finalization still removes the
overlay and reveals the live next subtree through the existing transition
lifecycle.

Terminal validation evaluates the composed effective value at the exact finite
root endpoint after repeats, yoyo direction, overwrite, and fill semantics; it
does not merely search source for a literal `1`. A zero-duration orchestrated
transition is valid only when its required terminal writes occur at time zero.
The transition runner applies that frame once and honors any renderer-specific
commit barrier before resource destruction; the timeline program itself does
not add a hidden duration.

## TimelineProgram Contract

A `TimelineProgram` is immutable, JSON-serializable, and safe to transfer
between runtimes. It is normally statically scheduled, but it may retain closed
timing expressions when a start or duration depends on a target query whose
size is known only during binding, such as text-unit stagger. A
`TimelineInstance` is always fully scheduled.

Representative debug serialization:

```yaml
schema: route.timeline/v1
timeUnit: milliseconds
programId: hero-presentation
ownerId: scene-root
duration: binding

requirements:
  - target.element
  - target.textUnits.grapheme.unicode17
  - channel.transform2d
  - channel.filterParameter
  - easing.back
  - event.named

targetQueries:
  hero:
    kind: element
    elementId: hero

  titleCharacters:
    kind: textUnits
    elementId: title
    unit: grapheme
    order: visual
    segmentation:
      standard: unicode-uax29
      version: 17.0.0

schedules:
  root-schedule:
    kind: sequence
    children:
      - kind: fixed
        id: hero-entrance
        duration: 700
      - kind: fanout
        id: title-reveal
        targets: titleCharacters
        childDuration: 500
        stagger:
          each: 35
          from: center

domains:
  root:
    parent: null
    start: 0
    cycleDuration:
      kind: scheduleEnd
      schedule: root-schedule
    iterations: 1
    iterationGap: 0
    direction: forward
    rate: 1
    refresh: never

easings:
  ease-0:
    kind: power
    exponent: 3
    direction: out

clipTemplates:
  - id: clip-0
    sourcePath: animations[0].gsap.steps[1].steps[0]
    domain: root
    targets: hero
    fanout: null
    channel: transform.y
    valueType: scalar
    start: 0
    duration: 700
    sampler:
      kind: interpolate
      from:
        kind: constant
        value: 260
      to:
        kind: constant
        value: 180
      easing: ease-0
    modifiers: []
    composite: replace
    priority: 0
    fill: forwards

events:
  - id: event-0
    domain: root
    time:
      kind: scheduleEnd
      schedule: root-schedule
    name: hero-ready
    payload:
      character: hero
    direction: forward
    occurrence: eachIteration
    seekPolicy: suppress

debug:
  marks:
    title-reveal: 700
```

The debug object is illustrative rather than a final storage optimization. The
schema and semantics below are normative.

### Program Header

| Field           | Requirement                                                          |
| --------------- | -------------------------------------------------------------------- |
| `schema`        | Exact version identifier `route.timeline/v1`                         |
| `timeUnit`      | Exact value `milliseconds`                                           |
| `programId`     | Stable animation id                                                  |
| `ownerId`       | Top-level target/ownership id                                        |
| `duration`      | Non-negative integer, `binding` when target-dependent, or `infinite` |
| `requirements`  | Sorted unique backend capability ids                                 |
| `targetQueries` | Serializable target definitions                                      |
| `schedules`     | Minimal scheduling templates retained for binding-time dependencies  |
| `domains`       | Local time transforms                                                |
| `easings`       | Deduplicated structured ease table                                   |
| `clipTemplates` | Serializable target/channel operations                               |
| `events`        | Named event markers                                                  |
| `debug`         | Optional diagnostics excluded from semantic signatures               |

### Time Domains

A domain contains:

| Field           | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `parent`        | Parent domain id or `null`                                       |
| `start`         | Integer local start in parent milliseconds                       |
| `cycleDuration` | Integer duration or closed timing expression resolved by binding |
| `iterations`    | Positive integer or `null` for infinite                          |
| `iterationGap`  | Integer hold between iterations                                  |
| `direction`     | `forward`, `reverse`, or `alternate`                             |
| `rate`          | Finite positive local speed                                      |
| `refresh`       | `never` or `iteration`                                           |

Domain boundary behavior is explicit:

- one occupied iteration is `cycleDuration + iterationGap`, except there is no
  trailing gap after the final finite iteration
- the iteration gap holds the endpoint reached by the iteration that just
  completed
- an intermediate forward iteration maps its exact next-iteration boundary to
  local time zero
- an intermediate reverse yoyo iteration maps its exact next-iteration
  boundary to the next forward/reverse endpoint as appropriate
- the exact end of a finite domain samples its final terminal endpoint and does
  not wrap to the first frame
- an infinite forward domain sampled at an exact cycle boundary maps to the
  beginning of the next iteration, preserving existing loop behavior
- a repeated domain must have a positive `cycleDuration`; repeating a
  zero-duration group is rejected

Sequence, parallel, delays, overlaps, marks, and anchors do not survive as
runtime-instance nodes. The compiler resolves them into domain and clip start
times when all target counts are static. When scheduling depends on a dynamic
query count, the program retains a minimal closed schedule template or timing
expression for the binder to resolve. Nested groups also survive in the program
when they introduce a time transform such as repeat, yoyo, repeat delay, speed,
or repeat refresh. The bound instance contains only concrete domains, tracks,
segments, and event times.

### Timing Expressions And Schedule Templates

Timing expressions are data, not executable code. The initial closed union is:

- integer constant milliseconds
- target-query count
- stagger span for a query and stagger descriptor
- child start
- child end
- schedule end
- integer add, subtract, maximum, and upward rounding

The compiler preserves only the dependencies required for binding. It still
validates the schedule graph for duplicate ids, invalid references, cycles,
known negative values, and statically unreachable children.

Binding resolves target queries first and then evaluates every timing
expression. The result must be a non-negative integer millisecond value. A
runtime-resolved negative start, overflow, infinity in a finite domain, or
fractional result is a binding error before any renderer mutation.

An integer time must be in `0..9007199254740991`, except a signed anchor offset
which may use the corresponding safe negative range. Addition, subtraction,
multiplication by iteration counts, stagger expansion, and upward rounding are
checked before storing a result. The reserved `infinite`/`null` domain markers
are semantic values and are never represented by IEEE infinity. Negative zero
is canonicalized to zero.

For example, the occupied duration of a staggered action is:

```txt
action duration + maximum generated stagger offset
```

If the target count is static, that becomes an integer during compilation. If
the target count depends on text layout, it becomes an integer during binding.

### Target Queries

Target queries are declarative and ordered. Binding must either return a stable
ordered target list or fail with a diagnostic. Query results may not silently
drop missing required targets.

The initial query kinds are:

- `element`
- `elements`
- `textUnits`
- `transitionSurface`
- `transitionMask`
- `transitionCompositor`

Future query kinds require a plan-version capability and conformance tests.

### Semantic Channels

The plan stores semantic channel identifiers, never direct renderer paths.

Initial channel families are:

- `transform.x`
- `transform.y`
- `transform.scale.x`
- `transform.scale.y`
- `transform.rotation.degrees`
- `appearance.alpha`
- `effect.blur.x`
- `effect.blur.y`
- `geometry.rect.*`
- `filter.<filterId>.parameter.<name>`
- `transition.mask.progress`
- `transition.compositor.progress`
- `transition.compositor.parameter.<name>`

The channel registry declares:

- supported target kinds
- value type
- getter and frame-application adapter contracts
- canonical unit/range and any coordinate-space conversion
- conflict identity and application/batching group
- deterministic order within a coupled application group
- validation rules
- optional batching hooks
- settlement behavior

An adapter may not silently mutate an unrelated semantic channel. Coupled
renderer state, such as transform components/pivot refresh or rect-style
rebuilds, is applied through one declared group that receives the final values
for all dirty member channels. If a backend operation genuinely affects another
semantic value, that effect is declared in the registry and included in binding
conflict analysis. This preserves composability when separate disjoint update
records animate, for example, position and scale on one target.

### Value Types

Initial value types are:

| Type                   | Semantics                                                                        |
| ---------------------- | -------------------------------------------------------------------------------- |
| `scalar`               | Finite double-precision number                                                   |
| `vec2`, `vec3`, `vec4` | Fixed-length component interpolation                                             |
| `mat3`, `mat4`         | Fixed-length component interpolation                                             |
| `angleDegrees`         | Unwrapped numeric degrees                                                        |
| `colorSrgb`            | Component interpolation in defined normalized sRGB space                         |
| `colorLinear`          | Component interpolation in linear-light space                                    |
| `integer`              | Scalar interpolation with declared rounding                                      |
| `boolean`              | Discrete                                                                         |
| `string`               | Discrete unless a future sampler defines another behavior                        |
| `discrete`             | Hold `from` for normalized progress below one and switch exactly at the endpoint |

The binder validates a clip's expressions against the channel's declared value
type before creating an instance.

Color values are straight-alpha RGBA. `colorSrgb` interpolates normalized sRGB
components; `colorLinear` interpolates linear-light components. Alpha is
component-interpolated in both cases and is not implicitly premultiplied.
Numeric sequence interpolation is component-wise. All ordinary numeric values
use IEEE-754 binary64 semantics in the conformance model; adapters may narrow
only after the final frame-patch value is produced and within a declared
tolerance.

### Value Expressions

The initial internal expression union contains:

- `constant`
- `underlying`
- `targetState`
- `subjectDimension`
- `add`
- `subtract`
- `multiply`
- `divide`
- `min`
- `max`
- `clamp`
- `randomNumber`
- `randomChoice`
- `targetIndex`
- `targetCount`
- `iteration`

This is an internal closed AST, not arbitrary source text. Public shorthands
such as `{ by: 20 }` compile into this AST. Division by zero, incompatible
shapes, and non-finite results are binding errors.

Expression typing is closed: `add`/`subtract` require two scalars or identical
numeric shapes; `multiply`/`divide` accept scalar-scalar or a numeric shape with
a scalar factor/divisor; `min`/`max`/`clamp`, indices, counts, and numeric random
are scalar; `randomChoice` alternatives must all have the channel's same
canonical type and shape. There is no implicit string parsing, scalar-to-vector
broadcast for addition, or matrix algebra hidden inside these arithmetic nodes.

`underlying` has a precise meaning: the effective lower-priority program value
for the same target/channel at the clip's scheduled start, or the activation
base value when no earlier program clip contributes. It is resolved from the
program and captured activation state, not by performing a history-dependent
renderer read when real-time playback happens to reach the clip.

Priority is established before expression resolution. At one timestamp,
source order is the final tie-breaker: a later action may capture the effective
result of an earlier action scheduled at that timestamp, but never its own or a
higher-priority result. Overwrite trimming occurs only after this capture graph
is resolved. The dependency graph must be acyclic; a cycle is a binding error.

### Samplers

Each clip has a versioned sampler descriptor. The core v1 sampler is:

- `interpolate`

It contains `from`, `to`, and `easing`. Future portable extensions may add
closed sampler kinds such as:

- `motionPath`
- `physics2d`
- `textScramble`
- `geometryMorph`

These are not opaque plugin blobs. Each new sampler requires a schema,
capability id, normative sampling behavior, and JavaScript/native conformance
fixtures. Unknown sampler kinds fail before playback.

### Fill Semantics

Every clip declares one of:

- `none`
- `forwards`
- `backwards`
- `both`

The frontend compiler assigns fill behavior rather than leaving it implicit.
Fill has the following exact meaning:

| Fill        | Before clip start | After clip end  |
| ----------- | ----------------- | --------------- |
| `none`      | no contribution   | no contribution |
| `forwards`  | no contribution   | contribute `to` |
| `backwards` | contribute `from` | no contribution |
| `both`      | contribute `from` | contribute `to` |

The frontend compiler assigns fill rather than leaving it implicit:

- `set` uses `forwards`.
- `to`, `from`, and `fromTo` use `forwards`, so they make no contribution before
  their scheduled start and retain their result afterward. A `to` captures its
  underlying start value exactly at activation; using backwards fill here would
  incorrectly freeze an earlier, still-moving clip at that future captured
  value.
- `keyframes` compile to chained clips with forward fill on the chain result.
- the legacy tween compiler emits an explicit time-zero initial assignment and
  explicit hold intervals where required, preserving first/later delay
  behavior without relying on accidental clip fill.

Overwrite resolution may trim a fill interval when a later clip takes
ownership.

### Boundary Semantics

- A positive-duration clip interpolates on `[start, start + duration)`.
- Sampling exactly at its end returns the exact `to` value when forward fill or
  a following chained segment requires it.
- A zero-duration set takes effect at its exact time and fills forward until
  superseded.
- A zero-duration `to` or `fromTo` takes its terminal `to` value at the exact
  start. A zero-duration `from` resolves immediately to its captured underlying
  endpoint and therefore does not expose the authored `from` value; use `set`
  when an instantaneous authored assignment is intended.
- Multiple zero-duration writes at one timestamp resolve in source/priority
  order under the selected overwrite policy.
- Easing receives a clamped normalized progress in `[0, 1]`.
- The evaluator returns exact authored endpoints without passing them through
  approximated easing math.
- A gap holds the most recent effective value when fill semantics require it;
  otherwise the underlying channel remains visible.

### Program Signature

Persistent continuity must compare a canonical semantic program signature,
not debug metadata or renderer handles. The signature input includes:

- normalized target queries
- domains
- easing definitions
- clips
- events
- playback-affecting configuration
- transition resource configuration where the transition runner owns it

Object keys are canonicalized and arrays retain semantic order. `debug`, source
locations, and compiler build timestamps are excluded. A hash may be added for
performance, but canonical equality remains the correctness definition.

The canonical byte representation is RFC 8785 JSON Canonicalization Scheme
(JCS) UTF-8 applied to the normalized semantic object. This supplies exact key
ordering, string escaping, whitespace, and shortest round-trippable binary64
number serialization while preserving array order and normalizing negative
zero. Non-finite numbers, lone surrogate code points, duplicate parsed object
keys, and values outside their declared unions are rejected before
canonicalization. The conformance package publishes canonical byte fixtures;
implementations compare those bytes directly, with an optional hash used only
as an index accelerator.

Continuation also compares a bound-target identity signature. This captures
the resolved element/text-unit order, channel compatibility, and ownership
path. A program with the same source but differently shaped text or a changed
target list restarts instead of continuing against the wrong bound tracks.
Runtime element identity includes a stable id plus renderer generation/handle
generation; reusing an id for a replacement object does not continue against a
stale handle. These generation values live only in the instance signature, not
the transferable program signature.

## TimelineInstance Contract

Binding a program creates a mutable execution instance with immutable target,
channel, schedule, and ordinary bound-track structure. Clips using declared
repeat refresh retain pure per-iteration value resolvers plus an internal cache;
the cache is an optimization and cannot affect sampled results.

Binding performs these steps in order:

1. Verify backend capabilities.
2. Resolve the owner target.
3. Resolve every target query into a stable ordered target list.
4. Verify owner/descendant scope rules.
5. Resolve semantic channels through the channel registry.
6. Capture base channel values and subject dimensions.
7. Resolve target-state expressions.
8. Evaluate timing expressions and resolve the complete schedule.
9. Expand fan-out and stagger into concrete clip instances.
10. Resolve deterministic value expressions and random values.
11. Resolve within-program overwrite and composition layers.
12. Group bound clips into target/channel tracks.
13. Validate finite/infinite duration and required terminal values.

Binding itself performs no adapter writes and does not register a player. It
returns either a complete instance plus its concrete write-set or one aggregated
diagnostic result. Activation commits only after all instances in the affected
ownership scope bind successfully and their cross-record write-sets are
disjoint. An allowed empty query binds to an empty target list without skipping
the action's timing envelope.

Representative bound shape:

```yaml
instanceId: hero-presentation@42
programId: hero-presentation
duration: 2530

tracks:
  - targetHandle: 17
    channelHandle: 3
    baseValue: 220
    layers:
      - priority: 0
        composite: replace
        segments:
          - domainIndex: 0
            start: 0
            duration: 700
            from: 260
            to: 180
            easingIndex: 2

events:
  - domainIndex: 0
    time: 2530
    eventIndex: 0
```

Runtime handles and mutable event/iteration state exist only here. They never
appear in saved scene data or a transferable `TimelineProgram`.

## Evaluator Contract

The pure evaluator accepts:

- a bound instance
- an absolute root-program time in milliseconds

It returns a frame patch containing ordered target/channel values. It does not
mutate renderer objects and does not emit events.

Evaluation order is:

1. Clamp or wrap root time according to the root domain.
2. Map time through nested domains.
3. Find effective clips per bound track.
4. Sample easing and interpolation.
5. Apply modifiers in declared order.
6. Resolve layer priority and composition.
7. Emit one final effective value per bound target/channel track.

“Effective” includes the activation base or lower layer when no clip contributes,
so seeking backward or leaving a `fill: none` interval restores the correct
value. The pure evaluator does not infer dirtiness from prior samples. A player
may compare the returned patch with its last successfully applied patch and omit
equal adapter writes as an optimization; manual out-of-order seeking must still
produce the same complete logical patch.

The application phase then:

1. Opens each target/channel group's batching hooks.
2. Applies frame-patch values through adapters.
3. Closes batching hooks in reverse order.
4. Treats invalid/destroyed targets according to the player's cancellation
   policy.

Sampling the same bound instance at the same time must return equivalent values
regardless of prior seeks. Stateful event crossing and repeat-refresh caches
belong to the player/instance boundary and must not change pure visual sampling.

Root-program time is already scaled by public `playback.speed`; nested group
`speed` values are handled by their domains. The instance `duration` is the
occupied root-program duration and does not divide itself by playback speed.
The player owns external elapsed time and maps it as:

```txt
rootProgramTime = externalElapsedTime * playback.speed
```

Therefore a finite program of 1000 milliseconds at `speed: 2` completes after
500 milliseconds of player time. Real-time tick and manual `setTime()` use the
same mapping. Runtime products may be fractional milliseconds; boundary tests
still compare against exact authored integer endpoints after domain clamping.

In real-time mode, external elapsed time is per player and starts at activation.
In manual/offline mode, the bus-wide sampled time is the shared scene animation
time; a player registered while manual time is active is immediately sampled at
that value, preserving the current deterministic rendering contract. A
player-specific `seek` always addresses that player's elapsed-time axis.

## Player And Animation Bus Contract

The animation bus continues to own:

- command queues
- real-time `tick(deltaMS)`
- manual `setTime(timeMS)`
- cancellation and target-state settlement
- active and pending contexts
- persistent continuity
- completion callbacks used internally
- `renderComplete` tracking
- named event delivery

The bus gains a `plan` driver beside the existing temporary `property` and
`custom` drivers. After migration, property execution becomes a plan context.
Transition resource ownership may remain a custom context whose `applyFrame`
is replaced by plan sampling plus overlay adapters; the custom context owns
resources and lifecycle but contributes its patch to the same frame transaction.

One tick or manual-time update is a frame transaction: process queued lifecycle
commands, compute every active player's next time, sample all instances, merge
their already conflict-checked patches in activation order, apply each target's
declared channel group once, then deliver events and terminal lifecycle
notifications. Plan players do not write renderer state independently while the
bus iterates them. This is required for deterministic batching and for disjoint
programs that animate coupled transform/style groups on one target.

The host-facing player-control semantics are renderer-independent even if JS,
Rust, and C++ expose them with different language syntax:

| Command/query                      | Semantics                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pause(id)` / `resume(id)`         | Stop/start real-time advancement without rebinding or emitting seek events                                                      |
| `seek(id, elapsedMS, eventReplay)` | Set that player's non-negative external elapsed time and sample once; event replay is opt-in                                    |
| `progress(id, value, eventReplay)` | Seek a finite player by normalized `[0, 1]` occupied duration; invalid for infinite duration                                    |
| `direction(id, forward\|reverse)`  | Change update-player advancement direction without allowing a negative speed; host-driven transition reversal is rejected in v1 |
| `speed(id, value)`                 | Set a finite positive player multiplier without changing the authored program                                                   |
| `cancel(id, settlement)`           | Enter the single cancellation path with `targetState`, `hold`, or transition-owned settlement                                   |
| `state(id)`                        | Return pending/active/paused plus direction, external time, root-program time, finite/infinite duration, and terminal status    |

Player lifecycle is `pending -> active <-> paused -> completed | cancelled`.
Binding/preflight failure produces a diagnostic and never enters `active`.
Reaching the end while forward, or time zero while reverse, is a terminal
boundary completion and releases render-completion tracking exactly once; the
notification identifies which boundary was reached. A later seek of a terminal
player requires an explicit restart/rebind rather than resurrecting released
ownership. The existing bus-wide `setTime()` remains the offline/manual command
that samples all current players using the same external-time mapping.

The reverse boundary rule applies only to updates. Transition players keep
forward-only host playback in v1 because reversing a resource-owning handoff to
its previous snapshot conflicts with the renderer's already-selected next live
state. Authored yoyo inside a finite transition program remains valid when its
overall forward terminal validation succeeds.

Render completion rules remain:

- finite render-scoped animations block completion
- persistent animations do not block completion
- infinite animations do not block completion
- cancellation is not completion
- a finite repeated animation completes only after its last iteration and
  repeat delay

## Determinism Contract

Determinism means that, for identical normalized input, bound base values,
target order, seed, capabilities, and sample time, every conforming runtime
produces values within the declared tolerance.

Required measures:

- integer authored millisecond boundaries
- finite-number validation at every public and internal boundary
- a specified seed hash and PRNG with published test vectors
- canonical easing definitions
- explicit color spaces
- explicit rounding for integer channels and local speed duration projection
- explicit event crossing behavior
- stable target ordering
- no dependence on object key enumeration for semantic ordering
- no per-frame randomness
- no wall-clock reads inside the evaluator

Standard easings may differ by tiny floating-point amounts across JavaScript
and native math libraries. Conformance uses exact endpoint checks and an
explicit interior tolerance. Sampled easings can use a stricter tolerance.

## Capability Contract

Backends report supported capability ids before binding. Example ids:

- `target.element`
- `target.textUnits.grapheme.unicode17`
- `target.transitionSurface`
- `channel.transform2d`
- `channel.rectStyle`
- `channel.filterParameter.scalar`
- `channel.filterParameter.vector`
- `channel.compositorParameter.matrix`
- `easing.sampled`
- `modifier.snap`
- `sampler.motionPath.v1`
- `event.named`

A program lists its requirements. Binding fails once, with all missing
capabilities reported together. There is no silent partial playback.

## Complexity And Resource Limits

Schema validity does not imply unlimited work. The compiler and binder account
for authored step count, nesting depth, expression nodes, resolved targets,
expanded clips/tracks, domains, and potentially delivered event occurrences.
They fail with an aggregated limit diagnostic before activation rather than
truncating targets, clips, or events.

Milestone 18 publishes portable-v1 minimum supported limits and the higher
defaults used by the JS runtime. Backends may advertise larger limits but may
not claim portable-v1 conformance below the published minima. Repeats remain
compact domains rather than copied clips. A seek requesting event replay must
preflight its crossing count against the event-delivery limit before moving the
playhead; ordinary suppressed offline seeking does not enumerate events.

## GSAP Compatibility Boundary

The portable profile intentionally maps common GSAP concepts while defining
its own serializable semantics.

### Core Portable Coverage

| GSAP concept                  | Portable representation                      |
| ----------------------------- | -------------------------------------------- |
| `to`, `from`, `fromTo`, `set` | Step kinds                                   |
| Timeline sequencing           | `sequence` and default `steps`               |
| Same-time children            | `parallel`                                   |
| Position parameter            | `delay`, `overlap`, structured `start`       |
| Labels                        | `mark` and anchors                           |
| Defaults                      | Lexical `defaults`                           |
| Nested timelines              | Nested groups and time domains               |
| Keyframes                     | `keyframes.frames`                           |
| Stagger                       | Structured deterministic `stagger`           |
| Relative values               | `{ by: ... }`                                |
| Repeat, repeat delay, yoyo    | Group/action/root fields and domains         |
| Time scale                    | Positive `speed`                             |
| Overwrite                     | Explicit modes                               |
| Snap/round/common modifiers   | Closed modifier descriptors                  |
| Random values                 | Seeded random expressions                    |
| Callbacks                     | Named `emit` events                          |
| Custom ease                   | Structured or sampled easing                 |
| Seek/progress                 | Animation bus/player API, not authored steps |

### Deliberate Differences

| GSAP behavior                                 | Portable decision                                                   |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Seconds                                       | Milliseconds                                                        |
| `repeat: -1`                                  | `repeat: infinite`                                                  |
| Selector strings                              | Stable element/text-unit target queries                             |
| Function values                               | Closed expression descriptors                                       |
| Callback functions                            | Named events                                                        |
| Unseeded random                               | Deterministic seeded random                                         |
| Position strings such as `<` and `label+=...` | Structured groups, overlap, and anchors                             |
| `from` immediate render                       | Apply at scheduled start; use explicit `set` for earlier assignment |
| Arbitrary modifier functions                  | Closed modifier set                                                 |
| Implicit plugin behavior                      | Explicit capability and sampler kind                                |

### Not In The Portable Core

- CSSPlugin-specific CSS parsing
- browser DOM selectors
- ScrollTrigger
- Draggable
- Observer
- automatic DOM layout capture for Flip
- arbitrary JavaScript callbacks
- arbitrary plugin registration
- arbitrary function modifiers or function-based values

Future portable samplers such as motion paths or geometry morphing are added
only when their data, binding, and sampling behavior can be specified for every
target backend.

## Diagnostics Requirements

Every compiler and binding error must include:

- animation id
- authoring source path
- step id when available
- target alias and resolved target id when available
- channel
- expected and received type or capability
- suggested correction when unambiguous

Examples of required validation failures:

- duplicate animation id in one normalized state
- more than one transition for one target
- both `tween` and `gsap` are present
- fractional or non-finite time value
- negative duration, delay, repeat delay, stagger amount, absolute time, or
  resolved start; signed anchor offsets are allowed only when the result stays
  non-negative
- duplicate step id or mark
- unknown or forward anchor
- computed negative start
- infinite sequence child followed by another child
- `each` and `amount` both present in stagger
- missing target alias
- target outside the ownership subtree
- incompatible value type or shape
- `x` combined with `translateX` on one effective target/channel interval
- unsupported channel for a target kind
- overlapping channel with `overwrite: error`
- active cross-record target/channel write-set intersection
- transition mask/compositor target without matching resource
- infinite root transition
- required terminal transition progress not reaching the next-state endpoint
- backend missing required capabilities

## Versioning And Serialization

- Public authoring uses `gsap.profile: portable-v1`.
- Internal programs use `schema: route.timeline/v1`.
- Unknown fields are rejected in v1 unless explicitly designated metadata.
- Additive compatible changes require new optional fields plus capability
  declarations.
- Semantic changes require a new plan version and an explicit migration.
- Debug/source metadata is optional and excluded from semantic signatures.
- A readable debug serializer is implemented before any packed representation.
- A packed typed-array form is an optimization of a validated program, not a
  second semantic format.

## Recommended Module Boundaries

The implementation keeps compilation, portable reference evaluation, runtime
binding, JavaScript backend evaluation, and renderer application separate.
Exact filenames may change, but the responsibilities resemble:

```txt
src/plugins/animations/timeline/
  programSchema.js
  validateProgram.js
  canonicalizeProgram.js
  compileTween.js
  compileGsap.js
  compileTransition.js
  schedule.js
  easing.js
  valueTypes.js
  expressions.js
  domains.js
  bindProgram.js
  evaluateInstance.js
  gsapEvaluator.js
  applyFramePatch.js
  channelRegistry.js
  targetRegistry.js
  eventCrossings.js
  conformance/
```

Dependency direction is one-way:

```txt
schemas/normalizers
        -> compilers
        -> program validation/canonicalization
        -> binder
        +-> pure reference evaluator
        \-> JavaScript GSAP evaluator

renderer target/channel adapters -> binder and frame-patch application
animation bus -> player/binder/JavaScript GSAP evaluator
```

The pure program, scheduling, math, and evaluator modules must not import the
Pixi renderer. Pixi adapters may import the pure modules, never the reverse.
`gsapEvaluator.js` is the explicit JavaScript backend boundary and may import
GSAP; no GSAP instance enters a TimelineProgram or conformance fixture.
The existing transition runner remains the resource-owning caller of the
timeline layer rather than moving texture and shader ownership into it.

## Implementation Roadmap

Every milestone has a required checkpoint. A milestone is not complete until
its checkpoint evidence is reviewed and recorded.

### Milestone 0: Contract Review And Freeze

Outcome:

- Approve this public interface, program/instance split, millisecond policy,
  target scope, transition modes, and GSAP compatibility boundary.
- Record any deferred decisions explicitly instead of leaving ambiguous fields
  in schemas.

Work:

- Walk through at least these authored fixtures manually:
  - basic update tween
  - `auto` update
  - rect plus filter animation
  - multi-stage staggered update
  - mask plus compositor transition
  - add/remove/replace transition activation
  - parent-transition descendant deferral
  - two disjoint updates and two conflicting updates on one target
  - zero-duration update and transition
  - persistent infinite update
  - manual sampled render
- Confirm names against existing Route Graphics conventions.
- Confirm that no public field accepts direct GSAP JavaScript, plugin instances,
  or backend-specific executable data.

Checkpoint:

- Design review checklist is signed off with no unresolved blocking semantic
  questions.
- Each fixture can be explained from source through program, binding, sampling,
  application, cancellation, and completion.
- Reviewers explicitly approve integer authored milliseconds and the
  `TimelineProgram`/`TimelineInstance` separation.
- Reviewers approve the activation transaction, unique-id/one-transition rules,
  strict cross-record conflict policy, and update/transition settlement table.

### Milestone 1: Baseline Characterization

Outcome:

- Capture current runtime behavior before refactoring.

Work:

- Add golden unit fixtures for current timeline construction and sampling.
- Add current output fixtures for update properties, rect styles, filters,
  transition surfaces, masks, and compositors.
- Add lifecycle fixtures for cancellation, persistence, loops, and
  `renderComplete`.
- Add manual `setTime()` fixtures at boundaries, within delays, and after end.
- Record existing visual snapshots for representative transitions.
- Inventory duplicate animation ids, multiple transitions per target,
  ordinary-property cross-record overlaps, and ancestor/descendant ownership
  combinations in all repository content.
- Tighten authored duration/delay validation to non-negative integer
  milliseconds behind a documented compatibility check.

Checkpoint:

- Existing tests pass.
- New characterization tests pass against the unchanged evaluator.
- Visual baselines are reviewed rather than blindly regenerated.
- Any content using fractional or invalid time values is identified before the
  validation change is enabled.
- Any content relying on ambiguous animation id or last-writer behavior is
  either migrated or covered by an explicitly time-limited compatibility test.

### Milestone 2: Core Program Schema And Validators

Outcome:

- Introduce `route.timeline/v1` data types, validation, readable serialization,
  and canonical semantic serialization without changing execution.

Work:

- Implement validators for program headers, domains, queries, easings,
  expressions, clip templates, modifiers, and events.
- Implement capability collection.
- Implement canonical semantic serialization and debug serialization.
- Implement checked JSON-safe integer arithmetic and canonical byte fixtures.
- Keep source paths for diagnostics.
- Reject functions, runtime objects, non-finite values, and unknown kinds.

Checkpoint:

- Valid programs round-trip through debug JSON without semantic change.
- Canonical serialization is stable across object insertion order.
- Independent parsing produces the exact same canonical UTF-8 bytes, including
  numeric, Unicode, negative-zero, and rejected-duplicate-key cases.
- Mutation-after-validation tests prove program immutability or defensive
  copying.
- Invalid-shape table tests cover every union discriminator and unknown field.
- A reviewer verifies that no Pixi, DOM, or GSAP type appears in the program
  module dependency graph.

### Milestone 3: Canonical Values, Easings, And Time Kernel

Outcome:

- Provide the shared pure math layer used by every compiler and evaluator.

Work:

- Implement integer millisecond boundary validation.
- Implement canonical scalar/vector/matrix/color/discrete types.
- Normalize existing easing names and GSAP aliases.
- Implement structured and sampled easings.
- Specify exact endpoints and interior numeric tolerances.
- Define integer-channel rounding and local speed duration rounding.

Checkpoint:

- Every existing easing matches current sampling at a dense timestamp set
  within the approved tolerance.
- Exact start/end assertions pass for every easing.
- Vector and matrix shape mismatch tests fail predictably.
- Color interpolation fixtures explicitly verify selected color space.
- Sampled easing rejects unsorted, missing-endpoint, and non-finite samples.
- A portable test-vector file is produced for later Rust/C++ use.

### Milestone 4: Legacy Tween Compiler In Shadow Mode

Outcome:

- Compile every existing tween surface into a `TimelineProgram` without using
  it for rendering yet.

Work:

- Compile ordinary update properties.
- Compile `initialValue`, delays, relative keyframes, and `auto` expressions.
- Compile rect style and geometry channels.
- Compile filter parameter tracks.
- Compile transition `prev`/`next` surface motion.
- Compile mask progress and compositor parameters.
- Compile `playback.loop` into an infinite root domain alias.
- Preserve normalized source paths.

Checkpoint:

- Golden program snapshots exist for every current public animation example.
- Randomized property-track fixtures compare old `getValueAtTime()` output with
  a reference sampler of the compiled clips.
- Current duration calculation and compiled duration match for all finite
  fixtures.
- Existing continuity signatures remain equivalent for semantically identical
  source, including explicit-zero versus omitted delay.
- Shadow compilation reports no errors across repository examples and
  playground templates.

### Milestone 5: Binder, Channel Registry, And Pure Evaluator

Outcome:

- Bind programs to mock targets and sample bound instances without changing
  production rendering.

Work:

- Implement target-query and channel-registry interfaces.
- Implement base-value and target-state capture.
- Resolve expressions and subject dimensions.
- Build bound target/channel tracks and priority layers.
- Implement domain time mapping.
- Implement pure frame-patch evaluation.
- Implement batch-friendly application separately from evaluation.
- Return concrete write-sets and implement transactional multi-program binding
  without applying time-zero values.

Checkpoint:

- Repeated out-of-order seeks return the same frame patch as monotonic playback.
- Sampling is idempotent and does not mutate targets.
- A failed program or cross-record conflict causes zero committed frame writes
  for the affected activation scope.
- Boundary table tests cover zero duration, delay start/end, clip end, repeat
  delay, yoyo turn, and final completion.
- Destroyed/missing targets fail binding or trigger the documented player
  cancellation path; they do not cause partial undefined writes.
- Fuzzed legacy programs match the existing evaluator within tolerance.
- Dependency review confirms the pure evaluator imports no Pixi modules.
- Coupled transform and rect-style fixtures prove application order/batching
  does not introduce hidden writes or make disjoint channels conflict.

### Milestone 6: Migrate Update Tween Execution

Outcome:

- Existing update tweens execute through bound plans under the animation bus.

Work:

- Add a plan-driven bus context.
- Merge all plan-player patches into one ordered frame transaction before
  adapter application and lifecycle delivery.
- Reuse current property adapters and rect batching hooks.
- Preserve initial-state application, `auto`, settlement, cancellation, and
  completion behavior.
- Preserve filter grouping under the same clock.
- Supply ordered subtree target registries and per-target next-state values only
  after rendering/layout is ready.
- Implement explicit natural-complete, state-cancel, invalid-target, and
  continuation paths.
- Run old and new evaluators in comparison mode during development.

Checkpoint:

- All update, normalization, rect, and filter tests pass.
- Manual and automatic playback produce matching values at the same times.
- Existing visual tests show no unexplained pixel differences.
- Cancellation applies the requested target state exactly once.
- Duplicate ids, same-channel update records, and partially bound multi-target
  updates fail before initial values are applied.
- Persistent and looping updates retain their current completion exclusions.
- Comparison instrumentation shows no duplicate renderer writes after the old
  path is disabled.
- Disjoint animation records on one target share coupled batching groups without
  frame-order differences between real-time and manual sampling.

### Milestone 7: Migrate Transition Timing

Outcome:

- Existing transition shorthand uses the shared program for all numeric timing
  while the transition runner retains resource ownership.

Work:

- Bind synthetic previous/next surface targets.
- Bind mask progress and sequence-mask sampling inputs.
- Bind compositor progress and scalar/vector/matrix parameters.
- Replace direct transition timeline construction with compiled tracks.
- Preserve deferred descendant operations, overlay validity, cancellation, and
  finalization.
- Stage snapshot/resource ownership before allocation and test preflight cleanup.

Checkpoint:

- Existing transition tests and reviewed visual baselines pass.
- Open, close, replace, mask-only, compositor-only, and mask-plus-compositor
  fixtures all reach the same terminal state.
- Cancellation destroys owned textures/resources once and reveals/settles the
  correct live subtree.
- Persistent transition continuation retains the original captured surfaces.
- Manual `setTime()` samples shader time, mask progress, and compositor
  parameters consistently.
- Zero-duration and failed-preflight transitions reveal the correct live state
  and release resources without a hidden timeline duration.
- Aborting or superseding after every asynchronous preparation boundary leaves
  no stale overlay/player and destroys each prepared resource once.

### Milestone 8: Time Domains And Expanded Playback

Outcome:

- Support finite repeat, infinite repeat, repeat delay, yoyo, nested speed, and
  repeat refresh infrastructure.

Work:

- Implement nested domain mapping and duration calculation.
- Normalize public repeat counts into total iterations.
- Add `playback.repeat`, `repeatDelay`, and `yoyo`.
- Keep `loop` as a compatibility alias.
- Define large-delta iteration skipping without per-iteration loops for
  non-refreshed domains and enforce the finite refresh-iteration bound.
- Implement the external-elapsed-time to root-program-time speed mapping once in
  the player, with nested speed remaining in domains.
- Add refresh hooks while initially allowing the compiler to reject unsupported
  refreshed expressions.

Checkpoint:

- A reviewed boundary matrix covers every combination of finite/infinite,
  repeat delay, yoyo, nested speed, and zero-duration rejection.
- Large delta ticks and direct seeks produce the same visual sample.
- Infinite repeat refresh and refresh beyond the portable iteration bound fail
  validation; finite refresh seeks are order-independent.
- Infinite programs never complete or block render completion.
- Finite repeated programs complete once after their true final endpoint.
- Unsupported root transition repetition fails validation before resources are
  allocated.

### Milestone 9: Conflict, Overwrite, And Composition Layers

Outcome:

- Define deterministic same-channel overlap before exposing rich timelines.

Work:

- Implement `auto`, `all`, `none`, and `error` binding policies.
- Implement stable source-order priorities.
- Implement `replace`; reserve and test internal `add` and `multiply` semantics.
- Add channel-ownership checks that reject active cross-record write-set
  intersections during staged binding; keep authored overwrite semantics inside
  one program.
- Include effective policy in semantic signatures.

Checkpoint:

- Pairwise overlap fixtures cover same/different target and same/different
  channel.
- `auto` preserves non-conflicting channels.
- `all` trims all earlier target clips from the incoming start as specified.
- `none` produces stable document-order results under seeking and real-time
  playback.
- `error` reports both source paths and the conflicting channel.
- Cross-record conflicts report both animation ids, target identity, channel,
  and source paths before either player commits.

### Milestone 10: Core `gsap` Schema And Compiler

Outcome:

- Implement the first portable update timeline frontend behind an internal
  development gate.

Work:

- Add profile, defaults, target aliases, and the step discriminated union.
- Compile `set`, `to`, `from`, `fromTo`, `keyframes`, `sequence`, `parallel`,
  and `wait`.
- Enforce `tween`/`gsap` exclusivity.
- Produce precise source-path diagnostics.
- Document the portable compatibility boundary.

Checkpoint:

- Each action kind has schema, normalization, compiler, and integration tests.
- Equivalent tween and gsap fixtures compile to semantically equivalent
  programs.
- Nested sequence/parallel duration fixtures are manually reviewed.
- `from` scheduled-start behavior is explicitly tested and documented.
- Invalid mixed authoring modes fail before render mutation.
- The profile is not advertised as complete while later portable-v1 milestones
  remain unavailable.

### Milestone 11: Marks, Anchors, Delays, And Overlap

Outcome:

- Complete readable GSAP-style placement without string position syntax.

Work:

- Implement marks and unique step ids.
- Implement lexical anchor scopes and group-envelope visibility.
- Implement absolute start and structured anchors.
- Implement delay/overlap scheduling and lexical defaults.
- Detect unknown references, forward references, cycles, negative starts, and
  unreachable children after infinity.
- Preserve source maps in resolved scheduling diagnostics.

Checkpoint:

- A scheduling truth table covers sequence, parallel, wait, delay, overlap,
  absolute time, mark, step-start, and step-end anchors.
- The compiler's calculated marks and duration match hand-calculated fixtures.
- Invalid dependency graphs fail with actionable paths.
- Cross-scope child anchors and references into repeated group internals are
  rejected; anchoring the containing group succeeds.
- Reviewers confirm representative complex timelines remain easier to read than
  equivalent GSAP position strings.

### Milestone 12: Multi-Target Fan-Out And Stagger

Outcome:

- Support multiple elements with deterministic target ordering and stagger.

Work:

- Implement element and explicit-list queries.
- Enforce ownership subtree scope.
- Implement `each`, `amount`, ordering modes, distribution easing, and explicit
  grid columns.
- Expand fan-out during binding.
- Include target identity in deterministic seed derivation.
- Implement the normative distance, easing, half-up rounding, zero-target, and
  one-target rules.

Checkpoint:

- Stagger offset tables match hand calculations for every `from` mode.
- Reversing target order changes results only as documented.
- Random order is identical for identical seeds and differs for changed seeds.
- Missing targets and out-of-scope targets fail before any values are applied.
- Multi-target completion duration includes the latest staggered end.
- `allowEmpty` produces no writes while preserving the documented base action
  timing envelope.

### Milestone 13: Text-Unit Targets

Outcome:

- Provide renderer-neutral character, word, and line animation targets.

Work:

- Define the text-unit target adapter contract.
- Bundle the pinned Unicode 17.0.0/UAX #29 data; implement grapheme/word
  segmentation and stable logical/visual ordering without host-version drift.
- Expose per-unit base transforms, alpha, bounds, and lifecycle.
- Decide whether the Pixi implementation uses per-unit display objects,
  geometry, or another batching strategy without leaking that choice into the
  plan.
- Define behavior when text reshapes during a persistent animation.

Checkpoint:

- Unicode fixtures include combining marks, emoji ZWJ sequences, surrogate
  pairs, ligatures, whitespace, multiline text, RTL text, and mixed direction.
- One authored grapheme target never splits a user-perceived character.
- Logical and visual order are independently verified.
- Two independent binders using the pinned segmentation fixtures produce the
  same logical unit boundaries; layout-dependent identities include the same
  declared shaping inputs or correctly report non-conformance.
- Text layout changes either preserve a documented binding identity or restart
  through continuity rules; they never silently retarget the wrong unit.
- Performance review measures representative long text rather than only small
  demos.

### Milestone 14: Expressions, Randomness, Modifiers, And Custom Ease

Outcome:

- Complete the portable replacement for common JSON-representable function
  values and core GSAP modifiers.

Work:

- Implement relative, math, target-index/count, and target-state expressions.
- Implement the public `expr` AST, static type checking, and depth/node limits.
- Specify and implement the seed hash and PRNG.
- Implement random number/choice and repeat refresh.
- Implement snap, round, clamp, wrap, and wrap-yoyo modifiers.
- Implement cubic-bezier and sampled custom easing.

Checkpoint:

- Publish seed/PRNG test vectors and verify them in an independent reference
  implementation.
- Rebinding the same program with the same inputs produces identical constants.
- Repeat refresh changes only the expressions documented as refreshable.
- Modifier pipelines are order-sensitive in the documented way.
- No expression can access global state, wall-clock time, renderer objects, or
  executable source.
- Type-invalid, over-depth, and over-node-budget expressions fail before target
  resolution or renderer mutation.
- Custom ease endpoints and monotonic sample-time validation pass.

### Milestone 15: Named Events And Playback Controls

Outcome:

- Support portable timeline events and expose player control without embedding
  callbacks in data.

Work:

- Compile `emit` steps.
- Implement forward/reverse crossing, once/each-iteration, and seek policies.
- Implement JSON-payload validation, same-time source ordering, crossing
  intervals, and completion-notification ordering.
- Expose pause, resume, seek, progress, reverse, and speed through the runtime
  API rather than authored side-effect steps.
- Preserve the reserved top-level `complete` field's inert v1 behavior.

Checkpoint:

- Event boundary tests cover large ticks, skipped frames, repeats, yoyo,
  reverse, seek, cancellation, and restart.
- Default `setTime()` and offline rendering emit no events.
- A live event fires at most once per configured occurrence even when a frame
  lands exactly on its timestamp repeatedly.
- Same-time and large-tick events are delivered in the normative forward and
  reverse order, and cancellation emits none.
- Player controls do not alter the immutable program or bound track values.
- Existing `renderComplete` behavior remains unchanged.

### Milestone 16: Orchestrated Transition `gsap` Mode

Outcome:

- Allow one rich timeline to coordinate previous/next surfaces, mask progress,
  and compositor parameters.

Work:

- Add transition synthetic target schemas and adapters.
- Decouple static compositor configuration from the current required nested
  tween when top-level `gsap` is present.
- Enforce shorthand/orchestrated mode exclusivity.
- Validate terminal transition state and finite duration.
- Preserve snapshot ownership and resource cleanup.
- Integrate orchestrated transitions with the same staged activation and
  descendant-deferral rules as shorthand transitions.

Checkpoint:

- Equivalent shorthand and orchestrated transitions render equivalent frames.
- A mixed surface/mask/compositor timeline remains deterministic under random
  seeks.
- Missing mask/compositor resources fail before overlay creation.
- Terminal validation prevents completing with an unrevealed next surface.
- Terminal validation accounts for overwrite, fill, finite repeats, yoyo, and
  zero-duration sets at the exact root endpoint.
- Cancellation and continuation pass the same ownership tests as shorthand
  transitions.

### Milestone 17: Documentation, Tooling, And Diagnostics

Outcome:

- Make the system authorable and debuggable without reading runtime source.

Work:

- Update JSON schemas, hosted docs, examples, and playground tooling.
- Add a compiler inspection command that prints normalized AST, program,
  duration, marks, target queries, requirements, and diagnostics.
- Add timeline visualization data without making the visualizer part of the
  semantic plan.
- Document GSAP-supported, differently-supported, deferred, and rejected
  features.
- Add migration examples from tween to gsap without requiring migration.

Checkpoint:

- Every public field has schema validation and documentation.
- Every documented example is executed in tests.
- Compiler errors include source paths and suggested fixes.
- A user can inspect why an action starts at a given millisecond and which
  target/channel it writes.
- Documentation review confirms no claim of arbitrary GSAP compatibility.
- The portable-v1 release checklist shows every reviewed public field as
  implemented and tested; fields still behind development rejection gates block
  public profile release.

### Milestone 18: Performance And Reliability Hardening

Outcome:

- Prove the shared plan is practical for production-scale scenes.

Work:

- Index tracks for cursor-based forward playback and binary-search seeking.
- Batch dirty target/channel application.
- Deduplicate easings, constants, and target queries.
- Add optional packed typed-array instances after semantic correctness.
- Measure binding time, allocation, sampling, and application separately.
- Stress cancellation, rebinding, and destroyed targets.
- Stress staged activation failures and adapter exceptions after batch hooks
  open.
- Publish portable minimum complexity/resource limits and JS runtime defaults.

Checkpoint:

- Benchmarks cover many elements, many text units, many shader parameters,
  nested repeats, and frequent manual seeks.
- No benchmark optimization changes golden sampling results.
- Memory returns to baseline after repeated start/cancel/destroy cycles.
- Failed binding commits no writes; failed application closes every opened batch
  hook and settles/cancels exactly once.
- The packed representation round-trips to the readable instance semantics.
- Performance budgets are agreed before declaring completion; no unreviewed
  benchmark-only shortcuts enter the semantic layer.
- Limit-boundary fixtures fail before activation and never silently truncate
  target, clip, track, or event output.

### Milestone 19: Cross-Language Conformance Package

Outcome:

- Make a future Rust/C++ evaluator implementable without reading JavaScript
  runtime internals.

Work:

- Publish versioned program schemas and semantic test vectors.
- Include target-query mock bindings, ease samples, expression results, domain
  mapping, track samples, composition, event crossings, canonical bytes, and
  random-number state/output vectors.
- Build a small independent reference evaluator or validator.
- Document numeric tolerances and endpoint requirements.

Checkpoint:

- A second implementation reads the same fixture programs and passes the
  conformance suite.
- No fixture depends on Pixi, DOM, JavaScript object ordering, or JavaScript
  callbacks.
- Differences outside tolerance are treated as specification bugs or runtime
  bugs, not accepted as backend personality.
- Native work begins only after this checkpoint.

### Milestone 20: Optional Portable Sampler Extensions

Outcome:

- Add advanced signature animation features only in response to concrete use
  cases and without weakening the core plan.

Candidate extensions:

- motion paths
- deterministic 2D physics
- text scramble/type replacement
- geometry/path morphing
- path drawing progress

For each candidate:

- define a closed sampler schema
- define supported target/channel types
- define binding and terminal semantics
- define deterministic sampling
- assign a capability id
- provide JS and native conformance fixtures

Checkpoint:

- Each extension passes its own design review and cross-runtime fixture suite.
- An extension is rejected if it requires opaque callbacks, browser-only
  objects, or unspecified plugin behavior.
- No extension changes core interpolate sampler semantics.

## Release Strategy

Use progressive internal replacement rather than one large switch:

1. Characterize current behavior.
2. Add and validate programs without executing them.
3. Compare old and new sampling in shadow mode.
4. Migrate existing update tween execution.
5. Migrate existing transition timing.
6. Add new playback and conflict semantics.
7. Expose the `gsap` frontend only after the shared evaluator is already proven.
8. Add multi-target and text-unit behavior behind capability checks.
9. Publish conformance artifacts before native work.

Feature flags should be internal and temporary. Public scene data must not need
to choose between old and new executors.

Release gates are explicit:

- Milestones 0-9 may ship only as internal replacement of existing behavior.
- Milestones 10-17 may exercise `portable-v1` in repository fixtures and
  development tooling, but the profile is not yet a supported public contract.
- Milestone 18 is the production-readiness gate for the complete portable-v1
  field set, including update, transition, multi-target, and text-unit paths.
- Milestone 19 is required before claiming that a Rust/C++ implementation is
  conformant. Milestone 20 extensions are independent opt-in capabilities and
  do not delay the core profile.

## Definition Of Done

The shared timeline project is complete when:

- all existing tween content executes through `TimelineProgram`
- all existing transition timing executes through the shared TimelineProgram
  evaluation contract
- the portable gsap profile supports the reviewed core interface
- integer millisecond validation is enforced consistently
- manual and real-time playback share one sampler
- seeking is deterministic and side-effect-free by default
- continuity, cancellation, and render completion preserve documented behavior
- update and transition selection, activation, descendant deferral, and
  settlement follow the normative lifecycle table
- animation ids and transition ownership are unambiguous, and separate records
  cannot race on one bound channel
- multi-target and text-unit animation pass correctness and performance reviews
- program inspection and diagnostics are available
- the conformance package can drive an independent runtime
- the old direct property timeline execution path is removed
- the PixiJS production path uses pinned GSAP while TimelineProgram and the
  native conformance contract require no JavaScript engine, Pixi-specific
  interpolation, DOM selectors, or executable animation data

## Review Checklist

Before approving implementation, reviewers should answer yes to each question:

- Does every public construct have one unambiguous timing meaning?
- Can the construct be represented as serializable data?
- Can the construct be bound without exposing renderer objects to the program?
- Can a bound instance be sampled at arbitrary time without playback history?
- Are event side effects separated from visual sampling?
- Are missing capabilities reported before mutation?
- Does staged activation either commit all required time-zero writes or none?
- Are update and transition lifecycle rules preserved?
- Are animation ids, selection triggers, descendant deferral, and terminal
  settlement unambiguous?
- Is ownership clear for multi-target actions?
- Are text characters defined as graphemes rather than code units?
- Are overwrite and cross-animation conflicts deterministic?
- Is every intentional same-channel overlap contained in one owned program?
- Are infinite duration and unreachable steps rejected where necessary?
- Are terminal transition values validated?
- Can the same semantics be implemented in Rust or C++?
- Is every milestone protected by a checkpoint that can fail?

## Normative External Standards

- Program-signature canonical bytes use RFC 8785 JSON Canonicalization Scheme:
  <https://www.rfc-editor.org/rfc/rfc8785.html>
- Portable-v1 text segmentation pins Unicode 17.0.0:
  <https://www.unicode.org/versions/Unicode17.0.0/>
- Grapheme and word boundary behavior follows the corresponding Unicode Text
  Segmentation annex: <https://www.unicode.org/reports/tr29/>

## Official GSAP Reference Surface Reviewed

The portable compatibility inventory was checked against the official GSAP
core documentation for:

- Tween configuration, keyframes, stagger, relative values, overwrite, repeat,
  repeat delay, repeat refresh, yoyo, callbacks, and time scale:
  <https://gsap.com/docs/v3/GSAP/Tween/>
- Timeline defaults, nesting, labels, position control, callbacks, repeats,
  seeking, and time scale: <https://gsap.com/docs/v3/GSAP/Timeline/>
- Utility concepts including distribute, interpolate, random, map, clamp, wrap,
  and snap: <https://gsap.com/docs/v3/GSAP/gsap.utils/>
- Core modifiers and snap behavior:
  <https://gsap.com/docs/v3/GSAP/CorePlugins/Modifiers/>

These references inform the compatibility table but do not override the
portable semantics defined in this document.
