# Rect Interaction Visual States Implementation Plan

Last updated: 2026-08-08

## Goal

Make `rect.hover`, `rect.click`, and `rect.rightClick` support native visual
states in Route Graphics while preserving their existing event metadata.

The first supported appearance fields are:

- `fill`
- `alpha`

Route Graphics owns pointer-state tracking and browser-visible state changes.
An embedding layer such as Route Engine may resolve higher-level resource IDs
and compatibility aliases before passing the renderer-ready shape to Route
Graphics.

## End State

Route Graphics accepts this low-level rect shape:

```yaml
- id: menu-button
  type: rect
  width: 320
  height: 72
  fill: "#202020"
  alpha: 0.8
  hover:
    fill: "#303030"
    alpha: 0.9
    cursor: pointer
    soundSrc: hover.mp3
    soundVolume: 70
    payload:
      source: menu-button
  click:
    fill: "#101010"
    alpha: 0.7
    soundSrc: press.mp3
    soundVolume: 80
    payload:
      action: select
  rightClick:
    fill: "#401010"
    alpha: 0.75
    soundSrc: context.mp3
    soundVolume: 60
    payload:
      action: context-menu
```

The interaction objects remain a single object containing both appearance and
event metadata. No new `visualStates` wrapper is introduced.

Renderer boundary rules:

- `fill` uses the same complete fill grammar as top-level rect `fill`, including
  solid and gradient fills.
- `alpha` is a finite number from `0` through `1`.
- `alpha` is the only opacity field accepted by Route Graphics.
- Route Graphics does not accept `opacity`, `colorId`, or other embedding-layer
  aliases.
- `payload`, sound, and cursor behavior remain unchanged.
- Unknown direct fields in an interaction object remain validation errors.
- Arbitrary keys inside `payload` remain data and are never interpreted as
  appearance fields.

## Existing Behavior

Route Graphics already has the main interaction primitives:

- `createHoverStateController`
- `createPressStateController`
- `createRightPressStateController`
- inherited hover, press, and right-press propagation from containers
- native visual states for sprites and text

Rects currently support only event metadata in `hover`, `click`, and
`rightClick`. Their interaction binder emits events, plays sounds, changes the
hover cursor, and handles drag/scroll, but it does not apply visual state.
Strict rect validation therefore rejects nested `fill` and `alpha`.

The rect style runtime already owns the animated base fill. Top-level `alpha`
is still animated directly on the Pixi display object. Supporting interaction
appearance correctly requires separating the current base/animated appearance
from the effective appearance shown after interaction overrides.

## Visual State Semantics

### State lifecycle

- Hover becomes active on direct `pointerover` or inherited container hover.
- Hover becomes inactive on direct `pointerout` after all inherited hover
  sources are inactive.
- Primary press becomes active on a primary `pointerdown` or inherited
  container press.
- Primary press becomes inactive on primary `pointerup` or
  `pointerupoutside` after all inherited press sources are inactive.
- Right press becomes active on `rightdown` or inherited container
  right-press.
- Right press becomes inactive on `rightup`, `rightupoutside`, or
  `rightclick` after all inherited right-press sources are inactive.
- Interaction state is cleared when the corresponding config is removed, the
  element is rebound, or the element is destroyed.

Existing event timing does not change:

- hover payload and sound occur on `pointerover`
- click payload and sound occur on a valid primary `pointerup`
- right-click payload and sound occur on `rightclick`
- `pointerupoutside` and `rightupoutside` clear appearance without emitting a
  successful click event

### Priority and partial overrides

Appearance resolves independently for each supported field with this priority:

1. active `rightClick`
2. active `click`
3. active `hover`
4. current base/animated value

Only a defined field overrides the lower layer. For example:

```yaml
fill: "#202020"
alpha: 0.8
hover:
  fill: "#303030"
click:
  alpha: 0.6
```

While hovered and pressed, the effective appearance is:

```yaml
fill: "#303030" # inherited from the active hover layer
alpha: 0.6 # overridden by the active click layer
```

This per-field cascade avoids requiring authors to repeat an entire appearance
in every state.

### Animation composition

Interaction appearance is an overlay on the current animated base, not a
replacement for animation state.

Required behavior:

- Base fill and alpha animations continue advancing while an interaction
  override covers the same field.
- Leaving the interaction reveals the latest animated value, not a snapshot
  taken when the pointer entered.
- An active state that does not define a field never interrupts that field's
  animation.
- Animation completion, cancellation, looping, seeking, and target-state
  settlement update the base channel first and then recompute the effective
  appearance.
- Legacy tween animations and portable GSAP timelines have identical
  composition behavior.

Snapshot-and-restore is explicitly not acceptable because it restores stale
values when animations or render-state updates occur during interaction.

### Render-state updates

