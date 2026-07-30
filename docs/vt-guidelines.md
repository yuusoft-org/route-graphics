# VT Guidelines

Last updated: 2026-05-17

## Purpose

Define one stable standard for VT authoring:

- Minimal visual language for consistent screenshots.
- Deterministic behavior testing without flaky text-on-screen assertions.

## Core Principles

- Keep snapshots simple and high-contrast.
- Prefer deterministic state changes over decorative visuals.
- Use VT for rendering correctness.
- Use unit/integration tests for non-visual behavior correctness.

## Visual Standard

### Default Look

- Use black background by default.
- Use white as default foreground color for rects/simple shapes.
- When differentiation is needed, use grayscale only.
- Do not use random or saturated colors unless color itself is the subject of the test.

### Approved Palette

- `bg`: `#000000`
- `fg-100`: `#FFFFFF`
- `fg-80`: `#D9D9D9`
- `fg-60`: `#A6A6A6`
- `fg-45`: `#737373`
- `fg-30`: `#4D4D4D`

### Visual Rules

- Keep each snapshot black + white whenever possible.
- Default repeated rect/simple-shape elements to the same fill.
- Only introduce extra grayscale shades when they are required to read overlap, layering, or identity during the assertion.
- Use grayscale only for overlap/layer distinction.
- Use the minimum number of shades needed to separate elements.
- Keep shade semantics consistent within a spec family.
- Avoid on-canvas descriptive labels when text itself is not the subject of the test.
- Put explanation in the spec `title`, `description`, and checklist notes instead of rendering helper text into the snapshot.
- Avoid gradients, glow, and decorative styling in VT.

### Allowed Exceptions

- Tests explicitly validating color behavior.
- Text/text-revealing/text-style behavior tests where rendered text is the feature under test.
- Text plugin tests validating `textStyle.fill`.
- Asset-based tests where source textures are inherently colored.

If using an exception, mention why in the spec `description`.

### Visual Anti-Patterns

- Random color per element.
- Rainbow palettes for non-color behavior tests.
- Relying on color-only change when geometry/alpha/z-order could assert behavior.

## Behavior Testing Standard

### Hard Rule

- Do not use on-screen debug text as behavior oracle.
- Do not add descriptive helper labels to explain what a non-text spec is doing.
- Do not assert callback/event correctness by snapshotting rendered event logs.

### Preferred Assertion Order

1. Assert via deterministic visual outcomes in VT:
   - geometry (`x`, `y`, `width`, `height`)
   - visibility (`alpha`)
   - layering (`zIndex`)
   - source/state changes (`src`, texture swap, presence/absence)
2. If behavior is not visually observable, assert outside VT:
   - unit/integration tests for callback payloads, audio/video runtime behavior

### Immediate Rules for Existing Specs

- Replace event-log text overlays with deterministic element-state changes.
- Avoid long `wait`-based flows when `customEvent snapShotKeyFrame` can drive deterministic timing.
- Avoid dynamic snapshot content (timestamps, runtime-generated IDs, arbitrary debug strings).
- If a behavior cannot be asserted visually, move assertion to `vitest`.

### Deferred: Runtime Event Assertions

- Runtime assertions via `customEvent` are deferred until VT runner support is finalized.
- Current migration must not depend on new assertion APIs.
- For now:
  - keep VT assertions visual-only,
  - move non-visual event payload checks to unit/integration tests.

### Migration Pattern

Old pattern:

- Trigger event.
- Render event payload text to canvas.
- Compare screenshot containing dynamic text.

New pattern:

- Trigger event.
- Verify deterministic visual state in VT.
- Verify payload correctness in non-VT tests.

## Authoring Checklist

- Spec uses default black/white/grayscale palette unless exception is documented.
- Repeated rect/simple-shape elements use one fill unless contrast is necessary for the assertion.
- No random colors.
- No text-log-based behavior assertion.
- No descriptive on-canvas labels unless the spec is explicitly testing text rendering/styling/revealing.
- Every event spec includes at least one explicit interaction step.
- Multi-state specs advance across intended states with explicit steps.
- Screenshot sequence matches intended checkpoints only (no redundant frames).

## Shader And GPU VT Review Checklist

Shader and GPU-facing VT specs need additional review before accepting
references or updating a PR. A clean screenshot capture/report is necessary, but
not sufficient.

- Open every new or changed shader VT page in a browser after `vt:generate`.
- Inspect browser console output for shader compile/link errors, missing asset
  aliases, texture decode failures, unhandled promises, and unexpected Pixi
  warnings.
