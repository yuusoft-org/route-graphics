import { Container, Graphics } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";
import { diffElements } from "../../common";
import { finalize, from, mergeMap, Observable } from "rxjs";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').BaseTransition} BaseTransition
 */

/**
 * @typedef {Object} ContainerElementOptions
 * @property {any[]} children
 * @typedef {ContainerElement & ContainerElementOptions} ContainerContainerElement
 */

/**
 * @implements {BaseRendererPlugin}
 */
export class ContainerRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "container";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {ContainerContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {Function} options.getRendererByElement
   * @param {Function} options.eventHandler
   * @param {Function} options.selectedTabId
   * @returns {Observable<undefined>}
   */
  add = (app, options) => {
    return new Observable((observer) => {
      const {
        parent,
        element: originalElement,
        transitions = [],
        getTransitionByType,
        getRendererByElement,
        eventHandler,
      } = options;

      // Create a deep clone to avoid mutating read-only element objects
      const element = structuredClone(originalElement);
      const container = new Container();
      container.label = element.id;

      const sliderRef = {};

      if (element.x !== undefined) {
        if (typeof element.x === "string" && element.x.endsWith("%")) {
          container.x =
            (Number(element.x.replace("%", "")) * app.screen.width) / 100;
        } else {
          container.x = element.x;
        }
      }

      if (element.y !== undefined) {
        if (typeof element.y === "string" && element.y.endsWith("%")) {
          container.y =
            (Number(element.y.replace("%", "")) * app.screen.height) / 100;
        } else {
          container.y = element.y;
        }
      }

      if (element.scaleX !== undefined) {
        container.scale.x = element.scaleX;
      }
      if (element.scaleY !== undefined) {
        container.scale.y = element.scaleY;
      }

      if (element.zIndex !== undefined) {
        container.zIndex = element.zIndex;
      }

      if (element.rotation !== undefined) {
        container.rotation = (element.rotation * Math.PI) / 180;
      }

      if (element.propagateEvents) {
        container.eventMode = "static";
        [
          "pointerup",
          "pointerupoutside",
          "pointerleave",
          "pointerdown",
          "pointerenter",
        ].forEach((event) => {
          container.on(event, (e) => {
            e.stopPropagation();
            for (const child of container.children) {
              child.emit(event);
            }
          });
        });
      }

      // const populateMissingHeightAndWidth = (el) => {
      //   (el.children || []).forEach((child) => {
      //     populateMissingHeightAndWidth(child);
      //   });

      //   if (el.height !== undefined && el.width !== undefined) {
      //     return;
      //   }

      //   if (el.type === "text" || el.type === "text-interactive") {
      //     const textStyle = new TextStyle({
      //       wordWrap: el.style.wordWrap || true,
      //       breakWords: !el.text.includes(" "),
      //       align: el.style.align,
      //       fill: el.style.fill,
      //       fontSize: el.style.fontSize,
      //       lineHeight: el.style.lineHeight,
      //       wordWrapWidth: el.style.wordWrapWidth,
      //       fontFamily: el.style.fontFamily,
      //       stroke: el.style.strokeColor
      //         ? {
      //             color: el.style.strokeColor,
      //             width: el.style.strokeWidth,
      //           }
      //         : undefined,
      //     });
      //     const measurements = CanvasTextMetrics.measureText(el.text, textStyle);
      //     if (el.height === undefined) {
      //       el.height = measurements.height;
      //     }
      //     if (el.width === undefined) {
      //       el.width = measurements.width;
      //     }
      //   }
      //   if (el.type === "container") {
      //     if (el.height === undefined && el.direction === "vertical") {
      //       const gap = el.gap || 0;
      //       el.height = el.children?.reduce((p, c, i) => {
      //         // Add gap for all elements except the first one
      //         return p + (c.height || 0) + (i > 0 ? gap : 0);
      //       }, 0);
      //     }

      //     if (el.width === undefined && el.direction === "horizontal") {
      //       const gap = el.gap || 0;
      //       el.width = el.children?.reduce((p, c, i) => {
      //         // Add gap for all elements except the first one
      //         return p + (c.width || 0) + (i > 0 ? gap : 0);
      //       }, 0);
      //     }
      //   }
      // };

      // populateMissingHeightAndWidth(element);
      const gap = element.gap || 0;

      let graphic = new Graphics()
        .roundRect(0, 0, element.width || 0, element.height || 0, 1)
        .fill(element.fill ? element.fill.color : "transparent");

      // Handle anchor validation even when direction is undefined
      const validAnchorValues = [0, 0.5, 1];
      const anchorX = element.anchorX ?? 0;
      const anchorY = element.anchorY ?? 0;

      if (!validAnchorValues.includes(anchorX)) {
        throw new Error(
          `Invalid anchorX value: ${anchorX}. Must be 0, 0.5, or 1`,
        );
      }
      if (!validAnchorValues.includes(anchorY)) {
        throw new Error(
          `Invalid anchorY value: ${anchorY}. Must be 0, 0.5, or 1`,
        );
      }

      if (element.direction) {
        let totalWidth;
        let totalHeight;

        if (element.direction === "horizontal") {
          totalWidth = element.children.reduce((p, c) => p + c.width + gap, 0);
          totalHeight = element.children.reduce(
            (p, c) => Math.max(p, c.height || 0),
            0,
          );
        } else if (element.direction === "vertical") {
          totalWidth = element.children.reduce(
            (p, c) => Math.max(p, c.width || 0),
            0,
          );
          totalHeight = element.children.reduce(
            (p, c) => p + c.height + gap,
            0,
          );
        }

        const anchor = { x: anchorX, y: anchorY };

        if (element.direction === "horizontal") {
          this.layoutChildren({
            element,
            anchor,
            totalWidth,
            totalHeight,
            gap,
            direction: "horizontal",
            scroll: element.scroll,
          });
        } else if (element.direction === "vertical") {
          this.layoutChildren({
            element,
            anchor,
            totalWidth,
            totalHeight,
            gap,
            direction: "vertical",
            scroll: element.scroll,
          });
        }

        // Setup scrolling functionality if needed
        this.setupScrolling({
          container,
          element,
          totalHeight,
          totalWidth,
          eventHandler,
          sliderRef,
        });

        graphic = this.createContainerGraphic(
          element,
          totalWidth,
          totalHeight,
          anchor,
        );
      }

      graphic.label = `${element.id}-container-background`;

      container.addChild(graphic);

      const renderObservables = [];

      (element.children || []).forEach((childElement) => {
        const renderer = getRendererByElement(childElement);
        
        // Adjust child coordinates based on container's anchor
        // The child coordinates should be relative to the container's anchor point
        const containerWidth = element.width || 0;
        const containerHeight = element.height || 0;
        const anchorOffsetX = anchorX * containerWidth;
        const anchorOffsetY = anchorY * containerHeight;
        
        const adjustedChild = {
          zIndex: element.zIndex,
          ...childElement,
          x: (childElement.x || 0) + anchorOffsetX,
          y: (childElement.y || 0) + anchorOffsetY,
        };
        
        renderObservables.push(
          renderer.add(app, {
            parent: container,
            element: adjustedChild,
            transitions,
            getTransitionByType,
            getRendererByElement,
            eventHandler,
          }),
        );
      });

      const transitionPromises = [];

      for (const transition of transitions) {
        if (
          transition.elementId === element.id &&
          transition.event === TransitionEvent.Add
        ) {
          const transitionClass = getTransitionByType(transition.type);
          if (!transitionClass) {
            throw new Error(
              `Transition class not found for type ${transition.type}`,
            );
          }
          transitionPromises.push(
            transitionClass.add(app, container, transition),
          );
        }
      }
      parent.addChild(container);

      const subscription = from(renderObservables)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
          },
          complete: () => {
            // Set pivot point based on anchor values (default to 0 if not specified)
            const { width: containerWidth, height: containerHeight } =
              this.getContainerDimensions(element, container);
            const pivotX = anchorX * containerWidth;
            const pivotY = anchorY * containerHeight;
            container.pivot.x = pivotX;
            container.pivot.y = pivotY;
            observer.complete();
          },
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {ContainerContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Observable<any>}
   */
  remove = (app, options) => {
    console.log("remove container 11111111111");
    return new Observable((observer) => {
      const { parent, element } = options;
      const container = parent.getChildByName(element.id);
      if (!container) {
        console.warn(`Container with id ${element.id} not found`);
        return;
      }

      container.destroy();

      return () => {
        container.destroy();
      };
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {ContainerContainerElement} options.prevElement
   * @param {ContainerContainerElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getRendererByElement
   * @param {Function} options.getTransitionByType
   * @returns {Observable<any>}
   */
  update = (app, options) => {
    return new Observable((observer) => {
      const {
        parent,
        prevElement: originalPrevElement,
        nextElement: originalNextElement,
        getRendererByElement,
        transitions = [],
        getTransitionByType,
        eventHandler,
      } = options;

      // Create deep clones to avoid mutating read-only element objects
      const prevElement = structuredClone(originalPrevElement);
      const nextElement = structuredClone(originalNextElement);
      const container = parent.getChildByName(prevElement.id);
      if (!container) {
        console.warn(`Container with id ${prevElement.id} not found`);
        return;
        // throw new Error(`Container with id ${prevElement.id} not found`);
      }

      if (nextElement.x !== undefined && nextElement.x !== prevElement.x) {
        container.x = nextElement.x;
      }
      if (nextElement.y !== undefined && nextElement.y !== prevElement.y) {
        container.y = nextElement.y;
      }
      if (
        nextElement.rotation !== undefined &&
        nextElement.rotation !== prevElement.rotation
      ) {
        container.rotation = (nextElement.rotation * Math.PI) / 180;
      }

      // Handle anchor validation even when direction is undefined
      const validAnchorValues = [0, 0.5, 1];
      const anchorX = nextElement.anchorX ?? 0;
      const anchorY = nextElement.anchorY ?? 0;

      if (!validAnchorValues.includes(anchorX)) {
        throw new Error(
          `Invalid anchorX value: ${anchorX}. Must be 0, 0.5, or 1`,
        );
      }
      if (!validAnchorValues.includes(anchorY)) {
        throw new Error(
          `Invalid anchorY value: ${anchorY}. Must be 0, 0.5, or 1`,
        );
      }

      // Re-layout children if direction or other layout-related properties have changed
      if (nextElement.direction) {
        const gap = nextElement.gap || 0;
        let totalWidth;
        let totalHeight;

        if (nextElement.direction === "horizontal") {
          totalWidth = nextElement.children.reduce(
            (p, c) => p + c.width + gap,
            0,
          );
          totalHeight = nextElement.children.reduce(
            (p, c) => Math.max(p, c.height || 0),
            0,
          );
        } else if (nextElement.direction === "vertical") {
          totalWidth = nextElement.children.reduce(
            (p, c) => Math.max(p, c.width || 0),
            0,
          );
          totalHeight = nextElement.children.reduce(
            (p, c) => p + c.height + gap,
            0,
          );
        }

        const anchor = { x: anchorX, y: anchorY };

        if (nextElement.direction === "horizontal") {
          this.layoutChildren({
            element: nextElement,
            anchor,
            totalWidth,
            totalHeight,
            gap,
            direction: "horizontal",
            scroll: nextElement.scroll,
          });
        } else if (nextElement.direction === "vertical") {
          this.layoutChildren({
            element: nextElement,
            anchor,
            totalWidth,
            totalHeight,
            gap,
            direction: "vertical",
            scroll: nextElement.scroll,
          });
        }

        // Update container graphic if needed
        const backgroundGraphic = container.children.find(
          (child) => child.label === `${nextElement.id}-container-background`,
        );
        if (backgroundGraphic) {
          // Remove old graphic
          backgroundGraphic.destroy();

          // Create new graphic
          const newGraphic = this.createContainerGraphic(
            nextElement,
            totalWidth,
            totalHeight,
            anchor,
          );
          newGraphic.label = `${nextElement.id}-container-background`;
          container.addChildAt(newGraphic, 0);
        }

        // Update scroll settings if needed
        if (prevElement.scroll !== nextElement.scroll) {
          this.setupScrolling({
            container,
            element: nextElement,
            totalHeight,
            totalWidth,
            eventHandler,
            sliderRef: {},
          });
        }
      }

      const $updates = [];

      const { toAddElements, toUpdateElements, toDeleteElements } =
        diffElements(prevElement.children, nextElement.children);

      for (const element of toDeleteElements) {
        const renderer = getRendererByElement(element);
        $updates.push(
          renderer.remove(app, {
            parent: container,
            element,
            transitions,
            getTransitionByType,
            getRendererByElement,
            eventHandler,
          }),
        );
      }

      for (const element of toAddElements) {
        const renderer = getRendererByElement(element);
        
        // Adjust child coordinates based on container's anchor
        const containerWidth = nextElement.width || 0;
        const containerHeight = nextElement.height || 0;
        const anchorOffsetX = anchorX * containerWidth;
        const anchorOffsetY = anchorY * containerHeight;
        
        const adjustedElement = {
          ...element,
          x: (element.x || 0) + anchorOffsetX,
          y: (element.y || 0) + anchorOffsetY,
        };
        
        $updates.push(
          renderer.add(app, {
            parent: container,
            element: adjustedElement,
            transitions,
            getTransitionByType,
            getRendererByElement,
            eventHandler,
          }),
        );
      }

      for (const element of toUpdateElements) {
        const renderer = getRendererByElement(element.next);
        
        // Apply anchor offset to updated elements, similar to how we handle added elements
        const containerWidth = nextElement.width || 0;
        const containerHeight = nextElement.height || 0;
        const anchorOffsetX = anchorX * containerWidth;
        const anchorOffsetY = anchorY * containerHeight;
        
        // Calculate previous anchor offset for comparison
        const prevAnchorX = prevElement.anchorX ?? 0;
        const prevAnchorY = prevElement.anchorY ?? 0;
        const prevContainerWidth = prevElement.width || 0;
        const prevContainerHeight = prevElement.height || 0;
        const prevAnchorOffsetX = prevAnchorX * prevContainerWidth;
        const prevAnchorOffsetY = prevAnchorY * prevContainerHeight;
        
        // Adjust coordinates if anchor or container size changed
        const adjustedPrevElement = {
          ...element.prev,
          x: (element.prev.x || 0) + prevAnchorOffsetX,
          y: (element.prev.y || 0) + prevAnchorOffsetY,
        };
        
        const adjustedNextElement = {
          ...element.next,
          x: (element.next.x || 0) + anchorOffsetX,
          y: (element.next.y || 0) + anchorOffsetY,
        };
        
        $updates.push(
          renderer.update(app, {
            parent: container,
            prevElement: adjustedPrevElement,
            nextElement: adjustedNextElement,
            transitions,
            getTransitionByType,
            getRendererByElement,
            eventHandler,
          }),
        );
      }

      // Sort children based on their order in nextElement.children
      // This ensures proper layering when zIndex is not specified
      if (nextElement.children && nextElement.children.length > 0) {
        container.children.sort((a, b) => {
          // Find the corresponding elements in nextElement.children
          const aElement = nextElement.children.find(
            (element) => element.id === a.label
          );
          const bElement = nextElement.children.find(
            (element) => element.id === b.label
          );
          
          // If both elements are found in children array
          if (aElement && bElement) {
            // First, sort by zIndex if specified
            const aZIndex = aElement.zIndex ?? 0;
            const bZIndex = bElement.zIndex ?? 0;
            if (aZIndex !== bZIndex) {
              return aZIndex - bZIndex;
            }
            
            // If zIndex is the same or not specified, maintain order from nextElement.children
            const aIndex = nextElement.children.indexOf(aElement);
            const bIndex = nextElement.children.indexOf(bElement);
            return aIndex - bIndex;
          }
          
          // Keep elements that aren't in children array at the beginning
          if (!aElement && !bElement) return 0;
          if (!aElement) return -1;
          if (!bElement) return 1;
        });
      }

      this._currentSubscription = from($updates)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
          finalize(() => {
            // Update pivot point based on anchor values
            const { width: containerWidth, height: containerHeight } =
              this.getContainerDimensions(nextElement, container);
            const pivotX = anchorX * containerWidth;
            const pivotY = anchorY * containerHeight;
            container.pivot.x = pivotX;
            container.pivot.y = pivotY;
            observer.complete();
          }),
        )
        .subscribe({
          error: (err) => {
            observer.error(err);
            console.error("Error:", err);
          },
        });

      return () => {
        this._currentSubscription?.unsubscribe();
      };
    });
  };

  /**
   * Generic layout method that handles both horizontal and vertical layouts
   * @param {Object} params - Layout parameters
   * @param {ContainerContainerElement} params.element - The container element
   * @param {Object} params.anchor - The anchor position {x, y}
   * @param {number} params.totalWidth - Total width of all children
   * @param {number} params.totalHeight - Total height of all children
   * @param {number} params.gap - Gap between children
   * @param {boolean} params.scroll - Whether the container should scroll
   * @param {'horizontal'|'vertical'} params.direction - Layout direction
   */
  layoutChildren({
    element,
    anchor,
    totalWidth,
    totalHeight,
    gap,
    direction,
    scroll,
  }) {
    const isHorizontal = direction === "horizontal";
    const mainAxis = isHorizontal ? "x" : "y";
    const crossAxis = isHorizontal ? "y" : "x";
    const mainSize = isHorizontal ? "width" : "height";
    const crossSize = isHorizontal ? "height" : "width";
    const mainTotal = isHorizontal ? totalWidth : totalHeight;
    const crossTotal = isHorizontal ? totalHeight : totalWidth;
    const mainAnchor = isHorizontal ? anchor.x : anchor.y;
    const crossAnchor = isHorizontal ? anchor.y : anchor.x;

    // Check if we need to handle wrapping (parent has defined size and not all children fit)
    // Don't wrap if scroll is enabled
    const shouldWrap =
      !scroll &&
      element[mainSize] !== undefined &&
      element[mainSize] < mainTotal;

    if (shouldWrap) {
      // Wrapping layout implementation
      let currentMainPos = 0;
      let currentCrossPos = 0;
      let currentRowHeight = 0;
      let rowStartIndex = 0;

      // First pass: Determine positions and row breaks
      (element.children || []).forEach((childElement, index) => {
        // Check if this element would overflow and needs to wrap to next line
        if (
          currentMainPos > 0 &&
          currentMainPos + childElement[mainSize] > element[mainSize]
        ) {
          // Apply alignment to the completed row
          this.alignRowElements(
            element.children.slice(rowStartIndex, index),
            mainAxis,
            mainAnchor,
            element[mainSize],
          );

          // Move to next row/column
          currentMainPos = 0;
          currentCrossPos += currentRowHeight + gap;
          currentRowHeight = 0;
          rowStartIndex = index;
        }

        // Position the element
        childElement[mainAxis] = currentMainPos;
        childElement[crossAxis] = currentCrossPos;

        // Update tracking variables
        currentMainPos += childElement[mainSize] + gap;
        currentRowHeight = Math.max(
          currentRowHeight,
          childElement[crossSize] || 0,
        );
      });

      // Handle the last row
      if (rowStartIndex < element.children.length) {
        this.alignRowElements(
          element.children.slice(rowStartIndex),
          mainAxis,
          mainAnchor,
          element[mainSize],
        );
      }
    } else {
      // Standard non-wrapping layout
      // Main axis layout
      if (mainAnchor === 0) {
        // Start alignment
        let layoutPos = 0;
        (element.children || []).forEach((childElement) => {
          childElement[mainAxis] = layoutPos;
          layoutPos += childElement[mainSize] + gap;
        });
      } else if (mainAnchor === 1) {
        // End alignment
        let layoutPos = -mainTotal;
        (element.children || []).forEach((childElement) => {
          childElement[mainAxis] = layoutPos;
          layoutPos += childElement[mainSize] + gap;
        });
      } else if (mainAnchor === 0.5) {
        // Center alignment
        let layoutPos = -mainTotal / 2;
        (element.children || []).forEach((childElement) => {
          childElement[mainAxis] = layoutPos;
          layoutPos += childElement[mainSize] + gap;
        });
      }

      // Cross axis layout
      if (crossAnchor === 0) {
        // Start alignment
        (element.children || []).forEach((childElement) => {
          childElement[crossAxis] = 0;
        });
      } else if (crossAnchor === 0.5) {
        // Center alignment
        (element.children || []).forEach((childElement) => {
          childElement[crossAxis] = -crossTotal / 2;
        });
      } else if (crossAnchor === 1) {
        // End alignment
        (element.children || []).forEach((childElement) => {
          childElement[crossAxis] = -crossTotal;
        });
      }
    }
  }

  /**
   * Aligns elements within a single row based on main axis anchor
   * @param {Array} rowElements - Elements in the current row
   * @param {string} mainAxis - Main axis ('x' or 'y')
   * @param {number} mainAnchor - Anchor position (0, 0.5, or 1)
   * @param {number} containerSize - Size of the container in the main axis
   */
  alignRowElements(rowElements, mainAxis, mainAnchor, containerSize) {
    if (!rowElements.length) return;

    // Calculate row width
    const rowSize = rowElements.reduce((total, element, index) => {
      return (
        total +
        element[mainAxis === "x" ? "width" : "height"] +
        (index > 0 ? 0 : 0)
      );
    }, 0);

    // Adjust positions based on anchor
    if (mainAnchor === 0.5) {
      // Center
      const offset = (containerSize - rowSize) / 2;
      let currentPos = offset;

      rowElements.forEach((element) => {
        element[mainAxis] = currentPos;
        currentPos += element[mainAxis === "x" ? "width" : "height"] + 0;
      });
    } else if (mainAnchor === 1) {
      // End
      const offset = containerSize - rowSize;
      let currentPos = offset;

      rowElements.forEach((element) => {
        element[mainAxis] = currentPos;
        currentPos += element[mainAxis === "x" ? "width" : "height"] + 0;
      });
    }
    // For start alignment (mainAnchor === 0), positions are already correct
  }

  /**
   * Create the container's background graphic
   * @param {ContainerContainerElement} element - The container element
   * @param {number} totalWidth - Total width of all children
   * @param {number} totalHeight - Total height of all children
   * @param {Object} anchor - The anchor position {x, y}
   * @returns {Graphics} The created graphic
   */
  createContainerGraphic(element, totalWidth, totalHeight, anchor) {
    let graphic = new Graphics()
      .roundRect(0, 0, totalWidth, totalHeight, 1)
      .fill(element.fill ? element.fill.color : "transparent");

    if (anchor.x === 1) {
      graphic.x -= element.width;
    }
    if (anchor.x === 0.5) {
      graphic.x -= element.width / 2;
    }
    if (anchor.y === 1) {
      graphic.y -= element.height;
    }
    if (anchor.y === 0.5) {
      graphic.y -= element.height / 2;
    }

    return graphic;
  }

  /**
   * Calculate container dimensions, using children bounds if no explicit dimensions
   * @param {ContainerContainerElement} element - The container element
   * @returns {Object} - Object with width and height properties
   */
  getContainerDimensions(element, container) {
    let containerWidth = element.width || 0;
    let containerHeight = element.height || 0;

    // If no direction is set and no explicit width/height, calculate from children bounds
    if (!element.direction && (!element.width || !element.height)) {
      if (container.children && container.children.length > 0) {
        // Calculate the bounding box of all children
        let minX = Infinity,
          maxX = -Infinity;
        let minY = Infinity,
          maxY = -Infinity;

        container.children.forEach((child) => {
          const childX = child.x || 0;
          const childY = child.y || 0;
          const childWidth = child.width || 0;
          const childHeight = child.height || 0;

          minX = Math.min(minX, childX);
          maxX = Math.max(maxX, childX + childWidth);
          minY = Math.min(minY, childY);
          maxY = Math.max(maxY, childY + childHeight);
        });

        if (!element.width) {
          containerWidth = maxX - minX;
          // Handle NaN case (when no valid children dimensions found)
          if (isNaN(containerWidth) || !isFinite(containerWidth)) {
            containerWidth = 0;
          }
        }
        if (!element.height) {
          containerHeight = maxY - minY;
          // Handle NaN case (when no valid children dimensions found)
          if (isNaN(containerHeight) || !isFinite(containerHeight)) {
            containerHeight = 0;
          }
        }
      }
    }

    return { width: containerWidth, height: containerHeight };
  }

  /**
   * Sets up scrolling for a container if needed
   * @param {Object} params - Scrolling parameters
   * @param {Container} params.container - The PIXI Container to enable scrolling on
   * @param {ContainerContainerElement} params.element - The container element
   * @param {number} params.totalHeight - Total height of all children
   * @param {number} params.totalWidth - Total width of all children
   * @param {Function} params.eventHandler - Function to handle events
   * @param {Object} params.sliderRef - Reference object for slider
   */
  setupScrolling({
    container,
    element,
    totalHeight,
    totalWidth,
    eventHandler,
    sliderRef,
  }) {
    // Only apply scrolling if scroll is enabled and content overflows
    const needsVerticalScroll =
      element.scroll && element.height && totalHeight > element.height;
    const needsHorizontalScroll =
      element.scroll && element.width && totalWidth > element.width;

    if (needsVerticalScroll || needsHorizontalScroll) {
      let scrollYOffset = 0;
      let scrollXOffset = 0;
      let minScrollY = -totalHeight + element.height;
      let minScrollX = -totalWidth + element.width;

      const clip = new Graphics()
        .rect(0, 0, element.width || totalWidth, element.height || totalHeight)
        .fill("red");
      container.mask = clip;
      container.eventMode = "static";

      container.addChild(clip);
      container.on("wheel", (e) => {
        // Handle vertical scrolling
        if (needsVerticalScroll && e.deltaY !== 0) {
          if (scrollYOffset - e.deltaY > 0) {
            // TODO fix small intervals at the edge
            // No-op for now
          } else if (scrollYOffset - e.deltaY < minScrollY) {
            // TODO fix small intervals at the edge
            // No-op for now
          } else {
            scrollYOffset -= e.deltaY;
            container.y -= e.deltaY;
            clip.y += e.deltaY;
          }
        }

        // Handle horizontal scrolling (shift+wheel or deltaX)
        if (
          needsHorizontalScroll &&
          (e.deltaX !== 0 || (e.shiftKey && e.deltaY !== 0))
        ) {
          const deltaX = e.deltaX !== 0 ? e.deltaX : e.deltaY;
          if (scrollXOffset - deltaX > 0) {
            // At left edge
            return;
          }
          if (scrollXOffset - deltaX < minScrollX) {
            // At right edge
            return;
          }
          scrollXOffset -= deltaX;
          container.x -= deltaX;
          clip.x += deltaX;
        }
      });
    }
  }
}