- Updating base `fill` or `alpha` while an override is active updates the base
  immediately but keeps the overriding value visible.
- Updating an active interaction's visual config recomputes the effective
  appearance immediately without requiring pointer exit/re-entry.
- Removing the currently winning field falls through to the next active layer
  or the latest base value.
- Rebinding interactions must not duplicate listeners, sounds, or events.
- Existing container inheritance remains active across child updates and child
  insertion while a container state is already active.

## Proposed Runtime Architecture

### 1. Add a rect appearance runtime

Add a small runtime next to `rectStyleRuntime.js`, tentatively
`rectAppearanceRuntime.js`. It owns:

- current base alpha
- references to the current base fill/style runtime
- current `hover`, `click`, and `rightClick` appearance configs
- direct and inherited active-state results
- per-field cascade resolution
- application of the effective fill and alpha
- batching so one animation frame causes at most one redraw/recompute

Keep base state and effective rendered state separate. Do not write interaction
values into the authored/computed element object or the rect style animation
state.

The appearance runtime should expose focused operations such as:

- install/sync for add and update paths
- set hover/press/right-press activity
- set base alpha from static reconciliation or animation
- notify that base fill changed
- compute effective appearance
- begin/end animation frame batching
- destroy/cleanup

The final names may follow nearby runtime conventions, but the ownership split
must remain explicit.

### 2. Reuse the existing interaction controllers

Extend `rectInteractions.js` to use the same hover, press, and right-press
controllers used by text and sprites.

The binder should:

- create controllers whenever the corresponding interaction exists, including
  metadata-only interactions
- send state changes to the rect appearance runtime
- add `pointerdown`, `pointerupoutside`, `rightdown`, `rightup`, and
  `rightupoutside` handling required for pressed visuals
- preserve primary-button filtering
- preserve hover cursor, sound, payload, drag, and scroll behavior
- clear inherited controller targets and any direct press state during cleanup
- avoid treating payload contents as configuration

Container inheritance must work without a rect-specific parallel propagation
system.

### 3. Compose drawing through the runtime

Update `addRect.js`, `updateRect.js`, `rectStyleRuntime.js`, and, if useful,
`rectDrawing.js` so all redraws use effective appearance:

- the style runtime remains the canonical animated base for fill and other rect
  style properties
- fill animation changes notify the appearance runtime
- the appearance runtime selects the effective fill before drawing
- alpha reconciliation updates base alpha, then writes effective alpha to Pixi
- interaction-only redraws do not overwrite base style state
- structured fill resources are released through the existing rect fill
  lifecycle when effective fills change or the rect is destroyed

Avoid duplicating full draw logic inside pointer listeners.

### 4. Route alpha animation through the base channel

Top-level rect `alpha` animations currently target the Pixi display object's
effective `alpha`. Introduce a rect-specific animation adapter so alpha samples
update appearance-runtime base alpha instead.

The integration must cover:

- legacy tween preparation and application
- portable timeline channel `appearance.alpha`
- automatic target-state resolution
- initial-value reads
- target-state settlement
- batching with existing rect style animation hooks

Non-rect elements must retain their existing direct Pixi alpha behavior. Keep
the adaptation scoped by the presence of the rect appearance runtime rather
than changing the public animation property.

Before implementation, add a focused runtime test proving the adapter sees the
base alpha while an interaction override is active. This closes the easiest
place for a false-positive implementation that looks correct only when no
animation is running.

## Validation, Schema, and Types

Update the raw and computed rect contracts together:

- `src/plugins/elements/rect/rectConfig.js`
- `src/schemas/elements/rect.element.yaml`
- `src/schemas/elements/rect.computed.yaml`
- `src/types.js`

Define one reusable rect interaction appearance shape where practical. The
allowed direct fields are:

| Interaction  | Appearance      | Metadata                                       |
| ------------ | --------------- | ---------------------------------------------- |
| `hover`      | `fill`, `alpha` | `cursor`, `soundSrc`, `soundVolume`, `payload` |
| `click`      | `fill`, `alpha` | `soundSrc`, `soundVolume`, `payload`           |
| `rightClick` | `fill`, `alpha` | `soundSrc`, `soundVolume`, `payload`           |

Validation requirements:

- reuse the existing fill validator rather than creating a reduced interaction
  fill grammar
- reject non-finite alpha and values outside `0..1`
- reject `opacity` with a path-specific unsupported-field error
- keep metadata validation unchanged
- keep arbitrary nested payload data valid, including payload keys named
  `fill`, `alpha`, or `opacity`
- ensure parser output preserves all supported appearance and metadata fields
  without mutation

## Test Plan

### Parser and validation

Extend `spec/parser/parseRect.test.yaml` and
`spec/elements/rectConfig.spec.js` to cover:

- `fill` and `alpha` in all three interaction objects
- solid, linear-gradient, and radial-gradient interaction fills
- boundary alpha values `0` and `1`
- invalid alpha type, non-finite values, and range errors
- unsupported `opacity`
- unsupported direct fields
- payload objects containing appearance-like keys that remain byte-for-byte
  unchanged
- raw and computed schema parity

### Pointer and event semantics

Extend `spec/elements/eventSemantics.spec.js` or add a focused rect visual-state
spec covering:

- hover enter/exit and cursor restoration
- primary press/release and `pointerupoutside`
- non-primary pointer events do not activate click visuals
- right press/release, `rightupoutside`, and `rightclick`
- event payload and sound timing remains unchanged
- metadata-only interactions still work
- cleanup and rebind do not duplicate listeners

### Appearance cascade

Add focused runtime tests for:

- base -> hover -> press -> hover -> base
- right-press priority over primary press and hover
- per-field fallthrough when higher states define only fill or only alpha
- explicit `alpha: 0` and transparent fill
- full structured fill replacement and restoration
- direct plus inherited state from one or more containers
- nested container inheritance
- removal and replacement of an active interaction during update
- child update/add while a parent interaction is already active
- delete/destroy cleanup

### Animation coexistence

Cover both legacy tweens and portable timelines:

- fill animation while hover fill is active
- alpha animation while hover alpha is active
- animation starts before interaction
- animation starts during interaction
- interaction begins during animation
- release reveals the latest sampled base value
- loop, seek, cancellation, natural completion, and target-state settlement
- an interaction that omits the animated field does not affect it
- base render-state update animations and interaction-config updates while
  active

Unit tests should inspect both base runtime state and effective Pixi output so
they cannot pass by asserting only one side of the composition.

### Browser and VT coverage

Add an isolated rect-interaction VT/browser fixture. It should exercise only
this feature and provide deterministic checkpoints for:

1. base appearance
2. hover appearance
3. primary pressed appearance
4. return to hover after release
5. return to base after pointer exit
6. right-pressed appearance and restoration
7. animated base fill/alpha progressing underneath an active override
8. release revealing the progressed base value

Pointer-driven screenshots must use the real browser input path. Do not model
hover or press by replacing the authored rect state between screenshots.

Follow `docs/vt-guidelines.md`: keep the fixture minimal, make each state
visually distinguishable, generate the reference, inspect it in a browser, and
run the report before accepting it.

## Documentation

Update `playground/pages/docs/nodes/rect.md` with:

- the combined appearance/metadata interaction shape
- the canonical use of `alpha`
- state lifecycle and priority
- partial override behavior
- an explicit statement that `opacity` and resource IDs belong to embedding
  layers, not Route Graphics
- a static example and an animation-coexistence example

Update any generated/public API documentation or type examples that list rect
interaction fields.

## Implementation Order

1. Add failing parser, validation, and static pointer-state tests that define
   the contract.
2. Add the rect appearance runtime and static fill/alpha composition.
3. Integrate the existing hover/press/right-press controllers and cleanup.
4. Wire add/update/destroy reconciliation and container inheritance.
5. Route alpha animation through the base appearance channel and add legacy
   tween tests.
6. Add portable timeline, seeking, cancellation, and settlement coverage.
7. Add the isolated browser/VT fixture and inspect the recorded checkpoints.
8. Update docs, schemas, and types; run the complete validation suite.

This ordering deliberately proves static interaction semantics before changing
animation routing, while still treating animation-safe restoration as part of
the same feature rather than optional follow-up work.

## Verification Commands

Use the repository's current scripts rather than introducing a separate test
harness:

```sh
bun run test
bun run build
bun run vt:generate
bun run vt:report
```

During implementation, run the focused Vitest files first, followed by the full
suite. The final handoff requires both the relevant automated state-transition
coverage and a browser-visible reproduction of the actual pointer path.

## Out of Scope

The first implementation does not add interaction overrides for:

- border
- corner radius
- blur or shader filters
- geometry or transforms
- drag/scroll appearance
- `opacity` as a Route Graphics alias
- resource resolution such as `colorId`
- changes to sprite or text interaction contracts

These can be added later using the same partial cascade only after their
composition with animations and hit testing is defined.

## Completion Criteria

The feature is complete when:

- rect `hover`, `click`, and `rightClick` accept and visibly apply `fill` and
  `alpha`
- direct and inherited state lifecycles match existing sprite/text semantics
- per-field priority and restoration are deterministic
- event metadata and payloads retain their current behavior
- base animations continue beneath interaction overrides and restore at their
  latest sampled values
- add, update, settlement, cancellation, and destroy paths leave no stale
  listeners or appearance state
- raw schema, computed schema, runtime validation, types, and docs agree
- focused tests, the full automated suite, and isolated browser/VT checks pass
  with reviewed visual output
