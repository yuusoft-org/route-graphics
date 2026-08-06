# Canonical Audio Effects Implementation Plan

Status: implemented and verified; design reviewed in
[`canonical-audio-effects-plan-review.md`](./canonical-audio-effects-plan-review.md)

Last updated: 2026-08-06

## Decision

Route Graphics will have one public interface for audio automation:

- `audio` defines persistent audio graph state.
- `audioEffects` defines temporary audio automation.
- `sound.transition` and `audio-channel.transition` will be removed.
- `audioEffects[].type: audio-transition` will be the only accepted transition
  form.

This is an intentional breaking change. There will be no compatibility period
in which both inline and effect-based transitions are accepted.

The architecture matches visual animation even though the existing audio
effect payload keeps its audio-specific lifecycle names:

| Visual rendering                         | Audio rendering                                 |
| ---------------------------------------- | ----------------------------------------------- |
| `elements`                               | `audio`                                         |
| `animations`                             | `audioEffects`                                  |
| transition `prev`                        | audio-transition `exit`                         |
| transition `next`                        | audio-transition `enter`                        |
| update `tween`                           | audio-transition `update`                       |
| animation ID owns animation lifecycle    | audio-effect ID owns audio automation lifecycle |
| reusable resources compile to animations | reusable resources compile to audio effects     |

Route Graphics does not gain reusable audio resources. Resource naming,
selection, and `target` endpoint resolution remain consumer responsibilities.
Route Graphics receives only concrete render-state audio nodes and effects.

## Goals

- expose one canonical state/effect split
- let one accepted effect control both sides of a source handoff
- support add, update, remove, and same-ID source replacement
- make effect IDs stable lifecycle identities that prevent accidental restarts
- settle active effects through ordinary render-state reconciliation
- retain outgoing sources until their exit work completes
- preserve current audible values when automation is interrupted
- keep mute and mixer/master controls independent from automated envelopes
- preserve deterministic delay, easing, relative-keyframe, and cleanup behavior
- provide enough lifecycle information for reusable Route Engine resources

## Non-Goals

- no `audioAnimations`, `audioHandoff`, `audioMasters`, or
  `audioAnimationControl` top-level fields
- no renderer-level named transition resources or presets
- no second shorthand such as `fade`, `crossfade`, or `hold`
- no `commandId` on audio effects
- no transition of `muted`, `loop`, source identity, or playback commands
- no blocking of the existing `renderComplete` event on audio automation
- no compatibility normalization from inline transitions
- no general DSP graph or audio-filter interface

## Canonical Public Contract

### Persistent graph state

```yaml
audio:
  - id: music
    type: audio-channel
    volume: 70
    muted: false
    children:
      - id: bgm
        type: sound
        src: next-track
        loop: true
        volume: 80
        pan: 0
```

No audio node accepts `transition`.

### Handoff effect

One effect may provide the outgoing and incoming sides together:

```yaml
audioEffects:
  - id: bgm-handoff-visit-42
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        exit:
          keyframes:
            - value: 0
              duration: 1000
              easing: easeInOutSine
        enter:
          initialValue: 0
          keyframes:
            - value: 80
              duration: 1000
              easing: easeInOutSine
```

On a same-ID source replacement, `exit` applies to the previous `bgm`
playback instance and `enter` applies to the next `bgm` playback instance.

The same public effect type also supports one-sided changes:

- add: author `enter`
- remove: author `exit`
- replacement: `exit` and `enter` are applicable

Do not attach a phase whose side does not exist. Cross-state validation rejects
an `exit` without a previous target and an `enter` without a next target.

### Retained update effect

```yaml
audioEffects:
  - id: bgm-volume-update-visit-43
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        update:
          keyframes:
            - value: 30
              duration: 600
              easing: easeOutQuad
```

`update` applies only when the target remains the same playback instance and
the declared property changes. It does not stand in for `enter` or `exit`.

### Supported properties

| Target type     | Properties                      |
| --------------- | ------------------------------- |
| `audio-channel` | `volume`, `pan`                 |
| `sound`         | `volume`, `pan`, `playbackRate` |

