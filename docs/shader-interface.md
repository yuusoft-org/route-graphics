# Inline Shader Effects

Last updated: 2026-07-30

## Status

The inline Effects vNext interface is implemented.

It covers:

- single-pass and ordered multi-pass element filters
- single-pass and ordered multi-pass transition compositors
- WebGL and WebGPU renderer selection
- scalar, vector, and matrix parameters
- independently animated filter and compositor parameters
- a deterministic, opt-in `uTime` clock
- custom textures with per-texture sampling
- pass padding, resolution, antialiasing, viewport clipping, blending, and mesh
- mask plus compositor transition chains
- shader filters on every built-in visual element type
- runtime reuse when only parameter values change

The original single-pass inline format remains valid. There is no shader
registry or new root-level `effects` object.

## Why Effects Stay Inline

An effect is owned by the element filter or transition that uses it:

```txt
element.filters[].source | passes[]
animation.compositor.source | passes[]
```

Keeping the declaration inline has useful semantics:

- state is self-contained and portable
- effect lifetime follows the element or transition
- parameters and their animation target are visible together
- there is no second namespace or lookup failure mode
- single-use effects do not need artificial global ids

The runtime still reuses compiled programs through the renderer's source
caches. Inline does not mean recompiling unchanged source on every render.

If reusable authoring becomes important, it should be implemented as tooling
that expands templates into this canonical inline form. It does not require a
new runtime root object.

## Where Effects Are Used

### Element Filters

Every built-in visual element accepts `filters`, including:

- `rect`
- `text`
- `container`
- `sprite`
- `spritesheet-animation`
- `video`
- `input`
- `slider`
- `text-revealing`
- `particles`

Each filter requires an `id` unique within that element.

Filters execute after built-in managed effects and in authored order:

```txt
element rendering
-> built-in managed effects
-> filters[0] pass 1
-> filters[0] pass 2
-> filters[1] pass 1
-> final output
```

For `input`, the GPU-rendered element is filtered. The temporary HTML editor
shown while the input is actively focused is a DOM overlay and is not processed
by GPU filters.

### Transition Compositors

A `type: transition` animation may define one inline `compositor` object. That
object can contain any number of ordered passes.

The compositor receives:

- the previous/cumulative surface as `uTexture`
- the captured next surface as `uNextTexture`
- `compositor.tween.progress` as `uProgress`

A transition can combine `prev`, `next`, `mask`, and `compositor`. If both mask
and compositor are present, execution is:

```txt
captured previous + captured next
-> built-in mask pass
-> compositor pass 1
-> compositor pass 2
-> final transition surface
```

Consequently, the first custom compositor pass sees the mask-composed surface
as `uTexture`. Every custom compositor pass still receives the original next
surface as `uNextTexture`.

## Canonical Shape

### Single Pass

```yaml
filters:
  - id: colorShift
    type: shader
    parameters:
      amount: 0.35
      tint: [0.2, 0.8, 1]
    textures:
      noise:
        src: noise-texture
        wrap: repeat
        mipmap: true
    time: true
    padding: 12
    resolution: inherit
    antialias: inherit
    clipToViewport: true
    mesh:
      grid: [1, 1]
    pipeline:
      blend: normal
      textureWrap: clamp
      mipmap: false
    source:
      webgl:
        fragment: |
          // GLSL
      webgpu:
        source: |
          // WGSL with mainVertex and mainFragment
```

### Multiple Passes

```yaml
filters:
  - id: bloom
    type: shader
    parameters:
      radius: 8
      strength: 0.7
    padding: 24
    resolution: 0.5
    passes:
      - id: horizontalBlur
        uniforms:
          direction: [1, 0]
        source:
          webgl:
            fragment: |
              // horizontal pass
          webgpu:
            source: |
              // horizontal pass
      - id: verticalBlur
        uniforms:
          direction: [0, 1]
        source:
          webgl:
            fragment: |
              // vertical pass
          webgpu:
            source: |
              // vertical pass
      - id: combine
        pipeline:
          blend: add
        source:
          webgl:
            fragment: |
              // combine pass
          webgpu:
            source: |
              // combine pass
```

