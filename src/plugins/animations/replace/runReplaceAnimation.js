import {
  AnimatedSprite,
  Container,
  Filter,
  Matrix,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import {
  buildTimeline,
  calculateMaxDuration,
  getValueAtTime,
} from "../../../util/animationTimeline.js";
import {
  clearDeferredMountOperations,
  createRenderContext,
  flushDeferredMountOperations,
} from "../../elements/renderContext.js";
import {
  setElementHitTestBounds,
  setElementRenderState,
} from "../../elements/elementRenderState.js";
import { cleanupParticlesInTree } from "../../elements/particles/particleRuntime.js";
import { getAnimationContinuitySignature } from "../planAnimations.js";
import { degreesToRadians } from "../../elements/util/transform.js";
import {
  createShaderEffect,
  destroyShaderEffect,
  getShaderEffectParameter,
  setShaderEffectParameter,
  setShaderEffectProgress,
  setShaderEffectResolution,
  setShaderEffectTime,
  setShaderTimeInTree,
  validateShaderEffectParameterValue,
} from "../../elements/util/shaderFilterEffect.js";
const DEFAULT_SUBJECT_VALUES = {
  translateX: 0,
  translateY: 0,
  alpha: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const sampleMaskReveal = ({ progress, maskValue, softness } = {}) => {
  const revealThreshold = 1 - clamp01(maskValue);
  const lowerEdge = clamp01(revealThreshold - softness);
  const upperEdge = clamp01(revealThreshold + softness);

  return smoothstep(lowerEdge, upperEdge, clamp01(progress));
};

const getLocalBoundsRectangle = (displayObject) =>
  displayObject.getLocalBounds().rectangle.clone();

const normalizeFrame = (frame) => {
  frame.width = Math.max(1, Math.ceil(frame.width));
  frame.height = Math.max(1, Math.ceil(frame.height));
  return frame;
};

const generateLocalSnapshotTexture = ({ app, displayObject, frame }) => {
  const original = {
    x: displayObject.x ?? 0,
    y: displayObject.y ?? 0,
    scaleX: displayObject.scale?.x ?? 1,
    scaleY: displayObject.scale?.y ?? 1,
    rotation: displayObject.rotation ?? 0,
    alpha: displayObject.alpha ?? 1,
    skewX: displayObject.skew?.x ?? 0,
    skewY: displayObject.skew?.y ?? 0,
  };

  try {
    displayObject.x = 0;
    displayObject.y = 0;
    displayObject.scale?.set?.(1, 1);
    displayObject.rotation = 0;
    displayObject.alpha = 1;
    displayObject.skew?.set?.(0, 0);
    displayObject.updateLocalTransform?.();

    return app.renderer.generateTexture({
      target: displayObject,
      frame,
    });
  } finally {
    displayObject.x = original.x;
    displayObject.y = original.y;
    displayObject.scale?.set?.(original.scaleX, original.scaleY);
    displayObject.rotation = original.rotation;
    displayObject.alpha = original.alpha;
    displayObject.skew?.set?.(original.skewX, original.skewY);
    displayObject.updateLocalTransform?.();
  }
};

const createSnapshotSubject = (app, displayObject) => {
  const frame = normalizeFrame(getLocalBoundsRectangle(displayObject));
  const canReuseSpriteTexture =
    displayObject instanceof Sprite &&
    (displayObject.filters?.length ?? 0) === 0;
  const texture = canReuseSpriteTexture
    ? displayObject.texture
    : generateLocalSnapshotTexture({
        app,
        displayObject,
        frame,
      });

  const sprite = new Sprite(texture);
  if (canReuseSpriteTexture) {
    sprite.tint = displayObject.tint;
    sprite.blendMode = displayObject.blendMode;
  }
  sprite.x = frame.x - (displayObject.pivot?.x ?? 0);
  sprite.y = frame.y - (displayObject.pivot?.y ?? 0);

  const wrapper = new Container();
  wrapper.x = displayObject.x ?? 0;
  wrapper.y = displayObject.y ?? 0;
  wrapper.scale.set(displayObject.scale?.x ?? 1, displayObject.scale?.y ?? 1);
  wrapper.rotation = displayObject.rotation ?? 0;
  wrapper.skew?.set?.(displayObject.skew?.x ?? 0, displayObject.skew?.y ?? 0);
  wrapper.alpha = displayObject.alpha ?? 1;
  wrapper.addChild(sprite);

  return {
    wrapper,
    texture,
    ownsTexture: !canReuseSpriteTexture,
    width: frame.width * Math.abs(wrapper.scale.x),
    height: frame.height * Math.abs(wrapper.scale.y),
  };
};

const createLiveSubject = (displayObject) => {
  const frame = normalizeFrame(getLocalBoundsRectangle(displayObject));

  return {
    wrapper: displayObject,
    live: true,
    width: frame.width * Math.abs(displayObject.scale?.x ?? 1),
    height: frame.height * Math.abs(displayObject.scale?.y ?? 1),
  };
};

const hasAnimatedSpriteInTree = (displayObject) => {
  if (!displayObject || displayObject.destroyed) {
    return false;
  }

  if (displayObject instanceof AnimatedSprite) {
    return true;
  }

  return (
    displayObject.children?.some((child) => hasAnimatedSpriteInTree(child)) ??
    false
  );
};

const isLiveSubject = (subject) => subject?.live === true;

const getSubjectDefaultValue = (property, base) => {
  switch (property) {
    case "x":
      return base.x;
    case "y":
      return base.y;
    default:
      return DEFAULT_SUBJECT_VALUES[property] ?? 0;
  }
};

const buildSubjectTimelines = (tween = {}, base) =>
  Object.entries(tween).map(([property, config]) => ({
    property,
    timeline: buildTimeline([
      {
        value: config.initialValue ?? getSubjectDefaultValue(property, base),
      },
      ...config.keyframes,
    ]),
  }));

const createSubjectController = (subject, tween) => {
  if (!subject?.wrapper || !tween) {
    return {
      duration: 0,
      timelines: [],
      apply: () => {},
    };
  }

  const wrapper = subject.wrapper;
  const base = {
    x: wrapper.x,
    y: wrapper.y,
    alpha: wrapper.alpha,
    scaleX: wrapper.scale.x,
    scaleY: wrapper.scale.y,
    rotation: wrapper.rotation,
    width: subject.width,
    height: subject.height,
  };
  const timelines = buildSubjectTimelines(tween, base);

  return {
    duration: calculateMaxDuration(timelines),
    timelines,
    apply: (time) => {
      wrapper.x = base.x;
      wrapper.y = base.y;
      wrapper.alpha = base.alpha;
      wrapper.scale.x = base.scaleX;
      wrapper.scale.y = base.scaleY;
      wrapper.rotation = base.rotation;

      for (const { property, timeline } of timelines) {
        const value = getValueAtTime(timeline, time);

        switch (property) {
          case "x":
            wrapper.x = value;
            break;
          case "y":
            wrapper.y = value;
            break;
          case "translateX":
            wrapper.x = base.x + value * base.width;
            break;
          case "translateY":
            wrapper.y = base.y + value * base.height;
            break;
          case "alpha":
            wrapper.alpha = base.alpha * value;
            break;
          case "scaleX":
            wrapper.scale.x = base.scaleX * value;
            break;
          case "scaleY":
            wrapper.scale.y = base.scaleY * value;
            break;
          case "rotation":
            wrapper.rotation = base.rotation + degreesToRadians(value);
            break;
        }
      }
    },
  };
};

const collectControllerSampleTimes = (controllers) => {
  const sampleTimes = new Set([0]);

  for (const controller of controllers) {
    sampleTimes.add(controller.duration);

    for (const { timeline } of controller.timelines ?? []) {
      for (let index = 0; index < timeline.length; index++) {
        const currentTime = timeline[index].time;
        sampleTimes.add(currentTime);

        if (index === 0) {
          continue;
        }

        const previousTime = timeline[index - 1].time;
        const span = currentTime - previousTime;
        if (span <= 0) {
          continue;
        }

        sampleTimes.add(previousTime + span * 0.25);
        sampleTimes.add(previousTime + span * 0.5);
        sampleTimes.add(previousTime + span * 0.75);
      }
    }
  }

  return [...sampleTimes].sort((a, b) => a - b);
};

const unionRectangles = (rectangles) => {
  if (rectangles.length === 0) {
    return new Rectangle(0, 0, 1, 1);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rectangle of rectangles) {
    minX = Math.min(minX, rectangle.x);
    minY = Math.min(minY, rectangle.y);
    maxX = Math.max(maxX, rectangle.x + rectangle.width);
    maxY = Math.max(maxY, rectangle.y + rectangle.height);
  }

  return new Rectangle(minX, minY, maxX - minX, maxY - minY);
};

const createMaskProgressTimeline = (mask) =>
  buildTimeline([
    {
      value: mask?.progress?.initialValue ?? 0,
    },
    ...(mask?.progress?.keyframes ?? []),
  ]);

const createCompositorProgressTimeline = (animation) =>
  buildTimeline([
    {
      value: animation.compositor?.tween?.uProgress?.initialValue ?? 0,
    },
    ...(animation.compositor?.tween?.uProgress?.keyframes ?? []),
  ]);

const REPLACE_MASK_FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vSecondaryCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform mat3 uSecondaryMatrix;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vSecondaryCoord = (uSecondaryMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`;

const REPLACE_MASK_FILTER_FRAGMENT = `
in vec2 vTextureCoord;
in vec2 vSecondaryCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uNextTexture;
uniform sampler2D uMaskTextureA;
uniform sampler2D uMaskTextureB;
uniform float uProgress;
uniform float uSoftness;
uniform float uMaskMix;
uniform float uMaskInvert;
uniform float uMaskDirectReveal;
uniform vec4 uMaskChannelWeights;
uniform vec4 uSecondaryClamp;

float sampleMaskValue(vec2 secondaryUv)
{
    vec2 clampedUv = clamp(secondaryUv, uSecondaryClamp.xy, uSecondaryClamp.zw);
    vec4 rawMaskA = texture(uMaskTextureA, clampedUv);
    vec4 rawMaskB = texture(uMaskTextureB, clampedUv);
    float maskA = dot(rawMaskA, uMaskChannelWeights);
    float maskB = dot(rawMaskB, uMaskChannelWeights);
    float maskValue = mix(maskA, maskB, clamp(uMaskMix, 0.0, 1.0));

    return mix(maskValue, 1.0 - maskValue, clamp(uMaskInvert, 0.0, 1.0));
}

float sampleReveal(float maskValue)
{
    float progress = clamp(uProgress, 0.0, 1.0);
    float revealThreshold = 1.0 - clamp(maskValue, 0.0, 1.0);
    float lowerEdge = clamp(revealThreshold - uSoftness, 0.0, 1.0);
    float upperEdge = clamp(revealThreshold + uSoftness, 0.0, 1.0);

    if (lowerEdge == upperEdge) {
        return progress < lowerEdge ? 0.0 : 1.0;
    }

    float t = clamp((progress - lowerEdge) / (upperEdge - lowerEdge), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

void main()
{
    vec2 uv = clamp(vTextureCoord, vec2(0.0), vec2(1.0));
    vec2 secondaryUv = clamp(vSecondaryCoord, uSecondaryClamp.xy, uSecondaryClamp.zw);
    vec4 prevColor = texture(uTexture, uv);
    vec4 nextColor = texture(uNextTexture, secondaryUv);
    float maskValue = sampleMaskValue(secondaryUv);
    float reveal = mix(
        sampleReveal(maskValue),
        clamp(maskValue, 0.0, 1.0),
        clamp(uMaskDirectReveal, 0.0, 1.0)
    );

    finalColor = mix(prevColor, nextColor, reveal);
}
`;

const REPLACE_MASK_FILTER_WGSL = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct ReplaceMaskUniforms {
  uProgress: f32,
  uSoftness: f32,
  uMaskMix: f32,
  uMaskInvert: f32,
  uMaskDirectReveal: f32,
  uMaskChannelWeights: vec4<f32>,
  uSecondaryMatrix: mat3x3<f32>,
  uSecondaryClamp: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> replaceMaskUniforms: ReplaceMaskUniforms;
@group(1) @binding(1) var uNextTexture: texture_2d<f32>;
@group(1) @binding(2) var uMaskTextureA: texture_2d<f32>;
@group(1) @binding(3) var uMaskTextureB: texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) secondaryUv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32>
{
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32>
{
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

fn sampleMaskValue(uv: vec2<f32>) -> f32
{
  let rawMaskA = textureSample(uMaskTextureA, uSampler, uv);
  let rawMaskB = textureSample(uMaskTextureB, uSampler, uv);
  let maskA = dot(rawMaskA, replaceMaskUniforms.uMaskChannelWeights);
  let maskB = dot(rawMaskB, replaceMaskUniforms.uMaskChannelWeights);
  let maskValue = mix(maskA, maskB, clamp(replaceMaskUniforms.uMaskMix, 0.0, 1.0));

  return mix(maskValue, 1.0 - maskValue, clamp(replaceMaskUniforms.uMaskInvert, 0.0, 1.0));
}

fn sampleReveal(maskValue: f32) -> f32
{
  let progress = clamp(replaceMaskUniforms.uProgress, 0.0, 1.0);
  let revealThreshold = 1.0 - clamp(maskValue, 0.0, 1.0);
  let lowerEdge = clamp(revealThreshold - replaceMaskUniforms.uSoftness, 0.0, 1.0);
  let upperEdge = clamp(revealThreshold + replaceMaskUniforms.uSoftness, 0.0, 1.0);

  if (lowerEdge == upperEdge) {
    if (progress < lowerEdge) {
      return 0.0;
    }

    return 1.0;
  }

  let t = clamp((progress - lowerEdge) / (upperEdge - lowerEdge), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput
{
  return VSOutput(
    filterVertexPosition(aPosition),
    filterTextureCoord(aPosition),
    (replaceMaskUniforms.uSecondaryMatrix * vec3(filterTextureCoord(aPosition), 1.0)).xy,
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) secondaryUv: vec2<f32>,
) -> @location(0) vec4<f32>
{
  let clampedUv = clamp(uv, vec2(0.0), vec2(1.0));
  let clampedSecondaryUv = clamp(
    secondaryUv,
    replaceMaskUniforms.uSecondaryClamp.xy,
    replaceMaskUniforms.uSecondaryClamp.zw,
  );
  let prevColor = textureSample(uTexture, uSampler, clampedUv);
  let nextColor = textureSample(uNextTexture, uSampler, clampedSecondaryUv);
  let maskValue = sampleMaskValue(clampedSecondaryUv);
  let reveal = mix(
    sampleReveal(maskValue),
    clamp(maskValue, 0.0, 1.0),
    clamp(replaceMaskUniforms.uMaskDirectReveal, 0.0, 1.0),
  );

  return mix(prevColor, nextColor, reveal);
}
`;

const MASK_CHANNEL_FILTER_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uMaskInvert;
uniform vec4 uMaskChannelWeights;

void main()
{
    vec4 rawMask = texture(uTexture, clamp(vTextureCoord, vec2(0.0), vec2(1.0)));
    float maskValue = dot(rawMask, uMaskChannelWeights);
    float outputValue = mix(maskValue, 1.0 - maskValue, clamp(uMaskInvert, 0.0, 1.0));

    finalColor = vec4(outputValue, outputValue, outputValue, 1.0);
}
`;

const MASK_CHANNEL_FILTER_WGSL = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct MaskChannelUniforms {
  uMaskInvert: f32,
  uMaskChannelWeights: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> maskChannelUniforms: MaskChannelUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32>
{
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32>
{
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput
{
  return VSOutput(
    filterVertexPosition(aPosition),
    filterTextureCoord(aPosition),
  );
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>
{
  let rawMask = textureSample(uTexture, uSampler, clamp(uv, vec2(0.0), vec2(1.0)));
  let maskValue = dot(rawMask, maskChannelUniforms.uMaskChannelWeights);
  let outputValue = mix(
    maskValue,
    1.0 - maskValue,
    clamp(maskChannelUniforms.uMaskInvert, 0.0, 1.0),
  );

  return vec4(outputValue, outputValue, outputValue, 1.0);
}
`;

const createMaskChannelWeights = (channel = "red") => {
  switch (channel) {
    case "green":
      return new Float32Array([0, 1, 0, 0]);
    case "blue":
      return new Float32Array([0, 0, 1, 0]);
    case "alpha":
      return new Float32Array([0, 0, 0, 1]);
    default:
      return new Float32Array([1, 0, 0, 0]);
  }
};

const OUTPUT_MASK_CHANNEL_WEIGHTS = createMaskChannelWeights("red");
// These render textures are sampled as raw TextureSources in the custom
// replace shader, so they must stay at logical resolution rather than the
// renderer/device resolution.
const createShaderRenderTexture = (width, height) =>
  RenderTexture.create({
    width,
    height,
    resolution: 1,
  });

const createMaskChannelFilter = (channelWeights, invert) => {
  const maskChannelUniforms = new UniformGroup({
    uMaskInvert: {
      value: invert ? 1 : 0,
      type: "f32",
    },
    uMaskChannelWeights: {
      value: channelWeights,
      type: "vec4<f32>",
    },
  });

  const filter = Filter.from({
    gpu: {
      vertex: {
        source: MASK_CHANNEL_FILTER_WGSL,
        entryPoint: "mainVertex",
      },
      fragment: {
        source: MASK_CHANNEL_FILTER_WGSL,
        entryPoint: "mainFragment",
      },
    },
    gl: {
      vertex: REPLACE_MASK_FILTER_VERTEX,
      fragment: MASK_CHANNEL_FILTER_FRAGMENT,
      name: "replace-mask-channel-filter",
    },
    resources: {
      maskChannelUniforms,
    },
  });

  return {
    filter,
    maskChannelUniforms,
  };
};

const renderMaskTextureToRenderTexture = ({
  app,
  texture,
  width,
  height,
  channelWeights,
  invert = false,
}) => {
  const sourceTexture = Texture.from(texture);
  const maskSprite = new Sprite(sourceTexture);
  maskSprite.width = width;
  maskSprite.height = height;
  maskSprite.filterArea = new Rectangle(0, 0, width, height);

  const maskContainer = new Container();
  maskContainer.addChild(maskSprite);

  const maskRenderTexture = createShaderRenderTexture(width, height);
  const { filter: maskChannelFilter } = createMaskChannelFilter(
    channelWeights,
    invert,
  );

  maskSprite.filters = [maskChannelFilter];
  app.renderer.render({
    container: maskContainer,
    target: maskRenderTexture,
    clear: true,
  });

  maskSprite.filters = [];
  maskContainer.destroy({ children: true });
  maskChannelFilter.destroy();

  return maskRenderTexture;
};

const createMaskTextures = (app, mask, width, height) => {
  if (!mask) {
    return {
      textures: [Texture.WHITE.source],
      channelWeights: createMaskChannelWeights("red"),
      invert: 0,
      destroy: () => {},
    };
  }

  if (mask.kind === "single") {
    const renderTexture = renderMaskTextureToRenderTexture({
      app,
      texture: mask.texture,
      width,
      height,
      channelWeights: createMaskChannelWeights(mask.channel ?? "red"),
      invert: mask.invert ?? false,
    });

    return {
      textures: [renderTexture.source],
      channelWeights: OUTPUT_MASK_CHANNEL_WEIGHTS,
      invert: 0,
      destroy: () => {
        renderTexture.destroy(true);
      },
    };
  }

  if (mask.kind === "sequence") {
    const textures = mask.frames.map((frame) =>
      renderMaskTextureToRenderTexture({
        app,
        texture: frame.texture,
        width,
        height,
        channelWeights: createMaskChannelWeights(mask.channel ?? "red"),
        invert: mask.invert ?? false,
      }),
    );

    return {
      textures: textures.map((texture) => texture.source),
      channelWeights: OUTPUT_MASK_CHANNEL_WEIGHTS,
      invert: 0,
      destroy: () => {
        for (const texture of textures) {
          texture.destroy(true);
        }
      },
    };
  }

  throw new Error(`Unsupported replace mask kind: ${mask.kind}.`);
};

const createReplaceMaskFilter = () => {
  const replaceMaskUniforms = new UniformGroup({
    uProgress: {
      value: 0,
      type: "f32",
    },
    uSoftness: {
      value: 0.001,
      type: "f32",
    },
    uMaskMix: {
      value: 0,
      type: "f32",
    },
    uMaskInvert: {
      value: 0,
      type: "f32",
    },
    uMaskDirectReveal: {
      value: 0,
      type: "f32",
    },
    uMaskChannelWeights: {
      value: new Float32Array([1, 0, 0, 0]),
      type: "vec4<f32>",
    },
    uSecondaryMatrix: {
      value: new Matrix(),
      type: "mat3x3<f32>",
    },
    uSecondaryClamp: {
      value: new Float32Array([0, 0, 1, 1]),
      type: "vec4<f32>",
    },
  });
  const filter = Filter.from({
    gpu: {
      vertex: {
        source: REPLACE_MASK_FILTER_WGSL,
        entryPoint: "mainVertex",
      },
      fragment: {
        source: REPLACE_MASK_FILTER_WGSL,
        entryPoint: "mainFragment",
      },
    },
    gl: {
      vertex: REPLACE_MASK_FILTER_VERTEX,
      fragment: REPLACE_MASK_FILTER_FRAGMENT,
      name: "replace-mask-filter",
    },
    resources: {
      replaceMaskUniforms,
      uNextTexture: Texture.EMPTY.source,
      uMaskTextureA: Texture.EMPTY.source,
      uMaskTextureB: Texture.EMPTY.source,
    },
  });

  return {
    filter,
    replaceMaskUniforms,
  };
};

export const selectSequenceMaskFrameState = ({
  progress = 0,
  frames = [],
  sampleMode = "hold",
} = {}) => {
  if (frames.length <= 1) {
    return {
      fromIndex: 0,
      toIndex: 0,
      mix: 0,
    };
  }

  const clampedProgress = clamp01(progress);

  if (sampleMode === "linear") {
    if (clampedProgress <= frames[0].at) {
      return {
        fromIndex: 0,
        toIndex: 0,
        mix: 0,
      };
    }

    const lastIndex = frames.length - 1;
    if (clampedProgress >= frames[lastIndex].at) {
      return {
        fromIndex: lastIndex,
        toIndex: lastIndex,
        mix: 0,
      };
    }

    for (let index = 0; index < frames.length - 1; index++) {
      const currentFrame = frames[index];
      const nextFrame = frames[index + 1];

      if (clampedProgress <= nextFrame.at) {
        const span = nextFrame.at - currentFrame.at;

        return {
          fromIndex: index,
          toIndex: index + 1,
          mix: span === 0 ? 0 : (clampedProgress - currentFrame.at) / span,
        };
      }
    }

    return {
      fromIndex: lastIndex,
      toIndex: lastIndex,
      mix: 0,
    };
  }

  let fromIndex = 0;

  for (let index = 1; index < frames.length; index++) {
    if (clampedProgress < frames[index].at) {
      break;
    }

    fromIndex = index;
  }

  return {
    fromIndex,
    toIndex: fromIndex,
    mix: 0,
  };
};

const createMaskTextureController = (app, mask, width, height, filter) => {
  const progressTimeline = createMaskProgressTimeline(mask);
  const duration = calculateMaxDuration([{ timeline: progressTimeline }]);
  const softness = Math.max(mask?.softness ?? 0.001, 0.0001);
  const { textures, channelWeights, invert, destroy } = createMaskTextures(
    app,
    mask,
    width,
    height,
  );
  const replaceMaskUniforms = filter.resources.replaceMaskUniforms;
  let lastFromIndex = -1;
  let lastToIndex = -1;

  return {
    duration,
    progressTimeline,
    apply: (progress) => {
      const selection =
        mask?.kind === "sequence"
          ? selectSequenceMaskFrameState({
              progress,
              frames: mask.frames,
              sampleMode: mask.sample ?? "hold",
            })
          : {
              fromIndex: 0,
              toIndex: 0,
              mix: 0,
            };

      if (selection.fromIndex !== lastFromIndex) {
        filter.resources.uMaskTextureA =
          textures[selection.fromIndex] ?? Texture.EMPTY.source;
        lastFromIndex = selection.fromIndex;
      }

      if (selection.toIndex !== lastToIndex) {
        filter.resources.uMaskTextureB =
          textures[selection.toIndex] ?? Texture.EMPTY.source;
        lastToIndex = selection.toIndex;
      }

      replaceMaskUniforms.uniforms.uProgress = clamp01(progress);
      replaceMaskUniforms.uniforms.uSoftness = softness;
      replaceMaskUniforms.uniforms.uMaskMix = selection.mix;
      replaceMaskUniforms.uniforms.uMaskInvert = invert;
      replaceMaskUniforms.uniforms.uMaskDirectReveal =
        mask?.kind === "sequence" ? 1 : 0;
      replaceMaskUniforms.uniforms.uMaskChannelWeights = channelWeights;
      replaceMaskUniforms.update();
    },
    destroy,
  };
};

const createFullFrameClamp = (width, height) => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  return new Float32Array([
    0.5 / safeWidth,
    0.5 / safeHeight,
    1 - 0.5 / safeWidth,
    1 - 0.5 / safeHeight,
  ]);
};

const getUnionBounds = (subjects) => {
  const boundsContainer = new Container();

  for (const subject of subjects) {
    if (subject?.wrapper) {
      boundsContainer.addChild(subject.wrapper);
    }
  }

  return normalizeFrame(getLocalBoundsRectangle(boundsContainer));
};

const getAnimatedUnionBounds = (subjects, controllers) => {
  const activeSubjects = subjects.filter((subject) => subject?.wrapper);

  if (activeSubjects.length === 0) {
    return getUnionBounds(subjects);
  }

  const boundsContainer = new Container();
  for (const subject of activeSubjects) {
    boundsContainer.addChild(subject.wrapper);
  }

  const rectangles = [];
  for (const time of collectControllerSampleTimes(controllers)) {
    for (const controller of controllers) {
      controller.apply(time);
    }

    rectangles.push(getLocalBoundsRectangle(boundsContainer));
  }

  for (const controller of controllers) {
    controller.apply(0);
  }

  for (const subject of activeSubjects) {
    if (subject.wrapper.parent === boundsContainer) {
      boundsContainer.removeChild(subject.wrapper);
    }
  }
  boundsContainer.destroy();

  return normalizeFrame(unionRectangles(rectangles));
};

const renderOffscreenContainer = ({ app, container, target, frame }) => {
  app.renderer.render({
    container,
    target,
    clear: true,
    clearColor: [0, 0, 0, 0],
    transform: new Matrix(1, 0, 0, 1, -frame.x, -frame.y),
  });
};

const renderLiveSubjectTexture = ({ app, displayObject, target, frame }) => {
  const original = {
    x: displayObject.x ?? 0,
    y: displayObject.y ?? 0,
    scaleX: displayObject.scale?.x ?? 1,
    scaleY: displayObject.scale?.y ?? 1,
    rotation: displayObject.rotation ?? 0,
    alpha: displayObject.alpha ?? 1,
    skewX: displayObject.skew?.x ?? 0,
    skewY: displayObject.skew?.y ?? 0,
  };

  try {
    displayObject.x = 0;
    displayObject.y = 0;
    displayObject.scale?.set?.(1, 1);
    displayObject.rotation = 0;
    displayObject.alpha = 1;
    displayObject.skew?.set?.(0, 0);
    displayObject.updateLocalTransform?.();

    renderOffscreenContainer({
      app,
      container: displayObject,
      target,
      frame,
    });
  } finally {
    displayObject.x = original.x;
    displayObject.y = original.y;
    displayObject.scale?.set?.(original.scaleX, original.scaleY);
    displayObject.rotation = original.rotation;
    displayObject.alpha = original.alpha;
    displayObject.skew?.set?.(original.skewX, original.skewY);
    displayObject.updateLocalTransform?.();
  }
};

const createPlainOverlaySubject = (app, subject) => {
  if (!isLiveSubject(subject) || !subject?.wrapper) {
    return {
      subject,
      render: () => {},
      destroy: () => {},
    };
  }

  const liveWrapper = subject.wrapper;
  const frame = normalizeFrame(getLocalBoundsRectangle(liveWrapper));
  const texture = createShaderRenderTexture(frame.width, frame.height);
  const sprite = new Sprite(texture);
  sprite.x = frame.x - (liveWrapper.pivot?.x ?? 0);
  sprite.y = frame.y - (liveWrapper.pivot?.y ?? 0);

  const wrapper = new Container();
  wrapper.x = liveWrapper.x ?? 0;
  wrapper.y = liveWrapper.y ?? 0;
  wrapper.scale.set(liveWrapper.scale?.x ?? 1, liveWrapper.scale?.y ?? 1);
  wrapper.rotation = liveWrapper.rotation ?? 0;
  wrapper.skew?.set?.(liveWrapper.skew?.x ?? 0, liveWrapper.skew?.y ?? 0);
  wrapper.alpha = liveWrapper.alpha ?? 1;
  wrapper.addChild(sprite);

  const renderRoot = new Container();
  renderRoot.addChild(liveWrapper);

  return {
    subject: {
      wrapper,
      width: frame.width * Math.abs(wrapper.scale.x),
      height: frame.height * Math.abs(wrapper.scale.y),
    },
    render: () =>
      renderLiveSubjectTexture({
        app,
        displayObject: liveWrapper,
        target: texture,
        frame,
      }),
    destroy: () => {
      if (liveWrapper.parent === renderRoot) {
        renderRoot.removeChild(liveWrapper);
      }
      renderRoot.destroy();
      if (!wrapper.destroyed) {
        wrapper.destroy({ children: true });
      }
      texture.destroy(true);
    },
  };
};

const detachChildFromParent = (child, parent) => {
  if (!child || child.parent !== parent) {
    return;
  }

  parent.removeChild(child);
};

const destroySubjectSnapshot = (subject, app) => {
  if (isLiveSubject(subject)) {
    return;
  }

  if (subject?.wrapper && !subject.wrapper.destroyed) {
    cleanupParticlesInTree({ app, root: subject.wrapper });
    subject.wrapper.destroy({ children: true });
  }

  if (subject?.ownsTexture) {
    subject.texture?.destroy(true);
  }
};

const resolveOverlaySubjects = ({
  prevElement,
  nextElement,
  animation,
  prevSubject,
  nextSubject,
}) => {
  if (!prevSubject || !nextSubject || prevElement?.id !== nextElement?.id) {
    return { prevSubject, nextSubject };
  }

  let overlayPrevSubject = prevSubject;
  let overlayNextSubject = nextSubject;

  if (animation.mask !== undefined || animation.compositor !== undefined) {
    return {
      prevSubject: overlayPrevSubject,
      nextSubject: overlayNextSubject,
    };
  }

  if (animation.prev === undefined) {
    overlayPrevSubject = null;
  }

  if (animation.next === undefined) {
    overlayNextSubject = null;
  }

  return {
    prevSubject: overlayPrevSubject,
    nextSubject: overlayNextSubject,
  };
};

const createPlainOverlay = ({
  app,
  animation,
  prevSubject,
  nextSubject,
  zIndex,
}) => {
  const overlay = new Container();
  overlay.zIndex = zIndex;
  const prevOverlaySubject = createPlainOverlaySubject(app, prevSubject);
  const nextOverlaySubject = createPlainOverlaySubject(app, nextSubject);

  if (prevOverlaySubject.subject?.wrapper) {
    overlay.addChild(prevOverlaySubject.subject.wrapper);
  }

  if (nextOverlaySubject.subject?.wrapper) {
    overlay.addChild(nextOverlaySubject.subject.wrapper);
  }

  const prevController = createSubjectController(
    prevOverlaySubject.subject,
    animation.prev?.tween,
  );
  const nextController = createSubjectController(
    nextOverlaySubject.subject,
    animation.next?.tween,
  );

  return {
    overlay,
    duration: Math.max(prevController.duration, nextController.duration),
    apply: (time) => {
      prevOverlaySubject.render();
      nextOverlaySubject.render();
      prevController.apply(time);
      nextController.apply(time);
    },
    destroy: () => {
      overlay.removeFromParent();
      cleanupParticlesInTree({ app, root: overlay });
      overlay.destroy({ children: true });
      prevOverlaySubject.destroy();
      nextOverlaySubject.destroy();
      destroySubjectSnapshot(prevSubject, app);
      destroySubjectSnapshot(nextSubject, app);
    },
  };
};

const createCompositorOverlay = ({
  app,
  animation,
  prevSubject,
  nextSubject,
  zIndex,
  getShaderTime,
}) => {
  const prevController = createSubjectController(
    prevSubject,
    animation.prev?.tween,
  );
  const nextController = createSubjectController(
    nextSubject,
    animation.next?.tween,
  );
  const progressTimeline = createCompositorProgressTimeline(animation);
  const progressDuration = calculateMaxDuration([
    {
      timeline: progressTimeline,
    },
  ]);
  const unionBounds = getAnimatedUnionBounds(
    [prevSubject, nextSubject],
    [prevController, nextController],
  );
  const prevRoot = new Container();
  const nextRoot = new Container();

  if (prevSubject?.wrapper) {
    prevRoot.addChild(prevSubject.wrapper);
  }

  if (nextSubject?.wrapper) {
    nextRoot.addChild(nextSubject.wrapper);
  }

  const prevTexture = createShaderRenderTexture(
    unionBounds.width,
    unionBounds.height,
  );
  const nextTexture = createShaderRenderTexture(
    unionBounds.width,
    unionBounds.height,
  );

  const overlay = new Container();
  overlay.zIndex = zIndex;

  const sprite = new Sprite(prevTexture);
  sprite.x = unionBounds.x;
  sprite.y = unionBounds.y;
  const compositorPadding = Math.max(
    0,
    ...(animation.compositor.passes ?? [animation.compositor]).map(
      (pass) => pass.padding ?? 0,
    ),
  );
  sprite.filterArea = new Rectangle(
    -compositorPadding,
    -compositorPadding,
    unionBounds.width + compositorPadding * 2,
    unionBounds.height + compositorPadding * 2,
  );
  overlay.addChild(sprite);

  const compositorEffect = createShaderEffect({
    effect: animation.compositor,
    width: unionBounds.width,
    height: unionBounds.height,
    progress: getValueAtTime(progressTimeline, 0),
    time: getShaderTime(),
    nextTextureSource: nextTexture.source,
    name: `route-graphics-transition-compositor-${animation.id}`,
  });
  const nextTextureClamp = createFullFrameClamp(
    unionBounds.width,
    unionBounds.height,
  );
  for (const compositorFilter of compositorEffect.filters) {
    const baseApplyCompositorFilter =
      typeof compositorFilter.apply === "function"
        ? compositorFilter.apply.bind(compositorFilter)
        : (filterManager, input, output, clearMode) => {
            filterManager.applyFilter(
              compositorFilter,
              input,
              output,
              clearMode,
            );
          };
    compositorFilter.apply = (filterManager, input, output, clearMode) => {
      const shaderUniforms = compositorFilter.resources.shaderUniforms;
      if (shaderUniforms?.uniforms?.uNextTextureMatrix) {
        filterManager.calculateSpriteMatrix(
          shaderUniforms.uniforms.uNextTextureMatrix,
          sprite,
        );
        shaderUniforms.uniforms.uNextTextureClamp = nextTextureClamp;
        shaderUniforms.update();
      }
      baseApplyCompositorFilter(filterManager, input, output, clearMode);
    };
  }

  const parameterTimelines = Object.entries(animation.compositor.tween ?? {})
    .filter(([parameter]) => parameter !== "uProgress")
    .map(([parameter, config]) => {
      const currentValue = getShaderEffectParameter(
        compositorEffect,
        parameter,
      );
      if (currentValue === undefined) {
        throw new Error(
          `Transition animation "${animation.id}" cannot target unknown compositor parameter "${parameter}".`,
        );
      }
      const parameterValues = [
        ...(config.initialValue === undefined ? [] : [config.initialValue]),
        ...config.keyframes.map((keyframe) => keyframe.value),
      ];
      for (const value of parameterValues) {
        validateShaderEffectParameterValue(compositorEffect, parameter, value);
      }
      return {
        parameter,
        timeline: buildTimeline([
          { value: config.initialValue ?? currentValue },
          ...config.keyframes,
        ]),
      };
    });
  const parameterDuration = calculateMaxDuration(parameterTimelines);

  let maskFilter = null;
  let maskTextureController = null;
  if (animation.mask) {
    ({ filter: maskFilter } = createReplaceMaskFilter());
    maskFilter.resources.uNextTexture = nextTexture.source;

    const baseApplyMaskFilter =
      typeof maskFilter.apply === "function"
        ? maskFilter.apply.bind(maskFilter)
        : (filterManager, input, output, clearMode) => {
            filterManager.applyFilter(maskFilter, input, output, clearMode);
          };
    maskFilter.apply = (filterManager, input, output, clearMode) => {
      const replaceMaskUniforms = maskFilter.resources.replaceMaskUniforms;
      filterManager.calculateSpriteMatrix(
        replaceMaskUniforms.uniforms.uSecondaryMatrix,
        sprite,
      );
      replaceMaskUniforms.uniforms.uSecondaryClamp = nextTextureClamp;
      replaceMaskUniforms.update();
      baseApplyMaskFilter(filterManager, input, output, clearMode);
    };

    maskTextureController = createMaskTextureController(
      app,
      animation.mask,
      unionBounds.width,
      unionBounds.height,
      maskFilter,
    );
  }

  sprite.filters = [
    ...(maskFilter ? [maskFilter] : []),
    ...compositorEffect.filters,
  ];

  let prevStaticRendered = false;
  let nextStaticRendered = false;

  if (!prevSubject?.wrapper) {
    renderOffscreenContainer({
      app,
      container: prevRoot,
      target: prevTexture,
      frame: unionBounds,
    });
    prevStaticRendered = true;
  }

  if (!nextSubject?.wrapper) {
    renderOffscreenContainer({
      app,
      container: nextRoot,
      target: nextTexture,
      frame: unionBounds,
    });
    nextStaticRendered = true;
  }

  return {
    overlay,
    duration: Math.max(
      prevController.duration,
      nextController.duration,
      progressDuration,
      parameterDuration,
      maskTextureController?.duration ?? 0,
    ),
    apply: (time) => {
      prevController.apply(time);
      nextController.apply(time);

      if (
        prevSubject?.wrapper &&
        (prevController.duration > 0 || !prevStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: prevRoot,
          target: prevTexture,
          frame: unionBounds,
        });
        prevStaticRendered = true;
      }

      if (
        nextSubject?.wrapper &&
        (nextController.duration > 0 || !nextStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: nextRoot,
          target: nextTexture,
          frame: unionBounds,
        });
        nextStaticRendered = true;
      }

      if (maskTextureController) {
        maskTextureController.apply(
          clamp01(getValueAtTime(maskTextureController.progressTimeline, time)),
        );
      }

      setShaderEffectResolution(
        compositorEffect,
        unionBounds.width,
        unionBounds.height,
      );
      setShaderEffectProgress(
        compositorEffect,
        getValueAtTime(progressTimeline, time),
      );
      setShaderEffectTime(compositorEffect, getShaderTime());
      for (const { parameter, timeline } of parameterTimelines) {
        setShaderEffectParameter(
          compositorEffect,
          parameter,
          getValueAtTime(timeline, time),
        );
      }
    },
    destroy: () => {
      overlay.removeFromParent();
      sprite.filters = [];
      maskFilter?.destroy();
      maskTextureController?.destroy();
      destroyShaderEffect(compositorEffect);
      cleanupParticlesInTree({ app, root: overlay });
      cleanupParticlesInTree({ app, root: prevRoot });
      cleanupParticlesInTree({ app, root: nextRoot });
      overlay.destroy({ children: true });
      prevRoot.destroy({ children: true });
      nextRoot.destroy({ children: true });
      prevTexture.destroy(true);
      nextTexture.destroy(true);
      destroySubjectSnapshot(prevSubject, app);
      destroySubjectSnapshot(nextSubject, app);
    },
  };
};

const createMaskedOverlay = ({
  app,
  animation,
  prevSubject,
  nextSubject,
  zIndex,
}) => {
  const prevController = createSubjectController(
    prevSubject,
    animation.prev?.tween,
  );
  const nextController = createSubjectController(
    nextSubject,
    animation.next?.tween,
  );
  const unionBounds = getAnimatedUnionBounds(
    [prevSubject, nextSubject],
    [prevController, nextController],
  );
  const prevRoot = new Container();
  const nextRoot = new Container();

  if (prevSubject?.wrapper) {
    prevRoot.addChild(prevSubject.wrapper);
  }

  if (nextSubject?.wrapper) {
    nextRoot.addChild(nextSubject.wrapper);
  }

  const prevTexture = createShaderRenderTexture(
    unionBounds.width,
    unionBounds.height,
  );
  const nextTexture = createShaderRenderTexture(
    unionBounds.width,
    unionBounds.height,
  );

  const overlay = new Container();
  overlay.zIndex = zIndex;

  const sprite = new Sprite(prevTexture);
  sprite.x = unionBounds.x;
  sprite.y = unionBounds.y;
  sprite.filterArea = new Rectangle(
    0,
    0,
    unionBounds.width,
    unionBounds.height,
  );
  overlay.addChild(sprite);

  const { filter: maskFilter } = createReplaceMaskFilter();
  maskFilter.resources.uNextTexture = nextTexture.source;
  sprite.filters = [maskFilter];
  const secondaryClamp = createFullFrameClamp(
    unionBounds.width,
    unionBounds.height,
  );
  const baseApplyMaskFilter =
    typeof maskFilter.apply === "function"
      ? maskFilter.apply.bind(maskFilter)
      : (filterManager, input, output, clearMode) => {
          filterManager.applyFilter(maskFilter, input, output, clearMode);
        };
  maskFilter.apply = (filterManager, input, output, clearMode) => {
    const replaceMaskUniforms = maskFilter.resources.replaceMaskUniforms;
    filterManager.calculateSpriteMatrix(
      replaceMaskUniforms.uniforms.uSecondaryMatrix,
      sprite,
    );
    replaceMaskUniforms.uniforms.uSecondaryClamp = secondaryClamp;
    replaceMaskUniforms.update();
    baseApplyMaskFilter(filterManager, input, output, clearMode);
  };

  const maskTextureController = createMaskTextureController(
    app,
    animation.mask,
    unionBounds.width,
    unionBounds.height,
    maskFilter,
  );
  let prevStaticRendered = false;
  let nextStaticRendered = false;

  if (!prevSubject?.wrapper) {
    renderOffscreenContainer({
      app,
      container: prevRoot,
      target: prevTexture,
      frame: unionBounds,
    });
  }

  if (!nextSubject?.wrapper) {
    renderOffscreenContainer({
      app,
      container: nextRoot,
      target: nextTexture,
      frame: unionBounds,
    });
  }

  return {
    overlay,
    duration: Math.max(
      prevController.duration,
      nextController.duration,
      maskTextureController.duration,
    ),
    apply: (time) => {
      prevController.apply(time);
      nextController.apply(time);

      if (
        prevSubject?.wrapper &&
        (prevController.duration > 0 || !prevStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: prevRoot,
          target: prevTexture,
          frame: unionBounds,
        });
        prevStaticRendered = true;
      }

      if (
        nextSubject?.wrapper &&
        (nextController.duration > 0 || !nextStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: nextRoot,
          target: nextTexture,
          frame: unionBounds,
        });
        nextStaticRendered = true;
      }

      const progress = clamp01(
        getValueAtTime(maskTextureController.progressTimeline, time),
      );
      maskTextureController.apply(progress);
    },
    destroy: () => {
      overlay.removeFromParent();
      sprite.filters = [];
      maskFilter.destroy();
      cleanupParticlesInTree({ app, root: overlay });
      cleanupParticlesInTree({ app, root: prevRoot });
      cleanupParticlesInTree({ app, root: nextRoot });
      overlay.destroy({ children: true });
      prevRoot.destroy({ children: true });
      nextRoot.destroy({ children: true });
      prevTexture.destroy(true);
      nextTexture.destroy(true);
      destroySubjectSnapshot(prevSubject, app);
      destroySubjectSnapshot(nextSubject, app);
      maskTextureController.destroy();
    },
  };
};

