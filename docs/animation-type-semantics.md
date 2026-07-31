# Animation Type Semantics

> Historical design note. The `live` / `replace` terminology described below
> has been removed from the public API. For the current implemented contract,
> use `docs/animation-model.md` and the hosted Tween documentation. This file is
> retained to explain the reasoning behind the `update` / `transition` rename.

## Purpose

This note captures a proposed cleanup of animation type semantics in `route-graphics`, based on the current engine behavior and the needs of script-driven scene transitions.

The immediate motivation is correct support for transitions like:

- showing an image with dissolve
- hiding an image with dissolve
- replacing one shown visual with another using the same transition

## Historical Behavior

The current public animation types are:

- `live`
- `replace`

In practice, `route-graphics` currently dispatches `live` animations in all three lifecycle paths:

- add
- update
- delete

Examples:

- `src/plugins/elements/sprite/addSprite.js`
- `src/plugins/elements/sprite/updateSprite.js`
- `src/plugins/elements/sprite/deleteSprite.js`
- `src/plugins/elements/container/addContainer.js`
- `src/plugins/elements/container/updateContainer.js`
- `src/plugins/elements/container/deleteContainer.js`

At the same time, `replace` animations are supported in add, update, and delete handling through `renderElements.js`, including the delete case where:

- `prevElement` exists
- `nextElement` is `null`

That path is implemented in:

- `src/plugins/elements/renderElements.js`
- `src/plugins/animations/replace/runReplaceAnimation.js`

So today both `live` and `replace` can participate in element entry/exit, depending on how the caller uses them.

## Problem

This makes the semantics blurry:

- `live` sounds like "animate the live element"
- but it is also currently used for add and delete
- `replace` sounds like "swap old for new"
- but it is also used for pure enter and pure exit

That ambiguity becomes more obvious when mapping from scene-transition semantics:

- a dissolve is conceptually a transition from previous composed state to next composed state
- it applies when something appears
- it applies when something disappears
- it applies when one thing changes into another

That is not a great fit for a type name like `replace`.

## Transition Mapping

For composed-state transitions, the correct conceptual model is:

- `show`: `prev = null`, `next = element`
- `hide`: `prev = element`, `next = null`
- `swap/update`: `prev = old`, `next = new`

This maps naturally to the current `replace` implementation.

It does not map well to the meaning most people would infer from `live`.

## Recommended Semantic Split

Narrow the animation types so they have clear contracts:

- one type for animating an element that already exists and remains on screen
- one type for transitions between previous and next visual state

Recommended split:

- `update`
- `transition`

### `update`

Meaning:

- animate properties on an element that exists before the state change
- and still exists after the state change

Use cases:

- motion of an already-visible element
- emphasis bounce
- pulse
- reposition
- opacity/scale/rotation changes where the element remains present

Non-goals:

- not for enter
- not for exit
- not for swap between previous and next visual states

### `transition`

Meaning:

- animate from previous visual state to next visual state

Use cases:

- show / enter
- hide / exit
- swap old to new
- dissolve
- fade
- mask-based wipes
- future shader-based transitions

This matches the existing `replace` implementation much better than the name `replace`.

## Why Not `tween`

`tween` is not a good replacement name for `live` because the schema already uses `tween:` as a property name.

That leads to awkward structures like:

```yaml
type: tween
tween:
  alpha:
    keyframes:
      - duration: 300
        value: 1
```

That is redundant and confusing.

## Why Not `property`

`property` is readable, but still too broad. It does not communicate the important lifecycle restriction:

- the element already exists
- and remains present after the update

`update` communicates that constraint better.

## Why Not Keep `live`

`live` is too vague once the contract is tightened.

If the intended future meaning is:

- only for elements already on screen
- only for elements that remain on screen

then `update` is a clearer name.

## Why `transition` Works Well

`transition` remains a good fit even as capabilities expand:

- simple fade
- dissolve
- mask-driven transition
- future shader-driven transition

