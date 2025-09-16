import { html, render } from "https://cdn.jsdelivr.net/npm/uhtml@4.5.8/+esm";
import RouteGraphics, {
  SpriteRendererPlugin,
  TextRendererPlugin,
  ContainerRendererPlugin,
  TextRevealingRendererPlugin,
  RectRendererPlugin,
  AudioPlugin,
  SliderRendererPlugin,
  KeyframeTransitionPlugin,
  createAssetBufferManager,
} from "/RouteGraphics.js";
import { parse } from "https://cdn.jsdelivr.net/npm/yaml@2.7.1/+esm";

class App {
  _states = [];
  _frameIndex = 0;
  _canvasRef = {};
  _app;
  _jsonContent;

  onMount = async () => {
    this.triggerRender();
    this._initPixiCanvas();
    this.listenEvents();
  };

  listenEvents = () => {
    document.addEventListener("keydown", (e) => {
      if (e.key === "n") {
        this._nextFrame();
      } else if (e.key === "b") {
        this._prevFrame();
      }
    });
  };

  triggerRender = () => {
    render(document.body, this.render());
  };

  _initPixiCanvas = async () => {
    const assets = {
      "file:bg1": {
        url: "/public/background-1-1.png",
        type: "image/png",
      },
      "file:circle-red": {
        url: "/public/circle-red.png",
        type: "image/png",
      },
      "file:circle-blue": {
        url: "/public/circle-blue.png",
        type: "image/png",
      },
      "file:circle-green": {
        url: "/public/circle-green.png",
        type: "image/png",
      },
      "file:circle-grey": {
        url: "/public/circle-grey.png",
        type: "image/png",
      },
      "file:button": {
        url: "/public/button.png",
        type: "image/png",
      },
      "file:button_over": {
        url: "/public/button_over.png",
        type: "image/png",
      },
      "file:button_down": {
        url: "/public/button_down.png",
        type: "image/png",
      },
      "file:bgm-1": {
        url: "/public/bgm-1.mp3",
        type: "audio/mpeg",
      },
      "file:bgm-2": {
        url: "/public/bgm-2.mp3",
        type: "audio/mpeg",
      },
      "Inkfree": {
        url: "/public/Inkfree.ttf",
        type: "application/x-font-ttf",
      },
    };
    const assetBufferManager = createAssetBufferManager();
    await assetBufferManager.load(assets);
    const assetBufferMap = assetBufferManager.getBufferMap();

    this._app = new RouteGraphics();
    await this._app.init({
      width: 1920,
      height: 1080,
      eventHandler: (eventName, payload) => {
        console.log('eventHandler', eventName, payload)
      },
      plugins: [
        new SpriteRendererPlugin(),
        new TextRendererPlugin(),
        new ContainerRendererPlugin(),
        new TextRevealingRendererPlugin(),
        new RectRendererPlugin(),
        new AudioPlugin(),
        new SliderRendererPlugin(),
        new KeyframeTransitionPlugin(),
      ],
    });

    await this._app.loadAssets(assetBufferMap);
    this._canvasRef.current.appendChild(this._app.canvas);
    this._canvasRef.current.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
    this._jsonContent = parse(window.vtState);
    this._renderCanvas();
  };

  _renderCanvas = () => {
    const { elements = [], transitions = [] } =
      this._jsonContent.states[this._frameIndex];
    this._app.render({ elements, transitions });
  };

  _nextFrame = () => {
    if (this._frameIndex >= this._jsonContent.states.length - 1) {
      return;
    }
    this._frameIndex++;
    this._renderCanvas();
  };

  _prevFrame = () => {
    if (this._frameIndex <= 0) {
      return;
    }
    this._frameIndex--;
    this._renderCanvas();
  };

  render = () => {
    return html`
      <style>
        .canvas-container {
          transform: scale(0.5);
          transform-origin: top left;
        }
      </style>
      <rtgl-view
        class="canvas-container"
        bgc="su"
        flex="1"
        ref=${this._canvasRef}
      >
      </rtgl-view>
    `;
  };
}

const app = new App();
app.onMount();