- Fix all shader and asset warnings before accepting references. Ignore only
  known environment noise such as favicon 404s or WebGL readback performance
  warnings.
- Verify every `src` and shader `textures` alias used by the spec exists in the
  VT asset manifest or is otherwise provided by the spec.
- Verify each intended state change is visibly observable in the actual runtime
  mesh. For custom vertex shaders, account for the real geometry; a deformation
  that evaluates to zero at the quad vertices is not a valid visual assertion.
- If a WebGL uniform is declared in both vertex and fragment stages, declare
  matching precision in both stages.
- For `uProgress` or other stateful animation behavior, include forward and
  backward navigation steps when reset/continuity is part of the contract.
- For a targeted parameter animation, include the filter id and at least one
  independently animated scalar or vector value in the visual checkpoints.
- For `time: true`, sample through `setAnimationTime(timeMS)` so references are
  deterministic; do not accept ticker-wall-clock screenshots as baselines.
- For multi-pass effects, ensure each pass makes a visually observable
  contribution and test pass-order changes when order is part of the contract.
- When a transition combines `mask` and `compositor`, verify the built-in mask
  result feeds the first custom pass and that later custom passes retain
  `uNextTexture`.
- For transition compositors, inspect a near-completion frame and the
  post-completion frame. The compositor should visually settle into the final
  target before overlay teardown so there is no end-of-transition handoff jump.
- A deterministic screenshot at `uProgress = 1` is still the compositor overlay,
  not proof that teardown is smooth. Add one extra tick/screenshot after
  completion and compare the final overlay against the live incoming frame.
- Compare the first compositor overlay frame against the live outgoing target
  when the target uses `width` / `height`, scale, or source textures whose
  native size differs from display size. This catches double-scaled snapshots
  before the transition starts moving.
- Do not accept a transition compositor reference if the final compositor frame
  is black, transparent, alpha-contaminated, or otherwise visually different
  from the live incoming target.
- Verify transition compositors through the actual browsed VT page and hash
  target in auto-play mode, not only by sampling deterministic candidate frames.
  The auto-play path is the one that exercises ticker-driven overlay teardown.
- Run screenshot capture and report after manual browser inspection, then accept
  only the expected reference diffs.

### Transition Compositor Handoff Regression

Shader transition compositors have a specific failure mode that is easy to miss:
the overlay can look correct in deterministic progress screenshots, then jump on
the frame where the overlay is removed and the live final target is revealed.

The usual root cause is a coordinate-space mismatch between the previous and
next transition snapshots. `uTexture` uses the primary Pixi filter coordinate,
but `uNextTexture` must be sampled through `uNextTextureMatrix` and clamped with
`uNextTextureClamp`. This is the same class of mapping problem the mask
transition path already solved. Do not sample both transition textures with the
same raw UV unless the test is deliberately covering the broken case.

Plain sprite snapshots have a related trap: generating a texture from an already
transformed sprite can bake scale or alpha into the snapshot, then the transition
wrapper applies the same transform again. VT coverage for compositor sprites
should include at least one case where the sprite has configured display size,
scale, or alpha that differs from the source texture.

For every compositor regression page that changes snapshot or coordinate
handling, include these visual checkpoints:

- first overlay frame compared against the live outgoing target
- mid-transition frame
- near-final frame
- deterministic final overlay frame
- one post-completion frame after overlay teardown

The final overlay and post-completion frames should be visually identical except
for expected single-pixel antialiasing noise. If they are not, debug the
snapshot coordinate mapping before accepting references.

Recommended command sequence for shader VT changes:

```sh
bun run vt:generate
# Open the changed page in a browser and inspect console output.
bun run vt:screenshot
docker run --rm --user "$(id -u):$(id -g)" -e RTGL_VT_DEBUG=true -v "$PWD:/workspace" docker.io/han4wluc/rtgl:playwright-v1.57.0-rtgl-v1.1.0 rtgl vt report
```

## Examples

### Preferred Visual Structure

```yaml
states:
  - elements:
      - id: "base"
        type: "rect"
        x: 120
        y: 120
        width: 300
        height: 180
        fill: "#FFFFFF"
      - id: "overlay"
        type: "rect"
        x: 180
        y: 160
        width: 300
        height: 180
        fill: "#A6A6A6"
```

### Behavior Test Direction (No Text Log)

- Trigger `hover`/`click`.
- Assert deterministic `src` or `alpha` change in snapshot.
- Assert payload in unit/integration test.

### Visual-Only Event Step Example

```yaml
steps:
  - move 200 120
  - click 200 120
  - screenshot
```
