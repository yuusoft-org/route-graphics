# Command-Controlled Sound Playback Proposal

Status: proposed. This interface is not implemented.

Last updated: 2026-07-25

## Purpose

Route Graphics currently treats audio as declarative graph state. Adding a
sound starts it, removing it stops it, and changing its source identity replaces
it. That model is still the default and remains appropriate for one-shot sound
effects and ordinary background music.

Some consumers need transport controls for a retained sound:

- play or restart at a position
- pause and preserve the exact renderer-owned cursor
- resume from that cursor
- stop and reset to zero
- seek without changing whether the sound is playing or paused
- receive decoded duration, progress, natural completion, and playback errors

This proposal adds those capabilities without exposing Route Graphics' internal
decode generation, source generation, cursor bookkeeping, or playback status.

The public additions are limited to:

1. one optional `playback` command object on a `sound`
2. four sound lifecycle events

Everything else in this document describes validation or internal runtime
behavior required to make those two additions reliable.

## Design Principles

- Command-controlled playback is opt-in per sound.
- Any number of sounds may be command controlled at the same time.
- Existing sounds without `playback` keep their current declarative behavior.
- Route Graphics owns the exact audio cursor and stale-callback suppression.
- Consumers identify commands with one monotonically increasing `commandId`.
- Mixer-only renders never execute a transport command.
- Commands are transient runtime instructions, not save-state restoration data.
- Playback output remains on the existing `eventHandler(eventName, payload)`
  path.

## Public Render-State Interface

A command-controlled sound has the normal sound fields plus `playback`:

```json
{
  "id": "music-room:player",
  "type": "sound",
  "src": "main-theme",
  "volume": 100,
  "muted": false,
  "pan": 0,
  "loop": false,
  "startDelayMs": 0,
  "playbackRate": 1,
  "startAt": 10,
  "endAt": 190,
  "playback": {
    "commandId": 42,
    "operation": "play",
    "positionMs": 0
  }
}
```

`playback` is optional when a sound ID first appears. Its presence opts that
sound into command-controlled transport and correlated sound events for that
sound's retained lifetime.

### Playback Mode Lifetime

Playback mode cannot change while a sound with the same ID is retained across
renders:

- a legacy sound cannot gain `playback`
- a command-controlled sound cannot lose `playback`

Either transition is a validation error. Route Graphics rejects that render
before audio reconciliation and leaves the existing source, cursor, decode,
mode, and accepted command ID unchanged.

To change modes, the consumer must first complete a render in which the sound
ID is absent, then add the sound in a later render. Re-adding it starts a new
runtime lifetime that may independently choose legacy or command-controlled
mode. Removing and replacing a sound with the same ID in one render is not a
mode transition because there is no observable absent lifetime.

### Playback Command Fields

| Field        | Required                   | Description                                     |
| ------------ | -------------------------- | ----------------------------------------------- |
| `commandId`  | always                     | Ordered, exactly-once command identity          |
| `operation`  | always                     | `play`, `pause`, `resume`, `stop`, or `seek`    |
| `positionMs` | for `play` and `seek` only | Position relative to the playable sound segment |

The command object is strict. Unknown properties are invalid.

Validation rules:

```json
{
  "commandId": "non-negative safe integer",
  "operation": ["play", "pause", "resume", "stop", "seek"],
  "positionMs": "finite non-negative number when required",
  "unknownProperties": "rejected"
}
```

`positionMs` is required for `play` and `seek`. It is invalid on `pause`,
`resume`, and `stop`.

### Time Units

Existing sound segment fields remain seconds:

```json
{
  "startAt": 10,
  "endAt": 190
}
```

Playback commands and events use milliseconds:

```json
{
  "positionMs": 83000,
  "durationMs": 180000
}
```

`positionMs` is relative to the playable segment. Position zero means
`startAt`, not necessarily the beginning of the decoded file.

For a decoded source duration `decodedDuration`:

