# Shared Timeline Implementation Review

Review date: 2026-08-01

Status: the renderer-neutral `route.timeline/v1` core and the `tween` and
`gsap` frontends are integrated in the JavaScript renderer. Update and
transition animations now use the same binding, domain, evaluation, event, and
player semantics. The PixiJS/JavaScript renderer now uses the pinned GSAP
runtime for numeric interpolation and native easing; the pure evaluator remains
the renderer-neutral conformance reference.

This review records implementation evidence against every roadmap milestone.
It deliberately distinguishes the shipped portable core from optional future
samplers and from claims that require an independent native implementation.

## Checkpoint Matrix

| Milestone                           | Result                                  | Evidence and review outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Contract freeze                  | Pass                                    | The normative envelope, ownership, timing, lifecycle, target, conflict, capability, and terminal rules are frozen in `shared-timeline-plan-design-and-roadmap.md`.                                                                                                                                                                                                                                                                                                                                        |
| 1. Baseline characterization        | Pass                                    | Existing parser, animation bus, update, transition, element, and CLI fixtures remain in the full regression suite.                                                                                                                                                                                                                                                                                                                                                                                        |
| 2. Program schema and validators    | Pass                                    | `validateProgram.js`, the authoring YAML schema, and the closed conformance JSON Schema reject unknown fields, unsafe time values, invalid unions, cycles, dangling references, and excessive program sizes.                                                                                                                                                                                                                                                                                              |
| 3. Values, easings, and time kernel | Pass                                    | Integer-millisecond validation, canonical value types, structured easings, endpoint rules, domain mapping, and canonical semantic signatures have unit and conformance vectors. Dense native-GSAP sweeps cover parameterized easing families; every scalar, vector, matrix, color, integer, and discrete type is sampled through the GSAP backend.                                                                                                                                                        |
| 4. Legacy tween compiler            | Pass                                    | Existing update tween data compiles to `TimelineProgram`; compiler fixtures cover manual, auto, relative, translation, filters, and rect channels.                                                                                                                                                                                                                                                                                                                                                        |
| 5. Binder and pure evaluator        | Pass                                    | Binding resolves abstract targets and semantic channels without writes. The pure evaluator remains history-independent and reusable-buffer tests cover out-of-order seeks. Frame application batches hooks and rolls back earlier channel writes if an adapter fails.                                                                                                                                                                                                                                     |
| 6. Update migration                 | Pass                                    | Production update dispatch sends both legacy tween and portable GSAP programs through the GSAP-backed TimelineProgram evaluator. Legacy public playback behavior remains covered.                                                                                                                                                                                                                                                                                                                         |
| 7. Transition migration             | Pass                                    | Shorthand transition tracks compile to the shared program and the transition runner samples that instance through the GSAP backend for surfaces, masks, and compositors. Existing transition tests pass.                                                                                                                                                                                                                                                                                                  |
| 8. Domains and playback             | Pass                                    | Finite/infinite repeat, repeat delay, yoyo, nested domains, speed, reverse, pause, resume, seek, progress, and continuity are implemented and tested.                                                                                                                                                                                                                                                                                                                                                     |
| 9. Conflict and composition         | Pass                                    | Replace/add/multiply, overwrite modes, deterministic priority, local overlap, activation-local conflicts, queue-wide cross-owner conflicts, and active-animation conflicts use concrete target/channel write sets before time-zero application.                                                                                                                                                                                                                                                           |
| 10. GSAP compiler                   | Pass                                    | The closed YAML/JSON union supports set, to, from, fromTo, keyframes, sequence, parallel, wait, mark, and emit with defaults and strict field discriminators.                                                                                                                                                                                                                                                                                                                                             |
| 11. Scheduling                      | Pass                                    | Structured starts, marks, child anchors, delays, overlap, backward-only references, and binding-time timing expressions have compiler and validator tests.                                                                                                                                                                                                                                                                                                                                                |
| 12. Multi-target and stagger        | Pass                                    | Element lists, unions, deterministic fan-out, 1D/grid origins, seeded random order, and binding/resource limits are implemented.                                                                                                                                                                                                                                                                                                                                                                          |
| 13. Text targets                    | Pass with boundary                      | Grapheme, word, and line targets, combining/emoji/Indic fixtures, stable identities, staged Pixi adapters, fingerprinted rebinding, and stagger integration are implemented. The JavaScript backend requires and probes host Unicode 17 `Intl.Segmenter` data instead of carrying a second copy of Unicode tables; older engines fail before mutation. Visual RTL ordering is deterministic but is not advertised as a complete shaping or Unicode Bidi implementation.                                   |
| 14. Expressions and modifiers       | Pass                                    | Closed expression ASTs, static shape checks, deterministic FNV-1a/SplitMix64 randomness, repeat refresh, snap/round/clamp/wrap/wrapYoyo, sampled ease, and complexity limits are covered.                                                                                                                                                                                                                                                                                                                 |
| 15. Events and controls             | Pass                                    | Named data-only events, crossing direction, occurrence identity, seek policy, delivery caps, and player controls are separated from pure visual sampling.                                                                                                                                                                                                                                                                                                                                                 |
| 16. Orchestrated transitions        | Pass                                    | Top-level transition GSAP targets prev/next/mask/compositor resources, shares the GSAP-backed evaluator, requires finite terminal state, and preserves transition ownership and cleanup.                                                                                                                                                                                                                                                                                                                  |
| 17. Docs and tooling                | Pass                                    | Public schema, examples, compatibility boundary, source-path diagnostics, `inspect-timeline`, semantic signatures, and visualization lanes are present and tested.                                                                                                                                                                                                                                                                                                                                        |
| 18. Performance and reliability     | Pass for the readable v1 representation | Reusable frame buffers, shared domain caches, scaled detached GSAP progress proxies, exactly-once backend cleanup, batched application and rollback, destroyed-target checks, deterministic fuzz/parity tests, program/binding/event limits, and separate compile/bind/sample/apply/heap metrics are implemented. Completion, cancellation, invalid targets, playback/sample failure, and queue rollback have explicit disposal tests. Packed arrays and cursor indexes remain conditional optimizations. |
| 19. Conformance package             | Pass for publication                    | `conformance/timeline/v1` contains the closed JSON Schema, portable programs, canonical bytes, bindings, exact/tolerant samples, domain/easing/expression/modifier/random/text/event vectors, and an independent reference evaluator for the fixture subset. This supports native implementation work; it is not a claim that a Rust or C++ backend already exists.                                                                                                                                       |
| 20. Optional samplers               | Intentionally not activated             | Motion paths, physics, scramble/replacement, morphing, and path drawing remain capability-gated future extensions. The roadmap explicitly makes them independent of core portable-v1 completion.                                                                                                                                                                                                                                                                                                          |