Property ranges remain:

- volume: `0` through `100`
- pan: `-1` through `1`
- playback rate: `0` or greater

`muted` remains an immediate gate. It is not an automatable numeric property.

### Track shape

The existing keyframe vocabulary remains canonical:

```yaml
initialValue: 0
keyframes:
  - delay: 250
    value: 40
    duration: 500
    easing: easeOutQuad
    relative: false
```

- `initialValue` is optional.
- `keyframes` is required and non-empty.
- `value` and `duration` are required.
- `delay` defaults to `0` and holds the preceding value.
- `easing` defaults to `linear`.
- `relative` defaults to `false`.
- duration and delay are finite, non-negative milliseconds.
- total track time is the sum of every `delay + duration`.
- relative endpoints are resolved and clamped sequentially.
- an `enter` or `update` track must end with an absolute endpoint equal to the
  next audio node's declared property value.
- an `exit` track may end at any valid absolute value.

`initialValue` defaults to the renderer-owned current value. Authors normally
set it for predictable `enter`, and omit it for `update` and `exit` so an
interrupted envelope continues without a jump.

## Effect Ownership And Diff Semantics

### Accepted occurrence

An effect is accepted for the current previous-to-next render edge when:

- its ID is present only in the next state, or
- its ID exists in both states but its normalized target or property signature
  changed.

The accepted next-state effect owns every applicable phase for that edge. This
is a deliberate change from the old rule in which removal looked up `exit`
only in `prevAudioEffects`.

For an accepted effect:

- `exit` reads the previous audio node or outgoing playback instance.
- `enter` reads the next audio node or incoming playback instance.
- `update` reads a retained playback instance and its previous/next property
  values.

This lets a consumer select one reusable transition occurrence at the moment
of a handoff and send both sides in one `audioEffects` item.

### Continuation

An effect with the same ID, target, and normalized property signature in both
states is a continuation:

- already-scheduled automation keeps running
- pending decode or delayed-enter work stays pending
- an unrelated render does not restart the effect
- a completed effect does not run again

Signatures are computed after defaults and key ordering are normalized.
Reordering the top-level effect list or changing object insertion order must
not produce a false restart. Semantically ordered keyframe arrays remain part
of the signature in their authored order.

The public render state must keep the accepted effect present while its
occurrence is owned. Consumers must not rely on resubmitting the same authored
path to mean replay.

A continued exit effect may outlive its public target. Once a previous-only
target has been detached, the active/completed effect ownership record supplies
the target kind and internal playback-instance ownership on later renders. An
unchanged continued effect is therefore valid even when the public target is
absent from both the later previous and next graphs. The same rule applies to a
removed channel and its detached children. A new effect with no target in
either graph and no matching ownership record is invalid.

### Supersession

A changed same-ID effect or a different next-state effect for the same target
supersedes the prior occurrence:

1. sample every affected parameter at one shared `AudioContext.currentTime`
2. cancel and hold prior scheduled automation at that time
3. clean up or detach prior outgoing ownership as applicable
4. start the accepted effect from the sampled audible values, unless an
   explicit `initialValue` overrides a track

Consumers should normally generate a new occurrence ID. Same-ID signature
replacement remains deterministic but is not the recommended authoring path.

### Removal and settlement

Removing an effect without a replacement means cancel and settle, including
when skip or reset causes the removal:

- retained next instances immediately use the latest declarative values
- outgoing-only instances stop and are cleaned up
- pending enter work is cancelled; a retained next source starts or continues
  at its declarative values when ready
- active update automation is cancelled and settled
- completed effects require no audible work

No separate settlement command or flag is added. Effect removal is
unambiguous because consumers are required to retain an accepted effect during
ordinary progression. Route Engine must therefore persist an accepted effect
until it is replaced, explicitly skipped/reset, or its owning presentation
state is discarded.

Removing and later re-adding the same ID is a new addition and runs again. A
consumer that revisits an authored action should still use an occurrence-based
ID so separate visits cannot be confused.

### Changes outside an effect

