# Render CLI

`route-graphics render` renders RouteGraphics YAML into still PNG images or MP4
video files using the local `dist/RouteGraphics.js` bundle and headless
Chromium through Playwright.

The output format is inferred from `-o`:

```bash
route-graphics render ./examples/hello.yaml -o ./out/hello.png
route-graphics render ./examples/storyboard.yaml -o ./out/storyboard.mp4
```

Use `--format` when the output path has no extension:

```bash
route-graphics render ./examples/storyboard.yaml --format mp4 -o ./out/storyboard
```

## Shared Options

| Option                        | Meaning                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `-o, --output <path>`         | Required output path. Supports `.png` and `.mp4`.                     |
| `--format <png\|mp4>`         | Override format inference.                                            |
| `--width <pixels>`            | Override render width.                                                |
| `--height <pixels>`           | Override render height.                                               |
| `--background-color <value>`  | Override background color. Accepts `#RRGGBB`, `0xRRGGBB`, or decimal. |
| `--browser-executable <path>` | Use a system Chrome/Chromium executable.                              |
| `--timeout <ms>`              | Browser-side timeout. Default: `15000`.                               |

## PNG

PNG output captures one state.

```bash
route-graphics render ./examples/hello.yaml -o ./out/hello.png
route-graphics render ./scene.yaml -o ./out/state-02.png --state 2
route-graphics render ./scene.yaml -o ./out/frame.png --state 2 --time 500
```

PNG-only options:

| Option                       | Meaning                                                           |
| ---------------------------- | ----------------------------------------------------------------- |
| `--state <index>`            | Select one zero-based state. Default: `0`.                        |
| `--time <ms>`                | Sample animations in manual mode at a specific timeline position. |
| `--wait-for-render-complete` | Wait for `renderComplete` before capture.                         |
| `--layout-report <path>`     | Write a JSON layout report for the captured state.                |

The layout report path must differ from both the YAML input and image output.
For example: `route-graphics render scene.yaml -o frame.png --layout-report layout.json`.
The legacy `bin/route-graphics-render.js` forwards to this same implementation
with the `render` subcommand. Existing PNG flags remain supported.

## MP4

MP4 output renders a state sequence in one browser session. Each selected state
is rendered in order, autoplay runs, and the CLI advances after a non-aborted
`renderComplete` event. Audio is not included.

```bash
route-graphics render ./scene.yaml -o ./out/scene.mp4 \
  --states 0-4 \
  --fps 30 \
  --hold 300 \
  --final-hold 1200
```

MP4-only options:

| Option                      | Meaning                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `--states <list>`           | State indexes/ranges. Default: all states. Example: `0,2-5`.            |
| `--fps <number>`            | Output frame rate. Default: `30`.                                       |
| `--hold <ms>`               | Hold after each intermediate state. Default: `0`.                       |
| `--initial-hold <ms>`       | Hold after the first state before advancing. Default: `--hold` or `0`.  |
| `--final-hold <ms>`         | Hold after the final state. Default: `1000`.                            |
| `--max-state-duration <ms>` | Timeout per state while waiting for `renderComplete`. Default: `15000`. |
| `--ffmpeg <path>`           | ffmpeg executable path. Default: `ffmpeg`.                              |

## YAML Shapes

The CLI accepts the same YAML layouts as the older PNG renderer:

- a single state object
- an array of states
- a wrapper object with `width`, `height`, `backgroundColor`, optional `assets`,
  and either `state` or `states`
- multiple YAML documents separated by `---` and treated as a state list

Assets must be declared under top-level `assets` and referenced by alias from
render states.