`source` and `passes` are mutually exclusive. `passes` must contain at least
one pass and pass ids must be unique within the effect. Missing pass ids are
generated as `pass1`, `pass2`, and so on.

Each pass reads the previous pass output through `uTexture`. The first pass
reads the element surface or transition input. This is a deliberately linear
pipeline, not an arbitrary render graph.

## Fields And Inheritance

These fields can be declared on the effect:

| Field                  | Default  | Meaning                                  |
| ---------------------- | -------- | ---------------------------------------- |
| `parameters`           | `{}`     | Shared mutable/animatable inputs         |
| `uniforms`             | `{}`     | Legacy alias for `parameters`            |
| `textures`             | `{}`     | Shared custom texture inputs             |
| `pipeline.blend`       | `normal` | `normal`, `add`, `multiply`, or `screen` |
| `pipeline.textureWrap` | `clamp`  | Default custom-texture wrap              |
| `pipeline.mipmap`      | `false`  | Default custom-texture mipmapping        |
| `mesh.grid`            | `[1, 1]` | `[columns, rows]`, each from 1 to 512    |
| `padding`              | `0`      | Extra filter extent in pixels            |
| `resolution`           | `1`      | Positive scale or `inherit`              |
| `antialias`            | `off`    | `on`, `off`, `inherit`, or boolean       |
| `clipToViewport`       | `true`   | Clip pass output to the viewport         |
| `time`                 | `false`  | Include and update `uTime`               |

A pass requires `source` and may override `pipeline`, `mesh`, `padding`,
`resolution`, `antialias`, `clipToViewport`, and `time`. It may also add:

- `uniforms`: pass-local static inputs
- `textures`: pass-local texture inputs

Effect parameters and textures are inherited by every pass. Pass-local entries
cannot generate a shader symbol already used by an inherited entry.

Use top-level `parameters` for values that should change at runtime. Use
pass-local `uniforms` for fixed constants such as a blur direction.

## Parameters

Keys use lower camel case:

```txt
^[a-z][A-Za-z0-9]*$
```

The runtime converts keys to shader symbols:

```txt
amount       -> uAmount
edgeWidth    -> uEdgeWidth
colorMatrix  -> uColorMatrix
```

Inferred values:

| YAML value      | Shader type            |
| --------------- | ---------------------- |
| number          | `f32` / `float`        |
| 2-number array  | `vec2<f32>` / `vec2`   |
| 3-number array  | `vec3<f32>` / `vec3`   |
| 4-number array  | `vec4<f32>` / `vec4`   |
| 9-number array  | `mat3x3<f32>` / `mat3` |
| 16-number array | `mat4x4<f32>` / `mat4` |

An explicit descriptor can disambiguate intent:

```yaml
parameters:
  exposure:
    type: f32
    value: 1.2
  tint:
    type: vec3
    value: [1, 0.8, 0.5]
  transform:
    type: mat3
    value: [1, 0, 0, 0, 1, 0, 0, 0, 1]
```

Accepted aliases are `f32`, `vec2`, `vec2<f32>`, `vec3`, `vec3<f32>`,
`vec4`, `vec4<f32>`, `mat3`, `mat3x3<f32>`, `mat4`, and `mat4x4<f32>`.

`parameters` and legacy `uniforms` cannot both be present on the same effect.
Legacy `uniforms` are normalized as mutable parameters, so v1 states continue
to work and can be animated without a schema migration.

## Parameter Animation

### Target Element Filters

Put filter timelines under the normal update `tween`, grouped by inline filter
id:

```yaml
animations:
  - id: pulseGlow
    targetId: portrait
    type: update
    playback:
      continuity: persistent
      loop: true
    tween:
      filters:
        glow:
          strength:
            keyframes:
              - duration: 400
                value: 1
                easing: easeInOutSine
              - delay: 200
                duration: 400
                value: 0.2
                easing: easeInOutSine
          tint:
            keyframes:
              - duration: 800
                value: [0.4, 0.7, 1]
                easing: linear
```

Ordinary element properties and any number of filter ids may coexist in one
`tween`. A missing `initialValue` is read from the current filter parameter.
Scalar, vector, and matrix values interpolate component by component. Relative
keyframes require matching shapes.

Shader tracks use the same delay contract as ordinary tweens. An optional
finite, non-negative `delay` holds the preceding scalar, vector, or matrix
value before interpolation. It contributes to total duration and repeats in a
loop.

Only one active animation may write the same
`targetId + filterId + parameter` channel in one state.

The authored `progress` key targets that filter's built-in `uProgress`:

```yaml
tween:
  filters:
    glow:
      progress:
        initialValue: 0
        keyframes:
          - duration: 300
            value: 1
```

### Animate A Transition Compositor

The compositor owns its timelines. `progress` is required and maps to
`uProgress`; other keys target its declared parameters:

```yaml
animations:
  - id: burn
    targetId: scene
    type: transition
    compositor:
      type: shader
      parameters:
        edgeWidth: 0.04
      source:
        webgl:
          fragment: |
            // ...
        webgpu:
          source: |
            // ...
      tween:
        progress:
          initialValue: 0
          keyframes:
            - duration: 900
              value: 1
              easing: linear
        edgeWidth:
          keyframes:
            - duration: 900
              value: 0.12
```

`edgeWidth` starts from `compositor.parameters.edgeWidth` because no
`initialValue` override is present.

`uTime`/`time` is read-only and cannot be tweened. Animate a custom parameter
when an effect needs an authored timeline.

## Deterministic Time

Set `time: true` on an effect or pass to include:

```txt
uTime: seconds since RouteGraphics initialization or the current manual time
```

The same clock is applied to every timed pass. It advances from ticker
`deltaMS` during automatic playback. In manual mode,
`setAnimationTime(timeMS)` sets both animation sampling and shader time, which
makes screenshots and offline rendering deterministic.

`uTime` is opt-in because adding it changes the WGSL `ShaderUniforms` layout.
Existing v1 shaders that omit `time` keep their original layout.

## Textures

Texture keys use the parameter naming rule and map to:

```txt
noise           -> uNoiseTexture, uNoiseTextureSampler
displacementMap -> uDisplacementMapTexture, uDisplacementMapTextureSampler
```

The sampler symbol is used by WebGPU. WebGL continues to expose each custom
texture as a combined `sampler2D`.

A value can be a source alias/URL:

```yaml
textures:
  noise: noise-texture
```

Or a descriptor:

```yaml
textures:
  noise:
    src: noise-texture
    wrap: repeat
    mipmap: true
```

Per-texture `wrap` and `mipmap` override the pipeline defaults. Texture sources
are cloned for sampling configuration; cached source assets are not mutated.

Each filter pass supports at most seven total shared plus pass-local custom
textures. Each compositor pass supports six because `uNextTexture` consumes
one additional slot.

## Renderer Selection

Both source variants are always required. The selected backend is controlled at
initialization:

```js
await graphics.init({
  // ...
  rendererPreference: "webgpu",
  rendererFallback: true,
});

console.log(graphics.rendererType); // "webgpu" or fallback "webgl"
```

`rendererPreference` defaults to `webgl`. `rendererFallback` defaults to
`true`. If fallback is disabled and the requested backend is unavailable,
initialization throws.

Repository validation includes a strict browser-backed WebGPU suite:

```sh
bun run test:webgpu
```

It disables renderer fallback, verifies that Pixi actually selected WebGPU,
compiles and renders timed filter updates, multipass filter animation, custom
texture samplers, subdivided meshes, and mask/compositor transitions, and
checks their browser screenshots. The command requires a functional WebGPU
adapter; an unavailable or unusable adapter is a test failure.

