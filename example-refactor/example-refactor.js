function parseToAst(state){
    const rootElements = state.elements || [];

  // Parse all root elements and their children recursively
  const astNodes = rootElements.map(element => parseElement(element, { x: 0, y: 0 }));

  // Calculate scene bounds
  const sceneBounds = calculateSceneBounds(astNodes);
  return {
    root: {
      id: 'root',
      type: 'root',
      x: 0,
      y: 0,
      width: sceneBounds.width,
      height: sceneBounds.height,
      children: astNodes,
      zIndex: 0
    },
  };
}

function calculateSceneBounds(elements) {
  if (elements.length === 0) {
    return { width: 0, height: 0 };
  }

  let maxX = 0;
  let maxY = 0;

  elements.forEach(element => {
    const elementRight = element.x + element.width;
    const elementBottom = element.y + element.height;

    maxX = Math.max(maxX, elementRight);
    maxY = Math.max(maxY, elementBottom);
  });

  return {
    width: maxX,
    height: maxY
  };
}

function parseElement(element, parentContext = { x: 0, y: 0 }) {

  const baseNode = {
    id: element.id,
    type: element.type,
    properties: { ...element.properties }
  };

  switch (element.type) {
    case 'text':
      return parseTextElement(baseNode, element, parentContext);
    // Add more specific parser here
    default:
      return parseGenericElement(baseNode, element, parentContext);
  }
}

function parseTextElement(baseNode, element, parentContext) {
  const dimensions = calculateTextDimensions(element);
  const position = calculateElementPosition(element, dimensions, parentContext);

  return {
    ...baseNode,
    ...position,
    ...dimensions,
    properties: {
      text: element.text || '',
      fontSize: element.fontSize || 16,
      fontFamily: element.fontFamily || 'Arial',
      fill: element.fill || 0x000000,
      align: element.align || 'left',
      ...baseNode.properties
    },
    zIndex: element.zIndex || 0
  };
}

function calculateTextDimensions(textElement) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${textElement.fontSize}px ${textElement.fontFamily}`;
  const metrics = ctx.measureText(textElement.text);
  return {
    width: metrics.width,
    height: textElement.fontSize
  };
}

function calculateElementPosition(element, dimensions, parentContext) {
  const anchor = element.anchor || 'top-left';
  const x = element.x !== undefined ? element.x : 0;
  const y = element.y !== undefined ? element.y : 0;

  let offsetX = 0;
  let offsetY = 0;

  switch (anchor) {
    case 'center':
      offsetX = dimensions.width / 2;
      offsetY = dimensions.height / 2;
      break;
    case 'top-center':
      offsetX = dimensions.width / 2;
      break;
    case 'top-right':
      offsetX = dimensions.width;
      break;
    case 'middle-left':
      offsetY = dimensions.height / 2;
      break;
    case 'middle-right':
      offsetX = dimensions.width;
      offsetY = dimensions.height / 2;
      break;
    case 'bottom-left':
      offsetY = dimensions.height;
      break;
    case 'bottom-center':
      offsetX = dimensions.width / 2;
      offsetY = dimensions.height;
      break;
    case 'bottom-right':
      offsetX = dimensions.width;
      offsetY = dimensions.height;
      break;
  }

  return {
    x: parentContext.x + x + offsetX,
    y: parentContext.y + y + offsetY
  };
}

function parseGenericElement(baseNode, element, parentContext) {
  const dimensions = {
    width: element.width || 0,
    height: element.height || 0
  };

  const position = calculateElementPosition(element, dimensions, parentContext);

  return {
    ...baseNode,
    ...position,
    ...dimensions,
    properties: {
      ...element.properties
    },
    zIndex: element.zIndex || 0
  };
}

import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@7.x/dist/pixi.min.mjs';

// Your given object
const data = parseToAst({elements: [
    {
        id: 'title',
        type: 'text',
        text: 'Welcome to Route Graphics',
        fontSize: 18,
        fontFamily: 'Arial',
        fill: 0x333333,
        x: 0,
        y: 0,
        anchor: 'bottom-left'
    },
    {
        id: 'text2',
        type: 'text',
        text: 'This is a second text element',
        fontSize: 18,
        fontFamily: 'Arial',
        fill: 0x00ff00,
        x: 0,
        y: 0,
        anchor: 'bottom-right'
    }
]});
console.log("Parsed AST:", data)

// Create Pixi app
const app = new PIXI.Application({
width: data.root.width,
height: data.root.height,
backgroundColor: 0xffffff,
});

document.body.appendChild(app.view);

// Recursive function to render nodes
function renderNode(node, container) {
let displayObj;

if (node.type === 'text') {
    const style = new PIXI.TextStyle({
    fontFamily: node.properties.fontFamily,
    fontSize: node.properties.fontSize,
    fill: node.properties.fill,
    align: node.properties.align,
    });

    displayObj = new PIXI.Text(node.properties.text, style);
    displayObj.x = node.x;
    displayObj.y = node.y;
} else if (node.type === 'rect') {
    displayObj = new PIXI.Graphics();
    displayObj.beginFill(node.properties.fill);
    displayObj.drawRect(0, 0, node.width, node.height);
    displayObj.endFill();
    displayObj.x = node.x;
    displayObj.y = node.y;
} else if (node.type === 'root') {
    displayObj = new PIXI.Container();
    displayObj.x = node.x;
    displayObj.y = node.y;
}

if (node.children) {
    node.children.forEach(child => renderNode(child, displayObj));
}

container.addChild(displayObj);
}

// Render root node
renderNode(data.root, app.stage);