const createReplaceOverlay = ({
  app,
  animation,
  prevSubject,
  nextSubject,
  zIndex,
  getShaderTime,
}) => {
  let replaceOverlay;

  if (animation.compositor) {
    replaceOverlay = createCompositorOverlay({
      app,
      animation,
      prevSubject,
      nextSubject,
      zIndex,
      getShaderTime,
    });
  } else if (animation.mask) {
    replaceOverlay = createMaskedOverlay({
      app,
      animation,
      prevSubject,
      nextSubject,
      zIndex,
    });
  } else {
    replaceOverlay = createPlainOverlay({
      app,
      animation,
      prevSubject,
      nextSubject,
      zIndex,
    });
  }

  return {
    ...replaceOverlay,
    prevSubject,
    nextSubject,
  };
};

const instantiateNextLiveElement = ({
  app,
  parent,
  nextElement,
  plugin,
  animations,
  eventHandler,
  animationBus,
  completionTracker,
  elementPlugins,
  renderContext,
  zIndex,
  signal,
  shaderTime,
  getShaderTime,
}) => {
  if (!nextElement) {
    return null;
  }

  const result = plugin.add({
    app,
    parent,
    element: nextElement,
    animations,
    eventHandler,
    animationBus,
    completionTracker,
    elementPlugins,
    renderContext,
    zIndex,
    signal,
    shaderTime,
    getShaderTime,
  });

  if (result && typeof result.then === "function") {
    return result.then(() => {
      if (signal?.aborted || parent.destroyed) {
        return null;
      }

      const nextDisplayObject =
        parent.children.find((child) => child.label === nextElement.id) ?? null;
      if (nextDisplayObject) {
        setElementRenderState(nextDisplayObject, nextElement);
      }
      return nextDisplayObject;
    });
  }

  if (signal?.aborted || parent.destroyed) {
    return null;
  }

  const nextDisplayObject =
    parent.children.find((child) => child.label === nextElement.id) ?? null;
  if (nextDisplayObject) {
    setElementRenderState(nextDisplayObject, nextElement);
  }
  return nextDisplayObject;
};

