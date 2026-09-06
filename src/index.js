import { createAssetBufferManager } from "./util/createAssetBufferManager.js";
import { Application, Assets } from "pixi.js";
import { AudioAsset } from "./AudioAsset.js";
import { configureAudioRuntime, resetAudioRuntime } from "./audioContext.js";
import { createDeterministicAudioRuntime } from "./audio/deterministicAudioRuntime.js";
import { createElementPlugin } from "./plugins/elements/elementPlugin.js";
import { createAnimationPlugin } from "./plugins/animations/animationPlugin.js";
import { createAudioPlugin } from "./plugins/audio/audioPlugin.js";
import { textPlugin } from "./plugins/elements/text/index.js";
import { rectPlugin } from "./plugins/elements/rect/index.js";
import { spritePlugin } from "./plugins/elements/sprite/index.js";
import { videoPlugin } from "./plugins/elements/video/index.js";
import { sliderPlugin } from "./plugins/elements/slider/index.js";
import { inputPlugin } from "./plugins/elements/input/index.js";
import { containerPlugin } from "./plugins/elements/container/index.js";
import { textRevealingPlugin } from "./plugins/elements/text-revealing/index.js";
import {
  animatedSpritePlugin,
  spritesheetAnimationPlugin,
} from "./plugins/elements/animated-sprite/index.js";
import { tweenPlugin } from "./plugins/animations/tween/index.js";
import { soundPlugin } from "./plugins/audio/sound/index.js";
import { particlesPlugin } from "./plugins/elements/particles/index.js";
import { renderElements } from "./plugins/elements/renderElements.js";
import { renderAudio } from "./plugins/audio/renderAudio.js";
import createRouteGraphics from "./RouteGraphics.js";

export default createRouteGraphics;

export {
  Application,
  Assets,
  AudioAsset,
  configureAudioRuntime,
  resetAudioRuntime,
  createDeterministicAudioRuntime,
  createAssetBufferManager,
  createElementPlugin,
  createAnimationPlugin,
  createAudioPlugin,
  textPlugin,
  rectPlugin,
  spritePlugin,
  videoPlugin,
  sliderPlugin,
  inputPlugin,
  containerPlugin,
  textRevealingPlugin,
  spritesheetAnimationPlugin,
  animatedSpritePlugin,
  tweenPlugin,
  soundPlugin,
  particlesPlugin,
  renderElements,
  renderAudio,
};

/** @typedef {import("./types.js").RouteGraphicsState} RouteGraphicsState */
/** @typedef {import("./types.js").RouteGraphicsInitOptions} RouteGraphicsInitOptions */
