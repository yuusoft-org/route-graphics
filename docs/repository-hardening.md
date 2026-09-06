# Repository hardening

The September 2026 review used v1.44.1 (`dcaa1f9`) as its baseline. This change
addresses its 23 concrete findings while retaining the public declarative state
model, GSAP backend, pure timeline evaluator, visual fixtures, and audio references.

## Correctness changes

| Review findings                              | Change                                                                                                                                                                                                                | Regression coverage                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1–2: completion reentry and early settlement | Retire players by identity before callbacks; reconcile an element after its update records settle, including persistent players adopted by compatible renders. Reset render generations before aborted notifications. | Public Chromium reentry checks, persistent update/cancellation tests, runtime dispatch tests, bus tests |
| 3–4: overwrite and yoyo                      | Preserve action identity across property clips and apply trims in timeline coordinates in both directions.                                                                                                            | Timeline regression tests and Chromium samples                                                          |
| 5–6: descendant and app teardown             | Register idempotent resource cleanup on display destruction; recursively destroy the stage's children. Input, slider, video, animated sprite, particle, scroll, and shader resources follow display ownership.        | Real Pixi input removal and destruction checks, plugin and public API tests                             |
| 7–8: asynchronous failure                    | Observe root and nested mount promises; clean failed hidden preparation and staged snapshots; report failure and allow identical-state retry.                                                                         | Root mount/retry, transition preparation, and asynchronous cleanup tests                                |
| 9: CSP compatibility                         | Use Pixi v8's CSP polyfills and adapt their uniform-buffer callback arguments so batched groups retain their offsets.                                                                                                 | WebGL/WebGPU buffer-offset tests and Chromium shader rendering without CSP `unsafe-eval`                |
| 10: retired audio channels                   | Keep every live channel instance owned until cleanup, even after its ID is removed or reused.                                                                                                                         | Timer/node teardown tests and deterministic audio rendering                                             |
| 11–14: asset identity and races              | Use prototype-free audio dictionaries, deduplicate pending buffer loads, invalidate stale cache writes, reserve audio before awaiting, and store shared texture values consistently.                                  | Cache clear/reload, special keys, cross-instance decode/unload, sequential and concurrent texture tests |
| 15–17: input ownership                       | Unbind only the owning keyboard callback, ignore IME confirmation keys, and guard deferred input callbacks by entry and native-control identity.                                                                      | Multiple managers plus host binding, composition, unmount, and same-ID replacement tests                |
| 18: long-session bookkeeping                 | Prune lifecycle parents only when no desired, mounted, or pending identity needs them.                                                                                                                                | 1,000-scene registry test and existing nested adoption cases                                            |
| 19–21: events and termination                | Traverse unbounded root events; invalidate queued starts even during queue processing; release failed activation reservations.                                                                                        | Infinite events, callback cancellation, rollback and failure tests                                      |
| 22–23: bounded timeline work                 | Populate repeat-refresh iterations iteratively and compare sorted active intervals with a linear scan that retains point intervals at tied endpoints.                                                                 | Direct 10,000-iteration seek, disjoint repeated intervals, and zero-duration sets at repeat boundaries  |

Failure payloads are deliberately more precise: failed tracked renders emit
`{ id, aborted: true, failed: true, error }`. Successful and superseded render
payloads retain their existing shape. Applications should distinguish failed
work from a successful render before advancing a scene.

## Structure, distribution, and removals

- Shared asset records and reservations live in `src/assets/sharedAssetOwnership.js`.
- Audio scheduling, sound transport, and instance ownership live in `src/audio`; `AudioStage` retains graph reconciliation and its public API.
- Replacement lifecycle orchestration and rendering surfaces are separate modules. Preparation cleanup covers rejection before activation as well as finalization.
- Reconciliation constructs an animation-target set once per diff and checks descendants without allocating a set of all descendant IDs for each element. In a local warmed 5,000-element/5,000-target benchmark, mean diff time dropped from about 148 ms to 1.4 ms. These are observations on one machine, not a performance guarantee.
- Both rendering CLI entry points use one implementation, including `--layout-report`. The legacy script remains a thin wrapper.
- Package, playground, and visual builds are separate targets. `build:all` builds each browser variant once. CI shares build artifacts across independent unit, audio, browser, and visual jobs.
- Package checks inspect the packed browser bundle, verify package resolution, and run both CLI entry points from a consumer directory. Package builds clear generated output before rebuilding so stale artifacts cannot ship.
- Canvas and Prettier are explicit development dependencies. CI runs semantic lint. Workflows pin Bun 1.3.5; Pages uses the pinned playground tool and rebuilds when engine inputs change.
- Pixi is pinned to 8.10.2 for renderer-specific texture limits; the custom-mesh adapter follows that version's filter-surface contract. WGSL vertex-source preparation preserves the final input when Pixi reflects its attributes.
- Removed the unused `cancalleableTimeout` utility, rectangle scroll re-export, particle behavior barrel, and non-index-exported `createAudioPlayer` wrapper. Test-only container parsing and the legacy timeline reference evaluator moved into `spec/support`.
- `loadAudioAssets` delegates to shared asset ownership. `plugins.animations` and its descriptor factory remain compatibility APIs and are deprecated; no registration is needed for built-in animation execution.
- Historical plans moved into `docs/archive` with forwarding links. Current timeline and keyframe contracts remain in place.

## Validation

- Full unit/component/CLI suite: 1,799 tests across 126 files, including persistent update reconciliation, point-interval overlap, CSP buffer offsets, and WGSL attribute reflection.
- Docker visual regression: 886/886 images matched the existing references across 248 fixtures.
- Deterministic audio rendering: 23/23 specifications passed, with two renders per specification and unchanged references.
- Real Chromium: strict-CSP initialization, ancestor/app destruction, successful and aborted completion reentry, independent animation completion, overwrite, and yoyo checks passed.
- Browser layout inspection: passed, including scaled alignment and unchanged pixels/events during inspection.
- WebGPU: five shader cases passed in Chromium 143.0.7499.4 with SwiftShader under CSP without `unsafe-eval`. The suite rejects device/validation errors, black frames, missing pixel changes, and incorrect timed-shader output.
- Package contents, browser bundle resolution, both packaged CLI help commands, all build targets, frozen dependency installs, and the playground build passed.
- Prettier passed. Semantic lint reported zero errors; 46 existing warnings remain, primarily unused interface parameters and particle behavior placeholders.

WebGPU CI uses Playwright's full Chromium channel and SwiftShader with Vulkan
presentation enabled. It is a required job. Pixel analysis examines every pixel
so regular stripes cannot alias a sampling stride; screenshots and metrics are
saved under `.rettangoli/webgpu` for failure artifacts. The test CSP permits
Pixi's image-decoding workers while keeping runtime `eval` blocked.

Composition-key behavior has automated event coverage; native IME UI and mobile
keyboard behavior still need a supported-device pass. No visual or audio
reference was regenerated for this change.