An unchanged effect does not claim unrelated node properties. Changes to
unclaimed properties reconcile normally.

If a consumer changes a property currently owned by an unchanged active effect,
the new declarative value supersedes that property's active track immediately;
the effect is not restarted. Consumers that want another animated change must
submit a new or changed effect occurrence ending at the new declared value.

## Audio-Graph Lifecycle Semantics

### Add

When the next target is new, an accepted effect may run `enter`. Without an
applicable enter track, the target begins at its declared value.

For a delayed or decoding sound, enter automation starts with actual source
playback after decode, audio-context resume, and `startDelayMs`. It does not
advance silently while the source is unavailable.

### Retained update

When source identity is unchanged, accepted `update` tracks run only for
properties whose declared values changed. Other properties retain their
current automation or reconcile immediately according to ownership.

### Remove

When the target exists only in the previous graph, an accepted `exit` keeps its
renderer-owned object alive until the longest applicable exit track and any
authorized `loopEnd` tail finish. Without exit work, removal is immediate.

### Same-ID source replacement

Changing a retained sound's `src`, `startAt`, `endAt`, or `startDelayMs`
replaces its playback instance:

- the outgoing instance uses `exit`
- the incoming instance uses `enter`
- the two instances have independent automation processors
- both may coexist under the same public sound ID
- public effect and target IDs remain stable while internal playback-instance
  IDs distinguish the sides

`update` does not run on the replacement edge. Any changed sound values become
the outgoing snapshot and incoming declared endpoints used by `exit` and
`enter` respectively.

### Decode-delay clock

The outgoing and incoming clocks follow one explicit policy:

- outgoing exit starts at reconciliation time and is never delayed for
  incoming decode
- if the incoming source is ready, its playback and enter tracks share that
  reconciliation base time, offset by its `startDelayMs`
- if decoding is pending, incoming playback and enter tracks start only after
  readiness and the complete source delay
- a late incoming source overlaps only the remaining outgoing tail, or starts
  after a gap when that tail has already finished
- incoming decode, validation, or playback failure does not restore the
  detached outgoing instance

### Completion and cleanup

Audio effects remain non-blocking for `renderComplete`.

The renderer nevertheless owns all scheduled work until it completes,
settles, fails, or is superseded. Cleanup waits for the maximum applicable
property duration and any finite authorized `loopEnd` tail. Every completion,
failure, cancellation, and destroy path must be idempotent.

### Command-controlled playback

Effect identity and playback `commandId` have separate jobs. A command orders
transport; an effect occurrence owns automation.

For a command-controlled sound:

- an accepted enter effect is armed until the first accepted `play` creates
  that sound lifetime's source
- source playback and enter automation start together after readiness
- a later same-source transport replay does not rerun the same enter effect
- an accepted source-identity replacement uses exit for the outgoing command
  instance and enter for the incoming instance
- stop or removal cleans up active automation without inventing another effect
  occurrence
- a replay that should animate again must carry a newly accepted effect
  occurrence ID

Channel pause/resume preserves existing automation-clock behavior; this change
does not overload audio effects as transport controls.

## Processing-Layer Requirements

The runtime must not collapse graph state, automation, and mute into one Web
Audio parameter. The intended logical layers for a sound are:

```text
source and playback-rate automation
-> per-playback-instance sound gain automation
-> per-playback-instance sound mute gate
-> per-playback-instance sound pan
-> retained audio-channel gain
-> retained audio-channel mute gate
-> retained audio-channel pan
-> destination
```

Consequences:

- outgoing and incoming sound instances retain independent volume, mute, pan,
  playback-rate, and declarative-state snapshots
- a retained channel remains a shared mixer/master layer above both sides
- changing a channel master volume while a sound fade is active scales the
  fade without cancelling or rebasing its envelope
- muting and unmuting a sound or channel during automation does not cancel the
  automated parameter; unmute reveals the value the envelope has reached
- a source replacement that also changes sound volume, pan, or muted state does
  not make the outgoing side jump to incoming sound settings

Consumers should use a stable channel for runtime music volume or global music
mute and target the child sound for a track handoff. This preserves an
independent shared master layer without adding `audioMasters`:

