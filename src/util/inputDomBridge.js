const DEFAULT_HIDDEN_OPACITY = "0";

const getSelectionValue = (element, key) => {
  const value = element?.[key];

  return typeof value === "number" ? value : 0;
};

const getSnapshot = (entry) => ({
  value: entry.element.value ?? "",
  selectionStart: getSelectionValue(entry.element, "selectionStart"),
  selectionEnd: getSelectionValue(entry.element, "selectionEnd"),
  focused: document.activeElement === entry.element,
  composing: entry.composing === true,
});

const isSnapshotEqual = (left, right) => {
  if (!left || !right) return false;

  return (
    left.value === right.value &&
    left.selectionStart === right.selectionStart &&
    left.selectionEnd === right.selectionEnd &&
    left.focused === right.focused &&
    left.composing === right.composing
  );
};

const isTextControlTarget = (target) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

const applyPointerInteractivity = (entry) => {
  entry.element.style.pointerEvents = "none";
};

const setSelection = (element, start, end) => {
  if (typeof element?.setSelectionRange !== "function") {
    return;
  }

  try {
    element.setSelectionRange(start, end);
  } catch {
    // Browser selection APIs are inconsistent across input types.
  }
};

const getClientGeometryRect = ({ app, geometry }) => {
  const canvas = app.canvas;

  if (!geometry || !canvas || geometry.visible === false) {
    return null;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const rendererWidth = app.renderer?.width || canvasRect.width || 1;
  const rendererHeight = app.renderer?.height || canvasRect.height || 1;
  const scaleX = canvasRect.width / rendererWidth;
  const scaleY = canvasRect.height / rendererHeight;
  const clipInsets = geometry.clipInsets ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const left = canvasRect.left + (geometry.x + clipInsets.left) * scaleX;
  const top = canvasRect.top + (geometry.y + clipInsets.top) * scaleY;
  const right =
    canvasRect.left + (geometry.x + geometry.width - clipInsets.right) * scaleX;
  const bottom =
    canvasRect.top +
    (geometry.y + geometry.height - clipInsets.bottom) * scaleY;

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
  };
};