```text
segmentStart = startAt
segmentEnd = endAt ?? decodedDuration
durationMs = (segmentEnd - segmentStart) * 1000
```

The resolved segment must be finite and positive. `startAt` must be below the
decoded source duration, and `endAt`, when present, must be greater than
`startAt` and no greater than the decoded source duration.

Command schema validation accepts any finite, non-negative `positionMs`.
Resolved position validation occurs once `durationMs` is known:

- a position below `durationMs` is playable
- a position equal to `durationMs` is the valid terminal cursor
- a position greater than `durationMs` cannot be executed

A position beyond duration does not change the existing cursor, transport
state, or active source. Route Graphics emits `soundError` with error code
`invalid-position`. This is a command execution error, not a render-schema
error: the higher command ID remains accepted, and any unchanged active source
is rebound to that command for future event correlation.

## Command Ordering

`commandId` is the only public synchronization value.

The consumer maintains one increasing audio-command counter. It advances only
when issuing a transport command and is not reused during the consumer
lifetime.

Route Graphics compares command IDs for each sound:

```json
{
  "sameCommandId": "acknowledgment; do not execute again",
  "lowerCommandId": "stale command; ignore",
  "higherCommandId": "execute exactly once"
}
```

Gaps between command IDs are valid. Ordinary renders, progress updates, volume
changes, and mute changes retain the current command ID.

A schema-invalid command is not accepted and does not advance correlation. A
schema-valid command with a higher ID is accepted before its transport effect
is evaluated. It therefore advances correlation even when the operation is a
state-dependent no-op or later produces an execution error such as
`invalid-position`. Any active source that survives the command is rebound to
the newly accepted command without restarting.

This rule is necessary because repeated render state is otherwise ambiguous.
These two command objects have identical content:

```json
{
  "commandId": 42,
  "operation": "play",
  "positionMs": 0
}
```

Keeping command ID `42` means "this command was already issued." Sending the
same operation with command ID `43` means "execute play again," which restarts
the sound.

## Operations

### Play

`play` starts or restarts a sound at `positionMs`.

Initial play:

```json
{
  "commandId": 42,
  "operation": "play",
  "positionMs": 0
}
```

Restart:

```json
{
  "commandId": 43,
  "operation": "play",
  "positionMs": 0
}
```

There is no separate public `start` or `restart` operation. A new `play`
command always creates a new active source at the requested segment-relative
position when that position is below `durationMs`.

A `play` position equal to `durationMs` tears down any previous active source,
sets the cursor and transport state to ended, and emits `soundProgress`. It
does not create a source or emit `soundComplete`, because no natural playback
occurred. A position greater than `durationMs` follows the
`invalid-position` rule above and leaves any existing playback unchanged.

When duration is not known yet, Route Graphics retains the requested play
position and resolves these same boundary rules after decoding and segment
validation. Route Graphics emits `soundReady` before starting valid playback,
reporting terminal progress, or emitting `invalid-position`.

If a previous decode attempt failed, a new `play` command starts a fresh
attempt rather than rebinding the previous error.

### Pause

```json
{
  "commandId": 44,
  "operation": "pause"
}
```

Pause captures Route Graphics' exact current cursor. The consumer does not send
a position, so a delayed progress render cannot overwrite the captured cursor.

Pausing while decode is pending records paused intent and retains that decode.
Once ready, the sound remains paused instead of starting. If no source has
started yet, the retained cursor is the sound's current stored position, or
zero when no position has been established.

Pausing an already-paused sound is a no-op after the command is accepted.

### Resume

```json
{
  "commandId": 45,
  "operation": "resume"
}
```

Resume continues from Route Graphics' captured cursor. The consumer does not
send a position.

Resuming while decode is pending records playing intent. Playback begins at the
retained cursor after decode and browser audio-context requirements are
satisfied.

