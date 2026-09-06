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
  bindTimelineProgram,
  createGsapTimelineEvaluator,
  getEasingCriticalProgresses,
  mapDomainTime,
} from "../timeline/index.js";
import { cleanupParticlesInTree } from "../../elements/particles/particleRuntime.js";
import { degreesToRadians } from "../../elements/util/transform.js";
import {
  createShaderEffect,
  destroyShaderEffect,
  getShaderEffectParameter,
  setShaderEffectParameter,
  setShaderEffectProgress,
  setShaderEffectResolution,
  setShaderEffectTime,
  validateShaderEffectParameterValue,
} from "../../elements/util/shaderFilterEffect.js";

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

export const createSnapshotSubject = (app, displayObject) => {
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

export const createLiveSubject = (displayObject) => {
  const frame = normalizeFrame(getLocalBoundsRectangle(displayObject));

  return {
    wrapper: displayObject,
    live: true,
    width: frame.width * Math.abs(displayObject.scale?.x ?? 1),
    height: frame.height * Math.abs(displayObject.scale?.y ?? 1),
  };
};

export const hasAnimatedSpriteInTree = (displayObject) => {
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

export const isLiveSubject = (subject) => subject?.live === true;

const getZeroForValueType = (valueType) => {
  const length = {
    vec2: 2,
    vec3: 3,
    vec4: 4,
    mat3: 9,
    mat4: 16,
    colorSrgb: 4,
    colorLinear: 4,
  }[valueType];
  return length === undefined ? 0 : Array(length).fill(0);
};

const createTransitionSurfaceTarget = (identityPrefix, surface, subject) => {
  const wrapper = subject?.wrapper;
  const base = {
    x: wrapper?.x ?? 0,
    y: wrapper?.y ?? 0,
    alpha: wrapper?.alpha ?? 1,
    scaleX: wrapper?.scale?.x ?? 1,
    scaleY: wrapper?.scale?.y ?? 1,
    rotation: wrapper?.rotation ?? 0,
  };
  return {
    handle: { kind: "surface", surface, subject, wrapper, base },
    identity: `${identityPrefix}:${surface}`,
    subject: {
      x: base.x,
      y: base.y,
      width: subject?.width ?? 1,
      height: subject?.height ?? 1,
    },
  };
};

export const createTransitionTimelineController = ({
  animation,
  program,
  prevSubject,
  nextSubject,
  maskControllers = [],
  compositorEffect,
  validateTerminal = false,
}) => {
  const identityPrefix = `transition:${animation.id}`;
  const valueTypes = new Map(
    program.clipTemplates.map((clip) => [clip.channel, clip.valueType]),
  );
  const maskHandles = (animation.mask ?? []).map((mask, index) => ({
    kind: "mask",
    index,
    progress: mask.progress?.initialValue ?? 0,
    apply: (value) => maskControllers[index]?.apply(clamp01(value)),
  }));
  const compositorHandle = {
    kind: "compositor",
    progress:
      animation.compositor?.tween?.progress?.initialValue ??
      animation.compositor?.tween?.uProgress?.initialValue ??
      0,
  };
  const transitionTargets = {
    prev: createTransitionSurfaceTarget(identityPrefix, "prev", prevSubject),
    next: createTransitionSurfaceTarget(identityPrefix, "next", nextSubject),
    mask: maskHandles.map((handle, index) => ({
      handle,
      identity: `${identityPrefix}:mask:${index}`,
    })),
    compositor: {
      handle: compositorHandle,
      identity: `${identityPrefix}:compositor`,
    },
  };

  const resolveChannel = (target, channel) => {
    const valueType = valueTypes.get(channel);
    if (target.handle.kind === "surface") {
      const { wrapper, base } = target.handle;
      const properties = {
        "transform.x": [
          () => base.x,
          (value) => {
            if (wrapper) wrapper.x = value;
          },
        ],
        "transform.y": [
          () => base.y,
          (value) => {
            if (wrapper) wrapper.y = value;
          },
        ],
        "transform.scale.x": [
          () => 1,
          (value) => {
            if (wrapper) wrapper.scale.x = base.scaleX * value;
          },
        ],
        "transform.scale.y": [
          () => 1,
          (value) => {
            if (wrapper) wrapper.scale.y = base.scaleY * value;
          },
        ],
        "transform.rotation.degrees": [
          () => 0,
          (value) => {
            if (wrapper)
              wrapper.rotation = base.rotation + degreesToRadians(value);
          },
        ],
        "appearance.alpha": [
          () => 1,
          (value) => {
            if (wrapper) wrapper.alpha = base.alpha * value;
          },
        ],
      };
      const pair = properties[channel];
      return pair
        ? { valueType, get: pair[0], apply: (_handle, value) => pair[1](value) }
        : null;
    }
    if (
      target.handle.kind === "mask" &&
      channel === "transition.mask.progress"
    ) {
      return {
        valueType,
        get: () => target.handle.progress,
        apply: (_handle, value) => {
          target.handle.progress = value;
          target.handle.apply(value);
        },
      };
    }
    if (target.handle.kind === "compositor") {
      if (channel === "transition.compositor.progress") {
        return {
          valueType,
          get: () => target.handle.progress,
          apply: (_handle, value) => {
            target.handle.progress = value;
            if (compositorEffect)
              setShaderEffectProgress(compositorEffect, value);
          },
        };
      }
      const match = /^transition\.compositor\.parameter\.(.+)$/.exec(channel);
      if (match) {
        const parameter = match[1];
        return {
          valueType,
          get: () => {
            if (!compositorEffect) return getZeroForValueType(valueType);
            const value = getShaderEffectParameter(compositorEffect, parameter);
            if (value === undefined) {
              throw new Error(
                `Transition animation "${animation.id}" cannot target unknown compositor parameter "${parameter}".`,
              );
            }
            return value;
          },
          apply: (_handle, value) => {
            if (compositorEffect) {
              setShaderEffectParameter(compositorEffect, parameter, value);
            }
          },
        };
      }
    }
    return null;
  };

  const instance = bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    transitionTargets,
    channelRegistry: { resolve: resolveChannel },
  });
  if (!Number.isFinite(instance.duration)) {
    throw new Error(`Transition animation "${animation.id}" must be finite.`);
  }
  const timelineEvaluator = createGsapTimelineEvaluator(instance);
  try {
    const terminalFrame = timelineEvaluator.evaluate(instance.duration);
    if (validateTerminal && animation.gsap) {
      for (const [index] of (animation.mask ?? []).entries()) {
        const value = terminalFrame.values.find(
          (item) =>
            item.targetIdentity === `${identityPrefix}:mask:${index}` &&
            item.channel === "transition.mask.progress",
        )?.value;
        if (value !== 1) {
          throw new Error(
            `Transition animation "${animation.id}" mask[${index}] must have effective terminal progress 1.`,
          );
        }
      }
      if (animation.compositor) {
        const value = terminalFrame.values.find(
          (item) => item.channel === "transition.compositor.progress",
        )?.value;
        if (value !== 1) {
          throw new Error(
            `Transition animation "${animation.id}" compositor must have effective terminal progress 1.`,
          );
        }
      }
    }
  } catch (error) {
    timelineEvaluator.destroy();
    throw error;
  }
  const sampleTimes = new Set([0, instance.duration]);
  for (const track of instance.tracks) {
    for (const segment of track.segments) {
      sampleTimes.add(segment.rootStart);
      sampleTimes.add(segment.rootEnd);
      const span = segment.rootEnd - segment.rootStart;
      if (span > 0) {
        const progresses = new Set([
          0.25,
          0.5,
          0.75,
          ...getEasingCriticalProgresses(segment.easing),
        ]);
        for (const progress of progresses) {
          sampleTimes.add(segment.rootStart + span * progress);
        }
      }
    }
  }
  return {
    program,
    instance,
    backend: timelineEvaluator.backend,
    duration: instance.duration,
    sampleTimes: [...sampleTimes].sort((left, right) => left - right),
    apply: (time) => {
      if (maskControllers.length > 0) {
        const rootTime = mapDomainTime(instance.domains.root, time);
        for (const [index, mask] of (animation.mask ?? []).entries()) {
          maskControllers[index]?.setActive(
            rootTime.localTime >= (mask.delay ?? 0),
          );
        }
      }
      timelineEvaluator.apply(time);
    },
    destroy: timelineEvaluator.destroy,
  };
};

