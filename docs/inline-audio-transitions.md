# Inline Audio Transition Interface

Status: proposed; design-only; not implemented

Last updated: 2026-08-02

## Purpose

This document proposes replacing separately authored `audio-transition`
records with one inline transition interface on `sound` and `audio-channel`
nodes.

The proposal is intentionally documentation-only. The current runtime and
schemas continue to use the `audioEffects` interface documented in
[`audio-effects.md`](./audio-effects.md).

## Goals

- keep transition behavior next to the audio node that owns it
- use one interface for simple fades and advanced multi-keyframe automation
- reuse visual animation keyframe terminology and timing semantics
- support enter, update, exit, and same-ID source-replacement lifecycles
- support overlapping outgoing and incoming playback during a crossfade
- support volume, pan, and playback-rate automation without named presets
- make sound playback delay distinct from automation-segment delay

## Non-Goals

- no separate transition ID or `targetId`
- no second shorthand interface for simple fades
- no named `fade`, `crossfade`, `hold`, or `offset` operations
- no transition of boolean switches or source-identity fields
- no shared multi-target audio timeline in this proposal
- no implementation or compatibility removal in this pull request

## Canonical Shape

Both `sound` and `audio-channel` may define one optional `transition` object.
The object is lifecycle-first. Each lifecycle phase contains property tracks,
and every property track uses the existing keyframe vocabulary.

```yaml
audio:
  - id: bgm
    type: sound
    src: theme
    loop: true
    volume: 80
    pan: 0
    playbackRate: 1
    transition:
      enter:
        volume:
          initialValue: 0
          keyframes:
            - value: 80
              duration: 2000
              easing: linear
      update:
        volume:
          keyframes:
            - value: 80
              duration: 500
              easing: easeOutQuad
      exit:
        volume:
          keyframes:
            - delay: 1000
              value: 0
              duration: 2000
              easing: linear
```

There is no separate compact form. A one-keyframe track is the minimal fade;
additional keyframes express advanced behavior through the same interface.

### Structural Definition

The proposed public structure, expressed as TypeScript-like documentation, is:

```ts
type InlineAudioTransition = {
  enter?: InlineAudioTransitionPhase;
  update?: InlineAudioTransitionPhase;
  exit?: InlineAudioTransitionPhase;
};

type InlineAudioTransitionPhase = {
  volume?: InlineAudioTransitionTrack;
  pan?: InlineAudioTransitionTrack;
  playbackRate?: InlineAudioTransitionTrack; // sound only
};

type InlineAudioTransitionTrack = {
  initialValue?: number;
  keyframes: InlineAudioTransitionKeyframe[]; // non-empty
};

type InlineAudioTransitionKeyframe = {
  value: number;
  duration: number; // milliseconds
  delay?: number; // milliseconds; defaults to 0
  easing?: string; // defaults to linear
  relative?: boolean; // defaults to false
};
```

`SoundElement` and `AudioChannelElement` each gain
`transition?: InlineAudioTransition`, subject to their supported-property
subsets. The `InlineAudio*` names intentionally remain distinct from the legacy
`AudioTransition`, `AudioTransitionPhase`, and `AudioTransitionKeyframe` types
used by `audioEffects` during the compatibility period.

## Interface Contract

### Node Field

| Field        | Type                    | Required | Description                        |
| ------------ | ----------------------- | -------- | ---------------------------------- |
| `transition` | audio transition object | no       | Inline lifecycle automation tracks |

`transition` does not participate in sound source identity. Changing only the
transition declaration must not restart or replace a retained sound.

### Lifecycle Phases

| Phase    | Activation                                                      | Configuration source |
| -------- | --------------------------------------------------------------- | -------------------- |
| `enter`  | A node is added, or a new source instance enters replacement    | next node            |
| `update` | A retained node's transitionable property changes               | next node            |
| `exit`   | A node is removed, or its old source instance exits replacement | previous node        |

Every phase is optional. An omitted phase makes that lifecycle change
immediate for the affected properties.

An `update` track runs only when its property changes. Changing the track while
leaving the property unchanged does not start automation.

### Transitionable Properties

| Target type     | Properties                      |
| --------------- | ------------------------------- |
| `audio-channel` | `volume`, `pan`                 |
| `sound`         | `volume`, `pan`, `playbackRate` |

Property ranges remain the same as the node fields:

- `volume`: `0` to `100`
- `pan`: `-1` to `1`
- `playbackRate`: greater than or equal to `0`

The following fields are not transitionable:

- `muted`
- `loop`
- `src`
- `startAt`
- `endAt`
- `startDelayMs`
- `playback`
- channel ownership

`muted` remains an immediate hard gate that does not overwrite the underlying
volume automation. Authors transition `volume` to zero when they need a smooth
mute.

### Property Track

```yaml
initialValue: 0
keyframes:
  - delay: 250
    value: 40
    duration: 500
    easing: easeOutQuad
    relative: false
```

