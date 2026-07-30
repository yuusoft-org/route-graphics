---
template: docs-documentation
title: Shaders
tags: documentation
sidebarId: guide-shaders
---

Route Graphics has a fully inline shader-effects interface:

- `elements[].filters[]` post-processes a visual element.
- `animations[].compositor` combines previous and next transition surfaces.

An effect can be a single pass or an ordered multi-pass chain. It can expose
independently animated scalar, vector, and matrix parameters, use custom
textures, opt into deterministic time, and run on WebGL or WebGPU.

There is no root effects registry. Shader source and configuration stay next to
their owner, while unchanged compiled programs are still reused internally.

## Backend Selection

Every pass supplies both GLSL and WGSL. Choose the preferred renderer during
initialization:

```js
await graphics.init({
  // other options
  rendererPreference: "webgpu",
  rendererFallback: true,
});

console.log(graphics.rendererType); // "webgpu" or fallback "webgl"
```

The defaults are `rendererPreference: "webgl"` and
`rendererFallback: true`. Set fallback to `false` when using a different
backend would be an error.

## Supported Elements

`filters` works on every built-in visual element:

- `rect`, `text`, `container`
- `sprite`, `spritesheet-animation`, `video`
- `input`, `slider`, `text-revealing`, `particles`

Multiple effects execute in array order. Passes inside an effect also execute
in array order:

```txt
element rendering
-> built-in effects
-> filters[0].passes[0]
-> filters[0].passes[1]
-> filters[1]
-> final output
```

For `input`, the Pixi element is filtered. The HTML editor temporarily shown
while the input is focused is a DOM overlay and is not shader-filtered.

## Single-Pass Filter

```yaml
elements:
  - id: portrait
    type: sprite
    src: portrait
    x: 80
    y: 40
    width: 480
    height: 640
    filters:
      - id: grade
        type: shader
        parameters:
          amount: 0.35
          tint: [0.3, 0.8, 1]
        textures:
          noise:
            src: film-noise
            wrap: repeat
            mipmap: true
        time: true
        padding: 8
        pipeline:
          blend: normal
          textureWrap: clamp
          mipmap: false
        source:
          webgl:
            fragment: |
              precision mediump float;

              in vec2 vTextureCoord;
              out vec4 finalColor;

              uniform sampler2D uTexture;
              uniform float uProgress;
              uniform float uTime;
              uniform vec2 uResolution;
              uniform float uAmount;
              uniform vec3 uTint;

              void main(void)
              {
                  vec4 color = texture(uTexture, vTextureCoord);
                  vec3 shifted = mix(color.rgb, color.rgb * uTint, uAmount);
                  finalColor = vec4(shifted, color.a);
              }
          webgpu:
            source: |
              // Full WGSL source with mainVertex and mainFragment.
```

Each filter `id` must be unique within its element.

## Multi-Pass Filter

Use `passes` instead of `source`:

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
      - id: horizontal
        uniforms:
          direction: [1, 0]
        source:
          webgl:
            fragment: |
              # GLSL horizontal blur
          webgpu:
            source: |
              # WGSL horizontal blur
      - id: vertical
        uniforms:
          direction: [0, 1]
        source:
          webgl:
            fragment: |
              # GLSL vertical blur
          webgpu:
            source: |
              # WGSL vertical blur
      - id: combine
        pipeline:
          blend: add
        source:
          webgl:
            fragment: |
              # GLSL combine
          webgpu:
            source: |
              # WGSL combine
