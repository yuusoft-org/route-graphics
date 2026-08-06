# Keyframe Start Value Design

Status: implemented

Last updated: 2026-08-06

Related documents:

- `docs/animation-model.md`
- `docs/animation-implementation-plan.md`
- `docs/inline-audio-transitions.md`
- `docs/portable-gsap-timelines.md`

## Decision

Manual keyframes gain an optional `startValue` field. It explicitly sets the
value at which that keyframe's interpolation segment begins.

```yaml
x:
  initialValue: 10
  keyframes:
    - duration: 400
      value: 100
    - delay: 200
      startValue: 0
      duration: 300
      value: 50
```

This track:

1. interpolates from `10` to `100` over `400` milliseconds
2. holds `100` for `200` milliseconds
3. jumps to `0` when the second segment begins
4. interpolates from `0` to `50` over `300` milliseconds

The field is named `startValue`, not `initialValue`, `from`, or `fromValue`:

- track-level `initialValue` remains the value before the entire track
- keyframe-level `startValue` is the value at the start of one segment
- keyframe-level `value` remains the value at the end of that segment
- `from` and `fromValue` do not make the track-versus-segment scope as explicit

`startValue` is optional. Omitting it preserves the current chained-keyframe
behavior exactly.

## Motivation

Today, every keyframe describes an endpoint. A segment begins at the previous
endpoint and reaches `value` over `duration`. An author who needs a deliberate
jump immediately before an interpolation must insert a zero-duration
keyframe:

```yaml
keyframes:
  - value: 100
    duration: 400
  - value: 0
    duration: 0
  - value: 50
    duration: 300
```

Zero-duration keyframes remain useful as explicit set operations, but they are
awkward when the set exists only to establish the next segment's starting
value. `startValue` expresses that segment as one authored unit.

## Timing Semantics

Each keyframe still occupies:

```text
delay + duration
```

For a keyframe beginning at cursor time `T`:

1. The value preceding the keyframe is held from `T` through its `delay`.
2. `startValue`, when present, takes effect at `T + delay`.
3. Interpolation begins at that same time and runs for `duration`.
4. The keyframe reaches `value` at `T + delay + duration`.

Therefore, `startValue` does not change the value held during `delay`:

```yaml
- delay: 500
  startValue: 20
  value: 80
  duration: 300
```

If the preceding endpoint is `100`, the runtime holds `100` for `500`
milliseconds, jumps to `20`, and then interpolates to `80`.

At an exact boundary, the segment beginning at that boundary owns the sampled
value. This makes the `startValue` jump observable when `duration` is positive.
If `duration` is zero, terminal `value` wins at the shared start/end boundary;
`startValue` has no observable duration.

## Absolute Resolution

Let:

- `B` be the resolved value held immediately before the segment
- `S` be the resolved interpolation start
- `E` be the resolved interpolation endpoint

For an absolute keyframe (`relative` omitted or `false`):

```text
S = startValue, when provided; otherwise B
E = value
```

The easing function interpolates from `S` to `E`.

The first keyframe uses the track's `initialValue` as `B` when one is provided.
Otherwise, `B` is captured from the current renderer-owned value according to
the existing track semantics.

## Relative Resolution

`startValue` also supports `relative: true`. Relative operations resolve in
sequence so that `value` remains the delta traversed during the segment:

```text
S = B + startValue, when startValue is provided; otherwise B
E = S + value
```

For example:

```yaml
- delay: 200
  startValue: -20
  value: 50
  relative: true
  duration: 300
```

If `B` is `100`, the runtime holds `100` during the delay, jumps to `80`, and
interpolates to `130`. The following keyframe uses `130` as its preceding
endpoint.

Addition is ordinary numeric addition for scalar values and component-wise
addition for compatible numeric vectors. The existing shape-validation rules
continue to apply. Types that do not currently support relative keyframes,
such as colors, do not gain relative support through `startValue`.

An absolute `startValue` follows the same authored range rules as an absolute
`value`. With `relative: true`, `startValue` is a signed delta and is resolved
before range constraints are applied, just like a relative endpoint delta.

When a channel constrains resolved values, it applies its existing constraint
rules to `S` before using `S` as the base for the endpoint delta, and then to
`E`. This is especially important for audio properties: the audible, clamped
start becomes the base for the relative movement that follows.

## Chaining And Playback

The resolved endpoint `E` becomes `B` for the following keyframe. The optional
start value does not become the chain baseline after its segment has finished.

Repeats reapply the same start-value discontinuity on every iteration. During
yoyo or reverse evaluation, the segment interpolates from `E` back to `S`; when
evaluation crosses into the preceding segment, the preceding segment resumes
ownership. If `S` differs from the preceding endpoint `B`, that boundary is
intentionally discontinuous in both directions.

An interruption during a keyframe's delay observes the held preceding value,
because `startValue` has not taken effect yet. An interruption during its
duration observes the interpolated value under the existing continuity rules.

## Compatibility

This is an additive authoring change:

- existing keyframes without `startValue` retain their current output
- `value`, `duration`, `delay`, `easing`, and `relative` retain their meanings
- track-level `initialValue` retains its current meaning
- zero-duration keyframes remain valid explicit set operations
- total track duration remains the sum of every `delay + duration`

`startValue` applies to compact manual keyframe interfaces that already expose
the endpoint-style `value` field, including numeric visual tweens, shader
parameters, and audio property automation. Absolute color start values may use
the field, but color keyframes remain non-relative.

The portable `gsap` frontend does not add `startValue` to its multi-property
`keyframes` frames. It already expresses this operation explicitly through a
`fromTo` action or a `set` followed by `to`.

## Implementation Coverage

The field ships as one coordinated change across the public interfaces that
use endpoint-style keyframes:

- `startValue` is present in the visual animation, shader, and audio schemas with the
  same type and absolute-value range rules as `value`
- runtime normalizers validate and preserve it without changing omitted-field output
- compilers build each segment from resolved `S` to resolved `E`
- delay holds and exact boundary ownership are preserved
- relative scalar and vector addition follows the order specified above
- public JSDoc types and hosted interface documentation expose it
- conformance coverage includes absolute, relative, delayed, vector, clamped,
  zero-duration, repeated, yoyo, and interrupted segments

The schemas, runtime normalizers, visual and transition compilers, Web Audio
automation scheduler, public types, documentation, and conformance tests all
recognize the field together.
