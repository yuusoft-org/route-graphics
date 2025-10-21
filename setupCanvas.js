import { createCanvas } from 'canvas'
import { JSDOM } from 'jsdom'

// Create a DOM environment
const dom = new JSDOM('<!doctype html><html><body></body></html>')

// Expose globals so your code sees them
global.window = dom.window
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement

// Patch <canvas> to use node-canvas
global.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    const canvas = createCanvas(this.width, this.height)
    return canvas.getContext('2d')
  }
  return null
}
