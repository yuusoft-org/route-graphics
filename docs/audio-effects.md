# Audio Channel Design

Last updated: 2026-08-06

This document defines the channel-based audio interface for Route Graphics
render state.

It documents the current channel-based audio graph implementation. The runtime
also still accepts flat Route Graphics `sound` audio nodes for compatibility.

## Goals

- model audio with the same declarative state/effect split used by Route
  Graphics visual nodes and animations
- keep channels out of `resources`
- keep audio nodes focused on current audio state
- keep automation in `audioEffects`
- support mixer-style channel volume without a separate mixer concept
- support smooth volume fades and crossfades
- preserve compatibility with existing flat `sound` render state
- leave room for pan and playback-rate automation

## Non-Goals

- no nested audio channels in the first implementation
- no requirement for ordinary declarative sounds to use command-style
  operations
- no required channel declarations in project resources
- no audio filter or general-purpose DSP interface

Command-controlled playback is a separate opt-in extension for retained sounds.
See [Command-Controlled Sound Playback](./audio-playback-commands.md).

## Render-State Shape

Route Graphics accepts two audio-facing top-level arrays:

```yaml
audio: []
audioEffects: []
```

`audio` defines the desired audio graph state. `audioEffects` defines typed
effects that target audio node IDs.

All audio node IDs and `audioEffects` IDs share one render-state namespace. IDs
must be globally unique within a rendered frame. This keeps `targetId`
resolution unambiguous and avoids channel-scoped lookup rules.

```yaml
audio:
  - id: music
    type: audio-channel
    volume: 80
    muted: false
    children:
      - id: bgm
        type: sound
        src: theme
        loop: true
        volume: 100

audioEffects:
  - id: music-volume-enter:scene-12
    type: audio-transition
    targetId: music
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 80, duration: 1000, easing: linear }
```

For compatibility, flat `sound` nodes remain valid:

```yaml
audio:
  - id: click
    type: sound
    src: click
```

Flat sounds are treated as children of an implicit root channel.

## Audio Nodes

The first implementation has two audio node types:

- `audio-channel`
- `sound`

Effects are not audio nodes. They live in `audioEffects`.

### Audio Channels

An `audio-channel` is a bus/container. It does not play a file. It controls its
child sounds.

```yaml
id: music
type: audio-channel
volume: 80
muted: false
pan: 0
loop: false
playback:
  commandId: 1
  operation: resume
children: []
```

Fields:

| Field      | Type            | Default  | Description                                     |
| ---------- | --------------- | -------- | ----------------------------------------------- |
| `id`       | string          | required | Stable globally unique channel ID               |
| `type`     | `audio-channel` | required | Node type                                       |
| `volume`   | number          | `100`    | Local channel volume, `0` to `100`              |
| `muted`    | boolean         | `false`  | Forces this channel's effective output to zero  |
| `pan`      | number          | `0`      | Stereo pan, `-1` left to `1` right              |
| `loop`     | boolean         | `false`  | Repeats the complete child schedule             |
| `playback` | object          | omitted  | Optional channel-level `pause`/`resume` command |
| `children` | sound[]         | `[]`     | Sound nodes owned by this channel               |

First implementation rule:

- `audio-channel.children` may contain `sound` nodes only.
- nested `audio-channel` nodes are invalid until explicitly supported.
- child array order does not control playback order; sounds are mixed in
  parallel and may use `startDelayMs` for scheduled sequences.
- `loop: true` restarts the complete child schedule after every child sound has
  finished. Looping channels cannot contain child sounds with `loop: true`.
- Changing a channel from `loop: true` to `loop: false` cancels child sounds
  that have not started yet and lets already-playing child sounds finish.