```

The first pass reads the element surface through `uTexture`; every later pass
reads the previous pass output. This is a linear chain, not an arbitrary render
graph.

Top-level values are inherited by each pass. A pass may override `pipeline`,
`mesh`, `padding`, `resolution`, `antialias`, `clipToViewport`, and `time`.
It may add pass-local static `uniforms` and `textures`.

Use top-level `parameters` for values you plan to animate. Use pass-local
`uniforms` for fixed values such as the blur direction.

## Effect Fields

| Field                  | Default              | Notes                                                |
| ---------------------- | -------------------- | ---------------------------------------------------- |
| `id`                   | required for filters | Optional on a compositor                             |
| `type`                 | required             | Must be `shader`                                     |
| `parameters`           | `{}`                 | Shared mutable/animatable values                     |
| `uniforms`             | `{}`                 | Backward-compatible alias for `parameters`           |
| `textures`             | `{}`                 | Shared custom textures                               |
| `source`               | -                    | Single-pass source; exclusive with `passes`          |
| `passes`               | -                    | Non-empty ordered pass list; exclusive with `source` |
| `pipeline.blend`       | `normal`             | `normal`, `add`, `multiply`, `screen`                |
| `pipeline.textureWrap` | `clamp`              | `clamp` or `repeat`                                  |
| `pipeline.mipmap`      | `false`              | Default custom-texture mipmapping                    |
| `mesh.grid`            | `[1, 1]`             | `[columns, rows]`, each 1 through 512                |
| `padding`              | `0`                  | Extra output extent in pixels                        |
| `resolution`           | `1`                  | Positive scale or `inherit`                          |
| `antialias`            | `off`                | `on`, `off`, `inherit`, or boolean                   |
| `clipToViewport`       | `true`               | Viewport clipping                                    |
| `time`                 | `false`              | Include deterministic `uTime`                        |

## Parameters

Names use lower camel case and become shader symbols by adding `u` and
capitalizing the first letter:

```txt
amount      -> uAmount
edgeWidth   -> uEdgeWidth
colorMatrix -> uColorMatrix
```

Supported values:

| YAML value      | GLSL / WGSL type       |
| --------------- | ---------------------- |
| number          | `float` / `f32`        |
| 2-number array  | `vec2` / `vec2<f32>`   |
| 3-number array  | `vec3` / `vec3<f32>`   |
| 4-number array  | `vec4` / `vec4<f32>`   |
| 9-number array  | `mat3` / `mat3x3<f32>` |
| 16-number array | `mat4` / `mat4x4<f32>` |

You can state the type explicitly:

```yaml
parameters:
  exposure:
    type: f32
    value: 1.2
  tint:
    type: vec3
    value: [1, 0.8, 0.5]
```

Accepted type names are `f32`, `vec2`, `vec2<f32>`, `vec3`, `vec3<f32>`,
`vec4`, `vec4<f32>`, `mat3`, `mat3x3<f32>`, `mat4`, and `mat4x4<f32>`.

Do not define both `parameters` and legacy `uniforms` on one effect.

## Animating A Filter Parameter

Target one filter by id:

```yaml
animations:
  - id: portrait-glow
    targetId: portrait
    type: update
    playback:
      continuity: persistent
      loop: true
    tween:
      filters:
        grade:
          amount:
            keyframes:
              - duration: 500
                value: 1
                easing: easeInOutSine
              - duration: 500
                value: 0.2
                easing: easeInOutSine
          tint:
            keyframes:
              - duration: 1000
                value: [0.4, 0.7, 1]
                easing: linear
```

An update animation may combine ordinary properties and any number of filter
ids in one `tween`. Arrays interpolate component by component. Missing initial
values come from the filter's current parameters. Only one active animation
may write a particular target/filter/parameter channel.

Use `progress` to animate one filter's built-in `uProgress`:

```yaml
tween:
  filters:
    grade:
      progress:
        initialValue: 0
        keyframes:
          - duration: 300
            value: 1
```

## Transition Compositors

A compositor is the same inline effect shape, but receives two captured
surfaces:

```yaml
animations:
  - id: burn
    targetId: scene
    type: transition
    mask:
      kind: single
      texture: paper-mask
    compositor:
      type: shader
      parameters:
        edgeWidth: 0.04
      passes:
        - id: burnEdge
          source:
            webgl:
              fragment: |
                # GLSL
            webgpu:
              source: |
                # WGSL
        - id: grade
          source:
            webgl:
              fragment: |
                # GLSL
            webgpu:
              source: |
                # WGSL
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