These are all transitions between previous and next render state, not just "replacement".

This is especially important for:

- `prev-only` exit
- `next-only` enter
- masked transitions
- shader transitions using old/new textures

## Proposed Naming

Rename:

- `live` -> `update`
- `replace` -> `transition`

Result:

```yaml
animations:
  subtle_move:
    type: update
    tween:
      x:
        keyframes:
          - duration: 200
            value: 20

  dissolve_300:
    type: transition
    prev:
      tween:
        alpha:
          initialValue: 1
          keyframes:
            - duration: 300
              value: 0
              easing: linear
    next:
      tween:
        alpha:
          initialValue: 0
          keyframes:
            - duration: 300
              value: 1
              easing: linear
```

## Behavioral Recommendation

If this rename is adopted, the behavior should be tightened to match it:

- `update` should only be dispatched in update paths
- add/delete paths should not dispatch `update`
- all enter/exit/swap behavior should go through `transition`

That likely means:

- stop dispatching the current `live` path from add handlers
- stop dispatching the current `live` path from delete handlers
- keep the update-time property animation path for persistent elements
- keep transition handling in `renderElements.js`

## Parent Transition And Child Animations

There is one important design choice to make explicit:

- a parent `transition` owns the subtree surface while the transition is active
- descendant animations are not expected to be visibly composited inside that parent transition

This means the engine should keep the current snapshot-style transition model for now:

- transition animates between previous and next subtree surfaces
- it does not live-render nested child animations into that surface each frame

Operational rule:

- if an element is entering through its own add path and no ancestor transition owns the subtree surface, its own child animations may run normally
- if an ancestor transition is active for the same state change, descendant animations are deferred until the parent transition finalizes

Why this rule is preferred:

- it matches the composed-state transition mental model better
- it keeps transition rendering much simpler and cheaper
- it avoids requiring live per-frame rendering of both prev and next subtrees into offscreen textures

Implementation consequence:

- newly mounted container children should go through `renderElements()` with `prevComputedTree: []` so child `transition` animations can still run on first mount when there is no ancestor transition
- when a parent `transition` mounts the hidden next subtree, descendant animation dispatch should be suppressed until finalize

## Animated Sprite And Text Revealing

`animated-sprite` and `text-revealing` should be supported by `transition`.

The preferred way to support them under the subtree ownership rule is:

- allow them to mount in a paused or resolved state for snapshot capture
- keep them from advancing while their parent transition owns the subtree surface
- start or resume them after the transition finalizes

This avoids turning the transition runner into a live subtree compositor.

## Porting Recommendation

For script-to-scene conversion work:

- use `transition` semantics for all `with dissolve`, `with fade`, and similar scene/show/hide transitions
- do not model those with `update`

This matches the composed-state model directly: transition from previous composed screen state to next composed screen state.

## Migration Notes

If a rename happens, there are two separate concerns:

1. Naming

- schema names
- docs
- examples
- engine-generated animation resources

2. Semantics

- whether add/delete stop dispatching the old `live` behavior
- how child animations behave under a parent `transition`
- how `animated-sprite` and `text-revealing` participate in `transition`

Suggested migration plan:

1. Rename the public types directly to `update` and `transition`.
2. Tighten runtime behavior so `update` is never used for add/delete.
3. Route first-mount container children through `renderElements()` so child `transition` animations still work on fresh subtree mount.
4. Make parent `transition` own the subtree surface and defer descendant animations until finalize.
5. Add paused or resolved mount support so `animated-sprite` and `text-revealing` can participate in `transition`.

## Summary

Recommended long-term contract:

- `update`: animate a persistent element already on screen
- `transition`: animate between previous and next visual state

Recommended rename:

- `live` -> `update`
- `replace` -> `transition`

Recommended transition mapping:

- `show ... with dissolve` -> `transition`
- `hide ... with dissolve` -> `transition`
- same-id visual swap with dissolve -> `transition`
- bounce/pulse/reposition of already-visible element -> `update`