const resolveNextDisplayObject = async (nextDisplayObjectOrPromise) => {
  if (
    nextDisplayObjectOrPromise &&
    typeof nextDisplayObjectOrPromise.then === "function"
  ) {
    return nextDisplayObjectOrPromise;
  }

  return nextDisplayObjectOrPromise ?? null;
};

export const runReplaceAnimation = ({
  app,
  parent,
  prevElement,
  nextElement,
  animation,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  elementPlugins,
  renderContext,
  plugin,
  prevPlugin = plugin,
  nextPlugin = plugin,
  resolveParent,
  zIndex,
  signal,
  shaderTime = 0,
  getShaderTime,
}) => {
  if (!prevElement && !nextElement) {
    throw new Error(
      `Replace animation "${animation.id}" must receive prevElement and/or nextElement.`,
    );
  }

  if (signal?.aborted || parent.destroyed) {
    return;
  }

  const prevDisplayObject = prevElement
    ? (parent.children.find((child) => child.label === prevElement.id) ?? null)
    : null;

  if (prevElement && !prevDisplayObject) {
    throw new Error(
      `Transition animation "${animation.id}" could not find the previous element "${prevElement.id}".`,
    );
  }

  const isPersistent = animation.playback?.continuity === "persistent";
  const continuitySignature = getAnimationContinuitySignature(animation);
  const transitionSignalController = isPersistent
    ? new AbortController()
    : null;
  const transitionSignal = transitionSignalController?.signal ?? signal;
  const getCurrentParent = () => {
    if (typeof resolveParent === "function") {
      const resolvedParent = resolveParent();
      return resolvedParent && !resolvedParent.destroyed
        ? resolvedParent
        : null;
    }

    return parent.destroyed ? null : parent;
  };
  const resolveShaderTime = () =>
    typeof getShaderTime === "function" ? getShaderTime() : shaderTime;

  const transitionMountParent = new Container();
  const hiddenMountContext = createRenderContext({
    suppressAnimations: true,
  });
  const trackCompletion = !isPersistent;
  const stateVersion = trackCompletion ? completionTracker.getVersion() : null;
  let completionTracked = false;
  let currentZIndex = zIndex;

  const trackTransition = () => {
    if (!trackCompletion || completionTracked) {
      return;
    }

    completionTracker.track(stateVersion);
    completionTracked = true;
  };

  const completeTransition = () => {
    if (!completionTracked) {
      return;
    }

    completionTracker.complete(stateVersion);
    completionTracked = false;
  };
  const nextDisplayObjectRef = { value: null };
  const replaceOverlayRef = { value: null };
  let finalizationStarted = false;
  let finalizationOperation;
  let previousLiveDeleted = false;
  const cleanupPendingTransition = () => {
    if (typeof animationBus?.removePending === "function") {
      animationBus.removePending(animation.id);
    }
  };
  const handleContinuationUpdate = ({ zIndex: nextZIndex } = {}) => {
    if (typeof nextZIndex !== "number") {
      return;
    }

    currentZIndex = nextZIndex;

    if (nextDisplayObjectRef.value && !nextDisplayObjectRef.value.destroyed) {
      nextDisplayObjectRef.value.zIndex = currentZIndex;
    }

    if (
      replaceOverlayRef.value?.overlay &&
      !replaceOverlayRef.value.overlay.destroyed
    ) {
      replaceOverlayRef.value.overlay.zIndex = currentZIndex;
    }
  };

  const deletePreviousLiveElement = () => {
    const prevSubject = replaceOverlayRef.value?.prevSubject;
    if (
      previousLiveDeleted ||
      !isLiveSubject(prevSubject) ||
      !prevElement ||
      !prevDisplayObject ||
      prevDisplayObject.destroyed
    ) {
      return undefined;
    }

    previousLiveDeleted = true;
    return prevPlugin.delete({
      app,
      parent: prevDisplayObject.parent ?? replaceOverlayRef.value.overlay,
      element: prevElement,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler,
      elementPlugins,
      renderContext,
      signal: transitionSignal,
    });
  };

  const presentNextDisplayObject = () => {
    const currentParent = getCurrentParent();
    if (nextDisplayObjectRef.value && !nextDisplayObjectRef.value.destroyed) {
      nextDisplayObjectRef.value.zIndex = currentZIndex;
      if (
        currentParent &&
        nextDisplayObjectRef.value.parent !== currentParent
      ) {
        nextDisplayObjectRef.value.parent?.removeChild?.(
          nextDisplayObjectRef.value,
        );
        currentParent.addChild(nextDisplayObjectRef.value);
      } else if (!currentParent) {
        nextDisplayObjectRef.value.removeFromParent?.();
        cleanupParticlesInTree({ app, root: nextDisplayObjectRef.value });
        nextDisplayObjectRef.value.destroy({ children: true });
      }
      if (currentParent) {
        nextDisplayObjectRef.value.visible = true;
      }
    }
  };

  const releaseTransitionResources = ({ flushDeferredEffects }) => {
    replaceOverlayRef.value?.destroy();

    if (flushDeferredEffects) {
      flushDeferredMountOperations(hiddenMountContext);
      return;
    }

    clearDeferredMountOperations(hiddenMountContext);
  };

  const finalize = ({ flushDeferredEffects }) => {
    if (finalizationStarted) return finalizationOperation;
    finalizationStarted = true;

    let deleteOperation;
    try {
      deleteOperation = deletePreviousLiveElement();
    } catch (error) {
      presentNextDisplayObject();
      releaseTransitionResources({ flushDeferredEffects: false });
      throw error;
    }

    // Make the committed next object available synchronously. A superseding
    // render can then reconcile its actual plugin type while old live-subject
    // cleanup remains pending inside the transition overlay.
    presentNextDisplayObject();

    if (!deleteOperation || typeof deleteOperation.then !== "function") {
      releaseTransitionResources({ flushDeferredEffects });
      return undefined;
    }

    finalizationOperation = deleteOperation.then(
      () => releaseTransitionResources({ flushDeferredEffects }),
      (error) => {
        releaseTransitionResources({ flushDeferredEffects: false });
        throw error;
      },
    );
    return finalizationOperation;
  };

  const finishTransition = ({ flushDeferredEffects }) => {
    let operation;
    try {
      operation = finalize({ flushDeferredEffects });
    } catch (error) {
      completeTransition();
      throw error;
    }
    if (!operation || typeof operation.then !== "function") {
      completeTransition();
      return undefined;
    }

    const completionOperation = operation.finally(completeTransition);
    // AnimationBus callbacks are synchronous hooks. Mark the rejection as
    // observed even when no direct caller awaits the returned operation.
    void completionOperation.catch(() => {});
    return completionOperation;
  };

  if (isPersistent && typeof animationBus?.registerPending === "function") {
    animationBus.registerPending({
      id: animation.id,
      animationType: animation.type,
      targetId: animation.targetId,
      signature: continuitySignature,
      continuity: "persistent",
      playbackSpeed: animation.playback?.speed,
      onCancel: () => {
        transitionSignalController?.abort();
        clearDeferredMountOperations(hiddenMountContext);
        cleanupParticlesInTree({ app, root: transitionMountParent });
        transitionMountParent.destroy({ children: true });
        completeTransition();
      },
      onContinuationUpdate: handleContinuationUpdate,
    });
  }

  trackTransition();

  const continueWithNextDisplayObject = (
    nextDisplayObject,
    continuedAsynchronously = false,
  ) => {
    if (transitionSignal?.aborted || !getCurrentParent()) {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      cleanupParticlesInTree({ app, root: transitionMountParent });
      transitionMountParent.destroy({ children: true });
      completeTransition();
      return;
    }

    if (nextElement && !nextDisplayObject) {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      completeTransition();
      throw new Error(
        `Transition animation "${animation.id}" could not create the next element "${nextElement.id}".`,
      );
    }

    if (nextDisplayObject) {
      setShaderTimeInTree(nextDisplayObject, resolveShaderTime());
    }

    const useLivePlainOverlay =
      animation.mask === undefined &&
      animation.compositor === undefined &&
      (hasAnimatedSpriteInTree(prevDisplayObject) ||
        hasAnimatedSpriteInTree(nextDisplayObject));
    const prevSubject = prevDisplayObject
      ? useLivePlainOverlay
        ? createLiveSubject(prevDisplayObject)
        : createSnapshotSubject(app, prevDisplayObject)
      : null;
    const nextSubject = nextDisplayObject
      ? useLivePlainOverlay
        ? createLiveSubject(nextDisplayObject)
        : createSnapshotSubject(app, nextDisplayObject)
      : null;

    const overlaySubjects = resolveOverlaySubjects({
      prevElement,
      nextElement,
      animation,
      prevSubject,
      nextSubject,
    });

    if (overlaySubjects.prevSubject !== prevSubject) {
      destroySubjectSnapshot(prevSubject, app);
    }

    if (overlaySubjects.nextSubject !== nextSubject) {
      destroySubjectSnapshot(nextSubject, app);
    }

    detachChildFromParent(nextDisplayObject, transitionMountParent);
    cleanupParticlesInTree({ app, root: transitionMountParent });
    transitionMountParent.destroy({ children: true });

    const cleanupPreparedTransition = () => {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      destroySubjectSnapshot(overlaySubjects.prevSubject, app);
      destroySubjectSnapshot(overlaySubjects.nextSubject, app);

      if (nextDisplayObject && !nextDisplayObject.destroyed) {
        nextDisplayObject.removeFromParent?.();
        cleanupParticlesInTree({ app, root: nextDisplayObject });
        nextDisplayObject.destroy({ children: true });
      }

      completeTransition();
    };

    const installTransition = ({ activateImmediately = false } = {}) => {
      const currentParent = getCurrentParent();
      if (transitionSignal?.aborted || !currentParent) {
        cleanupPreparedTransition();
        return;
      }

      if (nextDisplayObject && !isLiveSubject(overlaySubjects.nextSubject)) {
        nextDisplayObject.zIndex = currentZIndex;
        currentParent.addChild(nextDisplayObject);
        nextDisplayObject.visible = false;
      }

      const replaceOverlay = createReplaceOverlay({
        app,
        animation,
        prevSubject: overlaySubjects.prevSubject,
        nextSubject: overlaySubjects.nextSubject,
        zIndex: currentZIndex,
        getShaderTime: resolveShaderTime,
      });
      replaceOverlayRef.value = replaceOverlay;
      nextDisplayObjectRef.value = nextDisplayObject;

      setElementRenderState(replaceOverlay.overlay, nextElement ?? prevElement);
      setElementHitTestBounds(replaceOverlay.overlay, (overlay) => {
        const localBounds = overlay.getLocalBounds?.();
        return localBounds?.rectangle ?? localBounds;
      });

      currentParent.addChild(replaceOverlay.overlay);
      if (isLiveSubject(overlaySubjects.nextSubject)) {
        flushDeferredMountOperations(
          hiddenMountContext,
          (operation) => operation?.type === "play-animated-sprite",
        );
      }
      const animationPayload = {
        id: animation.id,
        driver: "custom",
        animationType: animation.type,
        targetId: animation.targetId,
        signature: continuitySignature,
        continuity: isPersistent ? "persistent" : "render",
        playbackSpeed: animation.playback?.speed,
        onContinuationUpdate: handleContinuationUpdate,
        duration: replaceOverlay.duration,
        deferCompletionUntilNextFrame: animation.compositor !== undefined,
        applyFrame: replaceOverlay.apply,
        applyTargetState: () => {
          replaceOverlay.apply(replaceOverlay.duration);
          return finalize({ flushDeferredEffects: false });
        },
        onComplete: () => finishTransition({ flushDeferredEffects: true }),
        onCancel: () => finishTransition({ flushDeferredEffects: false }),
        isValid: () =>
          Boolean(replaceOverlay.overlay) &&
          !replaceOverlay.overlay.destroyed &&
          (!nextDisplayObject || !nextDisplayObject.destroyed),
      };

      if (
        isPersistent &&
        typeof animationBus?.activatePending === "function" &&
        animationBus.activatePending(animation.id, animationPayload)
      ) {
        return;
      }

      cleanupPendingTransition();
      animationBus.dispatch({
        type: "START",
        payload: animationPayload,
      });
      if (activateImmediately) {
        animationBus.flush?.();
      }
    };

    const attemptedCleanupParents = new Set();
    const deletePreviousSnapshot = () => {
      if (
        transitionSignal?.aborted ||
        !prevDisplayObject ||
        isLiveSubject(overlaySubjects.prevSubject) ||
        prevDisplayObject.destroyed ||
        !prevDisplayObject.parent
      ) {
        return undefined;
      }

      // Observe a reparented live object before cleanup removes the only
      // generic evidence of a custom composite's current render slot.
      getCurrentParent();
      const cleanupParent = prevDisplayObject.parent;
      if (attemptedCleanupParents.has(cleanupParent)) {
        throw new Error(
          `Element plugin cleanup did not remove "${prevElement.id}" during transition "${animation.id}".`,
        );
      }
      attemptedCleanupParents.add(cleanupParent);

      const operation = prevPlugin.delete({
        app,
        parent: cleanupParent,
        element: prevElement,
        animations: [],
        animationBus,
        completionTracker,
        eventHandler,
        elementPlugins,
        renderContext,
        signal: transitionSignal,
      });

      if (!operation || typeof operation.then !== "function") {
        return undefined;
      }

      return operation.then(() => deletePreviousSnapshot());
    };

    const deleteOperation = deletePreviousSnapshot();

    if (deleteOperation && typeof deleteOperation.then === "function") {
      return deleteOperation.then(
        () => installTransition({ activateImmediately: true }),
        (error) => {
          cleanupPreparedTransition();
          throw error;
        },
      );
    }

    return installTransition({
      activateImmediately: continuedAsynchronously,
    });
  };

  const nextDisplayObjectOrPromise = nextElement
    ? instantiateNextLiveElement({
        app,
        parent: transitionMountParent,
        nextElement,
        plugin: nextPlugin,
        animations,
        eventHandler,
        animationBus,
        completionTracker,
        elementPlugins,
        renderContext: hiddenMountContext,
        zIndex,
        signal: transitionSignal,
        shaderTime,
        getShaderTime,
      })
    : null;

  if (
    nextDisplayObjectOrPromise &&
    typeof nextDisplayObjectOrPromise.then === "function"
  ) {
    return resolveNextDisplayObject(nextDisplayObjectOrPromise).then(
      (nextDisplayObject) =>
        continueWithNextDisplayObject(nextDisplayObject, true),
    );
  }

  return continueWithNextDisplayObject(nextDisplayObjectOrPromise ?? null);
};

export default runReplaceAnimation;