## Source And ABI

The bindings, symbols, entry points, and uniform ordering in this section are
the Route Graphics shader ABI. They are a stable authored contract, not a Pixi
API. The internal renderer adapter maps this ABI onto the installed rendering
backend. Shader source should use only the documented ABI and must not depend
on additional renderer globals or runtime objects.

Each source block is:

```yaml
source:
  webgl:
    vertex: |
      # optional GLSL vertex source
    fragment: |
      # required GLSL fragment source
  webgpu:
    source: |
      # required WGSL source
```

WGSL must define `mainVertex` and `mainFragment`. GLSL uses modern `in`/`out`
syntax. If `webgl.vertex` is omitted, Route Graphics supplies its standard
filter vertex shader with `aPosition` and `vTextureCoord`.

### Built-In Inputs

Every pass receives:

| Input         | Type        | Meaning                                       |
| ------------- | ----------- | --------------------------------------------- |
| `uTexture`    | texture     | Original surface or previous pass output      |
| `uProgress`   | `f32`       | Filter progress or transition progress        |
| `uResolution` | `vec2<f32>` | Current target size in logical pixels         |
| `uTime`       | `f32`       | Deterministic seconds, only when `time: true` |

Compositor passes additionally receive:

| Input                | Type          | Meaning                              |
| -------------------- | ------------- | ------------------------------------ |
| `uNextTexture`       | texture       | Captured next surface                |
| `uNextTextureMatrix` | `mat3x3<f32>` | Primary-UV to next-texture transform |
| `uNextTextureClamp`  | `vec4<f32>`   | Safe next-texture UV bounds          |

Always transform and clamp coordinates before sampling `uNextTexture`. The
previous and next surfaces can have different bounds and transforms.

### WGSL Uniform Order

The `ShaderUniforms` struct must declare fields in this exact order:

1. `uProgress: f32`
2. `uTime: f32` only when the effective pass has `time: true`
3. `uResolution: vec2<f32>`
4. compositor-only `uNextTextureMatrix: mat3x3<f32>`
5. compositor-only `uNextTextureClamp: vec4<f32>`
6. inherited parameters and pass-local uniforms, sorted lexically by key

The fixed group layout is:

```wgsl
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> shaderUniforms: ShaderUniforms;
```

In WebGPU, each custom texture occupies two bindings in lexical key order: the
texture followed by its generated sampler. For filters, the first pair is
`@group(1) @binding(1)` and binding 2. For compositors, `uNextTexture` remains
binding 1, so the first custom texture pair is binding 2 and binding 3.

For a filter texture named `noise`, declare and sample it as:

```wgsl
@group(1) @binding(1) var uNoiseTexture: texture_2d<f32>;
@group(1) @binding(2) var uNoiseTextureSampler: sampler;

let noise = textureSample(uNoiseTexture, uNoiseTextureSampler, uv);
```

Use the generated custom sampler rather than group 0's `uSampler`; that sampler
belongs to the filter input and does not carry the custom texture's `wrap` or
`mipmap` settings.

### Minimal WGSL Filter Scaffold

```wgsl
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct ShaderUniforms {
  uProgress: f32,
  uResolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> shaderUniforms: ShaderUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y =
    position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) -
    gfu.uOutputTexture.z;
  let uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  return VSOutput(vec4(position, 0.0, 1.0), uv);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv);
}
```

### Minimal GLSL Filter Fragment

```glsl
precision mediump float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uProgress;
uniform vec2 uResolution;

void main(void)
{
    finalColor = texture(uTexture, vTextureCoord);
}
```

## Mesh And Bounds

`mesh.grid` subdivides the normalized pass geometry. `[1, 1]` is one quad.
Higher values allow custom vertex shaders to deform geometry, for example a
page curl.

