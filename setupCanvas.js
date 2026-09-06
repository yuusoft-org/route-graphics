import { CanvasRenderingContext2D, createCanvas, registerFont } from 'canvas'
import { JSDOM } from 'jsdom'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CanvasTextMetrics, TextStyle } from 'pixi.js'
import { beforeEach, vi } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const notoSansPath = join(__dirname, 'spec/assets/fonts/NotoSans-Regular.ttf')
const TEST_FONT_FAMILY = 'RouteGraphicsTestSans'

// Pin text metrics in tests to a vendored font instead of host-specific Arial.
registerFont(notoSansPath, { family: TEST_FONT_FAMILY })

// Create a DOM environment
const dom = new JSDOM('<!doctype html><html><body></body></html>')

// Expose globals so your code sees them
global.window = dom.window
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.HTMLCanvasElement = dom.window.HTMLCanvasElement
global.CanvasRenderingContext2D = CanvasRenderingContext2D

// Patch <canvas> to use node-canvas
global.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    const width = this.width || 1280
    const height = this.height || 720
    const canvas = createCanvas(width, height)
    return canvas.getContext('2d')
  }
  return null
}

const originalMeasureText = CanvasTextMetrics.measureText.bind(CanvasTextMetrics)

const normalizeFontFamily = (fontFamily) => {
  return TEST_FONT_FAMILY
}

CanvasTextMetrics.measureText = function (text, style, ...rest) {
  const normalizedStyle = style instanceof TextStyle ? style.clone() : new TextStyle(style)
  normalizedStyle.fontFamily = normalizeFontFamily(normalizedStyle.fontFamily)
  return originalMeasureText(text, normalizedStyle, ...rest)
}

beforeEach(async () => {
  const pixi = await vi.importActual('pixi.js')
  pixi.CanvasTextMetrics.clearMetrics()
})