Resuming without a retained paused cursor is a no-op. The existing
`resumeAudio()` method remains the separate browser autoplay-unlock hook; it is
not a sound transport command.

### Stop

```json
{
  "commandId": 46,
  "operation": "stop"
}
```

Stop ends the active source and resets its cursor to zero. It retains the sound
node, decoded buffer or pending decode, and known duration.

Stopping while decode is pending prevents playback after decode but does not
discard the decode.

Use `pause` rather than `stop` when the cursor must be preserved.

### Seek

```json
{
  "commandId": 47,
  "operation": "seek",
  "positionMs": 83000
}
```

Seek moves to `positionMs` and preserves the current playback state:

- playing remains playing
- paused remains paused
- stopped remains stopped at the requested next-start position
- ended becomes stopped when seeking earlier than duration

Seeking while playing replaces the browser source internally without reporting
natural completion. Seeking while paused updates the retained cursor without
starting playback.

Seeking before duration is known is queued, not discarded. After decoding and
segment validation, Route Graphics resolves the requested position before
dispatching events. It emits `soundReady` first, followed by `soundProgress`
for a successful seek or `soundError` with `invalid-position` for a position
beyond duration.

Seeking exactly to duration tears down any active source and enters the ended
state. It emits `soundProgress` but not `soundComplete`, because completion was
caused by a command rather than natural playback. Seeking beyond duration
follows the `invalid-position` rule and preserves the existing cursor,
transport state, and active source.

Repeating the same seek requires a higher command ID even when `positionMs` is
unchanged.

## Multiple Controlled Sounds

The interface is not limited to one controlled sound:

```json
{
  "audio": [
    {
      "id": "story:bgm",
      "type": "sound",
      "src": "story-theme",
      "loop": true,
      "playback": {
        "commandId": 18,
        "operation": "pause"
      }
    },
    {
      "id": "music-room:player",
      "type": "sound",
      "src": "main-theme",
      "loop": false,
      "playback": {
        "commandId": 19,
        "operation": "play",
        "positionMs": 0
      }
    }
  ]
}
```

Each sound has one optional playback command object. Sound IDs remain globally
unique within render state, and each sound is reconciled independently.

This allows a consumer to pause retained story BGM while starting another
controlled music sound. Voice and sound effects may remain ordinary sounds
without `playback`.

## Changes Outside the Playback Command

Mixer properties do not require new commands:

```json
["volume", "muted", "pan", "channel volume", "channel muted"]
```

Updating only those properties must preserve the source, cursor, decode, and
accepted command ID. Muting or setting volume to zero does not pause playback.

`loop` may update the active source in place. `playbackRate` may also update in
place, but Route Graphics must account for the rate when reporting position.

These properties change source identity:

```json
["src", "startAt", "endAt", "startDelayMs"]
```

Changing a source-identity property on a command-controlled sound requires a
higher command ID with operation `play`. Changing source identity while
retaining the same command ID, or pairing the change with another operation, is
an invalid cross-render transition.

## Public Events

Command-controlled sounds emit four semantic events through the existing Route
Graphics event handler:

```text
eventHandler(eventName, payload)
```

Legacy sounds without `playback` do not emit these command-correlated events.
These names are proposed and do not join the stable public event set until the
interface is implemented and released.

All sound events are dispatched outside the active `render()` call so cached
decode results cannot cause reentrant rendering.

Sound lifecycle metadata follows the existing event payload contract in
`api-naming.md`: renderer-provided fields live under the reserved `_event`
object, and `_event.id` identifies the sound. These events do not place runtime
metadata at the payload's top level.

### `soundReady`

Emitted when decoding and playable-segment validation succeed:

```json
{
  "_event": {
    "id": "music-room:player",
    "commandId": 42,
    "positionMs": 0,
    "durationMs": 180000
  }
}
```

### `soundProgress`

Emitted at least every 250 milliseconds while playing and immediately after a
successful pause, seek, or stop when duration is known. A `play` or `seek`
command that moves to the terminal cursor also emits it:

```json
{
  "_event": {
    "id": "music-room:player",
    "commandId": 44,
    "positionMs": 83000,
    "durationMs": 180000
  }
}
```

When a cursor-changing operation is resolved during pending decode,
`soundReady` is emitted first. A successful pause, seek, stop, or terminal
`play` then emits one immediate `soundProgress`. A queued `play` or `seek`
beyond duration emits `soundError` instead of progress.

### `soundComplete`

Emitted only when active non-looping playback reaches its natural end:

```json
{
  "_event": {
    "id": "music-room:player",
    "commandId": 45,
    "positionMs": 180000,
    "durationMs": 180000
  }
}
```

Completion is not emitted for pause, seek, stop, replacement, removal, decode
failure, audio-context suspension, or Route Graphics destruction.

### `soundError`

Emitted when a controlled sound cannot become ready or execute a command:

```json
{
  "_event": {
    "id": "music-room:player",
    "commandId": 42,
    "errorCode": "decode-failed"
  }
}
```

Initial stable error codes:

```json
[
  "asset-unavailable",
  "decode-failed",
  "invalid-segment",
  "invalid-position",
  "playback-failed"
]
```

The payload must not expose browser exception messages, asset URLs, file
contents, stack traces, or other sensitive implementation details.

`invalid-position` means a `play` or `seek` position is greater than the
decoded playable segment's `durationMs`. It leaves existing transport state
unchanged.

## Event Correlation and Rebinding

Consumers accept a sound event only when both of these values match current
state:

```json
{
  "_event": {
    "id": "music-room:player",
    "commandId": 42
  }
}
```

Consumers compare `payload._event.id` and `payload._event.commandId`.
Route Graphics owns additional private instance and callback tokens. They are
not part of render state or event payloads.

Ready, error, and progress events bind to the latest accepted command. If a
decode settles under an older command, Route Graphics suppresses that stale
event and publishes the settled result under the latest applicable command.
When a decode is already settled as ready, Route Graphics can re-emit
`soundReady` for a newly accepted command before publishing progress for it.

A new `play` following an error creates a fresh attempt. It must not re-emit the
previous error as the result of the new command.

Completion is tied to the latest accepted command under which the current
active source remains valid:

- `play`, `resume`, and `seek` while playing bind their new active source
- any accepted higher command that leaves an active source unchanged rebinds
  that source to the new command without restarting it
- source replacement invalidates the previous private binding before binding
  the replacement
- pause, stop, transition to ended, sound removal, and sound replacement
  invalidate the binding without reporting completion

The rebinding rule includes accepted no-ops such as `resume` while already
playing and execution errors such as an out-of-range position. If that
unchanged source later reaches its natural end, `soundComplete` carries the
latest accepted command ID rather than the ID that originally created the
browser source. Schema-invalid, repeated, lower, and otherwise stale commands
do not advance or rebind correlation.

The browser `AudioBufferSourceNode.onended` callback is not sufficient to
identify natural completion because intentional `stop()` calls also trigger it.
Route Graphics must distinguish natural completion from controlled teardown.

## Decode Retention

Decode lifetime belongs to the retained command-controlled sound, not to an
individual browser source node.

- pause retains an in-progress or completed decode
- resume reuses the retained decode
- stop retains an in-progress or completed decode
- seek reuses the retained decode
- changing source identity replaces the retained decode
- removing the sound releases its binding and suppresses later callbacks
- a new `play` after error creates a fresh attempt

If a sound references an asset that is already decoded, it still emits
`soundReady` with the current command correlation. If an asset is decoding,
the sound subscribes to that in-flight result instead of warning once and
remaining permanently unstarted.

## Cursor Ownership

Route Graphics calculates position from the decoded segment, current source
offset, audio-context time, playback rate, and all pause/seek/source
replacements.

