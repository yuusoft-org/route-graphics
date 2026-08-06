# Canonical Audio Effects Plan Review

Status: approved with revisions incorporated

Reviewed: 2026-08-06

Plan: [`canonical-audio-effects-implementation-plan.md`](./canonical-audio-effects-implementation-plan.md)

## Review Scope

The review compared the proposed end state with:

- the current `audio` and `audioEffects` schemas
- `normalizeAudioRenderState()` and its inline/effect merge behavior
- `renderAudio()` and its separate previous/next validation
- `AudioStage.renderGraph()` transition lookup and source-tail ownership
- visual animation identity and continuity planning
- current command-controlled playback behavior
- existing unit, deterministic audio, VT, and browser fixtures
- the Route Engine requirement that one reusable transition occurrence control
  both outgoing and incoming audio

## Review Result

The plan is implementation-ready after the revisions below. It reaches the
requested end state without introducing a second public runtime:

- audio graph state stays in `audio`
- temporal behavior stays in `audioEffects`
- inline audio transitions are removed
- the existing `audio-transition` payload remains the concrete renderer shape
- one newly accepted effect owns exit, enter, or update for the current edge
- effect removal is the settlement signal

The design is architecturally aligned with visual animations. It intentionally
does not rename the existing audio payload to `type: update | transition`; Route
Engine resources may use that authoring split and compile to the established
`audio-transition` lifecycle fields.

## Findings And Resolutions

### 1. Previous-only exit lookup could not support one selected handoff

Severity: blocking

Current behavior reads exit configuration from `prevAudioEffects`. A resource
selected on the current story action exists only in the next render input, so
that rule cannot attach its exit track to the already-rendered outgoing sound.

Resolution:

- the plan makes the newly accepted next-state effect own the entire current
  edge
- its `exit` applies to the previous instance and its `enter` applies to the
  next instance
- this is explicitly listed as a runtime and acceptance requirement

This is the minimum semantic change required for one reusable resource to
produce one concrete effect and control both sides.

### 2. Effect omission was ambiguous with ordinary progression

Severity: blocking

If an effect were emitted only on its starting render, later omission could
mean either "continue scheduled work" or "skip and settle." Route Graphics
could not infer which meaning was intended.

Resolution:

- accepted effects remain in consumer presentation state
- unchanged ID plus unchanged normalized signature means continue without
  restart
- removal without replacement means settle
- Route Engine must persist occurrence ownership and remove it on skip/reset

This avoids a new settlement field or command.

### 3. Removed targets can disappear before non-blocking exits finish

Severity: blocking

Audio effects do not block `renderComplete`. A later render can therefore have
the same continued exit effect while its target is absent from both public
graphs. Union-only target validation would incorrectly reject that valid state.

Resolution:

- active and completed effects retain internal ownership metadata
- unchanged continued effects may resolve through that metadata
- genuinely orphaned effects with no graph target and no ownership record are
  still rejected

This also lets a completed non-blocking exit remain declared until its consumer
later removes the occurrence.

### 4. One-sided phase wording conflicted with strict validation

Severity: major

The first draft said unused phases would not run while also requiring enter to
have a next target and exit to have a previous target. That could be read as
allowing a full enter/exit payload on an add-only edge.

Resolution:

- add effects author enter
- remove effects author exit
- replacement effects may author both
- a phase whose required side is absent is rejected

The reusable Engine compiler already knows whether a selected resource has
`prev`, `next`, or both and can emit only applicable concrete phases.

### 5. Renders on the same story action could restart automation

Severity: blocking

A settings render or other unrelated render may repeat the same current action.
Deduplicating by resource path would suppress legitimate revisits, while
starting every submitted effect would restart the active envelope.

Resolution:

- effect IDs identify accepted action occurrences, not authored resource paths
- same occurrence and signature continues
- a revisit receives a different occurrence ID
- remove then re-add is also defined as a fresh start

No audio-effect `commandId` is needed.

### 6. Skip needed to settle retained updates as well as handoffs

Severity: blocking

