import { GlUboSystem, GpuUboSystem } from "pixi.js";
import "pixi.js/unsafe-eval";

// Pixi 8.10.2's CSP polyfills still accept (uniforms, data, offset), while
// UboSystem passes (uniforms, data, dataInt32, offset). Keep the actual offset
// when syncing multiple uniform groups into the same GPU buffer.
for (const System of [GlUboSystem, GpuUboSystem]) {
  const generateSync = System.prototype._generateUboSync;
  System.prototype._generateUboSync = function (elements) {
    const sync = generateSync.call(this, elements);
    if (sync.length !== 3) return sync;
    return (uniforms, data, _dataInt32, offset) => sync(uniforms, data, offset);
  };
}
