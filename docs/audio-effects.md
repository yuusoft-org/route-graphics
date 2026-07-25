# Audio Channel Design

Last updated: 2026-07-15

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
- no command-style `play` / `stop` operation model in the currently implemented
  channel graph
- no required channel declarations in project resources
- no audio filter or general-purpose DSP interface

Command-controlled playback is now being designed as a separate opt-in
extension for retained sounds. It is not implemented. See
[Command-Controlled Sound Playback Proposal](./audio-playback-commands.md).

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
  - id: music-volume
    type: audio-transition
    targetId: music
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 80, duration: 1000, easing: linear }
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }
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
children: []
```

Fields:

| Field      | Type            | Default  | Description                                    |
| ---------- | --------------- | -------- | ---------------------------------------------- |
| `id`       | string          | required | Stable globally unique channel ID              |
| `type`     | `audio-channel` | required | Node type                                      |
| `volume`   | number          | `100`    | Local channel volume, `0` to `100`             |
| `muted`    | boolean         | `false`  | Forces this channel's effective output to zero |
| `pan`      | number          | `0`      | Stereo pan, `-1` left to `1` right             |
| `loop`     | boolean         | `false`  | Repeats the complete child schedule            |
| `children` | sound[]         | `[]`     | Sound nodes owned by this channel              |

First implementation rule:

- `audio-channel.children` may contain `sound` nodes only.
- nested `audio-channel` nodes are invalid until explicitly supported.
- child array order does not control playback order; sounds are mixed in
  parallel and may use `startDelayMs` for scheduled sequences.
- `loop: true` restarts the complete child schedule after every child sound has
  finished. Looping channels cannot contain child sounds with `loop: true`.
- Changing a channel from `loop: true` to `loop: false` cancels child sounds
  that have not started yet and lets already-playing child sounds finish.

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

`startAt` and `endAt` are intended for partial playback. If `endAt` is present,
duration is `endAt - startAt`.

The channel audio graph uses `startDelayMs` only. `sound.delay` is not part of
this interface.

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

Effects are render-state entries, not resources.

### Validation Rules

Route Graphics should reject invalid audio render state instead of guessing:

- duplicate IDs across `audio` nodes and `audioEffects`
- `audio-channel.children` entries whose type is not `sound`
- nested `audio-channel` nodes in the first implementation
- `audio-transition.targetId` that cannot be resolved in the state used for its
  lifecycle
- an empty `audio-transition.properties` map or empty property lifecycle map
- transition phases without a non-empty `keyframes` array
- keyframes missing required `value` or `duration`
- keyframes that use an unsupported easing name
- more than one `audio-transition` targeting the same audio node in one render
  state
- unknown audio node, effect, or automated property types

## Audio Transitions

An `audio-transition` automates property changes on a target.

```yaml
audioEffects:
  - id: music-transitions
    type: audio-transition
    targetId: music
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 80, duration: 1000, easing: linear }
        update:
          keyframes:
            - { value: 40, duration: 300, easing: linear }
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }
      pan:
        update:
          keyframes:
            - { value: -1, duration: 200, easing: linear }