Mesh deformation does not change semantic layout, hit testing, or z-order.
Use `padding` when output must extend beyond the original bounds. Transition
overlay bounds include compositor padding.

`clipToViewport: false` allows the filter output to exceed the viewport, while
the owning render target and filter area still impose their normal limits.

## Alpha And Final Handoff

Shader output follows the Route Graphics premultiplied-alpha contract. When
constructing a color from unpremultiplied values, return:

```txt
vec4(rgb * alpha, alpha)
```

The final transition compositor frame is presented before the live next target
is revealed. At the last `uProgress` value, compositor output should therefore
visually converge on `uNextTexture` to avoid a handoff jump.

## Runtime Reuse And Cleanup

Changing only top-level parameter values updates existing uniform groups in
place. It does not rebuild the filter chain. Changes to source, pass structure,
static uniforms, textures, pipeline, mesh, or pass options rebuild the affected
effect.

Compiled GLSL and WGSL programs are reused by the renderer's source-based
program caches. Per-effect filter instances remain separate so parameters can
animate independently.

Owned filters, cloned texture sources, and mesh geometry are destroyed with the
display object or transition overlay.

The subdivided mesh path integrates with Pixi's filter geometry internals
behind one versioned internal adapter. `pixi.js` is therefore pinned to the
adapter's tested version instead of accepting automatic minor upgrades.
Architecture tests reject a version mismatch and reject private FilterSystem
access anywhere else in production code. An intentional Pixi upgrade changes
that adapter and its tests, not the authored shader ABI. Standard `[1, 1]`
filter geometry does not use this internal path.

## Validation And Diagnostics

Normalization rejects:

- missing WebGL or WebGPU source
- WGSL without `mainVertex` and `mainFragment`
- unknown effect, pass, source, pipeline, mesh, texture, or typed-value keys
- duplicate filter ids or pass ids
- invalid parameter/texture keys
- generated symbol collisions
- reserved ABI symbols
- incompatible animation value shapes
- unknown renderer preferences and invalid pass options
- more than seven filter or six compositor custom textures per pass
- simultaneous writers for one shader animation channel

Animation dispatch reports the animation id, filter id, element id, and unknown
parameter when a target cannot be resolved.

`parse(...)` performs configuration and shader-animation binding validation.
`render(...)` performs the same validation, then preflights shader programs
before mutating the display tree. A rejected configuration or synchronous
compiler failure leaves the last good scene and logical state in place.

WebGL source is compiled and linked against the active WebGL context during
preflight. Failures use a `RouteGraphicsShaderError` with a stable
`ROUTE_GRAPHICS_SHADER_INVALID` code and diagnostic details for backend, phase,
owner, effect, pass, source path, and shader stage.

WebGPU layout extraction and shader-module creation are also preflighted.
However, the WebGPU platform exposes final compiler diagnostics
asynchronously. Errors detectable during synchronous preparation use the same
Route Graphics diagnostic; final driver diagnostics can still arrive through
the browser's WebGPU error reporting after `render(...)` returns.

Successful program preflights are cached per renderer context and source, so an
unchanged shader is not compiled twice merely for validation.

Reserved symbols include `uTexture`, `uPrevTexture`, `uNextTexture`,
`uNextTextureMatrix`, `uNextTextureClamp`, `uMaskTexture`, `uProgress`,
`uTime`, `uResolution`, `uSampler`, and the documented WGSL ABI names.
Generated custom sampler symbols also participate in collision validation.

## Deliberate Boundaries

- Effect source is inline; named registries and source file references are not
  runtime concepts.
- Multi-pass effects are linear chains, not arbitrary DAGs or feedback graphs.
- A transition owns one compositor object, but that object may contain many
  passes.
- Both WebGL and WebGPU source variants are required.
- Shader mesh deformation is visual and does not alter semantic hit bounds.
- The focused `input` DOM editor overlay is outside the GPU filter pipeline.
