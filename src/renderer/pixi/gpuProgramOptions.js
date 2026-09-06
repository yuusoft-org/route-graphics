/**
 * Pixi 8.10's WGSL attribute parser requires a separator after the last vertex
 * parameter's type. A closing parenthesis is valid WGSL but is not recognized
 * by that parser. Whitespace preserves the authored shader's semantics.
 */
export const createGpuProgramOptions = (source, name) => {
  const reflectedSource = source.replace(
    /(\bfn\s+mainVertex\s*\([\s\S]*?)(\)\s*->)/,
    "$1 $2",
  );
  return {
    name,
    vertex: { source: reflectedSource, entryPoint: "mainVertex" },
    fragment: { source: reflectedSource, entryPoint: "mainFragment" },
  };
};
