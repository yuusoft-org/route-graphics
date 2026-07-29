# Animation Implementation Plan

Last updated: 2026-07-29

## Goal

Track the remaining implementation work for the semantic cutover to:

- top-level `animations`
- required `type: update | transition`
- `tween` as the motion payload
- `prev` / `next` for handoff surfaces
- `mask` for reveal-driven transitions

The old public `operation`-based shape has been removed.

## Where We Are Now

Current runtime shape:

- public normalization expects `type: update | transition`
- update animation is driven through one central animation bus
- every changed render cancels all active update animations before planning the next state
- transition supports add, update, and delete lifecycles through diff planning
- transition supports `prev` and `next` tween composition with optional `mask`
- transition supports shader `compositor` with top-level `tween.uProgress`
- element shader filters are supported through `elements[].filters`
- update playback supports positive speed multipliers and infinite,
  non-blocking loops

Primary files involved today:

- `src/util/normalizeRenderState.js`
- `src/util/normalizeAnimations.js`
- `src/plugins/elements/renderElements.js`
- `src/plugins/animations/animationBus.js`
- `src/plugins/animations/planAnimations.js`
- `src/plugins/animations/replace/runReplaceAnimation.js`
- `src/schemas/animations/animation.yaml`
- `src/types.js`

## Target Public Model

### Update

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

### Transition

```yaml
animations:
  - id: "scene-handoff"
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
    mask:
      kind: "single"
      texture: "masks/spiral-07.png"
      channel: "red"
      softness: 0.08
      progress:
        initialValue: 0
        keyframes:
          - duration: 500
            value: 1
            easing: "linear"
```

Key rules:

- `update` uses `tween`
- `update` and `transition` both support absolute `x` / `y` and subject-relative
  `translateX` / `translateY`
- a single tween cannot combine `x` with `translateX`, or `y` with `translateY`
- `update` and `transition` support optional `playback.continuity: persistent`
- `update` and `transition` support optional positive `playback.speed`
- `update` supports optional `playback.loop: true`
- `transition` uses `prev`, `next`, and optional `mask`
- `transition` may define:
  - `prev` only
  - `next` only
  - both
  - `mask` with no explicit motion overrides
  - `compositor`
- `update` cannot use `mask`
- shader compositor support is `transition`-only
- shader compositor support is mutually exclusive with `mask` in v1
- top-level `transition.tween` is valid only for `uProgress` when a compositor
  is present
- compositor support requires top-level `tween.uProgress`
- `update` is update-only and must not be used for add/delete
- a parent `transition` owns the subtree surface while active
- descendant animations under that parent `transition` are deferred until finalize

## Completed Migration

The public type rename is complete.

Already implemented in the current runtime:

- public `type: update | transition`
- `tween` instead of `properties`
- `prev` / `next` / `mask`
- transition `compositor`
- element `filters`
- diff-driven add/update/delete mapping for transition lifecycles
- next-only and prev-only transitions
- tween plus mask composition in one transition animation

## Historical Step 1: Rename The Public Types

Status:

- complete

Completed work:

- renamed public `live` to `update`
- renamed public `replace` to `transition`
- updated schema, normalization, docs, tests, and examples together
- did not keep a compatibility alias layer

## Remaining Work

## Step 2: Tighten Lifecycle Semantics

Goal:

- make lifecycle behavior match `update` and `transition`

Work:

- `update` should dispatch only in update paths
- add/delete paths should never dispatch `update`
- `transition` should own all enter, exit, and swap behavior
- keep the diff deciding add/update/delete
- keep `renderElements()` as the central transition entrypoint for those lifecycles

Files likely touched:

- `src/plugins/animations/planAnimations.js`
- `src/plugins/elements/renderElements.js`
- `src/util/diffElements.js`

## Step 3: Route Fresh Child Mounts Through The Planner

Goal:

- preserve child transitions on first mount without relying on add-time update animation

Work:

- for newly mounted containers, render children through `renderElements()`
- use `prevComputedTree: []` for fresh subtree mounts
- stop recursive raw child `add()` from being the only first-mount path
- keep child `transition` support working for brand-new subtrees when no ancestor transition is active

## Step 4: Make Parent Transition Own The Subtree Surface

Goal:

- keep the transition runner snapshot-based instead of becoming a live subtree compositor

Work:

- keep the current snapshot-style prev/next surface handoff
- when a parent `transition` is active, defer descendant animations for that same state change until finalize
- mount the hidden next subtree in a suppressed animation state
- on finalize, reveal the live subtree and start or resume descendant animations

## Step 5: Keep Update Cheap

Goal:

- preserve the cheap live-object property animation path for persistent elements

Work:

- continue using the animation bus for `type: update`
- keep update-time motion on one live display object
- use `transition` for enter/exit/swap even when the effect is a simple fade
- use `update` only for elements that persist across the state change

## Step 5A: Add Persistent Playback Continuity

Goal:

- allow selected `update` and `transition` animations to continue across later
  renders without adding a third top-level animation type

