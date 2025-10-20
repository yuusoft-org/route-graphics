# Route Graphics Rewrite - Detailed Implementation Plan

## Overview
This document outlines a comprehensive plan to rewrite RouteGraphics.js using a 2-phase pipeline approach: input JSON → AST → PixiJS. The goal is to separate calculation logic from rendering, making the code more maintainable, testable, and flexible.

### 2-Phase Pipeline Design

```
Input: RouteGraphicsState JSON
    ↓
[Phase 1: Parser]
    - Parse elements and properties
    - Calculate all positions and dimensions
    - Resolve anchor/direction to explicit coordinates
    - Build hierarchical AST
    ↓
Output: AST (with complete layout info)
    ↓
[Phase 2: Renderer]
    - Create PixiJS objects at calculated positions
    - Apply properties without calculations
    - Handle diffing and updates
    - Manage z-indexing
    ↓
Output: Rendered PixiJS scene
```

## File Structure

```
src/
├── RouteGraphics.js (main entry point - updated)
├── ast/
│   ├── types.js (AST interface definitions)
│   ├── parser.js (JSON → AST conversion)
│   └── renderer.js (AST → PixiJS rendering)
├── layout/
│   ├── calculator.js (position/dimension calculations)
│   ├── resolver.js (anchor/direction resolution)
│   └── validator.js (layout validation)
├── diff/
│   └── ast-diff.js (AST diffing algorithm)
└── plugins/ (updated for AST compatibility)
    ├── base/
    │   └── BaseASTPlugin.js
    └── elements/ (updated existing plugins)
```

## Detailed Implementation Steps

### Phase 1: Core Infrastructure

#### 1.1 AST Types and Interfaces (`src/ast/types.js`)
```javascript
/**
 * @typedef {Object} ASTNode
 * @property {string} id - Unique identifier
 * @property {string} type - Element type (container, text, image, etc.)
 * @property {number} x - Absolute x position
 * @property {number} y - Absolute y position
 * @property {number} width - Explicit width
 * @property {number} height - Explicit height
 * @property {ASTNode[]} children - Child elements
 * @property {Object} properties - Element-specific properties
 * @property {number} [zIndex] - Z-index for sorting
 * @property {Object} [style] - Styling information
 * @property {Object} [events] - Event handlers
 */

/**
 * @typedef {Object} AST
 * @property {ASTNode} root - Root node
 * @property {Object} metadata - AST metadata
 * @property {number} metadata.totalWidth - Total scene width
 * @property {number} metadata.totalHeight - Total scene height
 * @property {number} metadata.parseTime - Time taken to parse
 */
```

#### 1.2 Layout Calculator (`src/layout/calculator.js`)
```javascript
/**
 * Core layout calculation engine
 * - Handles container positioning
 * - Calculates text dimensions before rendering
 * - Resolves anchor points to absolute positions
 * - Manages direction-based layouts
 */
class LayoutCalculator {
  /**
   * Calculate absolute positions for all elements
   * @param {BaseElement[]} elements - Input elements
   * @returns {ASTNode[]} Calculated AST nodes
   */
  calculateLayout(elements) {}

  /**
   * Calculate text dimensions without rendering
   * @param {Object} textElement - Text element configuration
   * @returns {Object} { width, height } dimensions
   */
  calculateTextDimensions(textElement) {}

  /**
   * Resolve container anchor and child positioning
   * @param {Object} container - Container element
   * @param {ASTNode[]} children - Child AST nodes
   * @returns {Object} Resolved container dimensions
   */
  resolveContainerLayout(container, children) {}
}
```

#### 1.3 AST Parser (`src/ast/parser.js`)
```javascript
/**
 * Converts RouteGraphicsState JSON to AST
 * - Uses LayoutCalculator for position calculations
 * - Creates hierarchical AST structure
 * - Resolves all dimensions before rendering
 */
class ASTParser {
  /**
   * Parse RouteGraphicsState to AST
   * @param {RouteGraphicsState} state - Input state
   * @returns {AST} Parsed AST
   */
  parse(state) {}

  /**
   * Parse individual element to AST node
   * @param {BaseElement} element - Element to parse
   * @param {LayoutCalculator} calculator - Layout calculator instance
   * @returns {ASTNode} Parsed AST node
   */
  parseElement(element, calculator) {}
}
```

### Phase 2: Rendering System

