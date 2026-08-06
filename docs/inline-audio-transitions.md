# Inline Audio Transition Interface

Status: implemented

Last updated: 2026-08-06

## Purpose

This document defines the canonical inline transition interface on `sound` and
`audio-channel` nodes. Separately authored `audio-transition` records remain
accepted as a legacy compatibility interface documented in
[`audio-effects.md`](./audio-effects.md).

Keyframes share the optional `startValue` segment-start semantics defined in
[`Keyframe Start Value Design`](./keyframe-start-value-design.md).

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
- no shared multi-target audio timeline in this interface
- no removal of the legacy compatibility interface in this change

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

The public structure, expressed as TypeScript-like documentation, is:

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
  startValue?: number;
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

| Field        | Type    | Required | Default  | Description                                         |
| ------------ | ------- | -------- | -------- | --------------------------------------------------- |
| `value`      | number  | yes      | none     | Absolute endpoint, or delta from the resolved start |
| `startValue` | number  | no       | previous | Explicit segment start, or delta when relative      |
| `duration`   | number  | yes      | none     | Ramp duration in milliseconds                       |
| `delay`      | number  | no       | `0`      | Hold preceding value before this ramp               |
| `easing`     | string  | no       | `linear` | Easing for the segment reaching this keyframe       |
| `relative`   | boolean | no       | `false`  | Resolve start and endpoint sequentially as deltas   |

`duration` and `delay` must be finite non-negative numbers, and `value` and any
`startValue` must be finite. Absolute values use the same ranges as their
target fields. Relative values are signed deltas. A relative start is resolved
and clamped first; that audible start is then the base for the endpoint delta.
The resolved endpoint becomes the baseline for the following keyframe.

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

When `startValue` is present, the preceding endpoint remains audible for the
whole delay. The parameter jumps to the resolved start at the delay boundary
and ramps from there. For a zero-duration keyframe, terminal `value` wins at
that shared boundary.

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

Enter tracks deferred by pending decode, `startDelayMs`, or audio-context resume
remain pending per property. If an accepted render changes that property before
its enter track starts, the change supersedes and cancels the pending enter for
that property, whether the change uses an update track or applies immediately.
The update resolves from the current renderer-owned value and ends at the
latest declared value; the canceled enter track must not run when playback
eventually starts. If playback begins while the superseding update is still
active, that property's automation continues from its renderer-owned value at
that Web Audio clock time and runs only the remaining schedule; if the update
has completed, the property uses its final value. Enter tracks for unchanged
properties remain pending. If the property changes after its enter track
starts, the normal interruption rules apply instead.

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

Whether a `loopEnd` tail can finish is determined from its complete resolved
playback-rate timeline, not only its instantaneous rate at interruption. The
calculation includes the current rate, `initialValue`, keyframe delays, eased
ramps, and clamped relative endpoints. It accumulates the source-media progress
produced by that timeline toward the remaining loop boundary. After the last
keyframe, its final rate continues as a constant for this calculation.

If that timeline reaches the boundary at a finite Web Audio clock time, cleanup
waits for the tail even when its initial rate is `0`; an exit ramp to a positive
rate can therefore resume and finish it. If no finite boundary time exists—for
example, there is no playback-rate exit track and the current rate is `0`, or
the track ends at `0` before accumulating enough source-media progress—the
loop-end wait is abandoned. Teardown then follows only the finite
exit-transition timeline, with immediate cleanup when no transition work
remains. This preserves existing zero-rate cleanup without cutting off a tail
that scheduled automation can complete.

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

An audio-specific transition-complete event or explicitly blocking audio
timeline is outside this interface.

## Validation

The runtime rejects:

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

1. inline `transition` is the canonical public authoring interface
2. existing `audioEffects` / `audio-transition` input remains accepted for a
   compatibility period
3. both forms normalize to the same internal property timelines
4. defining both forms for one target in one state is a validation error
5. manual fixtures use inline syntax while dedicated compatibility tests retain
   the legacy form
6. removal of `audioEffects` requires a separate breaking release