```yaml
audio:
  - id: music-master
    type: audio-channel
    volume: 60
    muted: false
    children:
      - id: bgm
        type: sound
        src: next-track
        volume: 80

audioEffects:
  - id: bgm-handoff-visit-42
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        exit:
          keyframes: [{ value: 0, duration: 1000 }]
        enter:
          initialValue: 0
          keyframes: [{ value: 80, duration: 1000 }]
```

An effect that directly targets a channel intentionally animates the shared
bus and therefore affects every sound routed through that channel.

## Validation Contract

Validation must consider the previous and next audio graphs together. Validating
each render state independently is insufficient because a newly accepted
effect may intentionally target a previous-only node for exit.

### Per-state structural validation

- `audio` and `audioEffects` are arrays.
- IDs are non-empty and unique under the existing audio render-state namespace.
- `sound` and `audio-channel` reject the `transition` field through their
  schemas and runtime validation.
- effect type, target, properties, tracks, keyframes, values, ranges, and
  easing names are strict.
- each next state has at most one `audio-transition` per target.

### Cross-state lifecycle validation

- an accepted effect target must resolve in the union of previous and next
  built-in audio nodes
- an unchanged continued effect may instead resolve through its existing
  active/completed ownership record when its detached target is public on
  neither side
- `enter` requires a next target
- `exit` requires a previous target
- `update` requires the same retained target kind on both sides
- playback-rate tracks require a sound target
- add edges may use enter only
- remove edges may use exit only
- source-replacement edges may use enter and exit, but not update
- retained edges may use update; enter and exit are inapplicable
- an enter/update final endpoint must equal the next declared property value
- changing a public ID between `sound` and `audio-channel` remains invalid

Continued effects are checked for structural validity but do not re-trigger
lifecycle phases. A removed effect need not resolve in the next state because
its active ownership is held internally. Hydrating a state that contains an
orphaned effect without a matching public target or renderer ownership record
is invalid.

## Route Engine Integration Contract

Route Engine may expose reusable audio-animation resources with the same
authoring split as visual animation resources:

- resource `type: transition` has `prev` and `next`
- resource `type: update` has retained-property tracks

The Engine compiler maps concrete selected resources as follows:

| Engine resource path | Route Graphics effect path                       |
| -------------------- | ------------------------------------------------ |
| `prev.volume`        | `properties.volume.exit`                         |
| `next.volume`        | `properties.volume.enter`                        |
| update `volume`      | `properties.volume.update`                       |
| `prev.pan`           | `properties.pan.exit`                            |
| `next.pan`           | `properties.pan.enter`                           |
| update `pan`         | `properties.pan.update`                          |
| playback-rate tracks | corresponding sound-only playback-rate lifecycle |

The Engine resolves symbolic values such as `target` before calling Route
Graphics. Route Graphics never receives resource names or symbolic endpoints.

Every accepted action occurrence gets an effect ID that distinguishes story
visits. Engine presentation state owns and persists that effect across
unrelated renders. Skip/reset removes it, which invokes Route Graphics
settlement.

For BGM, Route Engine should put per-track volume, pan, and mute on the `bgm`
sound and reserve its stable parent channel for runtime `musicVolume` and
`muteAll` controls. The handoff effect targets the sound. This is what keeps
outgoing/incoming authored state independent while settings remain a shared
master above both sides.

## Implementation Workstreams

### 1. Freeze the contract with tests

Add failing schema, normalization, planning, and `AudioStage` tests for the
canonical examples before changing runtime behavior.

Primary files:

- `src/schemas/audio/audio-transition.yaml`
- `spec/audio/normalizeAudio.spec.js`
- `spec/util/normalizeAudio.spec.js`
- `spec/audio/audioStage.spec.js`
- `spec/audio/renderAudio.spec.js`

### 2. Remove the inline public interface

- remove `transition` from `sound.yaml` and `audio-channel.yaml`
- remove inline-only definitions from `audio-transition.yaml`
- remove inline transition JSDoc types from `src/types.js`
- delete inline collection and merge logic from `normalizeAudio.js`
- reject inline input instead of silently ignoring it
- migrate examples, fixtures, AVT, VT, and documentation