Specified public interface:

```yaml
animations:
  - id: "bg-breathe"
    targetId: "bg"
    type: "update"
    playback:
      continuity: "persistent"
    tween:
      scaleX:
        keyframes:
          - duration: 3000
            value: 1.05
            easing: "easeInOutSine"
          - duration: 3000
            value: 1
            easing: "easeInOutSine"
```

Implemented contract:

- `playback` is optional on `update` and `transition`
- `playback.continuity` supports `render` and `persistent`
- when omitted, `update` keeps current render-scoped behavior
- when omitted, `transition` keeps current render-scoped behavior
- when present on `update`, the same animation should continue across later
  renders if `id`, `targetId`, and normalized config are unchanged
- when present on `transition`, the same in-flight handoff should continue
  across later renders if `id`, `targetId`, and normalized `prev` / `next` /
  `mask` / `compositor` / top-level `tween.uProgress` / `playback` config are
  unchanged
- if a later render omits the animation, it stops
- if a later render changes the animation config, it restarts
- a persistent animation should not count toward any render's
  `renderComplete`; renders complete independently of persistent playback
- persistent transition continuity keeps the same active handoff alive; it does
  not retarget the transition mid-flight

Implemented work:

- extend normalization and schema for optional `playback.continuity`
- reconcile persistent update animations by stable animation `id` instead of
  cancelling them unconditionally on every changed render
- reconcile persistent transitions by stable animation `id` and keep the
  existing overlay / hidden-next handoff alive across unrelated later renders
- keep render-scoped animations on current reset behavior when continuity is not
  requested
- skip completion tracking for persistent animations, so their eventual finish
  never emits `renderComplete`
- keep the restart rules simple: changed config or changed owned target/subtree
  breaks continuity and starts a new animation instance

Primary runtime files:

- `src/util/normalizeAnimations.js`
- `src/schemas/animations/animation.yaml`
- `src/RouteGraphics.js`
- `src/plugins/animations/animationBus.js`
- `src/plugins/animations/planAnimations.js`
- `src/plugins/animations/updateAnimationDispatch.js`
- `src/util/diffElements.js`

## Step 5B: Add Looping Update Playback

Status:

- complete

Public interface:

```yaml
animations:
  - id: "ambient-pulse"
    targetId: "portrait"
    type: "update"
    playback:
      continuity: "persistent"
      speed: 1.5
      loop: true
    tween:
      scaleX:
        initialValue: 1
        keyframes:
          - duration: 600
            value: 1.05
            easing: "easeInOutSine"
          - duration: 600
            value: 1
            easing: "easeInOutSine"
```

Implemented contract:

- looping is valid only for `type: update`
- the timeline wraps by its finite positive duration after applying playback
  speed
- ticked and manually sampled playback use the same deterministic phase
- loops never enter render completion tracking
- loops never emit animation completion
- cancellation or omission stops a loop without synthesizing completion
- looping transitions and loop-plus-`complete` configurations are rejected
- persistent continuity may carry the same loop across compatible renders;
  changed tween or playback configuration restarts it

## Step 6: Keep Mask Transition As The Reveal Primitive

Goal:

- keep one clear reveal primitive

Work:

- keep `mask.kind: single | sequence`
- keep `channel`, `softness`, `invert`, and `progress`
- keep sequence masks on explicit `frames[].at` positions with `sample: hold | linear`
- keep mask transition-only

No new public primitive is needed here.

## Step 7: Support Transition Composition

Goal:

- allow richer transitions without multiplying top-level concepts

Work:

- allow `prev.tween`
- allow `next.tween`
- allow `mask`
- make those composable inside one transition

This is the shape needed for:

- push plus dissolve
- slide plus reveal
- richer VN transitions

This is implemented. Keep VT coverage around it so it stays working.

## Step 8: Broaden Element-Type Support

Goal:

- make transition behavior consistent across the library

Work:

- let `animated-sprite` mount paused for transition snapshotting and post-finalize start
- add a resolved or paused build path for `text-revealing`
- keep both suppressed while an ancestor transition owns the subtree surface
- then evaluate:
  - `video`
  - `slider`
  - `particles`

## Step 9: Revisit Shader Later, If Needed

Goal:

- keep the core small until a real need returns

Current decision:

- do not support shader-backed transition for now

Future rule:

- if shader compositor support returns, it should live under `transition`
- it should not change the `update | transition` split
- element shader filters should live on elements, outside animation objects

## Future Cleanup: Completion Leases

The current completion tracker still uses paired:

- `track(version)`
- `complete(version)`

That is workable, but it spreads version capture and release logic through many code paths.

A later cleanup should move this to an acquired lease/token model such as:

```js
const completion = completionTracker.acquire();
completion.complete();
```

Benefits:

- idempotent completion semantics
- fewer version-plumbing bugs in async and deferred flows
- clearer ownership for cancellation and finalize paths
- less callback coupling around `getVersion()` / `track()` / `complete()`

This should be done as a dedicated follow-up, not mixed into the current animation semantic migration.