```

Fields:

| Field        | Type               | Default  | Description               |
| ------------ | ------------------ | -------- | ------------------------- |
| `id`         | string             | required | Stable effect ID          |
| `type`       | `audio-transition` | required | Effect type               |
| `targetId`   | string             | required | Audio node ID to automate |
| `properties` | object             | required | Property automation map   |

`targetId` may reference:

- an `audio-channel`
- a `sound`

`targetId` resolves the target kind directly, so `targetType` is unnecessary.
Each target may have at most one `audio-transition` in a render state. Authors
combine all automated properties and lifecycle phases for that target inside
one `properties` map.

Transition phases:

| Phase    | When it applies                               | Transition source       |
| -------- | --------------------------------------------- | ----------------------- |
| `enter`  | Target appears in the next render state       | next `audioEffects`     |
| `exit`   | Target disappears from the next render state  | previous `audioEffects` |
| `update` | Target remains but the property value changes | next `audioEffects`     |

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
| `relative` | boolean | `false`  | Resolve `value` relative to the prior keyframe value     |

The first keyframe starts at `initialValue` when provided; otherwise it starts
at the current audible value. Each later keyframe starts where the previous one
ended. When a relative keyframe exceeds a property's range, its clamped audible
endpoint is the baseline for the next relative keyframe. Total phase duration
is the sum of its keyframe durations.

Audio keyframes support the same easing names as visual animation keyframes.
Resolved volume, pan, and playback-rate values are constrained to their valid
ranges. For `enter` and `update`, authors should normally finish at the value
declared on the target audio node so declarative state and audible state agree.

An omitted phase makes that lifecycle change immediate for the property. If a
new render interrupts an active transition, the next ramp starts from the
current audible value after cancelling or holding previously scheduled
automation. Removed instances remain alive until their longest exit transition
finishes.

Using the previous state's `audioEffects` for `exit` lets a removed sound fade
out without keeping a dead target in the next render state.

Volume transition example:

```yaml
audioEffects:
  - id: music-volume
    type: audio-transition
    targetId: music
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 100, duration: 1000, easing: linear }
        update:
          keyframes:
            - { value: 40, duration: 300, easing: linear }
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }
```

Pan and playback-rate transition example:

```yaml
audioEffects:
  - id: bgm-transitions
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

- Added audio node or effect: create it and apply `enter` transition if a
  matching `audio-transition` exists in the next `audioEffects`.
- Updated audio node or effect: update changed properties and apply `update`
  transition if a matching `audio-transition` exists in the next `audioEffects`.
- Removed audio node or effect: keep the internal node alive until `exit`
  transition from the previous `audioEffects` completes, then stop and clean up.

No explicit `op: play` or `op: stop` is needed for the currently implemented
declarative sound lifecycle.

The same `sound.id` and source identity fields mean continuation. It does not
replay. Consumers must use a new playback-instance ID when replaying a one-shot
sound.

The proposed command-controlled playback extension does not change these rules
for ordinary sounds. A sound opts into the proposed transport model only when
it carries a `playback` command. See
[Command-Controlled Sound Playback Proposal](./audio-playback-commands.md).
Under that proposal, a command-controlled sound cannot be a child of an
`audio-channel` with `loop: true`, because channel-schedule replay would bypass
command ordering.

Cross-state identity rules:

| Object          | Continues when                                       | Replaced when                                        |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `audio-channel` | Its `id` exists as an `audio-channel` in both states | It is removed and later added                        |
| `sound`         | Its `id` and all source identity fields match        | `src`, `startAt`, `endAt`, or `startDelayMs` changes |

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
# previous
audio:
  - id: music
    type: audio-channel
    children:
      - id: bgm
        type: sound
        src: track-a

audioEffects:
  - id: bgm-volume
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        exit:
          keyframes:
            - { value: 0, duration: 1000, easing: linear }

# next
audio:
  - id: music
    type: audio-channel
    children:
      - id: bgm
        type: sound
        src: track-b

audioEffects:
  - id: bgm-volume
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 100, duration: 1000, easing: linear }
```

The public ID remains `bgm`, but the audio stage needs separate internal
playback instance IDs so the outgoing and incoming sources can overlap safely.

## Web Audio Mapping

The intended internal graph for one channel and one child sound is:

```text
AudioBufferSourceNode
  -> sound GainNode
  -> sound StereoPannerNode
  -> channel mix
  -> channel GainNode
  -> channel StereoPannerNode
  -> AudioContext.destination
```

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
property phase. A phase duration is the sum of its keyframe durations:

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
- same-ID source-identity replacement with overlapping internal instances
- validation for duplicate transition targets and cross-state audio node kinds
- removal of the legacy `sound.delay` interface in favor of `startDelayMs`
