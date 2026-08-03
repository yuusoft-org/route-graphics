# Deterministic Audio Visual Testing

Route Graphics audio visual tests (AVT) render the real public audio state
interface through Chromium's `OfflineAudioContext`. References are canonical
48 kHz stereo PCM16 WAV files plus exact public-event transcripts.

AVT never records speakers, uses `MediaRecorder`, or compares compressed audio.
Wall-clock capture and codecs such as Opus are not byte deterministic and are
therefore unsuitable as reference artifacts.

## Commands

```sh
bun run avt
bun run avt:generate
bun run avt:report
```

- `avt` builds the package, renders every spec twice, proves both independent
  renders are identical, and compares their WAV bytes and JSON transcript with
  the checked-in references.
- `avt:generate` performs the same determinism check before replacing reference
  WAV and JSON files.
- `avt:report` compares references and writes a self-contained,
  directly-openable `avt/output/report.html`. On a mismatch it also writes
  playable expected, actual, and per-run WAV files with their JSON transcripts.
  The command loads the finished report in Chromium and verifies that every
  embedded audio source, waveform, and spectrogram renders successfully.

Set `RTGL_AVT_REPEATS` to an integer greater than or equal to two to increase
the independent-render determinism check:

```sh
RTGL_AVT_REPEATS=5 bun run avt
```

## Spec Structure

Specs live in `avt/specs/*.yaml`:

```yaml
title: Same-ID BGM crossfade
description: Verifies outgoing and incoming sources overlap during replacement.
durationMs: 3250
sampleRate: 48000
numberOfChannels: 2
assets:
  trackA:
    generator: tone
    frequency: 440
  trackB:
    generator: tone
    frequency: 880
states:
  - atMs: 0
    state:
      id: outgoing
      elements: []
      animations: []
      audio:
        - id: bgm
          type: sound
          src: trackA
          loop: true
          volume: 100
          transition:
            exit:
              volume:
                keyframes:
                  - { value: 0, duration: 1000, easing: linear }
  - atMs: 500
    state:
      id: incoming
      elements: []
      animations: []
      audio:
        - id: bgm
          type: sound
          src: trackB
          loop: true
          volume: 100
          transition:
            enter:
              volume:
                initialValue: 0
                keyframes:
                  - { value: 100, duration: 1000, easing: linear }
```

The first state must use `atMs: 0`. Later states execute on deterministic audio
time. Timers created by `startDelayMs`, cleanup tails, and controlled progress
events use the same virtual clock.

Use generated uncompressed tone assets for reference specs. A tone accepts
`frequency` and optional `endFrequency`, `durationMs`, and `amplitude` fields;
different start/end frequencies produce a deterministic chirp. Compressed
decoder compatibility belongs in browser smoke or unit tests because codec
output may change across browser versions.

Specs must render at least one non-zero PCM sample by default. Use
`expectSilence: true` only for a fixture whose intended output is complete
silence; the runner then enforces the inverse assertion.

## Artifact Contract

Every reference contains:

- a canonical PCM16 WAV
- a SHA-256 hash of the exact WAV bytes
- fixed sample rate, channel count, frame count, duration, and signal summary
- the exact ordered public event transcript

The comparison is byte equality, not an amplitude or timing tolerance. A
Chromium upgrade may intentionally change Web Audio output; such an upgrade
requires explicit reference regeneration and review, just like a graphics
renderer upgrade can change VT references.

Reference WAVs are stored with Git LFS. Generated reports under `avt/output`
are ignored and uploaded by CI only on failure.

## Runtime Boundary

The realtime browser runtime remains the default. It delegates to the browser's
normal `AudioContext`, wall clock, timers, intervals, and microtask queue.

Runtime configuration is process-wide, matching the existing shared audio
context. Install it before creating any Route Graphics application, do not swap
it while an application is alive, and always restore the browser runtime after
destroying the offline application.

AVT installs a deterministic runtime before creating Route Graphics:

```js
const runtime = createDeterministicAudioRuntime({
  durationMs: 3000,
  sampleRate: 48000,
  numberOfChannels: 2,
});

configureAudioRuntime(runtime);
const app = createRouteGraphics();

try {
  await app.init(options);
  await app.loadAssets(assets);
  app.render(firstState);
  runtime.scheduleAt(1000, () => app.render(secondState));
  const renderedAudioBuffer = await runtime.render();
} finally {
  app.destroy();
  runtime.destroy();
  resetAudioRuntime();
}
```

The deterministic runtime replaces only environment-facing time and context
operations. `AudioStage`, graph reconciliation, transitions, commands, Web
Audio nodes, and public event emission are the same code used by realtime
playback.

## Test Boundary

Use AVT for observable audio output and its matching public event sequence:

- volume, mute, pan, and playback rate
- segments and loops
- enter, update, and exit automation
- delays, replacement, and overlap
- channel composition and interruption tails
- controlled playback commands

Keep non-signal behavior in unit or integration tests:

- decode failure and pending-decode races
- failed source creation or start
- stale callback suppression
- internal resource ownership and cleanup identity
- validation and exact error messages
- actual browser autoplay policy

This mirrors the VT rule: artifacts test rendered output; focused tests cover
behavior that has no meaningful rendered artifact.
