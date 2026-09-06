# Animation Implementation Plan

Archived planning snapshot. The current contract is [animation-model.md](../animation-model.md).
Implementation corrections are recorded in [repository hardening](../repository-hardening.md).

Last updated: 2026-08-06

## Purpose

Track animation-runtime work separately from the public contract in
`docs/animation-model.md`.

## Implemented Public Model

The runtime and schema currently support:

- top-level `animations`
- required `type: update | transition`
- ordinary update `tween` properties
- `prev.tween` and `next.tween` transition surface motion
- single and sequence transition masks
- inline single-pass and multi-pass shader compositors
- mask followed by custom compositor passes
- element shader filters on every built-in visual node
- filter-specific shader parameter timelines
- custom transition compositor parameter timelines
- deterministic opt-in shader time
- `playback.continuity: render | persistent`
- positive playback speed
- non-blocking loops for updates
- non-negative per-segment delays for manual and automatic tweens
- manual deterministic sampling

The old `operation`, `properties`, `subjects`, `live`, and `replace` public
shapes have been removed.

## Runtime Ownership

### Update

An update animates one live display object. One animation context may contain
both:

- ordinary transform/alpha/blur property timelines
- any number of filter-specific shader parameter groups under
  `tween.filters.<filterId>`

The animation bus samples both groups from the same clock, applies playback
speed and looping once, and completes them as one animation.

### Transition

A transition owns a captured previous/next surface handoff. Its execution
pipeline is:

```txt
capture previous and next surfaces
-> apply prev/next surface motion
-> optional mask pass
-> optional compositor pass chain
-> present final overlay frame
-> reveal live next subtree
```

A parent transition owns the subtree surface while active. Descendant
animations are deferred until finalize instead of being live-composited into
the captured surfaces.

### Persistent Continuity

An update continues only when its id, target, normalized `tween`, filter
timelines, playback config, and live target identity remain compatible.

A transition continues only when its id, target, `prev`, `next`, `mask`,
inline `compositor` including its tween, playback config, and owned subtree
remain compatible.

Changed configuration restarts the animation. Omission cancels it.

## Inline Effects Milestone

Status: complete.

Implemented work:

- retained inline effect ownership; no root registry
- added ordered pass chains
- added scalar, vector, and matrix parameters
- added targeted parameter timelines
- added deterministic read-only `uTime`
- added pass padding, resolution, antialias, clipping, blend, and mesh
- added per-texture sampling
- added selectable WebGL/WebGPU initialization
- added mask plus compositor composition
- broadened element filter support
- reused programs and filter instances where safe
- added validation, diagnostics, schemas, tests, and documentation

See `docs/shader-interface.md` for the full contract.

## Remaining Animation Work

These are animation-lifecycle improvements, not missing shader-effect
capabilities.

### Keyframe Start Values

Status: implemented.

Optional keyframe-level `startValue` is supported across the compact visual,
shader-parameter, and audio keyframe interfaces. The runtime preserves the
preceding value during `delay`, applies `startValue` when the interpolation
duration begins, and resolves relative frames sequentially from the preceding
endpoint through the explicit start to the endpoint.

The schemas, normalizers, compilers, evaluators, public types, hosted docs, and
conformance tests shipped together so no interface accepts the field with
partial behavior. See `docs/keyframe-start-value-design.md` for the normative
formulas, boundary rules, compatibility constraints, and implementation
coverage.

### Tighten Update Lifecycle Semantics

Goal:

- dispatch `update` only when an element persists across a state change
- keep all authored enter, exit, and replacement handoffs under `transition`
- remove remaining add/delete update behavior kept for legacy compatibility

Primary areas:

- element add/delete handlers
- `src/plugins/animations/planAnimations.js`
- `src/plugins/elements/renderElements.js`

### Complete First-Mount Child Planning

Goal:

- route newly mounted container children through the central render planner
- preserve child transitions on first mount when no ancestor transition owns
  the subtree
- consistently suppress and later release descendant animations when an
  ancestor transition does own the subtree

### Broaden Transition Lifecycle Coverage

Goal:

- keep animated sprites paused/resolved during transition snapshots
- keep text-revealing nodes paused/resolved during captured handoffs
- verify video, slider, input, and particle lifecycle behavior under parent
  transitions

This is distinct from shader filtering: those visual node types already accept
element shader filters.

### Completion Leases

The completion tracker still uses paired `track(version)` and
`complete(version)` calls. A later internal cleanup can replace these with an
idempotent acquired lease/token:

```js
const completion = completionTracker.acquire();
completion.complete();
```

This would simplify cancellation and asynchronous finalize paths without
changing the public animation model.

## Non-Goals

- a third top-level animation type
- live per-frame rendering of both transition subtrees
- an arbitrary shader render graph
- a root-level effect registry
- changing semantic layout or hit testing from shader mesh deformation