const collectControllerSampleTimes = (controllers) => {
  const sampleTimes = new Set([0]);

  for (const controller of controllers) {
    for (const time of controller.sampleTimes ?? []) sampleTimes.add(time);
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
uniform float uMaskActive;
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
    float reveal = clamp(uMaskActive, 0.0, 1.0) * mix(
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
  uMaskActive: f32,
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
  let reveal = clamp(replaceMaskUniforms.uMaskActive, 0.0, 1.0) * mix(
    sampleReveal(maskValue),
    clamp(maskValue, 0.0, 1.0),
    clamp(replaceMaskUniforms.uMaskDirectReveal, 0.0, 1.0),
  );

  return mix(prevColor, nextColor, reveal);
}
`;

const MASK_ACCUMULATE_FILTER_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMaskTextureA;
uniform sampler2D uMaskTextureB;
uniform float uProgress;
uniform float uSoftness;
uniform float uMaskMix;
uniform float uMaskInvert;
uniform float uMaskDirectReveal;
uniform float uMaskActive;
uniform vec4 uMaskChannelWeights;

float sampleAccumulatedMaskValue(vec2 uv)
{
    vec4 rawMaskA = texture(uMaskTextureA, uv);
    vec4 rawMaskB = texture(uMaskTextureB, uv);
    float maskA = dot(rawMaskA, uMaskChannelWeights);
    float maskB = dot(rawMaskB, uMaskChannelWeights);
    float maskValue = mix(maskA, maskB, clamp(uMaskMix, 0.0, 1.0));

    return mix(maskValue, 1.0 - maskValue, clamp(uMaskInvert, 0.0, 1.0));
}

float sampleAccumulatedReveal(float maskValue)
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
    float accumulated = texture(uTexture, uv).r;
    float maskValue = sampleAccumulatedMaskValue(uv);
    float reveal = clamp(uMaskActive, 0.0, 1.0) * mix(
        sampleAccumulatedReveal(maskValue),
        clamp(maskValue, 0.0, 1.0),
        clamp(uMaskDirectReveal, 0.0, 1.0)
    );
    float combined = max(accumulated, reveal);

    finalColor = vec4(combined, combined, combined, 1.0);
}
`;

const MASK_ACCUMULATE_FILTER_WGSL = `
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
  uMaskActive: f32,
  uMaskChannelWeights: vec4<f32>,
  uSecondaryMatrix: mat3x3<f32>,
  uSecondaryClamp: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> replaceMaskUniforms: ReplaceMaskUniforms;
@group(1) @binding(1) var uMaskTextureA: texture_2d<f32>;
@group(1) @binding(2) var uMaskTextureB: texture_2d<f32>;

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

fn sampleAccumulatedMaskValue(uv: vec2<f32>) -> f32
{
  let rawMaskA = textureSample(uMaskTextureA, uSampler, uv);
  let rawMaskB = textureSample(uMaskTextureB, uSampler, uv);
  let maskA = dot(rawMaskA, replaceMaskUniforms.uMaskChannelWeights);
  let maskB = dot(rawMaskB, replaceMaskUniforms.uMaskChannelWeights);
  let maskValue = mix(maskA, maskB, clamp(replaceMaskUniforms.uMaskMix, 0.0, 1.0));

  return mix(maskValue, 1.0 - maskValue, clamp(replaceMaskUniforms.uMaskInvert, 0.0, 1.0));
}

fn sampleAccumulatedReveal(maskValue: f32) -> f32
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
  );
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>
{
  let clampedUv = clamp(uv, vec2(0.0), vec2(1.0));
  let accumulated = textureSample(uTexture, uSampler, clampedUv).r;
  let maskValue = sampleAccumulatedMaskValue(clampedUv);
  let reveal = clamp(replaceMaskUniforms.uMaskActive, 0.0, 1.0) * mix(
    sampleAccumulatedReveal(maskValue),
    clamp(maskValue, 0.0, 1.0),
    clamp(replaceMaskUniforms.uMaskDirectReveal, 0.0, 1.0),
  );
  let combined = max(accumulated, reveal);

  return vec4(combined, combined, combined, 1.0);
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

const createReplaceMaskUniforms = ({ active = true } = {}) =>
  new UniformGroup({
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
    uMaskActive: {
      value: active ? 1 : 0,
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

const createReplaceMaskFilter = ({ active = true } = {}) => {
  const replaceMaskUniforms = createReplaceMaskUniforms({ active });
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

const createMaskAccumulateFilter = ({ active = true } = {}) => {
  const replaceMaskUniforms = createReplaceMaskUniforms({ active });
  const filter = Filter.from({
    gpu: {
      vertex: {
        source: MASK_ACCUMULATE_FILTER_WGSL,
        entryPoint: "mainVertex",
      },
      fragment: {
        source: MASK_ACCUMULATE_FILTER_WGSL,
        entryPoint: "mainFragment",
      },
    },
    gl: {
      vertex: REPLACE_MASK_FILTER_VERTEX,
      fragment: MASK_ACCUMULATE_FILTER_FRAGMENT,
      name: "replace-mask-accumulate-filter",
    },
    resources: {
      replaceMaskUniforms,
      uMaskTextureA: Texture.EMPTY.source,
      uMaskTextureB: Texture.EMPTY.source,
    },
  });

  return { filter, replaceMaskUniforms };
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
    setActive: (active) => {
      const value = active ? 1 : 0;
      if (replaceMaskUniforms.uniforms.uMaskActive === value) return;
      replaceMaskUniforms.uniforms.uMaskActive = value;
      replaceMaskUniforms.update();
    },
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

// Each filter consumes the previous grayscale reveal field and writes the
// per-pixel maximum with its own reveal, producing an order-independent union.
const createMaskCompositionController = ({ app, masks, width, height }) => {
  const outputTexture = createShaderRenderTexture(width, height);
  const sprite = new Sprite(Texture.WHITE);
  sprite.width = width;
  sprite.height = height;
  sprite.tint = 0x000000;
  sprite.filterArea = new Rectangle(0, 0, width, height);

  const container = new Container();
  container.addChild(sprite);

  const entries = masks.map((mask) => {
    const { filter } = createMaskAccumulateFilter({
      active: !(mask.delay > 0),
    });
    return {
      filter,
      controller: createMaskTextureController(app, mask, width, height, filter),
    };
  });
  sprite.filters = entries.map(({ filter }) => filter);

  return {
    textureSource: outputTexture.source,
    controllers: entries.map(({ controller }) => controller),
    render: () => {
      app.renderer.render({
        container,
        target: outputTexture,
        clear: true,
        clearColor: [0, 0, 0, 1],
      });
    },
    destroy: () => {
      sprite.filters = [];
      for (const { filter } of entries) filter.destroy();
      for (const { controller } of entries) controller.destroy();
      container.destroy({ children: true });
      outputTexture.destroy(true);
    },
  };
};

const bindComposedMaskTexture = (filter, textureSource) => {
  const uniforms = filter.resources.replaceMaskUniforms;
  filter.resources.uMaskTextureA = textureSource;
  filter.resources.uMaskTextureB = textureSource;
  uniforms.uniforms.uProgress = 0;
  uniforms.uniforms.uSoftness = 0.001;
  uniforms.uniforms.uMaskMix = 0;
  uniforms.uniforms.uMaskInvert = 0;
  uniforms.uniforms.uMaskDirectReveal = 1;
  uniforms.uniforms.uMaskActive = 1;
  uniforms.uniforms.uMaskChannelWeights = OUTPUT_MASK_CHANNEL_WEIGHTS;
  uniforms.update();
};

const createOverlayMaskResources = ({
  app,
  masks,
  width,
  height,
  nextTextureSource,
  sprite,
}) => {
  if (!masks?.length) {
    return null;
  }

  const singleMask = masks.length === 1 ? masks[0] : null;
  const { filter } = createReplaceMaskFilter({
    active: singleMask ? !(singleMask.delay > 0) : true,
  });
  filter.resources.uNextTexture = nextTextureSource;

  let composition = null;
  let controllers;
  if (singleMask) {
    controllers = [
      createMaskTextureController(app, singleMask, width, height, filter),
    ];
  } else {
    composition = createMaskCompositionController({
      app,
      masks,
      width,
      height,
    });
    controllers = composition.controllers;
    bindComposedMaskTexture(filter, composition.textureSource);
  }

  const secondaryClamp = createFullFrameClamp(width, height);
  const baseApplyFilter =
    typeof filter.apply === "function"
      ? filter.apply.bind(filter)
      : (filterManager, input, output, clearMode) => {
          filterManager.applyFilter(filter, input, output, clearMode);
        };
  filter.apply = (filterManager, input, output, clearMode) => {
    const replaceMaskUniforms = filter.resources.replaceMaskUniforms;
    filterManager.calculateSpriteMatrix(
      replaceMaskUniforms.uniforms.uSecondaryMatrix,
      sprite,
    );
    replaceMaskUniforms.uniforms.uSecondaryClamp = secondaryClamp;
    replaceMaskUniforms.update();
    baseApplyFilter(filterManager, input, output, clearMode);
  };

  return {
    filter,
    controllers,
    render: () => composition?.render(),
    destroy: () => {
      filter.destroy();
      if (composition) {
        composition.destroy();
      } else {
        controllers[0].destroy();
      }
    },
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

  const originalTransforms = activeSubjects.map(({ wrapper }) => ({
    wrapper,
    x: wrapper.x,
    y: wrapper.y,
    alpha: wrapper.alpha,
    rotation: wrapper.rotation,
    scaleX: wrapper.scale.x,
    scaleY: wrapper.scale.y,
  }));
  const boundsContainer = new Container();
  const rectangles = [];
  try {
    for (const subject of activeSubjects) {
      boundsContainer.addChild(subject.wrapper);
    }

    for (const time of collectControllerSampleTimes(controllers)) {
      for (const controller of controllers) {
        controller.apply(time);
      }

      rectangles.push(getLocalBoundsRectangle(boundsContainer));
    }
  } finally {
    for (const original of originalTransforms) {
      const { wrapper } = original;
      wrapper.x = original.x;
      wrapper.y = original.y;
      wrapper.alpha = original.alpha;
      wrapper.rotation = original.rotation;
      wrapper.scale.set(original.scaleX, original.scaleY);
    }

    for (const subject of activeSubjects) {
      if (subject.wrapper.parent === boundsContainer) {
        boundsContainer.removeChild(subject.wrapper);
      }
    }
    boundsContainer.destroy();
  }

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

export const detachChildFromParent = (child, parent) => {
  if (!child || child.parent !== parent) {
    return;
  }

  parent.removeChild(child);
};

export const destroySubjectSnapshot = (subject, app) => {
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

export const resolveOverlaySubjects = ({
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
  program,
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

  const timelineController = createTransitionTimelineController({
    animation,
    program,
    prevSubject: prevOverlaySubject.subject,
    nextSubject: nextOverlaySubject.subject,
  });

  return {
    overlay,
    duration: timelineController.duration,
    timelineController,
    apply: (time) => {
      prevOverlaySubject.render();
      nextOverlaySubject.render();
      timelineController.apply(time);
    },
    destroy: () => {
      timelineController.destroy();
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
  program,
  prevSubject,
  nextSubject,
  zIndex,
  getShaderTime,
}) => {
  const boundsTimelineController = createTransitionTimelineController({
    animation,
    program,
    prevSubject,
    nextSubject,
  });
  let unionBounds;
  try {
    unionBounds = getAnimatedUnionBounds(
      [prevSubject, nextSubject],
      [boundsTimelineController],
    );
  } finally {
    boundsTimelineController.destroy();
  }
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

  const compositorEffect = createShaderEffect({
    effect: animation.compositor,
    width: unionBounds.width,
    height: unionBounds.height,
    progress:
      animation.compositor?.tween?.progress?.initialValue ??
      animation.compositor?.tween?.uProgress?.initialValue ??
      0,
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

  Object.entries(animation.compositor.tween ?? {})
    .filter(
      ([parameter]) => parameter !== "uProgress" && parameter !== "progress",
    )
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
        ...config.keyframes.flatMap((keyframe) => [
          ...(keyframe.startValue === undefined ? [] : [keyframe.startValue]),
          keyframe.value,
        ]),
      ];
      for (const value of parameterValues) {
        validateShaderEffectParameterValue(compositorEffect, parameter, value);
      }
      return parameter;
    });

  const maskResources = createOverlayMaskResources({
    app,
    masks: animation.mask,
    width: unionBounds.width,
    height: unionBounds.height,
    nextTextureSource: nextTexture.source,
    sprite,
  });

  sprite.filters = [
    ...(maskResources ? [maskResources.filter] : []),
    ...compositorEffect.filters,
  ];

  const timelineController = createTransitionTimelineController({
    animation,
    program,
    prevSubject,
    nextSubject,
    maskControllers: maskResources?.controllers,
    compositorEffect,
    validateTerminal: true,
  });

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
    duration: timelineController.duration,
    timelineController,
    apply: (time) => {
      timelineController.apply(time);
      maskResources?.render();

      if (
        prevSubject?.wrapper &&
        (timelineController.duration > 0 || !prevStaticRendered)
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
        (timelineController.duration > 0 || !nextStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: nextRoot,
          target: nextTexture,
          frame: unionBounds,
        });
        nextStaticRendered = true;
      }

      setShaderEffectResolution(
        compositorEffect,
        unionBounds.width,
        unionBounds.height,
      );
      setShaderEffectTime(compositorEffect, getShaderTime());
    },
    destroy: () => {
      timelineController.destroy();
      overlay.removeFromParent();
      sprite.filters = [];
      maskResources?.destroy();
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
  program,
  prevSubject,
  nextSubject,
  zIndex,
}) => {
  const boundsTimelineController = createTransitionTimelineController({
    animation,
    program,
    prevSubject,
    nextSubject,
  });
  let unionBounds;
  try {
    unionBounds = getAnimatedUnionBounds(
      [prevSubject, nextSubject],
      [boundsTimelineController],
    );
  } finally {
    boundsTimelineController.destroy();
  }
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

  const maskResources = createOverlayMaskResources({
    app,
    masks: animation.mask,
    width: unionBounds.width,
    height: unionBounds.height,
    nextTextureSource: nextTexture.source,
    sprite,
  });
  sprite.filters = [maskResources.filter];
  const timelineController = createTransitionTimelineController({
    animation,
    program,
    prevSubject,
    nextSubject,
    maskControllers: maskResources.controllers,
    validateTerminal: true,
  });
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
    duration: timelineController.duration,
    timelineController,
    apply: (time) => {
      timelineController.apply(time);
      maskResources.render();

      if (
        prevSubject?.wrapper &&
        (timelineController.duration > 0 || !prevStaticRendered)
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
        (timelineController.duration > 0 || !nextStaticRendered)
      ) {
        renderOffscreenContainer({
          app,
          container: nextRoot,
          target: nextTexture,
          frame: unionBounds,
        });
        nextStaticRendered = true;
      }
    },
    destroy: () => {
      timelineController.destroy();
      overlay.removeFromParent();
      sprite.filters = [];
      maskResources.destroy();
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

export const createReplaceOverlay = ({
  app,
  animation,
  program,
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
      program,
      prevSubject,
      nextSubject,
      zIndex,
      getShaderTime,
    });
  } else if (animation.mask) {
    replaceOverlay = createMaskedOverlay({
      app,
      animation,
      program,
      prevSubject,
      nextSubject,
      zIndex,
    });
  } else {
    replaceOverlay = createPlainOverlay({
      app,
      animation,
      program,
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