const getRendererPoint = ({ app, clientX, clientY }) => {
  const canvas = app.canvas;

  if (!canvas || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const rendererWidth = app.renderer?.width || canvasRect.width || 1;
  const rendererHeight = app.renderer?.height || canvasRect.height || 1;
  const scaleX = canvasRect.width / rendererWidth;
  const scaleY = canvasRect.height / rendererHeight;

  if (scaleX <= 0 || scaleY <= 0) {
    return null;
  }

  return {
    x: (clientX - canvasRect.left) / scaleX,
    y: (clientY - canvasRect.top) / scaleY,
  };
};

const isPointerWithinEntryGeometry = ({ app, entry, event }) => {
  const geometry = entry.options.getGeometry?.();
  const visibleRect = getClientGeometryRect({ app, geometry });
  const clientX = event.clientX;
  const clientY = event.clientY;

  const isWithinVisibleRect =
    Boolean(visibleRect) &&
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    clientX >= visibleRect.left &&
    clientX <= visibleRect.right &&
    clientY >= visibleRect.top &&
    clientY <= visibleRect.bottom;

  if (!isWithinVisibleRect) {
    return false;
  }

  if (typeof entry.options.hitTest !== "function") {
    return true;
  }

  const rendererPoint = getRendererPoint({ app, clientX, clientY });

  return Boolean(rendererPoint && entry.options.hitTest(rendererPoint));
};

export const createInputDomBridge = ({ app }) => {
  const entries = new Map();
  let root;
  let activeId = null;
  const isLive = (entry) => !entry.disposed && entries.get(entry.id) === entry;
  const notifyEntry = (entry, name, ...args) => {
    if (isLive(entry)) return entry.callbacks[name]?.(...args);
  };

  const ensureRoot = () => {
    if (!root) {
      root = document.createElement("div");
      root.dataset.routeGraphicsInputBridge = "true";
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.top = "0";
      root.style.pointerEvents = "none";
      root.style.zIndex = "1000";
      root.style.width = "0";
      root.style.height = "0";
    }

    const host = app.canvas?.parentNode ?? document.body;

    if (!root.isConnected) {
      host.appendChild(root);
    }
  };

  const notifySnapshot = (entry, previousSnapshot = entry.lastSnapshot) => {
    if (!isLive(entry)) return;
    const snapshot = getSnapshot(entry);

    if (snapshot.focused && activeId !== entry.id) {
      activeId = entry.id;
    } else if (!snapshot.focused && activeId === entry.id) {
      activeId = null;
    }

    applyPointerInteractivity(entry, activeId);

    if (previousSnapshot?.value !== snapshot.value) {
      notifyEntry(entry, "onValueChange", snapshot);
    }

    if (
      previousSnapshot?.selectionStart !== snapshot.selectionStart ||
      previousSnapshot?.selectionEnd !== snapshot.selectionEnd ||
      previousSnapshot?.focused !== snapshot.focused ||
      previousSnapshot?.composing !== snapshot.composing
    ) {
      notifyEntry(entry, "onSelectionChange", snapshot);
    }

    entry.lastSnapshot = snapshot;
  };

  const updateElementAttributes = (entry) => {
    const {
      disabled = false,
      multiline = false,
      maxLength,
      textStyle,
      padding,
      placeholder = "",
      autocomplete = "off",
      autocapitalize = "off",
      spellcheck = false,
    } = entry.options;
    const { element } = entry;

    if (element instanceof HTMLInputElement) {
      element.type = "text";
    }

    element.disabled = disabled;
    element.placeholder = placeholder;
    element.autocomplete = autocomplete;
    element.autocapitalize = autocapitalize;
    element.spellcheck = Boolean(spellcheck);
    element.style.opacity = DEFAULT_HIDDEN_OPACITY;
    element.style.color = "transparent";
    element.style.caretColor = "transparent";
    element.style.background = "transparent";
    element.style.paddingTop = `${padding.top}px`;
    element.style.paddingRight = `${padding.right}px`;
    element.style.paddingBottom = `${padding.bottom}px`;
    element.style.paddingLeft = `${padding.left}px`;
    const fontFamily = textStyle?.fontFamily ?? "Arial";
    element.style.fontFamily = Array.isArray(fontFamily)
      ? fontFamily.join(", ")
      : fontFamily;
    element.style.fontSize = `${textStyle?.fontSize ?? 16}px`;
    element.style.fontWeight = textStyle?.fontWeight ?? "400";
    element.style.textAlign = textStyle?.align ?? "left";
    element.style.lineHeight =
      typeof textStyle?.lineHeight === "number"
        ? `${textStyle.lineHeight}px`
        : "normal";
    element.style.whiteSpace = multiline ? "pre" : "nowrap";
    element.style.overflowWrap = "normal";
    element.style.resize = "none";
    element.style.overflow = "hidden";

    if (typeof maxLength === "number") {
      element.maxLength = maxLength;
    } else {
      element.removeAttribute("maxLength");
    }

    element.tabIndex = -1;

    if (multiline && element instanceof HTMLTextAreaElement) {
      element.wrap = "off";
      element.rows = 1;
    }

    applyPointerInteractivity(entry, activeId);
  };

  const syncGeometry = (entry) => {
    ensureRoot();

    const canvas = app.canvas;
    const geometry = entry.options.getGeometry?.();

    if (!canvas || !geometry || geometry.visible === false) {
      entry.element.style.display = "none";
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const rendererWidth = app.renderer?.width || canvasRect.width || 1;
    const rendererHeight = app.renderer?.height || canvasRect.height || 1;
    const scaleX = canvasRect.width / rendererWidth;
    const scaleY = canvasRect.height / rendererHeight;
    const clipInsets = geometry.clipInsets ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const scaledClipInsets = {
      top: clipInsets.top * scaleY,
      right: clipInsets.right * scaleX,
      bottom: clipInsets.bottom * scaleY,
      left: clipInsets.left * scaleX,
    };

    entry.element.style.display = "block";
    entry.element.style.left = `${canvasRect.left + geometry.x * scaleX}px`;
    entry.element.style.top = `${canvasRect.top + geometry.y * scaleY}px`;
    entry.element.style.width = `${geometry.width * scaleX}px`;
    entry.element.style.height = `${geometry.height * scaleY}px`;

    const hasClipInsets = Object.values(scaledClipInsets).some(
      (value) => value > 0,
    );

    entry.element.style.clipPath = hasClipInsets
      ? `inset(${scaledClipInsets.top}px ${scaledClipInsets.right}px ${scaledClipInsets.bottom}px ${scaledClipInsets.left}px)`
      : "none";
  };

  const onDocumentPointerDown = (event) => {
    if (!activeId) return;

    const activeEntry = entries.get(activeId);
    const target = event.target;

    if (!activeEntry || target === activeEntry.element) return;
    if (activeEntry.element.contains(target)) return;
    if (isTextControlTarget(target) && root?.contains(target)) return;
    if (isPointerWithinEntryGeometry({ app, entry: activeEntry, event })) {
      return;
    }
    activeEntry.element.blur();
  };

  const tick = () => {
    for (const entry of entries.values()) {
      syncGeometry(entry);

      if (!entry.lastSnapshot) {
        entry.lastSnapshot = getSnapshot(entry);
        continue;
      }

      const snapshot = getSnapshot(entry);

      if (!isSnapshotEqual(snapshot, entry.lastSnapshot)) {
        notifySnapshot(entry, entry.lastSnapshot);
      }
    }
  };

  const createControlElement = ({ id, options }) => {
    const element =
      options.multiline === true
        ? document.createElement("textarea")
        : document.createElement("input");

    element.dataset.routeGraphicsInputId = id;
    element.style.position = "fixed";
    element.style.border = "none";
    element.style.outline = "none";
    element.style.margin = "0";
    element.style.boxSizing = "border-box";
    element.style.borderRadius = "0";
    element.style.transformOrigin = "top left";
    element.style.appearance = "none";
    element.style.boxShadow = "none";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";

    return element;
  };

  const attachListeners = (entry) => {
    const { id, element } = entry;
    const isCurrentControl = () => isLive(entry) && entry.element === element;
    const listen = (type, callback) =>
      element.addEventListener(type, (event) => {
        if (isCurrentControl()) callback(event);
      });

    const syncFromDom = () => {
      if (isCurrentControl()) notifySnapshot(entry);
    };

    listen("focus", () => {
      if (entry.pendingBlurTimer) {
        clearTimeout(entry.pendingBlurTimer);
        entry.pendingBlurTimer = null;
      }
      activeId = id;
      applyPointerInteractivity(entry, activeId);
      const snapshot = getSnapshot(entry);
      entry.lastSnapshot = snapshot;
      notifyEntry(entry, "onFocus", snapshot);
      notifyEntry(entry, "onSelectionChange", snapshot);
    });

    listen("blur", () => {
      if (activeId === id) {
        activeId = null;
      }
      applyPointerInteractivity(entry, activeId);
      entry.pendingBlurTimer = setTimeout(() => {
        entry.pendingBlurTimer = null;
        if (!isCurrentControl()) return;
        const snapshot = getSnapshot(entry);

        if (snapshot.focused) {
          entry.lastSnapshot = snapshot;
          return;
        }
        entry.lastSnapshot = snapshot;
        notifyEntry(entry, "onBlur", snapshot);
        notifyEntry(entry, "onSelectionChange", snapshot);
      }, 0);
    });

    listen("input", syncFromDom);
    listen("select", syncFromDom);
    listen("click", () => queueMicrotask(syncFromDom));
    listen("keyup", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      queueMicrotask(syncFromDom);
    });
    listen("keydown", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (entry.composing || event.isComposing || event.keyCode === 229) return;
      const submitOnEnter = entry.options.submitOnEnter !== false;
      const shouldConsumeEnter = entry.options.submitOnEnter === false;
      const hasSubmitCallback = typeof entry.callbacks.onSubmit === "function";
      const isSingleLineEnter =
        event.key === "Enter" &&
        entry.options.multiline !== true &&
        !event.shiftKey;
      const shouldSubmitSingleLine =
        isSingleLineEnter && submitOnEnter && hasSubmitCallback;
      const shouldSubmitMultiline =
        event.key === "Enter" &&
        entry.options.multiline === true &&
        (event.ctrlKey || event.metaKey) &&
        submitOnEnter &&
        hasSubmitCallback;

      if (
        isSingleLineEnter ||
        shouldSubmitMultiline ||
        (event.key === "Enter" && shouldConsumeEnter)
      ) {
        event.preventDefault();
      }

      if (shouldSubmitSingleLine || shouldSubmitMultiline) {
        notifyEntry(entry, "onSubmit", getSnapshot(entry), event);
      }

      if (event.key === "Escape") {
        element.blur();
      }

      queueMicrotask(syncFromDom);
    });
    listen("compositionstart", () => {
      entry.composing = true;
      const snapshot = getSnapshot(entry);
      entry.lastSnapshot = snapshot;
      notifyEntry(entry, "onCompositionStart", snapshot);
      notifyEntry(entry, "onSelectionChange", snapshot);
    });
    listen("compositionupdate", () => {
      const snapshot = getSnapshot(entry);
      entry.lastSnapshot = snapshot;
      notifyEntry(entry, "onCompositionUpdate", snapshot);
      notifyEntry(entry, "onSelectionChange", snapshot);
    });
    listen("compositionend", () => {
      entry.composing = false;
      syncFromDom();
      notifyEntry(entry, "onCompositionEnd", getSnapshot(entry));
    });
  };

  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  app.ticker?.add?.(tick);

  const mount = (id, options) => {
    ensureRoot();

    const existingEntry = entries.get(id);

    if (existingEntry) {
      existingEntry.options = options;
      existingEntry.owner = options.owner;
      existingEntry.callbacks = options.callbacks ?? {};
      updateElementAttributes(existingEntry);
      syncGeometry(existingEntry);
      if (
        typeof options.value === "string" &&
        existingEntry.element.value !== options.value
      ) {
        existingEntry.element.value = options.value;
      }
      existingEntry.lastSnapshot = getSnapshot(existingEntry);
      return existingEntry.element;
    }

    const entry = {
      id,
      owner: options.owner,
      element: createControlElement({ id, options }),
      options,
      callbacks: options.callbacks ?? {},
      composing: false,
      pendingBlurTimer: null,
      lastSnapshot: null,
    };

    attachListeners(entry);

    if (typeof options.value === "string") {
      entry.element.value = options.value;
    }

    updateElementAttributes(entry);
    root.appendChild(entry.element);
    entries.set(id, entry);
    syncGeometry(entry);
    entry.lastSnapshot = getSnapshot(entry);
    return entry.element;
  };

  const update = (id, options) => {
    const entry = entries.get(id);

    if (!entry) {
      return mount(id, options);
    }

    const requiresReplacement =
      (options.multiline === true) !==
      entry.element instanceof HTMLTextAreaElement;

    entry.options = options;
    entry.callbacks = options.callbacks ?? {};

    if (requiresReplacement) {
      const previousElement = entry.element;
      const wasFocused = document.activeElement === previousElement;
      const previousSelectionStart = getSelectionValue(
        previousElement,
        "selectionStart",
      );
      const previousSelectionEnd = getSelectionValue(
        previousElement,
        "selectionEnd",
      );

      entry.element = createControlElement({ id, options });
      attachListeners(entry);
      previousElement.replaceWith(entry.element);
      entry.element.value =
        typeof options.value === "string"
          ? options.value
          : previousElement.value;
      updateElementAttributes(entry);
      syncGeometry(entry);
      entry.lastSnapshot = getSnapshot(entry);

      if (wasFocused && !options.disabled) {
        const control = entry.element;
        queueMicrotask(() => {
          if (!isLive(entry) || entry.element !== control) return;
          control.focus();
          if (!isLive(entry) || entry.element !== control) return;
          setSelection(
            entry.element,
            previousSelectionStart,
            previousSelectionEnd,
          );
        });
      }

      return entry.element;
    }

    if (
      typeof options.value === "string" &&
      options.value !== entry.element.value &&
      entry.composing !== true
    ) {
      entry.element.value = options.value;
    }

    updateElementAttributes(entry);
    syncGeometry(entry);
    entry.lastSnapshot = getSnapshot(entry);

    return entry.element;
  };

  /** @param {string} id @param {{selectAll?: boolean, selectionStart?: number, selectionEnd?: number}} [options] */
  const focus = (
    id,
    { selectAll = false, selectionStart, selectionEnd } = {},
  ) => {
    const entry = entries.get(id);

    if (!entry || entry.element.disabled) return;

    const isAlreadyFocused = document.activeElement === entry.element;
    activeId = id;
    applyPointerInteractivity(entry, activeId);
    if (!isAlreadyFocused) {
      entry.element.focus();
    }
    if (selectAll) {
      entry.element.select?.();
      notifySnapshot(entry, entry.lastSnapshot);
      return;
    }

    if (
      typeof selectionStart === "number" ||
      typeof selectionEnd === "number"
    ) {
      const start =
        typeof selectionStart === "number"
          ? selectionStart
          : getSelectionValue(entry.element, "selectionStart");
      const end =
        typeof selectionEnd === "number"
          ? selectionEnd
          : typeof selectionStart === "number"
            ? selectionStart
            : getSelectionValue(entry.element, "selectionEnd");

      setSelection(entry.element, start, end);
    }

    notifySnapshot(entry, entry.lastSnapshot);
  };

  const updateSelection = (id, start, end = start, { focus = false } = {}) => {
    const entry = entries.get(id);

    if (!entry || entry.element.disabled) return;

    const applySelection = () => {
      setSelection(entry.element, start, end);
      notifySnapshot(entry, entry.lastSnapshot);
    };

    if (focus && document.activeElement !== entry.element) {
      entry.element.focus();
      applySelection();
      return;
    }

    applySelection();
  };

  const blur = (id) => {
    const entry = entries.get(id);
    entry?.element.blur();
  };

  const unmount = (id, owner) => {
    const entry = entries.get(id);

    if (!entry || (owner !== undefined && entry.owner !== owner)) return;
    if (activeId === id) {
      activeId = null;
    }

    if (entry.pendingBlurTimer) {
      clearTimeout(entry.pendingBlurTimer);
      entry.pendingBlurTimer = null;
    }

    entry.disposed = true;
    entries.delete(id);
    entry.element.remove();

    if (entries.size === 0) {
      root?.remove();
    }
  };

  const destroy = () => {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    app.ticker?.remove?.(tick);

    for (const entry of entries.values()) {
      entry.disposed = true;
      if (entry.pendingBlurTimer) {
        clearTimeout(entry.pendingBlurTimer);
        entry.pendingBlurTimer = null;
      }
      entry.element.remove();
    }

    entries.clear();
    activeId = null;
    root?.remove();
    root = undefined;
  };

  return {
    mount,
    update,
    focus,
    setSelection: updateSelection,
    blur,
    unmount,
    destroy,
  };
};

export default createInputDomBridge;
