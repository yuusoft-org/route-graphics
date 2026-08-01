const PROPERTY_CHANNELS = Object.freeze({
  x: ["transform.x", "scalar", "channel.transform2d"],
  y: ["transform.y", "scalar", "channel.transform2d"],
  translateX: ["transform.x", "scalar", "channel.transform2d"],
  translateY: ["transform.y", "scalar", "channel.transform2d"],
  scaleX: ["transform.scale.x", "scalar", "channel.transform2d"],
  scaleY: ["transform.scale.y", "scalar", "channel.transform2d"],
  rotation: [
    "transform.rotation.degrees",
    "angleDegrees",
    "channel.transform2d",
  ],
  alpha: ["appearance.alpha", "scalar", "channel.appearance"],
  blurX: ["effect.blur.x", "scalar", "channel.blur"],
  blurY: ["effect.blur.y", "scalar", "channel.blur"],
  width: ["geometry.width", "scalar", "channel.geometryDimensions"],
  height: ["geometry.height", "scalar", "channel.geometryDimensions"],
});

const inferNumericSequenceType = (value) => {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return "scalar";
  return (
    {
      2: "vec2",
      3: "vec3",
      4: "vec4",
      9: "mat3",
      16: "mat4",
    }[value.length] ?? "discrete"
  );
};

export const isSubjectRelativeProperty = (property) =>
  property === "translateX" || property === "translateY";

export const getSemanticChannel = ({
  property,
  filterId,
  transitionTarget,
  sampleValue,
}) => {
  if (filterId) {
    return {
      channel: `filter.${filterId}.parameter.${property}`,
      valueType: inferNumericSequenceType(sampleValue),
      requirement: "channel.filterParameter",
    };
  }

  if (transitionTarget === "mask") {
    return {
      channel: "transition.mask.progress",
      valueType: "scalar",
      requirement: "channel.transitionMask",
    };
  }

  if (transitionTarget === "compositor") {
    return {
      channel:
        property === "uProgress" || property === "progress"
          ? "transition.compositor.progress"
          : `transition.compositor.parameter.${property}`,
      valueType: inferNumericSequenceType(sampleValue),
      requirement: "channel.transitionCompositor",
    };
  }

  if (property.startsWith("rect.")) {
    const isColor = property.endsWith(".color") || property === "rect.fill";
    return {
      channel: `geometry.${property}`,
      valueType: isColor ? "colorSrgb" : inferNumericSequenceType(sampleValue),
      requirement: "channel.geometryRect",
    };
  }

  const entry = PROPERTY_CHANNELS[property];
  if (!entry) {
    throw new Error(
      `Animation property "${property}" has no semantic channel.`,
    );
  }
  return { channel: entry[0], valueType: entry[1], requirement: entry[2] };
};

export const getLegacyPropertyForChannel = (channel) => {
  const match = Object.entries(PROPERTY_CHANNELS).find(
    ([property, [candidate]]) =>
      candidate === channel && !property.startsWith("translate"),
  );
  if (match) return match[0];
  if (channel.startsWith("geometry.rect.")) {
    return channel.slice("geometry.".length);
  }
  return null;
};