`compositor.tween.progress` is required and maps to `uProgress`. Other tracks
target declared compositor parameters and infer their initial values from
`compositor.parameters`.

Masks and compositors can be combined. The mask executes first, followed by the
custom compositor passes. Every custom pass still receives the captured next
surface as `uNextTexture`.

## Built-In Inputs

Every pass receives:

| Input         | Meaning                                       |
| ------------- | --------------------------------------------- |
| `uTexture`    | Original input or previous pass output        |
| `uProgress`   | Filter or transition progress                 |
| `uResolution` | Pass size in logical pixels                   |
| `uTime`       | Deterministic seconds, only with `time: true` |

Compositor passes additionally receive:

| Input                | Meaning                                     |
| -------------------- | ------------------------------------------- |
| `uNextTexture`       | Captured next surface                       |
| `uNextTextureMatrix` | Maps the primary UV into next-texture space |
| `uNextTextureClamp`  | Safe next-texture sampling bounds           |

Always transform and clamp before sampling `uNextTexture`; previous and next
surfaces can have different bounds and transforms.

## Deterministic Time

`time: true` adds `uTime`, in seconds. Automatic playback advances it from the
renderer ticker. Manual `setAnimationTime(timeMS)` sets animation sampling and
shader time together, so offline frames and screenshots are repeatable.

`uTime` is read-only. Animate a custom parameter for an authored timeline.

Time is opt-in to preserve the WGSL uniform layout of existing shaders.

## Custom Textures

Texture names map to symbols ending in `Texture`:

```txt
noise           -> uNoiseTexture
displacementMap -> uDisplacementMapTexture
```

Use an asset alias/URL directly or override sampling:

```yaml
textures:
  noise:
    src: film-noise
    wrap: repeat
    mipmap: true
```

Per-texture values override pipeline defaults. A filter pass supports up to
seven shared plus local custom textures; a compositor pass supports six.

## WebGL Contract

`source.webgl.fragment` is required. `source.webgl.vertex` is optional. When it
is omitted, Route Graphics provides the standard Pixi filter vertex shader and
the fragment shader can consume `vTextureCoord`:

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

Custom mesh deformation requires a custom vertex shader accepting
`in vec2 aPosition`.

## WebGPU Contract

WGSL must define `mainVertex` and `mainFragment` and use Pixi's filter groups:

```wgsl
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> shaderUniforms: ShaderUniforms;
```

Declare `ShaderUniforms` fields in this exact order:

1. `uProgress: f32`
2. optional `uTime: f32` when `time: true`
3. `uResolution: vec2<f32>`
4. compositor-only `uNextTextureMatrix: mat3x3<f32>`
5. compositor-only `uNextTextureClamp: vec4<f32>`
6. parameters and pass-local uniforms sorted by their authored key

Filter custom textures start at `@group(1) @binding(1)` in lexical key order.
For compositors, `uNextTexture` uses binding 1, so custom textures start at
binding 2.

## Mesh, Bounds, And Alpha

`mesh.grid: [1, 1]` is one quad. Subdivision enables vertex deformation but
does not change layout or semantic hit-test bounds.

Use `padding` for effects that draw outside the source bounds. Transition
overlays include compositor padding.

Pixi expects premultiplied alpha. When constructing color from unpremultiplied
values, return `vec4(rgb * alpha, alpha)`.

The last compositor frame is shown before Route Graphics reveals the live next
target. Make the final shader result converge on `uNextTexture` to avoid a
visible handoff jump.

## Reuse And Limits

Changing only parameter values updates existing effects in place. Source,
passes, static uniforms, textures, pipeline, mesh, or pass-option changes
rebuild the effect. Pixi caches compiled programs by source.

The intentional boundaries are:

- source is inline; there is no root registry or source-file reference
- pass chains are linear, without arbitrary graph edges or feedback
- one compositor object is allowed per transition, with any number of passes
- both WebGL and WebGPU source are required
- the focused input DOM overlay is outside the GPU filter pipeline

See [Animation Node](/docs/nodes/tween/) for the full animation and transition
model.