#### 2.1 AST Renderer (`src/ast/renderer.js`)
```javascript
/**
 * Renders AST to PixiJS scene
 * - No calculations, only rendering
 * - Handles diffing between AST versions
 * - Manages PixiJS object lifecycle
 */
class ASTRenderer {
  /**
   * Render AST to PixiJS stage
   * @param {Application} app - PixiJS application
   * @param {Container} stage - PixiJS stage container
   * @param {AST} ast - AST to render
   * @param {AST} [prevAST] - Previous AST for diffing
   * @returns {Promise<void>}
   */
  render(app, stage, ast, prevAST) {}

  /**
   * Create PixiJS object from AST node
   * @param {ASTNode} node - AST node
   * @returns {DisplayObject} PixiJS display object
   */
  createPixiObject(node) {}

  /**
   * Update existing PixiJS object from AST node
   * @param {DisplayObject} pixiObj - Existing PixiJS object
   * @param {ASTNode} node - New AST node
   */
  updatePixiObject(pixiObj, node) {}
}
```

#### 2.2 AST Diffing (`src/diff/ast-diff.js`)
```javascript
/**
 * Calculates differences between AST versions
 * - Replaces diffElements() functionality
 * - Works with explicit x,y,width,height coordinates
 * - Optimized for performance
 */
class ASTDiffer {
  /**
   * Calculate differences between two ASTs
   * @param {AST} prevAST - Previous AST
   * @param {AST} nextAST - Next AST
   * @returns {Object} { added, updated, removed } node arrays
   */
  diff(prevAST, nextAST) {}
}
```

### Phase 3: Plugin System Refactor

#### 3.1 Base AST Plugin (`src/plugins/base/BaseASTPlugin.js`)
```javascript
/**
 * Base class for AST-compatible plugins
 * - Works with AST nodes instead of raw elements
 * - Separates calculation from rendering logic
 */
class BaseASTPlugin {
  /**
   * Calculate AST node properties (parse phase)
   * @param {BaseElement} element - Input element
   * @param {LayoutCalculator} calculator - Layout calculator
   * @returns {Object} Additional AST properties
   */
  calculateNodeProperties(element, calculator) {}

  /**
   * Create PixiJS object (render phase)
   * @param {ASTNode} node - AST node
   * @param {Application} app - PixiJS application
   * @returns {DisplayObject} PixiJS object
   */
  createPixiObject(node, app) {}

  /**
   * Update PixiJS object (render phase)
   * @param {DisplayObject} pixiObj - Existing object
   * @param {ASTNode} node - New AST node
   */
  updatePixiObject(pixiObj, node) {}
}
```

### Phase 4: Main Class Integration

#### 4.1 Updated RouteGraphics Class
Key changes to `src/RouteGraphics.js`:

```javascript
class RouteGraphics extends BaseRouteGraphics {
  constructor() {
    super();
    this._parser = new ASTParser();
    this._renderer = new ASTRenderer();
    this._differ = new ASTDiffer();
    this._lastAST = null;
  }

  /**
   * Updated render method using 2-phase pipeline
   * @param {RouteGraphicsState} state - Input state
   */
  render(state) {
    // Phase 1: Parse JSON to AST
    const startTime = Date.now();
    const ast = this._parser.parse(state);
    console.log(`Parse phase: ${Date.now() - startTime}ms`);

    // Phase 2: Render AST to PixiJS
    const renderStart = Date.now();
    this._renderer.render(this._app, this._app.stage, ast, this._lastAST);
    console.log(`Render phase: ${Date.now() - renderStart}ms`);

    this._lastAST = ast;
    this._state = state;
  }
}
```

## Implementation Timeline

### Day 1
- [ ] Create AST types
- [ ] Implement LayoutCalculator core functionality
- [ ] Set up basic file structure
- [ ] Implement ASTParser class
- [ ] Add text dimension calculation
- [ ] Add container layout resolution
- [ ] Write parser unit tests

### Day 2
- [ ] Implement ASTRenderer class
- [ ] Implement ASTDiffer class
- [ ] Add PixiJS object creation/update logic
- [ ] Write renderer unit tests
- [ ] Create BaseASTPlugin class
- [ ] Refactor existing plugins to use AST
- [ ] Update plugin registration system
- [ ] Write plugin tests
- [ ] Update main RouteGraphics class
- [ ] Integration testing