import { compilePortableGsapAnimation } from "./compilePortableGsap.js";

const toPortableFrameValue = (frame) =>
  frame.relative ? { by: frame.value } : frame.value;

const addInitialTrackDelay = (config, delay = 0) => {
  if (delay === 0) return config;

  return {
    ...config,
    keyframes: config.keyframes.map((frame, index) =>
      index === 0 ? { ...frame, delay: (frame.delay ?? 0) + delay } : frame,
    ),
  };
};

const addLegacyTrack = (steps, { target, property, config }) => {
  const children = [];
  if (config.initialValue !== undefined) {
    children.push({
      kind: "set",
      targets: target,
      values: { [property]: config.initialValue },
      overwrite: "none",
    });
  }
  if (config.keyframes.length > 0) {
    children.push({
      kind: "keyframes",
      targets: target,
      overwrite: "none",
      frames: config.keyframes.map((frame) => ({
        values: { [property]: toPortableFrameValue(frame) },
        duration: frame.duration,
        ...(frame.delay === undefined ? {} : { delay: frame.delay }),
        ...(frame.easing === undefined ? {} : { easing: frame.easing }),
      })),
    });
  }
  if (children.length === 1) steps.push(children[0]);
  else if (children.length > 1)
    steps.push({ kind: "sequence", steps: children });
};

/** Compile the existing transition shorthand through the portable frontend. */
export const compileLegacyTransitionAnimation = (
  animation,
  { sourcePath = "animation" } = {},
) => {
  if (!animation || animation.type !== "transition" || animation.gsap) {
    throw new Error(
      "Legacy transition compilation requires a shorthand transition animation.",
    );
  }

  const parallel = [];
  for (const [property, config] of Object.entries(
    animation.prev?.tween ?? {},
  )) {
    addLegacyTrack(parallel, { target: "previous", property, config });
  }
  for (const [property, config] of Object.entries(
    animation.next?.tween ?? {},
  )) {
    addLegacyTrack(parallel, { target: "next", property, config });
  }
  for (const [index, mask] of (animation.mask ?? []).entries()) {
    addLegacyTrack(parallel, {
      target: `mask-${index}`,
      property: "progress",
      config: addInitialTrackDelay(mask.progress, mask.delay),
    });
  }
  for (const [property, config] of Object.entries(
    animation.compositor?.tween ?? {},
  )) {
    addLegacyTrack(parallel, {
      target: "compositor",
      property:
        property === "uProgress" || property === "progress"
          ? "progress"
          : `parameters.${property}`,
      config,
    });
  }

  // A resource-only/plain transition still needs a zero-duration program so
  // lifecycle and manual sampling use the same player contract.
  if (parallel.length === 0) {
    parallel.push({
      kind: "set",
      targets: "previous",
      values: { alpha: 1 },
      overwrite: "none",
    });
  }

  return compilePortableGsapAnimation(
    {
      ...animation,
      gsap: {
        profile: "portable-v1",
        targets: {
          previous: { transitionSurface: "prev" },
          next: { transitionSurface: "next" },
          ...Object.fromEntries(
            (animation.mask ?? []).map((_mask, index) => [
              `mask-${index}`,
              { transitionMask: index },
            ]),
          ),
          ...(animation.compositor
            ? { compositor: { transitionCompositor: true } }
            : {}),
        },
        steps: [{ kind: "parallel", steps: parallel }],
      },
    },
    { sourcePath },
  );
};

export const compileTransitionAnimation = (animation, options) =>
  animation.gsap
    ? compilePortableGsapAnimation(animation, options)
    : compileLegacyTransitionAnimation(animation, options);