There is no deprecation warning or conversion layer.

### 3. Split structural normalization from edge validation

Refactor `normalizeAudioRenderState()` to normalize one graph without deciding
cross-state target applicability. Add a joint transition validator/planner that
receives:

```js
{
  prevAudio,
  nextAudio,
  prevAudioEffects,
  nextAudioEffects,
  ownedAudioEffects,
}
```

It returns normalized graph maps plus an explicit effect lifecycle plan:

```js
{
  continued: [],
  accepted: [],
  superseded: [],
  settled: [],
}
```

The plan is internal. It is not a new public render-state field.

### 4. Add effect lifecycle planning

Create a focused planner rather than embedding effect-diff policy throughout
`AudioStage.js`. The planner must:

- key continuity by effect ID and normalized signature
- detect target-level replacement
- choose add/update/remove/source-replacement applicability
- reject incompatible phase/target combinations
- preserve active and pending occurrences across unrelated renders
- preserve completed detached ownership while the occurrence remains declared
- emit settlement when an owned effect disappears

Suggested location:

- `src/plugins/audio/planAudioEffects.js`
- `src/plugins/audio/planAudioEffects.test.js`

### 5. Execute plans in AudioStage

Refactor `AudioStage.renderGraph()` to consume the lifecycle plan while reusing
the existing transition compiler and Web Audio scheduler.

Required runtime changes:

- take exit configuration from the newly accepted effect
- retain active/completed effect ownership by ID
- make scheduling and cleanup idempotent
- settle active handoff, retained update, and pending-enter work
- preserve outgoing/incoming per-instance processors
- keep channel gain and mute above child sound envelopes
- use one shared interruption time for every affected parameter
- preserve the decode-delay clock policy

Avoid a second audio animation runtime. The existing keyframe compilation,
easing sampling, tracked audible-value, tail, and source cleanup mechanisms
remain the implementation base.

### 6. Integrate Route Graphics render state

Update `renderAudio()` and `RouteGraphics` state reconciliation so the planner
receives both graph states and both effect states once. Per-state normalization
may still enforce structure across built-in and plugin nodes, but target and
lifecycle validation moves to the joint planner so valid previous-only targets
are not rejected.

Plugin-based non-graph audio remains unaffected.

### 7. Migrate tests and fixtures

Convert every built-in inline transition fixture to `audioEffects`. Keep one
negative fixture proving inline input is rejected. Historical fixture filenames
may remain when needed to preserve checked-in binary reference identity, but
their content and descriptions must identify `audioEffects` as canonical.

The migration includes:

- unit and public API fixtures
- schema/parser fixtures
- deterministic audio specs and references
- visual/browser audio specs
- playground and hosted node documentation

### 8. Replace conflicting documentation

- make `docs/audio-effects.md` the normative audio graph/effect document
- remove or replace `docs/inline-audio-transitions.md` with a breaking-change
  migration note
- update audio visual testing examples
- update sound and channel reference pages
- record the removal in the changelog/release notes

### 9. Release as one breaking change

Schema, runtime, types, fixtures, and docs ship together. The version must not
advertise inline support after the runtime stops accepting it.

Route Engine should update only after the canonical Route Graphics version is
available; it must not pin a private commit or emit the abandoned expanded
interface.

## Test Matrix

### Schema and normalization

- canonical sound/channel effect acceptance
- inline sound and channel transition rejection
- previous-only exit target acceptance
- next-only enter target acceptance
- retained update target acceptance
- source replacement enter/exit acceptance
- invalid phase for lifecycle rejection
- duplicate effect target and duplicate ID rejection
- final endpoint validation
- sound/channel property subset validation

### Lifecycle planner

- added effect starts exactly once
- unchanged effect survives unrelated renders without restart
- completed unchanged effect remains completed
- same-ID changed signature supersedes from current value
- new-ID same-target effect supersedes from current value
- removal settles active enter/exit handoff
- removal settles active retained update
- removal cancels pending decode/delayed enter
- removal after completion is a no-op
- remove then re-add runs again
- separate action-occurrence IDs allow legitimate story revisits