- Optional channel `playback` preserves active child cursors and remaining
  delays across monotonic `pause`/`resume` commands. See
  [Command-Controlled Sound Playback](./audio-playback-commands.md#audio-channel-pause-and-resume).

### Sounds

A `sound` is a playable source. It represents one logical playback instance.

```yaml
id: bgm
type: sound
src: theme
volume: 100
muted: false
pan: 0
loop: true
startDelayMs: 0
playbackRate: 1
startAt: 0
endAt: null
```

Fields:

| Field          | Type        | Default  | Description                                  |
| -------------- | ----------- | -------- | -------------------------------------------- |
| `id`           | string      | required | Globally unique playback identity            |
| `type`         | `sound`     | required | Node type                                    |
| `src`          | string      | required | Audio asset alias or source URL              |
| `volume`       | number      | `100`    | Local sound volume, `0` to `100`             |
| `muted`        | boolean     | `false`  | Forces this sound's effective output to zero |
| `pan`          | number      | `0`      | Stereo pan, `-1` left to `1` right           |
| `loop`         | boolean     | `false`  | Loop playback                                |
| `startDelayMs` | number      | `0`      | Delay in milliseconds before playback starts |
| `playbackRate` | number      | `1`      | Playback speed multiplier                    |
| `startAt`      | number      | `0`      | Start offset in seconds                      |
| `endAt`        | number/null | `null`   | Optional end time in seconds                 |
| `playback`     | object      | omitted  | Optional command-controlled transport        |

`startAt` and `endAt` are intended for partial playback. If `endAt` is present,
duration is `endAt - startAt`.

The channel audio graph uses `startDelayMs` only. `sound.delay` is not part of
this interface.

When `playback` is present, the sound uses ordered `play`, `pause`, `resume`,
`stop`, and `seek` commands instead of automatic declarative startup. See
[Command-Controlled Sound Playback](./audio-playback-commands.md) for the
strict JSON shape, lifecycle events, and reconciliation rules.

### Sound Identity and Replay

Route Graphics treats `sound.id` as the playback identity.

If a `sound` remains present with the same `id`, `src`, `startAt`, `endAt`, and
`startDelayMs`, it is a continuing playback instance. It should not restart just
because the same render state is submitted again. Changing any of those source
identity fields replaces the playback instance; changes to output controls,
looping, playback rate, or channel ownership update it in place.

Use stable IDs for persistent sounds:

```yaml
id: bgm
type: sound
src: theme
loop: true
```

Use generated playback-instance IDs for one-shot sounds that should replay, even
when they use the same audio asset as a previous one-shot:

```yaml
id: one-shot-${eventId}-${playbackIndex}
type: sound
src: ui-confirm
loop: false
```

The playback-instance component can come from an event ID, sequence number, or
consumer-level playback token. If the same event can be submitted more than once
and should replay audio, the generated ID must include a visit or playback
counter, not only a static event ID.

Avoid fixed one-shot IDs such as `click` or `confirm`. With a declarative diff
model, repeating the same fixed ID and `src` means "keep this existing sound",
not "play it again".

## Audio Effects

`audioEffects` is a typed automation list. It contains transitions that target
audio node IDs.

Supported effect item type:

- `audio-transition`

Effects are render-state entries, not resources. A consumer may compile a
reusable engine resource into a concrete effect occurrence, but Route Graphics
only receives the concrete `audioEffects` entry.

### Validation Rules

Route Graphics should reject invalid audio render state instead of guessing:

- duplicate IDs across `audio` nodes and `audioEffects`
- `audio-channel.children` entries whose type is not `sound`
- nested `audio-channel` nodes in the first implementation
- `audio-transition.targetId` that cannot be resolved from the previous or next
  audio graph, or from an active renderer-owned tail
- an empty `audio-transition.properties` map or empty property lifecycle map
- transition phases without a non-empty `keyframes` array
- keyframes missing required `value` or `duration`
- keyframes that use an unsupported easing name
- more than one `audio-transition` targeting the same audio node in one render
  state
- lifecycle phases that do not apply to the current edge
- `enter` or `update` tracks whose final absolute keyframe does not match the
  next node's declared property value
- an `update` track for a property whose declared value did not change
- unknown audio node, effect, phase, or automated property types

## Audio Transitions

An `audio-transition` automates property changes on a target.

```yaml
audioEffects:
  - id: music-volume-update:scene-13
    type: audio-transition
    targetId: music
    properties:
      volume:
        update:
          keyframes:
            - { value: 40, duration: 300, easing: linear }
      pan:
        update:
          keyframes:
            - { value: -1, duration: 200, easing: linear }
```

Fields:

| Field        | Type               | Default  | Description               |
| ------------ | ------------------ | -------- | ------------------------- |
| `id`         | string             | required | Effect occurrence ID      |
| `type`       | `audio-transition` | required | Effect type               |
| `targetId`   | string             | required | Audio node ID to automate |
| `properties` | object             | required | Property automation map   |

`targetId` may reference:

- an `audio-channel`
- a `sound`

`targetId` resolves the target kind directly, so `targetType` is unnecessary.
Each target may have at most one `audio-transition` in a render state. Authors
combine every property automated by the current edge inside one `properties`
map.

Transition phases:

| Phase    | When it applies                                                 |
| -------- | --------------------------------------------------------------- |
| `enter`  | Target is added, or is the incoming side of sound replacement   |
| `exit`   | Target is removed, or is the outgoing side of sound replacement |
| `update` | Target continues and the declared property value changes        |

The next render state's effect owns the whole edge. On a same-ID sound
replacement, one next-state effect can contain both `exit` for the outgoing
instance and `enter` for the incoming instance. A removal state can contain an
`exit` effect whose target exists only in the previous audio graph.

Every phase uses the same keyframe payload as visual animation transitions:

```yaml
enter:
  initialValue: 0
  keyframes:
    - value: 40
      duration: 300
      easing: easeOutQuad
    - value: 80
      duration: 700
      easing: easeInOutSine
```

Phase fields:

| Field          | Type       | Default               | Description                                  |
| -------------- | ---------- | --------------------- | -------------------------------------------- |
| `initialValue` | number     | current audible value | Value before the first keyframe              |
| `keyframes`    | keyframe[] | required              | Ordered, non-empty property automation steps |

Keyframe fields:

| Field      | Type    | Default  | Description                                              |
| ---------- | ------- | -------- | -------------------------------------------------------- |
| `value`    | number  | required | Absolute target, or a delta when `relative` is `true`    |
| `duration` | number  | required | Milliseconds to reach this keyframe from the prior value |
| `easing`   | string  | `linear` | Animation easing applied to the segment reaching it      |
| `delay`    | number  | `0`      | Milliseconds to hold before this ramp                    |
| `relative` | boolean | `false`  | Resolve `value` relative to the prior keyframe value     |

The first keyframe starts at `initialValue` when provided; otherwise it starts
at the current audible value. Each later keyframe starts where the previous one
ended. When a relative keyframe exceeds a property's range, its clamped audible
endpoint is the baseline for the next relative keyframe. Total phase duration
is the sum of every keyframe's delay and duration.

Audio keyframes support the same easing names as visual animation keyframes.
Resolved volume, pan, and playback-rate values are constrained to their valid
ranges. `enter` and `update` must finish with an absolute keyframe equal to the
value declared on the next target audio node.

An omitted phase makes that lifecycle change immediate for the property. If a
new effect occurrence supersedes active automation, claimed properties start
from their current audible values and unclaimed properties settle to their
declarative values. Removed instances remain alive until their longest exit
transition finishes.

Volume transition example:

```yaml
audioEffects:
  - id: music-volume-exit:scene-14
    type: audio-transition
    targetId: music
    properties:
      volume:
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }
```

Pan and playback-rate transition example:

```yaml
audioEffects:
  - id: bgm-controls-update:scene-15
    type: audio-transition
    targetId: bgm
    properties:
      pan:
        update:
          keyframes:
            - { value: 1, duration: 200, easing: linear }
      playbackRate:
        update:
          keyframes:
            - { value: 1.5, duration: 500, easing: linear }
```

Recommended transitionable properties:

| Target type     | Properties                      |
| --------------- | ------------------------------- |
| `audio-channel` | `volume`, `pan`                 |
| `sound`         | `volume`, `pan`, `playbackRate` |

`muted` and `loop` are immediate boolean switches. `src`, `startAt`, `endAt`,
and `startDelayMs` define source identity and replace the playback instance when
changed; they are not transitionable properties.

### Effect occurrence identity

`audio-transition.id` identifies one accepted occurrence, independently of a
sound playback command's `commandId`.

- A new ID is a new occurrence and runs once on the current audio edge.
- The same ID with the same canonical payload continues existing automation; it
  does not restart after an unrelated render such as a master-volume change.
- The same ID with a changed payload, or a new effect on the same target,
  supersedes the previous occurrence.
- Removing an effect settles every active property immediately and releases
  any outgoing or pending incoming instances it owns.

Object-key order does not change effect identity. Keyframe array order does.
Consumers should normally generate IDs from a line-entry, action occurrence,
or visit token. Reusing an authored resource ID as the occurrence ID would
suppress legitimate revisits.

## Volume

Channel volume and sound volume stack multiplicatively.

```yaml
audio:
  - id: music
    type: audio-channel
    volume: 50
    children:
      - id: bgm
        type: sound
        src: theme
        volume: 50
```

Effective volume:

```text
channel 50% * sound 50% = 25%
```

In Web Audio terms:

```js
effectiveGain = (channel.volume / 100) * (sound.volume / 100);
```

This matches normal mixer behavior: source gain is scaled by track/channel gain.

If both channel and sound volumes transition at the same time, both ramps apply.
Authors should use channel transitions for group fades and sound transitions for
individual sound fades.

`muted: true` is an immediate hard gate that overrides, but does not change,
the node's volume. Unmuting restores the current volume. Authors should
transition `volume` to `0` when they need a smooth mute.

## Add, Update, Remove

Route Graphics should keep audio declarative.

- Added audio node: create it and apply `enter` from a newly accepted next-state
  effect.
- Updated audio node: apply `update` from a newly accepted next-state effect.
- Removed audio node: apply `exit` from a newly accepted next-state effect,
  keep its renderer-owned instance alive for the tail, then stop and clean up.
- Removed effect: settle its active automation immediately. This is the explicit
  skip/reset mechanism even when the target node itself is unchanged.

No explicit `op: play` or `op: stop` is needed for the currently implemented
declarative sound lifecycle.

The same `sound.id` and source identity fields mean continuation. It does not
replay. Consumers must use a new playback-instance ID when replaying a one-shot
sound.

The command-controlled playback extension does not change these rules for
ordinary sounds. A sound opts into the transport model only when it carries a
`playback` command. See
[Command-Controlled Sound Playback](./audio-playback-commands.md). A
command-controlled sound cannot be a child of an `audio-channel` with
`loop: true` or a channel that has its own `playback` command, because two
transport owners would conflict. A non-looping uncontrolled channel may retain
either interruption mode; an outgoing `loopEnd` instance finishes as an
event-detached tail.

Cross-state identity rules:

| Object          | Continues when                                | Replaced when                                        |
| --------------- | --------------------------------------------- | ---------------------------------------------------- |
| `audio-channel` | Its `id` and playback-control mode match      | It is removed and later added                        |
| `sound`         | Its `id` and all source identity fields match | `src`, `startAt`, `endAt`, or `startDelayMs` changes |

Changing an ID between `sound` and `audio-channel` is invalid rather than a
replacement. Moving a continuing sound between channels reroutes it without
restarting playback.

### Same ID, Different Source Identity

If a `sound` keeps the same `id` but changes `src`, `startAt`, `endAt`, or
`startDelayMs`, treat it as replacement:

1. old source uses its `exit` transition
2. new source uses its `enter` transition
3. both internal playback instances may coexist during the crossfade

Example:

```yaml
# previous state
audio:
  - id: music
    type: audio-channel
    children:
      - id: bgm
        type: sound
        src: track-a

# next state owns both sides of the replacement edge
audio:
  - id: music
    type: audio-channel
    children:
      - id: bgm
        type: sound
        src: track-b

audioEffects:
  - id: bgm-handoff:scene-16
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }
        enter:
          initialValue: 0
          keyframes:
            - { value: 100, duration: 1000, easing: linear }
```

The public ID remains `bgm`, but the audio stage needs separate internal
playback instance IDs so the outgoing and incoming sources can overlap safely.
The outgoing exit starts at edge acceptance. If the incoming asset is still
decoding, only its enter waits; outgoing teardown and cleanup do not wait for
decode readiness.

## Web Audio Mapping

The intended internal graph for one channel and one child sound is:

```text
AudioBufferSourceNode
  -> sound GainNode
  -> sound StereoPannerNode
  -> sound mute GainNode
  -> channel mix
  -> channel GainNode
  -> channel StereoPannerNode
  -> channel mute GainNode
  -> AudioContext.destination
```

Every sound playback instance owns its sound gain, pan, and mute processors.
During replacement, the outgoing instance keeps its previous node snapshot and
the incoming instance receives the next snapshot. The shared parent channel is
the independent master layer, so changing channel volume while a child fade is
active multiplies the result without cancelling or rebasing that fade. Mute is
also an independent hard gate; mute/unmute does not destroy scheduled volume or
pan automation.

Volume, pan, and playback-rate transitions use Web Audio `AudioParam`
automation. Each keyframe is scheduled after the previous segment:

```js
const now = audioContext.currentTime;
const currentValue = getTrackedAudibleValue(param, now);

if (param.cancelAndHoldAtTime) {
  param.cancelAndHoldAtTime(now);
} else {
  param.cancelScheduledValues(now);
}

param.setValueAtTime(currentValue, now);
scheduleKeyframes(param, keyframes, now);
```

Linear segments use native linear ramps. Other animation easings are sampled
into short linear segments, with a bounded sample count for very long
transitions. Tracking the scheduled timeline prevents stale `AudioParam.value`
readback from causing a jump when a later render interrupts an active ramp.

For removed nodes with an exit transition, cleanup happens after the longest
property phase. A phase duration is the sum of its keyframe delays and
durations:

```js
source.stop(now + longestExitDuration / 1000);
```

## Implementation Status

Implemented:

- schemas for `audio-channel`, extended `sound`, and `audio-transition`
- flat `sound` normalization through an implicit root channel
- channel gain nodes and internal playback instance IDs
- `audio-transition` for `volume` and `pan` on channels and sounds
- `audio-transition` for `playbackRate` on sounds
- animation-style multi-keyframe phases with shared easing names
- occurrence ownership, continuation, supersession, and explicit settlement
- same-ID source-identity replacement with overlapping internal instances
- immediate outgoing replacement teardown independent of incoming decode
- per-instance sound processors with independent channel-master and mute gates
- validation for duplicate transition targets and cross-state audio node kinds
- removal of inline sound/channel `transition`; `audioEffects` is the only API
- removal of the legacy `sound.delay` interface in favor of `startDelayMs`
