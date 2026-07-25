---
template: docs-documentation
title: Sound Node
tags: documentation
sidebarId: node-sound
---

`sound` is the built-in audio node for one-shot SFX, looping BGM, and optional
command-controlled playback.

Try it in the [Playground](/playground/?template=sound-demo).

## Used In

- `audio[]`

## Field Reference

| Field          | Type        | Required | Default | Notes                                      |
| -------------- | ----------- | -------- | ------- | ------------------------------------------ |
| `id`           | string      | Yes      | -       | Globally unique sound id.                  |
| `type`         | string      | Yes      | -       | Must be `sound`.                           |
| `src`          | string      | Yes      | -       | Audio source alias/URL.                    |
| `volume`       | number      | No       | `100`   | Local volume from `0` to `100`.            |
| `muted`        | boolean     | No       | `false` | Mutes this sound without pausing it.       |
| `pan`          | number      | No       | `0`     | Stereo pan from `-1` to `1`.               |
| `loop`         | boolean     | No       | `false` | Loop playback.                             |
| `startDelayMs` | number      | No       | `0`     | Delay in ms before playback starts.        |
| `playbackRate` | number      | No       | `1`     | Playback speed multiplier.                 |
| `startAt`      | number      | No       | `0`     | Playable segment start in seconds.         |
| `endAt`        | number/null | No       | `null`  | Optional playable segment end in seconds.  |
| `playback`     | object      | No       | omitted | Strict command-controlled playback object. |

## Behavior Notes

- Delayed sounds are scheduled and can be canceled by updates/deletes with the same `id`.
- Updating a pending delayed sound with `startDelayMs` reschedules from scratch.
- If a pending delayed sound is updated to immediate playback, the pending timer is canceled and sound is added immediately.
- A sound without `playback` keeps the ordinary declarative behavior shown
  below.
- A sound with `playback` accepts ordered transport commands and emits
  `soundReady`, `soundProgress`, `soundComplete`, and `soundError`.
- A command-controlled sound cannot be retained across a render that removes
  `playback`, and it cannot be a child of a looping audio channel.

## Example: Minimal SFX

```yaml
audio:
  - id: click-sound
    type: sound
    src: sfx-1
```

## Example: Looping Background Music

```yaml
audio:
  - id: bgm-main
    type: sound
    src: bgm-1
    volume: 70
    loop: true
```

## Example: Delayed Sound Cue

```yaml
audio:
  - id: stage-announce
    type: sound
    src: sfx-announce
    startDelayMs: 1200
    volume: 90
```

## Example: Command-Controlled Playback

```json
{
  "audio": [
    {
      "id": "music-room:player",
      "type": "sound",
      "src": "main-theme",
      "playback": {
        "commandId": 42,
        "operation": "play",
        "positionMs": 0
      }
    }
  ]
}
```

The `playback` object has exactly these fields:

```json
{
  "commandId": "non-negative safe integer",
  "operation": ["play", "pause", "resume", "stop", "seek"],
  "positionMs": "required for play and seek; forbidden otherwise"
}
```

Keep `commandId` unchanged for ordinary UI, volume, mute, and progress renders.
Increment it only when issuing another transport command. See
[`docs/audio-playback-commands.md`](https://github.com/RouteVN/route-graphics/blob/main/docs/audio-playback-commands.md)
for the complete operation, event, cursor, and error rules.
