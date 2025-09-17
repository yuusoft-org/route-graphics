# Cursor Style Integration Plan

## Current State Analysis

The RouteGraphics library currently supports:
- **Elements**: Various element types (rect, sprite, text, container, audio) with their properties
- **Transitions**: Animation transitions between element states
- **Individual cursor properties**: Elements can specify `cursor: pointer` for per-element cursor changes

## Proposed Solution: Global Cursor Styles

Add a new `global` configuration object to the declarative state structure that allows setting PixiJS cursor styles at the application level.

### 1. State Structure Extension

Extend the `RouteGraphicsState` type to include an optional `global` property:

```typescript
RouteGraphicsState {
  elements: BaseElement[]
  transitions?: BaseTransition[]
  global?: {
    cursorStyles?: {
      default?: string
      hover?: string
      // Future extensibility for other cursor states
      disabled?: string
      loading?: string
    }
  }
}
```

### 2. Implementation Approach

#### A. Type Definition Updates (`src/types.js`)
- Add `GlobalConfiguration` typedef with cursor styles
- Update `RouteGraphicsState` to include optional `global` property

#### B. RouteGraphics Core Changes (`src/RouteGraphics.js`)
- Add global cursor style handling in the `render` method
- Apply cursor styles to `app.renderer.events.cursorStyles` when global config changes
- Ensure global cursor styles are applied before element-specific processing

#### C. Rendering Priority
1. **Global cursor styles** - Applied first as application defaults
2. **Element-specific cursor** - Override global styles for specific elements (existing behavior)

### 3. Usage Example

```yaml
states:
  - global:
      cursorStyles:
        default: "url('https://example.com/default-cursor.png'), auto"
        hover: "url('https://example.com/hover-cursor.png'), auto"
    elements:
      - id: "button-1"
        type: "rect"
        x: 100
        y: 100
        width: 50
        height: 50
        cursor: "pointer"  # This overrides global hover style for this element
```

### 4. Implementation Steps

1. **Extend types** - Add global configuration types
2. **Update diffing logic** - Ensure global config changes trigger updates
3. **Modify render method** - Apply global cursor styles to PixiJS application
4. **Maintain backward compatibility** - Existing element-level cursor properties continue to work
5. **Add tests** - Create test cases for global cursor style functionality

### 5. Benefits

- **Consistency**: Set application-wide cursor themes
- **Flexibility**: Still allows per-element cursor overrides
- **Performance**: Global styles applied once rather than per-element
- **Extensibility**: Framework ready for future global configurations (themes, fonts, etc.)

### 6. Future Considerations

The `global` configuration object can be extended for other application-level settings:
- Global fonts
- Application themes
- Default animation durations
- Global event handlers

This approach maintains the declarative nature of the library while providing the requested cursor style functionality at the application level.