Settling only outgoing/incoming source work would leave a retained volume, pan,
or playback-rate update scheduled after skip.

Resolution:

- effect removal settles handoffs, active retained updates, and pending enters
- the unit, system, deterministic audio, and browser matrices call out the
  retained-update path separately

### 7. Incoming decode timing had to use one clock policy

Severity: major

Waiting for incoming decode before starting outgoing exit conflicts with prompt
outgoing teardown and has unbounded failure timing.

Resolution:

- outgoing exit always starts at reconciliation time
- ready incoming playback shares that base time
- delayed decode defers only the incoming side
- failure never resurrects the detached outgoing source

The acceptance criteria and timing tests use the same rule.

### 8. Master volume and mute must not overwrite an envelope

Severity: blocking

Automating and hard-muting the same gain parameter destroys scheduled envelope
state. Pre-scaling keyframes with a runtime music setting similarly prevents
independent setting changes during a fade.

Resolution:

- per-sound automation, sound mute, retained channel gain, and channel mute are
  separate processing layers
- Route Engine uses sound fields for per-track state and a stable parent
  channel for `musicVolume`/`muteAll`
- changing the master scales both handoff sides without cancelling sound
  automation
- mute/unmute coverage is required during active automation

This uses the existing channel interface and does not add `audioMasters`.

### 9. Outgoing and incoming source state must not share sound processors

Severity: blocking

Same-ID source replacement temporarily owns two playback instances. If they
share sound gain, pan, or mute processing, applying next state can make the
outgoing source jump before its exit completes.

Resolution:

- each playback instance owns its sound state and automation processors
- only the retained parent channel is shared
- replacement tests cover different outgoing/incoming volume, pan, and mute

An effect that deliberately targets the channel still affects the whole shared
bus, which is the documented mixer behavior.

### 10. Command-controlled playback was missing from the first draft

Severity: major

The existing runtime supports ordered playback commands. Removing inline
transitions without specifying how canonical effects arm and consume enter
work could regress first play, replay, or source replacement.

Resolution:

- effect ID and playback `commandId` remain independent
- the first accepted play consumes armed enter work once
- same-source transport replay does not repeat the same effect
- a new animated replay needs a new effect occurrence
- source replacement consumes accepted exit/enter work

Targeted tests were added to the plan.

### 11. Independent per-state validation rejects valid exit targets

Severity: blocking

`renderAudio()` currently validates previous and next states separately. A new
remove effect legitimately targets a node found only in the previous graph.

Resolution:

- normalization is split from edge validation
- one joint planner receives both audio graphs, both effect lists, and owned
  effect records
- phase applicability is checked against the edge rather than one isolated
  state

### 12. Array/object order must not become lifecycle identity

Severity: major

Naive serialization could restart an unchanged effect after harmless key
insertion or list ordering differences.

Resolution:

- continuity uses a normalized canonical signature
- object-key order is ignored
- semantically ordered keyframe arrays remain ordered

## Remaining Implementation Risks

No unresolved public-contract blocker remains. The main implementation risks
are internal:

- `AudioStage.js` has many intertwined source, command, loop-tail, and cleanup
  paths; the plan mitigates this with a pure lifecycle planner and idempotent
  execution helpers
- the inline fixture migration is broad; repository-wide positive-example
  search is part of the completion gate
- browser audio timing can be noisy; deterministic AVT owns precise envelope
  assertions while browser coverage verifies integration paths

## Review Checklist

- [x] one public automation path
- [x] one effect can control outgoing and incoming sides
- [x] retained updates remain distinct
- [x] action occurrence ownership is explicit
- [x] unchanged renders do not restart
- [x] legitimate revisits can replay
- [x] skip/reset settles all active automation classes
- [x] previous-only and detached target ownership is defined
- [x] decode-delay policy is internally consistent
- [x] sound envelopes, mute gates, and channel master are independent
- [x] command-controlled playback is covered
- [x] targeted and actual audio/browser timing coverage is required
- [x] no dependency on the abandoned expanded Route Graphics interface