| Field          | Type       | Required | Default                      |
| -------------- | ---------- | -------- | ---------------------------- |
| `initialValue` | number     | no       | current renderer-owned value |
| `keyframes`    | keyframe[] | yes      | none; must be non-empty      |

Authors should provide `initialValue` for predictable `enter` behavior. In
particular, a volume fade-in normally uses `initialValue: 0`. Update and exit
tracks normally omit it so an interrupted transition continues from the
current audible value.

### Keyframe

| Field      | Type    | Required | Default  | Description                                      |
| ---------- | ------- | -------- | -------- | ------------------------------------------------ |
| `value`    | number  | yes      | none     | Absolute endpoint, or delta when relative        |
| `duration` | number  | yes      | none     | Ramp duration in milliseconds                    |
| `delay`    | number  | no       | `0`      | Hold preceding value before this ramp            |
| `easing`   | string  | no       | `linear` | Easing for the segment reaching this keyframe    |
| `relative` | boolean | no       | `false`  | Resolve value relative to the preceding endpoint |

`duration` and `delay` must be finite non-negative numbers, and `value` must be
finite. Absolute values use the same ranges as their target fields. A relative
value is a signed delta and is not itself restricted to the target field's
range. Its resolved endpoint is clamped to that range before becoming the
baseline for the following keyframe.

For `enter` and `update`, the last keyframe must be absolute and equal the value
declared on the next audio node. This keeps the final audible value consistent
with declarative state. Exit tracks may end at any valid absolute value.

### Delay Semantics

Keyframe `delay` is automation timing, not source playback timing.

```yaml
exit:
  volume:
    keyframes:
      - delay: 1000
        value: 0
        duration: 2000
```

This track:

1. holds the current volume for `1000` milliseconds
2. ramps to `0` over `2000` milliseconds
3. completes after `3000` milliseconds

For every track, total duration is:

```text
sum(keyframe.delay + keyframe.duration)
```

Repeated keyframe delays allow holds between later ramp segments without a
second step or offset vocabulary.

`sound.startDelayMs` remains separate: it delays when the source begins
playback. `transition.*.*.keyframes[].delay` delays one automation segment
while holding that property's preceding value.

## Lifecycle Semantics

### Enter

An enter track starts from `initialValue` when provided. Otherwise it starts
from the renderer-owned parameter value for the newly created node.

```yaml
transition:
  enter:
    volume:
      initialValue: 0
      keyframes:
        - value: 80
          duration: 1000
          easing: linear
```

For a delayed declarative sound, the sound's enter automation clock starts when
its source actually begins playback after `startDelayMs` and audio-context
resume. Channel enter automation starts when the channel enters the audio
graph.

For command-controlled playback, enter automation runs with the first accepted
`play` that starts a source in that sound lifetime. It also runs for the
incoming instance of an accepted source replacement: the required higher
`play` command changes source identity even though the public sound ID and
sound lifetime are retained. Later `play` commands that retain source identity
are transport-only restarts and do not repeat the graph-lifecycle enter
transition.

### Update

An update track starts when the declared property changes. Omitting
`initialValue` makes it begin at the current renderer-owned value, including an
intermediate value held from interrupted automation.

```yaml
transition:
  update:
    pan:
      keyframes:
        - value: -0.5
          duration: 200
        - value: 0
          duration: 300
```

### Exit

Exit configuration comes from the previous node because the node is absent
from the next state. The outgoing instance remains alive until all applicable
exit work completes.

```yaml
transition:
  exit:
    volume:
      keyframes:
        - value: 0
          duration: 1000
```

If several exit properties have different durations, their transition work
completes after the maximum total track duration. Under a containing channel's
`interruption: loopEnd`, exit tracks run concurrently with the already-authorized
final iteration, and cleanup waits until both any exit-transition work and that
loop-end tail have finished. Without a loop-end tail, cleanup occurs when the
longest exit track completes, or immediately when there are no exit tracks.

A `loopEnd` tail is waited on only while it can make finite progress toward its
boundary. If its effective playback rate is already `0`, or exit automation
leaves it at `0` before it reaches that boundary, the loop-end wait is
abandoned. Teardown then follows only the finite exit-transition timeline and
cleanup is immediate when no transition work remains. This preserves the
existing zero-rate cleanup behavior and prevents an outgoing sound or channel
from being retained indefinitely.

## Source Replacement And Overlap

Changing any source-identity field on a retained public sound ID replaces its
playback instance. Source-identity fields remain:

- `src`
- `startAt`
- `endAt`
- `startDelayMs`

Replacement creates two internal instances:

- the outgoing instance uses the previous node's `exit` tracks
- the incoming instance uses the next node's `enter` tracks

Both sets of tracks use the Web Audio clock. The outgoing exit begins at the
replacement's reconciliation time. If the incoming source is already decoded,
validated, and ready to schedule, it uses that same base time: with no incoming
`startDelayMs`, its source and enter tracks start with the outgoing exit; a
source delay offsets both the incoming source and its enter tracks.

