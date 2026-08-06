# Inline Audio Transitions Removed

Last updated: 2026-08-06

The `transition` field on `sound` and `audio-channel` nodes has been removed.
Route Graphics intentionally has one automation interface: top-level
`audioEffects`, matching the state/effect separation used by visual animations.
There is no compatibility adapter.

## Migration

Before:

```yaml
audio:
  - id: bgm
    type: sound
    src: theme
    volume: 80
    transition:
      enter:
        volume:
          initialValue: 0
          keyframes:
            - { value: 80, duration: 1000, easing: easeInOutSine }
```

After:

```yaml
audio:
  - id: bgm
    type: sound
    src: theme
    volume: 80

audioEffects:
  - id: bgm-enter:visit-42
    type: audio-transition
    targetId: bgm
    properties:
      volume:
        enter:
          initialValue: 0
          keyframes:
            - { value: 80, duration: 1000, easing: easeInOutSine }
```

Inline shape was lifecycle-first (`enter.volume`). The canonical effect shape
is property-first (`properties.volume.enter`).

For same-ID source replacement, put outgoing and incoming automation in one
new next-state occurrence:

```yaml
audioEffects:
  - id: bgm-handoff:visit-43
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
            - { value: 80, duration: 1000, easing: linear }
```

For removal, put the exit effect in the next state even though the target only
exists in the previous audio graph. Use a fresh occurrence ID whenever the
effect should run again. Keep an unchanged ID and payload only to continue
already accepted automation without restarting it.

See [Audio Channel Design](./audio-effects.md#audio-effects) for the complete
runtime and lifecycle contract.