## Release Review

The core definition of done is satisfied for the JavaScript renderer:

- legacy tween and transition timing no longer own separate interpolation loops
- all semantic time is integer milliseconds
- authored data and compiled programs contain no callbacks or renderer objects
- binding and conflict checks happen before time-zero writes
- queued starts are conflict-checked together, including ancestor/descendant
  target overlaps
- adapter failure restores already-written values and closes batch hooks
- update and transition remain distinct lifecycle types while sharing execution
- the PixiJS/JavaScript production path imports pinned GSAP 3.15.0 and reports
  `backend: gsap`; GSAP tweens are detached from its global timeline
- the program, compiler, binder, pure evaluator, and conformance fixtures remain
  free of Pixi and GSAP runtime objects

Four statements remain intentionally bounded:

1. A future native backend is not called conformant until it passes the versioned
   fixtures; the included independent evaluator is a reference subset, not that
   native backend.
2. The JavaScript text adapter is Unicode-17-gated and renderer-specific. The
   timeline program and its boundary fixtures remain renderer-neutral.
3. Performance budgets are environment/workload decisions. The repository ships
   a repeatable benchmark instead of encoding an arbitrary pass/fail number.
4. GSAP is a JavaScript backend choice, not part of `route.timeline/v1`.
   Native Rust/C++/Vulkan implementations consume the same program and prove
   value parity against the conformance fixtures without embedding JavaScript.

## Validation Commands

```text
bun run build
bunx vitest run --exclude spec/cli/renderPngCli.spec.js
bunx vitest run spec/cli/renderPngCli.spec.js
bunx oxlint src scripts
bunx prettier --check <changed files>
git diff --check
node ./bin/route-graphics.js inspect-timeline examples/portable-gsap.yaml --compact
node scripts/benchmarkTimeline.mjs 500 100
```
