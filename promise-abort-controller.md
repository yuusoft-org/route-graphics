# Migration Plan: RxJS to Promises with AbortController

## Executive Summary

This document analyzes the feasibility of migrating from RxJS Observables to Promises with AbortController for cancellation in the RouteGraphics codebase.

**Conclusion: The migration is feasible and recommended.** The codebase uses RxJS primarily for cancellation, which can be effectively replaced with AbortController.

## Current RxJS Usage Analysis

### Files Using RxJS
1. **Core File:**
   - `src/RouteGraphics.js` - Main orchestrator

2. **Plugin Files:**
   - `src/plugins/elements/SpriteRendererPlugin.js`
   - `src/plugins/elements/TextRendererPlugin.js`
   - `src/plugins/elements/ContainerRendererPlugin.js`
   - `src/plugins/elements/RectRendererPlugin.js`
   - `src/plugins/transitions/KeyframeTransitionPlugin.js`

### RxJS Operators Used
- `Observable` - For creating cancellable async operations
- `from` - Converting arrays to observables
- `mergeMap` - Running operations in parallel
- `finalize` - Cleanup logic
- `tap` - Side effects (minimal usage)

### Current Cancellation Pattern

The codebase follows a consistent pattern:

1. **Observable Creation**: Each plugin method returns an Observable
2. **Subscription Management**: Subscriptions are stored and unsubscribed on cancellation
3. **Cleanup**: Return functions handle unsubscription and resource cleanup

Example pattern:
```javascript
add = (app, options) => {
  return new Observable((observer) => {
    // Setup logic
    
    const subscription = from(transitionObservables)
      .pipe(mergeMap((task$) => task$))
      .subscribe({
        error: (err) => console.error("Error:", err),
        complete: () => observer.complete(),
      });

    return () => {
      subscription.unsubscribe();
      // Additional cleanup
    };
  });
};
```

## Proposed Promise + AbortController Pattern

### New Pattern
```javascript
add = async (app, options, signal) => {
  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }

  // Setup logic
  
  // Handle transitions in parallel
  const transitionPromises = transitions.map(transition => 
    transitionClass.add(app, sprite, transition, signal)
  );
  
  // Run all transitions
  await Promise.all(transitionPromises);
  
  // Return cleanup function if needed
  return () => {
    // Cleanup resources like sprite.destroy()
  };
};
```

## Migration Strategy

### Phase 1: Core Infrastructure
1. Update `BaseRendererPlugin` interface to use Promises
2. Modify `RouteGraphics._render` to use AbortController
3. Update type definitions

### Phase 2: Plugin Migration
1. Migrate transition plugins (simpler, fewer dependencies)
2. Migrate renderer plugins one by one
3. Update tests for each plugin

### Phase 3: Cleanup
1. Remove RxJS dependency from package.json
2. Update documentation
3. Performance testing

## Implementation Details

### Key Simplification
Unlike the event listener approach sometimes seen in examples, we don't need to use `signal.addEventListener('abort', ...)` for most cases. The AbortSignal is primarily used for:
- Checking `signal.aborted` to exit early from operations
- Passing to APIs that accept AbortSignal (like fetch)
- The actual abort happens externally via `controller.abort()`

### 1. Managing Parallel Operations
**Current (RxJS):**
```javascript
from(actions).pipe(mergeMap((task$) => task$))
```

**New (Promise):**
```javascript
await Promise.all(actions.map(action => action(signal)))
```

### 2. Cancellation Propagation
**Current (RxJS):**
```javascript
this._currentSubscription?.unsubscribe();
```

**New (AbortController):**
```javascript
this._currentAbortController?.abort();
this._currentAbortController = new AbortController();
```

### 3. Cleanup Pattern
**Current (RxJS):**
```javascript
return () => {
  subscription.unsubscribe();
  sprite.destroy();
};
```

**New (Promise-based):**
```javascript
// Main render method in RouteGraphics
try {
  await Promise.all(actions);
} catch (error) {
  if (error.name === 'AbortError') {
    // Handle cleanup for aborted operations
    cleanupResources();
  }
  throw error;
}
```

The key difference is that cleanup happens at the orchestration level when catching abort errors, rather than registering event listeners in each method.

### 4. Animation Frame Handling
For `KeyframeTransitionPlugin`, we need special handling:
```javascript
add = async (app, sprite, transition, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operation aborted', 'AbortError'));
      return;
    }

    const effect = (time) => {
      if (signal?.aborted) {
        app.ticker.remove(effect);
        reject(new DOMException('Operation aborted', 'AbortError'));
        return;
      }
      
      // Animation logic
      currentTimeDelta += time.deltaMS;
      
      if (currentTimeDelta >= maxDuration) {
        app.ticker.remove(effect);
        resolve();
      }
    };
    
    app.ticker.add(effect);
  });
};
```

## Unknowns and Risks

### Unknowns
1. **Performance Impact**: Need to benchmark Promise.all vs mergeMap for large numbers of parallel operations
2. **Memory Usage**: AbortController vs RxJS subscription memory footprint
3. **Browser Compatibility**: AbortController requires modern browsers (but this is likely not an issue)

### Risks
1. **Breaking Changes**: Plugin API will change, affecting any external plugins
2. **Error Handling**: Promise error propagation differs from Observable error handling
3. **Testing Coverage**: Need to ensure all cancellation scenarios are tested

### Mitigation Strategies
1. **Gradual Migration**: Migrate one plugin at a time with thorough testing
2. **Compatibility Layer**: Temporarily support both patterns during migration
3. **Performance Testing**: Benchmark before and after migration
4. **Comprehensive Tests**: Add specific cancellation scenario tests

## Decisions Needed

1. **API Design**: Should we pass AbortSignal as a parameter or use a different pattern?
   - Option A: Pass signal to every method
   - Option B: Store signal in plugin instance
   - **Recommendation**: Option A for clarity and flexibility

2. **Error Handling**: How should we handle abort errors?
   - Option A: Throw DOMException (standard approach)
   - Option B: Silent cancellation
   - **Recommendation**: Option A with proper error catching at top level

3. **Backward Compatibility**: Should we maintain the Observable API temporarily?
   - Option A: Clean break, update all at once
   - Option B: Support both patterns temporarily
   - **Recommendation**: Option A for cleaner codebase

4. **Testing Strategy**: How extensive should cancellation testing be?
   - **Recommendation**: Add specific test suite for cancellation scenarios

## Benefits of Migration

1. **Reduced Bundle Size**: Removing RxJS will significantly reduce bundle size
2. **Simpler Mental Model**: Promises are more widely understood than Observables
3. **Native Browser API**: AbortController is a standard web API
4. **Better DevTools Support**: Promises have better debugging support
5. **Easier Maintenance**: Less abstraction, more straightforward code

## Conclusion

The migration from RxJS to Promises with AbortController is:
- **Feasible**: The codebase uses RxJS in a limited way that maps well to AbortController
- **Beneficial**: Will reduce complexity and bundle size
- **Low Risk**: With proper testing and gradual migration

The main use of RxJS is for cancellation, which AbortController handles natively. The migration will result in cleaner, more maintainable code with better performance characteristics.