Consumers must not estimate current position from wall-clock time. They update
their display state from `soundProgress`.

Progress-derived position changes do not produce new playback commands. A
consumer may render updated UI and mixer state while retaining the same
playback command:

```json
{
  "commandId": 42,
  "operation": "play",
  "positionMs": 0
}
```

The original command position remains unchanged until the consumer issues
another transport operation.

## Runtime Lifecycle

Playback commands are transient runtime instructions. They are intentionally
not sufficient to restore an exact paused cursor after Route Graphics has been
destroyed.

Consumers must clear or deliberately restart command-controlled playback when:

- creating a new Route Graphics instance
- loading saved state
- starting a new game or runtime session
- replacing the project
- otherwise invalidating renderer-owned audio state

Re-rendering through the same Route Graphics instance preserves playback.
Destroying and recreating the instance does not.

This lifecycle keeps the public command small. Adding public decode generations
and desired status would still not restore the renderer's exact cursor after
destruction, so those fields do not belong in this interface.

## Legacy Compatibility

An ordinary sound remains valid:

```json
{
  "id": "click",
  "type": "sound",
  "src": "click-sfx"
}
```

Its behavior remains:

- addition starts playback
- removal stops playback
- stable sound and source identity continues playback
- source-identity changes replace playback
- replaying a one-shot requires a new sound playback-instance ID

No new command ID or events are required for legacy sounds.

Audio channels require no interface changes. Existing channel and sound volume,
mute, pan, loop, timing, and transition fields remain unchanged.

## Internal Implementation Requirements

This proposal does not prescribe public methods for transport. An eventual
implementation will need internal support for:

- a retained playback controller per command-controlled sound
- private source/decode generations and callback tokens
- exact cursor capture and source recreation for pause, resume, and seek
- command ordering and exactly-once reconciliation
- decoded segment validation and duration calculation
- progress scheduling
- event dispatch through the current Route Graphics event handler
- settled-decode rebinding to the latest command
- natural-completion detection
- stale callback suppression after replacement, removal, and destruction

The existing `resumeAudio()` public method remains unchanged.

## Why the Interface Does Not Expose More State

An earlier design considered this larger command:

```json
{
  "trackId": "mainTheme",
  "playbackGeneration": 12,
  "commandRevision": 4,
  "operation": "pause",
  "status": "paused",
  "positionMs": 83000
}
```

That shape duplicates state already owned by the sound node, consumer, and
renderer:

- `sound.id` identifies the controlled renderer sound
- the consumer already knows which logical track is selected
- Route Graphics can own source and decode generations privately
- one ordered command ID provides exactly-once reconciliation
- the operation determines desired transport behavior
- pause and resume must use the renderer's exact cursor rather than a supplied
  projected position

The smaller command preserves the required safety properties without making
consumers coordinate multiple counters and duplicate playback status.

## Required Test Coverage

Implementation is not complete until tests cover:

- strict command validation and operation-specific `positionMs`
- multiple simultaneous command-controlled sounds
- same, lower, and higher command IDs
- accepted no-op and execution-error completion rebinding
- repeated play and repeated seek
- pause/resume cursor continuity
- pause, resume, stop, play, and queued seek while decoding
- play and seek positions below, equal to, and greater than duration
- retained-sound transitions into and out of command-controlled mode
- source-identity change requirements
- volume, mute, pan, and channel updates without restart
- playback-rate-aware progress
- segment-relative duration and position
- ready, progress, complete, and error payloads under `_event`
- cached and in-flight decode rebinding
- retry after decode error
- intentional `onended` suppression
- stale callbacks after command changes, replacement, removal, and destroy
- story BGM pause/resume while another sound plays
- lifecycle clearing when Route Graphics is recreated
- backward compatibility for sounds without `playback`

Unit tests should exercise the state machine with a mocked audio context.
Browser audio tests should verify real cursor continuity, event timing, and
autoplay-unlock behavior.