If the incoming source is still decoding, outgoing teardown is not postponed.
The incoming enter tracks remain unscheduled rather than advancing silently.
They start with the source after decode and validation succeed and its complete
`startDelayMs` countdown finishes. If the outgoing exit or `loopEnd` tail is
still active then, the instances overlap for the remaining time; otherwise
there is an audible gap. A decode, validation, or playback failure does not run
the incoming enter tracks and does not restore the detached outgoing instance.
The shared-start guarantee therefore applies only to ready incoming sources.
Outgoing cleanup follows the exit and `loopEnd` rules above. Overlap is a
lifecycle consequence, not a separate field.

### Immediate Crossfade

Previous state:

```yaml
audio:
  - id: bgm
    type: sound
    src: track-a
    volume: 80
    loop: true
    transition:
      exit:
        volume:
          keyframes:
            - value: 0
              duration: 2000
              easing: linear
```

Next state:

```yaml
audio:
  - id: bgm
    type: sound
    src: track-b
    volume: 80
    loop: true
    transition:
      enter:
        volume:
          initialValue: 0
          keyframes:
            - value: 80
              duration: 2000
              easing: linear
```

The old source fades out while the new source fades in for the same two-second
window. This example assumes `track-b` is ready when replacement reconciliation
begins; otherwise the pending-decode timing above applies.

### Synchronized Delayed Crossfade

Outgoing track:

```yaml
exit:
  volume:
    keyframes:
      - delay: 1000
        value: 0
        duration: 2000
```

Incoming track:

```yaml
enter:
  volume:
    initialValue: 0
    keyframes:
      - delay: 1000
        value: 80
        duration: 2000
```

Timeline:

```text
0s              1s                         3s
|---- hold ------|------ crossfade ---------|
outgoing: 80 ------------------------------> 0
incoming:  0 ------------------------------> 80
```

Both instances exist from transition start. The incoming source is silent
during the first second because its volume is held at `initialValue: 0`.

### Full-Volume Overlap Before Fade-Out

The incoming sound may omit an enter transition and begin at its declared
volume. The outgoing sound delays only its fade:

```yaml
transition:
  exit:
    volume:
      keyframes:
        - delay: 1000
          value: 0
          duration: 2000
```

Timeline:

```text
0s              1s                         3s
|-- both full ---|-- outgoing fades --------|
incoming: 80 --------------------------------
outgoing: 80 ------------------------------> 0
```

## Interruption

When a new render changes a property during active automation:

1. cancel or hold the previously scheduled automation at the shared current
   audio time
2. resolve the current renderer-owned value
3. start the new update or exit track from that value unless it declares
   `initialValue`

A render that leaves the property unchanged does not cancel its active track.
Changing or removing only the transition declaration does not retroactively
cancel already scheduled automation.

## Channel And Sound Composition

Channel and sound gains remain multiplicative. Their transition tracks may run
at the same time:

```text
effective gain = channel gain * sound gain
```

Authors use channel transitions for group fades and sound transitions for
individual fades or replacements.

## Completion

Audio transitions remain non-blocking for the existing public `renderComplete`
event. Exit cleanup and outgoing-instance ownership still continue internally
until the applicable exit tracks and any completable, already-authorized
`loopEnd` tail have completed. Non-progressing zero-rate tails use the finite
fallback defined under Exit.

A future audio-specific transition-complete event or explicitly blocking audio
timeline is outside this proposal.

## Validation

The future implementation should reject:

- `transition` that is not a non-empty object
- unsupported lifecycle phase names
- unsupported properties for the target node type
- empty property tracks or empty keyframe arrays
- unknown track or keyframe fields
- missing keyframe `value` or `duration`
- non-finite keyframe values
- negative or non-finite delay/duration
- unsupported easing names
- absolute values outside the property range
- a relative final keyframe for enter or update
- an enter/update final value different from the node's declared value
- simultaneous inline and legacy transitions targeting the same audio node

## Compatibility And Migration

When implemented:

1. inline `transition` becomes the canonical public authoring interface
2. existing `audioEffects` / `audio-transition` input remains accepted for a
   compatibility period
3. both forms normalize to the same internal property timelines
4. defining both forms for one target in one state is a validation error
5. current fixtures migrate to inline syntax while dedicated compatibility
   tests retain the legacy form
6. removal of `audioEffects` requires a separate breaking release

This proposal does not add inline fields to schemas or types yet. Those changes
belong in the implementation pull request so published validation never claims
support before the runtime provides it.

## Implementation Requirements For A Later Pull Request

The later implementation must include:

- schema and JSDoc types for inline lifecycle tracks
- normalization into one internal target-to-transition map
- shared enter/exit scheduling time for ready replacement instances
- pending-decode enter scheduling that does not delay outgoing teardown
- keyframe-delay support in audio parameter automation
- current-value hold on interruption
- cleanup after both the longest exit track and any completable `loopEnd` tail
- finite cleanup fallback for zero-rate `loopEnd` tails
- conflict validation against legacy `audioEffects`
- unit tests for normalization and timing
- audio-stage tests for enter, update, exit, interruption, and replacement
- manual audio fixtures for immediate, delayed, and full-volume overlap