### AudioStage system behavior

- enter fade on add
- exit fade on remove
- simultaneous exit/enter source crossfade
- retained volume, pan, and playback-rate update
- multi-property tracks with unequal completion times
- interruption from current audible value
- outgoing cleanup after longest exit
- finite and non-progressing `loopEnd` tails
- ready incoming source shares reconciliation base time
- delayed decode does not postpone outgoing exit
- decode and playback failure clean up deterministically
- source delay starts source and enter together
- command-controlled first play consumes armed enter exactly once
- same-source transport replay does not rerun an unchanged effect
- command-controlled source replacement uses the accepted exit/enter effect
- channel master volume changes during active sound automation
- sound and channel mute/unmute during active automation
- replacement preserves outgoing sound volume/pan/mute snapshot
- destroy/reset during pending and active work is idempotent

### Deterministic audio and browser coverage

Use deterministic WAV/JSON assertions for envelope timing and cleanup, then
exercise the actual browser path for:

- crossfade overlap
- delayed incoming decode
- interruption
- mute/unmute during active automation
- channel master-volume change during active sound fade
- skip settlement during handoff
- skip settlement during retained update

Each timing page must isolate one behavior. Do not claim completion from a
fixture that combines unrelated audio failures.

### Regression suite

- full unit/system suite
- schema and conformance suite
- deterministic AVT suite
- relevant VT/browser suite
- build and lint

## Acceptance Criteria

Implementation is complete only when:

1. inline `transition` is absent from sound/channel schemas and public types
2. inline input fails strict runtime and schema validation
3. `audioEffects` is the only documented automation interface
4. one newly accepted effect drives both exit and enter on replacement
5. retained update effects run without an additional public command field
6. unchanged effect occurrences do not restart on unrelated renders
7. effect removal settles active handoffs, updates, and pending enters
8. outgoing and incoming instances keep independent sound processing
9. retained channel master and mute changes do not cancel sound envelopes
10. delayed decode never postpones outgoing teardown
11. interruption begins from the tracked current audible value
12. every completion/failure/cancellation path releases sources and timers
13. focused system and actual browser/audio timing coverage passes
14. Route Engine can compile one reusable transition resource into one concrete
    `audioEffects` occurrence

## Expected Change Surface

Primary implementation files:

- `src/schemas/audio/sound.yaml`
- `src/schemas/audio/audio-channel.yaml`
- `src/schemas/audio/audio-transition.yaml`
- `src/types.js`
- `src/util/normalizeAudio.js`
- `src/plugins/audio/renderAudio.js`
- `src/plugins/audio/planAudioEffects.js` (new)
- `src/AudioStage.js`

Primary documentation and fixture areas:

- `docs/audio-effects.md`
- `docs/inline-audio-transitions.md`
- `docs/audio-visual-testing.md`
- `playground/pages/docs/nodes/sound.md`
- `spec/audio/`
- `spec/util/normalizeAudio.spec.js`
- `avt/specs/`
- `vt/specs/audio/`

## Risks And Mitigations

### Effect persistence is a consumer obligation

If a consumer emits an effect for one render and immediately omits it, removal
will settle it. Document the ownership rule prominently and cover Route Engine
state persistence before integration.

### AudioStage is already lifecycle-dense

Adding effect ownership directly to existing branches risks cleanup races.
Introduce a pure lifecycle planner and keep scheduler operations behind
idempotent helpers.

### Breaking fixture migration is broad

Land schema, runtime, fixtures, and docs in the same PR. Use repository-wide
search to prove no positive inline examples remain.

### Browser audio timing is environment-sensitive

Put exact envelope assertions in deterministic AVT. Use browser coverage for
integration behavior and generous event-based synchronization rather than
wall-clock sleeps.

### Shared channel semantics can be misunderstood

Document that sound handoffs own per-instance sound processors while a retained
channel is intentionally shared. Use a stable channel for master controls and
target the sound for per-track handoffs.
