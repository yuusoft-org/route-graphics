/**
 * @typedef {import('pixi.js').Application} Application
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @typedef {number | number[] | {type: string, value: number | number[]}} ShaderParameterValue
 */

/**
 * @typedef {Object} ShaderTextureDescriptor
 * @property {string} src - Texture asset alias or URL
 * @property {"clamp" | "repeat"} [wrap] - Per-texture wrap override
 * @property {boolean} [mipmap] - Per-texture mipmap override
 */

/**
 * @typedef {Object} ShaderSource
 * @property {{vertex?: string, fragment: string}} webgl - Pixi v8 GLSL source
 * @property {{source: string}} webgpu - WGSL source defining mainVertex and mainFragment
 */

/**
 * @typedef {Object} ShaderPass
 * @property {string} [id] - Pass id within a multi-pass effect
 * @property {ShaderSource} source - Inline WebGL and WebGPU source
 * @property {Object<string, ShaderParameterValue>} [uniforms] - Pass-local static uniforms
 * @property {Object<string, string | ShaderTextureDescriptor>} [textures] - Pass-local texture inputs
 * @property {{blend?: "normal" | "add" | "multiply" | "screen", textureWrap?: "clamp" | "repeat", mipmap?: boolean}} [pipeline] - Blend and default texture sampling
 * @property {{grid: [number, number]}} [mesh] - Geometry subdivision
 * @property {number} [padding] - Extra output bounds in logical pixels
 * @property {number | "inherit"} [resolution] - Filter render resolution
 * @property {boolean | "on" | "off" | "inherit"} [antialias] - Pass antialiasing
 * @property {boolean} [clipToViewport] - Whether output is clipped to the viewport
 * @property {boolean} [time] - Whether this pass receives deterministic uTime
 */

/**
 * @typedef {Object} ShaderFilter
 * @property {string} [id] - Stable id; required for element filters and optional for compositors
 * @property {"shader"} type - Inline shader effect type
 * @property {Object<string, ShaderParameterValue>} [parameters] - Mutable public parameters
 * @property {Object<string, ShaderParameterValue>} [uniforms] - Legacy alias for parameters
 * @property {ShaderSource} [source] - Inline single-pass WebGL and WebGPU source
 * @property {ShaderPass[]} [passes] - Inline multi-pass effect chain
 * @property {Object<string, string | ShaderTextureDescriptor>} [textures] - Texture inputs shared by every pass
 * @property {{blend?: "normal" | "add" | "multiply" | "screen", textureWrap?: "clamp" | "repeat", mipmap?: boolean}} [pipeline] - Pass defaults
 * @property {{grid: [number, number]}} [mesh] - Default geometry subdivision
 * @property {number} [padding] - Default pass padding
 * @property {number | "inherit"} [resolution] - Default pass resolution
 * @property {boolean | "on" | "off" | "inherit"} [antialias] - Default pass antialiasing
 * @property {boolean} [clipToViewport] - Default viewport clipping
 * @property {boolean} [time] - Whether passes receive deterministic uTime
 */

/**
 * @typedef {Object} AnimationKeyframe
 * @property {number | number[] | string} value - Segment endpoint, or delta when relative is true
 * @property {number | number[] | string} [startValue] - Explicit segment start, absolute or a delta when relative is true
 * @property {number} duration - Segment duration in milliseconds
 * @property {number} [delay=0] - Time to hold the preceding endpoint before the segment
 * @property {string} [easing="linear"] - Animation easing name
 * @property {boolean} [relative=false] - Whether numeric start and endpoint values are relative
 */

/**
 * @typedef {Object} ShaderTweenProperty
 * @property {number | number[]} [initialValue] - Optional override; otherwise inferred from the current parameter value
 * @property {Array<{value: number | number[], startValue?: number | number[], duration: number, delay?: number, easing?: string, relative?: boolean}>} keyframes - Parameter keyframes
 */

/**
 * @typedef {Object<string, ShaderTweenProperty>} ShaderTween
 * The `progress` key targets the built-in uProgress input; other keys target declared parameters.
 */

/**
 * @typedef {ShaderFilter & {tween: ShaderTween}} ShaderCompositor
 */

/**
 * @typedef {Object} BaseElement
 * @property {string} id - Unique identifier for the element
 * @property {string} type - Type of the element
 * @property {ShaderFilter[]} [filters] - Ordered inline shader effects
 */

/**
 * @typedef {Object} PositionAfterAnchorOptions
 * @property {{x: number, y: number}} position - Object with x/y coordinates
 * @property {{width: number, height: number}} dimensions - Object with width/height
 * @property {{anchorX: number, anchorY: number}} anchor - Object with anchorX/anchorY
 */

/**
 * @typedef {Object} PositionAfterAnchor
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} ParseCommonObjectOption
 * @property {number} providedWidth
 * @property {number} providedHeight
 */

/**
 * @typedef {Object} HoverProps
 * @property {string} soundSrc
 * @property {number} [soundVolume]
 * @property {string} cursor
 * @property {Object} payload
 */

/**
 * @typedef {Object} ClickProps
 * @property {string} soundSrc
 * @property {number} [soundVolume]
 * @property {Object} payload
 */

/**
 * @typedef {Object} ScrollProps
 * @property {Object} [payload]
 */

/**
 * @typedef {Object} ComputedNode
 * @property {string} type - Type of the computed node
 * @property {string} id - ID of the computed node
 * @property {number} x - X position of the computed node
 * @property {number} y - Y position of the computed node
 * @property {number} width - Width of the computed node
 * @property {number} height - Height of the computed node
 * @property {number} originX
 * @property {number} originY
 * @property {number} scaleX
 * @property {number} scaleY
 * @property {number} rotation - Rotation in degrees
 */

/**
 * @typedef {Object} BlurConfig
 * @property {number} x
 * @property {number} y
 * @property {number} quality
 * @property {5 | 7 | 9 | 11 | 13 | 15} kernelSize
 * @property {boolean} repeatEdgePixels
 */

/**
 * @typedef {Object} SpriteComputedProps
 * @property {'sprite'} type
 * @property {number} alpha
 * @property {number} [rotation] - Rotation in degrees
 * @property {string} url
 * @property {BlurConfig} [blur]
 * @property {SpriteHover} hover
 * @property {SpriteClick} click
 * @property {SpriteClick} rightClick
 * @property {ScrollProps} [scrollUp]
 * @property {ScrollProps} [scrollDown]
 * @typedef {ComputedNode & SpriteComputedProps } SpriteComputedNode
 */

/**
 * @typedef SpriteHoverProps
 * @property {string} src
 * @typedef {(SpriteHoverProps & HoverProps)} SpriteHover
 */

/**
 * @typedef SpriteClickProps
 * @property {string} src
 * @typedef {(SpriteClickProps & HoverProps)} SpriteClick
 */

/**
 * @typedef {Object} SliderComputedProps
 * @property {'slider'} type
 * @property {number} alpha
 * @property {string} direction
 * @property {string} thumbSrc
 * @property {string} barSrc
 * @property {string} [inactiveBarSrc]
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {number} initialValue
 * @property {SliderHover} hover
 * @property {SliderDrag} drag
 * @property {SliderDragStart} dragStart
 * @property {SliderDragEnd} dragEnd
 * @typedef {ComputedNode & SliderComputedProps} SliderComputedNode
 */

/**
 * @typedef {Object} SliderHover
 * @property {string} thumbSrc
 * @property {string} barSrc
 * @property {string} [inactiveBarSrc]
 * @property {string} cursor
 * @property {string} soundSrc
 */

/**
 * @typedef {Object} SliderDrag
 * @property {Object} payload
 */

/**
 * @typedef {Object} SliderDragStart
 * @property {Object} payload
 */

/**
 * @typedef {Object} SliderDragEnd
 * @property {Object} payload
 */

/**
 * @typedef {Object} AnimatedSpriteComputedProps
 * @property {'spritesheet-animation'} type
 * @property {string} src
 * @property {Object} atlas - Direct atlas frame metadata
 * @property {Object<string, string[]>} clips - Named playback clips
 * @property {number} alpha
 * @property {BlurConfig} [blur]
 * @property {Object} playback
 * @property {string[]} playback.frames - Frame names for the playback sequence
 * @property {string} [playback.clip] - Clip name resolved through `clips`
 * @property {number} playback.fps - Playback rate in frames per second
 * @property {boolean} [playback.loop=true] - Whether the animation should loop
 * @property {boolean} [playback.autoplay=true] - Whether playback starts on mount/update
 * @typedef {ComputedNode & AnimatedSpriteComputedProps} AnimatedSpriteComputedNode
 */

/**
 * @typedef {Object} ParticleTextureShape
 * @property {'circle' | 'ellipse' | 'rect'} shape - Shape type
 * @property {number} [radius] - Radius for circle shape
 * @property {number} [width] - Width for ellipse/rect shapes
 * @property {number} [height] - Height for ellipse/rect shapes
 * @property {string} [color] - Fill color (hex)
 */

/**
 * @typedef {Object} ParticleDistribution
 * @property {'uniform' | 'normal' | 'bias'} kind
 * @property {'min' | 'max' | 'center'} [toward]
 * @property {number} [strength]
 * @property {number} [mean]
 * @property {number} [deviation]
 */

/**
 * @typedef {Object} ParticleRangeValue
 * @property {number} min
 * @property {number} [max]
 * @property {ParticleDistribution} [distribution]
 */

/**
 * @typedef {Object} ParticleTextureItem
 * @property {string} [src]
 * @property {'circle' | 'ellipse' | 'rect'} [shape]
 * @property {number} [radius]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [color]
 * @property {number} [weight]
 */

/**
 * @typedef {Object} ParticleTextureSelector
 * @property {'single' | 'random' | 'cycle'} mode
 * @property {'perParticle' | 'perWave'} [pick]
 * @property {ParticleTextureItem[]} items
 */

/**
 * @typedef {string | ParticleTextureShape | ParticleTextureSelector} ParticleTexture
 */

/**
 * @typedef {Object} ParticleBehavior
 * @property {string} type - Behavior type name
 * @property {Object} [config] - Behavior-specific configuration
 */

/**
 * @typedef {Object} ParticleSpawnBounds
 * @property {number} x - X position
 * @property {number} y - Y position
 * @property {number} width - Width
 * @property {number} height - Height
 */

/**
 * @typedef {Object} ParticleEmitter
 * @property {ParticleRangeValue} lifetime - Particle lifespan in seconds
 * @property {number} frequency - Seconds between spawns (0 = burst all at once)
 * @property {number} particlesPerWave - Particles spawned per wave
 * @property {number} [maxParticles] - Maximum active particles
 * @property {number} [emitterLifetime] - How long emitter runs in seconds (-1 = infinite)
 * @property {ParticleSpawnBounds} [spawnBounds] - Recycle boundary
 * @property {boolean} [recycleOnBounds] - Recycle particles leaving bounds
 * @property {number} [seed] - Seed for deterministic randomness
 */

/**
 * @typedef {Object} ParticlesComputedProps
 * @property {'particles'} type
 * @property {number} count - Max particles count
 * @property {ParticleTexture} texture - Texture name or custom texture configuration
 * @property {ParticleBehavior[]} behaviors - Behavior configurations
 * @property {ParticleEmitter} emitter - Emitter configuration
 * @property {number} alpha - Container opacity
 * @typedef {ComputedNode & ParticlesComputedProps} ParticlesComputedNode
 */

/**
 * @typedef {Object} ParticleSource
 * @property {'point' | 'rect' | 'circle' | 'line'} kind
 * @property {Object} data
 */

/**
 * @typedef {Object} ParticleEmissionModule
 * @property {'continuous' | 'burst'} mode
 * @property {number} [rate]
 * @property {number} [burstCount]
 * @property {number} [maxActive]
 * @property {number | 'infinite'} [duration]
 * @property {number | ParticleRangeValue} particleLifetime
 * @property {ParticleSource} source
 */

/**
 * @typedef {Object} ParticleVelocityModule
 * @property {'directional' | 'radial'} kind
 * @property {number | ParticleRangeValue} speed
 * @property {number | ParticleRangeValue} [direction]
 * @property {number | ParticleRangeValue} [angle]
 */

/**
 * @typedef {Object} ParticleMovementModule
 * @property {ParticleVelocityModule} [velocity]
 * @property {{x: number, y: number}} [acceleration]
 * @property {number} [maxSpeed]
 * @property {boolean} [faceVelocity]
 */

/**
 * @typedef {Object} ParticleAppearanceModule
 * @property {ParticleTexture} texture
 * @property {Object} [scale]
 * @property {Object} [alpha]
 * @property {Object} [color]
 * @property {Object} [rotation]
 */

/**
 * @typedef {Object} ParticleBoundsModule
 * @property {'none' | 'recycle'} mode
 * @property {'area' | 'custom'} [source]
 * @property {number | {top: number, right: number, bottom: number, left: number}} [padding]
 * @property {ParticleSpawnBounds} [custom]
 */

/**
 * @typedef {Object} ParticleModules
 * @property {ParticleEmissionModule} emission
 * @property {ParticleMovementModule} [movement]
 * @property {ParticleAppearanceModule} appearance
 * @property {ParticleBoundsModule} [bounds]
 */

/**
 * @typedef {Object} ScrollbarVisualState
 * @property {string} src
 * @property {string} [hoverSrc]
 * @property {string} [pressSrc]
 */

/**
 * @typedef {ScrollbarVisualState & { length?: number }} ScrollbarThumbConfig
 */

/**
 * @typedef {ScrollbarVisualState & { size?: number, step?: number }} ScrollbarButtonConfig
 */

/**
 * @typedef {Object} VerticalScrollbarConfig
 * @property {number} thickness
 * @property {ScrollbarVisualState} track
 * @property {ScrollbarThumbConfig} thumb
 * @property {ScrollbarButtonConfig} [startButton]
 * @property {ScrollbarButtonConfig} [endButton]
 */

/**
 * @typedef {Object} ContainerComputedProps
 * @property {'container'} type
 * @property {'absolute' | 'horizontal' | 'vertical'} direction
 * @property {SpriteComputedNode | TextComputedNode | RectComputedNode | ContainerComputedNode} children
 * @property {number} gapX
 * @property {number} gapY
 * @property {number} rotation
 * @property {boolean} scroll
 * @property {BlurConfig} [blur]
 * @property {boolean} [anchorToBottom]
 * @property {{ vertical?: VerticalScrollbarConfig }} [scrollbar]
 * @property {HoverProps} hover
 * @property {ClickProps} click
 * @property {ClickProps} rightClick
 * @property {ScrollProps} [scrollUp]
 * @property {ScrollProps} [scrollDown]
 * @typedef {ComputedNode & ContainerComputedProps } ContainerComputedNode
 */

/**
 * @typedef {Object} SetupScrollingOptions
 * @property {Container} container - The PIXI Container to enable scrolling on
 * @property {ContainerContainerElement} element - The container element
 * @property {boolean} [interactive] - Enable wheel interaction when viewport is active
 * @property {boolean} [allowViewportWithoutScroll] - Allow masked viewport without scroll=true
 * @property {{ scrollXOffset?: number, scrollYOffset?: number, wasAtHorizontalEnd?: boolean, wasAtVerticalEnd?: boolean } | null} [previousState]
 */

/**
 * @typedef {Object} SetupClipping
 * @property {Container} container - The PIXI Container to enable scrolling on
 * @property {ContainerContainerElement} element - The container element
 */

/**
 * @typedef {Object} RenderAppOptions
 * @property {Application} app
 * @property {Container} parent
 * @property {ComputedNode[]} prevComputedTree
 * @property {ComputedNode[]} nextComputedTree
 * @property {Object[]} animations
 * @property {Function} eventHandler
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} AnimateElementsOptions
 * @property {import('./RouteGraphics').ApplicationWithSoundStage} app
 * @property {Container} parent
 * @property {SpriteComputedNode} spriteComputedNode
 * @property {Object[]} animations
 * @param {Function} params.transitionElements
 * @property {Function} signalAbortCb
 * @property {AbortSignal} signal
 */

/**
 * @typedef {Object} RectFillPoint
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} RectFillStop
 * @property {number} offset
 * @property {string} color
 */

/**
 * @typedef {Object} RectSolidFill
 * @property {'solid'} type
 * @property {string} color
 */

/**
 * @typedef {Object} RectLinearGradientFill
 * @property {'linear-gradient'} type
 * @property {RectFillPoint} [start]
 * @property {RectFillPoint} [end]
 * @property {RectFillStop[]} stops
 * @property {'local' | 'global'} [coordinateSpace]
 * @property {number} [resolution]
 * @property {'pad' | 'repeat'} [spread]
 */

/**
 * @typedef {Object} RectRadialGradientFill
 * @property {'radial-gradient'} type
 * @property {RectFillPoint} [innerCenter]
 * @property {number} [innerRadius]
 * @property {RectFillPoint} [outerCenter]
 * @property {number} [outerRadius]
 * @property {RectFillStop[]} stops
 * @property {'local' | 'global'} [coordinateSpace]
 * @property {number} [resolution]
 * @property {'pad' | 'repeat'} [spread]
 * @property {number} [scale]
 * @property {number} [rotation]
 */

/**
 * @typedef {string | RectSolidFill | RectLinearGradientFill | RectRadialGradientFill} RectFill
 */

/**
 * @typedef {Object} RectComputedProps
 * @property {'rect'} type
 * @property {RectFill} [fill] - Optional fill. When omitted, the rect renders transparent.
 * @property {Object} border
 * @property {number} border.width
 * @property {string} border.color
 * @property {number} border.alpha
 * @property {{topLeft: number, topRight: number, bottomRight: number, bottomLeft: number}} [cornerRadius]
 * @property {BlurConfig} [blur]
 * @property {string} cursor - Cursor style (e.g., "pointer")
 * @property {string} pointerDown - Event name for pointer down
 * @property {string} pointerUp - Event name for pointer up
 * @property {string} pointerMove - Event name for pointer move
 * @property {number} rotation - Rotation in degrees
 * @property {HoverProps} hover
 * @property {ClickProps} click
 * @property {ClickProps} rightClick
 * @property {ScrollProps} [scrollUp]
 * @property {ScrollProps} [scrollDown]
 * @typedef {(ComputedNode & RectComputedProps)} RectComputedNode
 */

/**
 * @typedef TextHoverProps
 * @property {Object} textStyle
 * @typedef {(TextHoverProps & HoverProps)} TextHover
 */

/**
 * @typedef TextClickProps
 * @property {Object} textStyle
 * @typedef {(TextClickProps & HoverProps)} TextClick
 */

/**
 * @typedef {Object} TextShadow
 * @property {string} [color] - Shadow color
 * @property {number} [alpha] - Shadow opacity from 0 to 1
 * @property {number} [blur] - Shadow blur radius in pixels
 * @property {number} [offsetX] - Horizontal shadow offset in pixels
 * @property {number} [offsetY] - Vertical shadow offset in pixels
 */

/**
 * @typedef {Object} TextStyle
 * @property {string} fill - Text color
 * @property {string | string[]} fontFamily - Font family or ordered fallback list
 * @property {number} fontSize - Font size in pixels
 * @property {'left' | 'center' | 'right'} align - Text alignment
 * @property {number} lineHeight - Line height multiplier
 * @property {boolean} wordWrap - Enable word wrapping
 * @property {boolean} breakWords - Allow breaking words when wrapping
 * @property {number} wordWrapWidth - Word wrap width
 * @property {string} [strokeColor] - Text stroke/outline color
 * @property {number} [strokeWidth] - Text stroke/outline width
 * @property {number} [padding] - Extra texture padding around rendered glyphs
 * @property {TextShadow | null} [shadow] - Optional text shadow
 */

/**
 * @typedef {Object} TextComputedProps
 * @property {string | Array<TextChunk>} content - The text content to display. Arrays contain static rich text lines.
 * @property {number} measuredWidth - The rendered text width before fixed-width layout is applied
 * @property {Object} textStyle - Text style object
 * @property {TextHover} [hover]
 * @property {TextClick} [click]
 * @property {TextClick} [rightClick]
 * @property {ScrollProps} [scrollUp]
 * @property {ScrollProps} [scrollDown]
 * @typedef {ComputedNode & TextComputedProps} TextComputedNode
 */

/**
 * @typedef {Object} InputPadding
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} left
 */

/**
 * @typedef {Object} InputStrokeStyle
 * @property {number} width
 * @property {string} color
 * @property {number} alpha
 */

/**
 * @typedef {Object} InputComputedProps
 * @property {'input'} type
 * @property {string} value
 * @property {string} placeholder
 * @property {boolean} multiline
 * @property {boolean} [submitOnEnter]
 * @property {boolean} disabled
 * @property {number} [maxLength]
 * @property {RectFill} fill
 * @property {InputStrokeStyle} border
 * @property {InputStrokeStyle} focusRing
 * @property {Object} textStyle
 * @property {InputPadding} padding
 * @property {Object} [change]
 * @property {Object} [submit]
 * @property {Object} [focusEvent]
 * @property {Object} [blurEvent]
 * @property {Object} [selectionChange]
 * @property {Object} [compositionStart]
 * @property {Object} [compositionUpdate]
 * @property {Object} [compositionEnd]
 * @typedef {ComputedNode & InputComputedProps} InputComputedNode
 */

/**
 * @typedef {Object} SoftWipeConfig
 * @property {number} [softness=1.25] - Multiplier applied to line height to determine feathered edge width
 * @property {'linear' | 'easeOutCubic'} [easing='linear'] - Easing curve applied to each line wipe
 * @property {number} [lineOverlap=0] - Fraction of a line's duration that the next line may overlap
 * @property {number} [lineDelay=0] - Delay in milliseconds before the next line starts after overlap is applied
 */

/**
 * @typedef {Object} TextRevealingComputedProps
 * @property {Array<TextChunk>} content - Array of processed text chunks (lines)
 * @property {number} [width] - Width constraint for text wrapping
 * @property {number} alpha - Opacity/transparency (0-1)
 * @property {Object} textStyle - Default text style
 * @property {number} [speed=50] - Animation speed on a curved 0-100 scale; 100 renders instantly
 * @property {number} [initialRevealedCharacters=0] - Number of leading text characters rendered as already revealed before the reveal animation starts
 * @property {Object} complete - Complete event
 * @property {Object} [indicator] - Settings for the text continuation indicator
 * @property {Object} [indicator.revealing] - Visual shown while text is revealing
 * @property {'image' | 'spritesheet'} [indicator.revealing.kind='image'] - Revealing indicator visual kind
 * @property {string} [indicator.revealing.src] - Source of the revealing indicator image or spritesheet
 * @property {number} [indicator.revealing.width] - Width of the revealing indicator visual
 * @property {number} [indicator.revealing.height] - Height of the revealing indicator visual
 * @property {number} [indicator.revealing.offsetX] - Revealing visual horizontal offset; falls back to indicator.offsetX
 * @property {number} [indicator.revealing.offsetY] - Revealing visual vertical offset; falls back to indicator.offsetY
 * @property {Object} [indicator.revealing.atlas] - Spritesheet atlas metadata when kind is spritesheet
 * @property {Object} [indicator.revealing.clips] - Named spritesheet clips when kind is spritesheet
 * @property {Object} [indicator.revealing.playback] - Spritesheet playback settings when kind is spritesheet
 * @property {Object} [indicator.complete] - Visual shown when text revealing is finished
 * @property {'image' | 'spritesheet'} [indicator.complete.kind='image'] - Complete indicator visual kind
 * @property {string} [indicator.complete.src] - Source of the complete indicator image or spritesheet
 * @property {number} [indicator.complete.width] - Width of the complete indicator visual
 * @property {number} [indicator.complete.height] - Height of the complete indicator visual
 * @property {number} [indicator.complete.offsetX] - Complete visual horizontal offset; falls back to indicator.offsetX
 * @property {number} [indicator.complete.offsetY] - Complete visual vertical offset; falls back to indicator.offsetY
 * @property {Object} [indicator.complete.atlas] - Spritesheet atlas metadata when kind is spritesheet
 * @property {Object} [indicator.complete.clips] - Named spritesheet clips when kind is spritesheet
 * @property {Object} [indicator.complete.playback] - Spritesheet playback settings when kind is spritesheet
 * @property {number} [indicator.offsetX=16] - Horizontal offset between the text and the indicator
 * @property {number} [indicator.offsetY=0] - Vertical adjustment from the indicator's automatic line placement; positive values move down
 * @property {'typewriter' | 'softWipe' | 'none'} [revealEffect='typewriter'] - Text reveal effect (typewriter = per-character reveal, softWipe = full-text soft mask wipe, none = skip animation)
 * @property {SoftWipeConfig} [softWipe] - Parameters for the softWipe reveal effect
 * @property {Object} [revealSound] - Sound to play while text is actively revealing
 * @property {string} revealSound.src - Source alias or URL for the reveal sound
 * @property {number} [revealSound.volume=100] - Reveal sound volume where 0 is muted and 100 is full volume
 * @property {boolean} [revealSound.loop=true] - Whether the reveal sound loops until revealing finishes
 * @property {'loopEnd' | 'immediate'} [revealSound.stopTiming='loopEnd'] - When to stop after revealing completes; loopEnd finishes the active iteration while immediate interrupts playback
 * @typedef {ComputedNode & TextRevealingComputedProps} TextRevealingComputedNode
 */

/**
 * @typedef {Object} TextChunk
 * @property {Array<TextPart>} lineParts - Text and furigana parts in this line
 * @property {number} y - Vertical position of this line
 * @property {number} lineMaxHeight - Maximum height of text in this line
 */

/**
 * @typedef {Object} TextPart
 * @property {string} text - Text content
 * @property {Object} textStyle - Text style
 * @property {number} x - Horizontal position
 * @property {number} y - Vertical position (relative to line, usually 0)
 * @property {FuriganaPart} furigana
 */

/**
 * @typedef {Object} FuriganaPart
 * @property {string} text - Furigana text
 * @property {Object} textStyle - Furigana text style
 * @property {number} x - Horizontal position relative to the parent text part
 * @property {number} y - Vertical position relative to the parent text part
 */

/**
 * @typedef {Object} PositionAfterAnchorOptions
 * @property {number} positionX
 * @property {number} positionY
 * @property {number} width
 * @property {number} height
 * @property {number} anchorX
 * @property {number} anchorY
 */

/**
 * @typedef {Object} PositionAfterAnchor
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} SpriteDimension
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} DiffElementResult
 * @property {ComputedNode[]} toAddElement
 * @property {ComputedNode[]} toDeleteElement
 * @property {{"prev":ComputedNode[],"next":ComputedNode[]}} toUpdateElement
 */

/**
 * @typedef {Object} SoundPlaybackCommand
 * @property {number} commandId - Monotonically increasing command identity
 * @property {'play' | 'pause' | 'resume' | 'stop' | 'seek'} operation - Transport operation
 * @property {number} [positionMs] - Segment-relative position for play and seek
 */

/**
 * @typedef {Object} SoundElement
 * @property {string} id - Unique identifier
 * @property {string} type - Should be "sound"
 * @property {string} src - Source of the sound
 * @property {number} [volume=100] - Volume (0-100, 100 default)
 * @property {boolean} [muted=false] - Whether the sound is muted
 * @property {number} [pan=0] - Stereo pan from -1 to 1
 * @property {boolean} [loop=false] - Whether to loop the sound
 * @property {number} [startDelayMs=0] - Delay in milliseconds before playing
 * @property {number} [playbackRate=1] - Playback speed multiplier
 * @property {number} [startAt=0] - Start offset in seconds
 * @property {number|null} [endAt=null] - Optional end time in seconds
 * @property {SoundPlaybackCommand} [playback] - Optional command-controlled playback instruction
 * @property {InlineAudioTransition} [transition] - Inline lifecycle property automation
 */

/**
 * @typedef {Object} AudioChannelPlaybackCommand
 * @property {number} commandId - Monotonically increasing command identity
 * @property {'pause' | 'resume'} operation - Channel transport operation
 */

/**
 * @typedef {Object} AudioChannelElement
 * @property {string} id - Unique identifier
 * @property {string} type - Should be "audio-channel"
 * @property {number} [volume=100] - Volume (0-100, 100 default)
 * @property {boolean} [muted=false] - Whether the channel is muted
 * @property {number} [pan=0] - Stereo pan from -1 to 1
 * @property {boolean} [loop=false] - Whether to repeat the complete child sound schedule
 * @property {'immediate' | 'loopEnd'} [interruption='immediate'] - Whether interruption stops immediately or finishes the active schedule iteration
 * @property {AudioChannelPlaybackCommand} [playback] - Optional cursor-preserving channel transport instruction
 * @property {SoundElement[]} [children=[]] - Sound nodes owned by the channel
 * @property {InlineAudioTransition} [transition] - Inline lifecycle property automation
 */

/**
 * @typedef {Object} InlineAudioTransitionKeyframe
 * @property {number} value - Absolute target value, or delta when relative is true
 * @property {number} [startValue] - Explicit segment start, absolute or a delta when relative is true
 * @property {number} duration - Ramp duration in milliseconds
 * @property {number} [delay=0] - Time to hold the preceding value before the ramp
 * @property {string} [easing="linear"] - Animation easing name
 * @property {boolean} [relative=false] - Whether value is relative to the previous value
 */

/**
 * @typedef {Object} InlineAudioTransitionTrack
 * @property {number} [initialValue] - Optional starting value before the first keyframe
 * @property {InlineAudioTransitionKeyframe[]} keyframes - Ordered property keyframes
 */

/**
 * @typedef {Object} InlineAudioTransitionPhase
 * @property {InlineAudioTransitionTrack} [volume] - Volume automation
 * @property {InlineAudioTransitionTrack} [pan] - Stereo-pan automation
 * @property {InlineAudioTransitionTrack} [playbackRate] - Playback-rate automation for sounds
 */

/**
 * @typedef {Object} InlineAudioTransition
 * @property {InlineAudioTransitionPhase} [enter] - Automation for creation or incoming replacement
 * @property {InlineAudioTransitionPhase} [update] - Automation for changed properties
 * @property {InlineAudioTransitionPhase} [exit] - Automation for removal or outgoing replacement
 */

/**
 * @typedef {Object} AudioTransitionKeyframe
 * @property {number} value - Absolute target value, or delta when relative is true
 * @property {number} [startValue] - Explicit segment start, absolute or a delta when relative is true
 * @property {number} duration - Duration to reach this value in milliseconds
 * @property {number} [delay=0] - Time to hold the preceding value before the ramp
 * @property {string} [easing="linear"] - Animation easing name
 * @property {boolean} [relative=false] - Whether value is relative to the previous value
 */

/**
 * @typedef {Object} AudioTransitionPhase
 * @property {number} [initialValue] - Optional starting value before the first keyframe
 * @property {AudioTransitionKeyframe[]} keyframes - Ordered property keyframes
 */

/**
 * @typedef {Object} AudioTransition
 * @property {string} id - Unique identifier
 * @property {string} type - Should be "audio-transition"
 * @property {string} targetId - Target sound or audio-channel id
 * @property {Object<string, Object<string, AudioTransitionPhase>>} properties - Property lifecycle keyframes
 */

/**
 * @typedef {Object} ContainerElementOptions
 * @property {number} [x] - The x-coordinate
 * @property {number} [y] - The y-coordinate
 * @property {number} [xp] - The x-coordinate in percentage
 * @property {number} [yp] - The y-coordinate in percentage
 * @property {number} [xa] - X Anchor
 * @property {number} [ya] - Y Anchor
 * @property {number} [width] - Width
 * @property {number} [height] - Height
 * @property {{ vertical?: VerticalScrollbarConfig }} [scrollbar] - Optional custom scrollbar chrome
 *
 * @typedef {BaseElement & ContainerElementOptions} ContainerElement
 */
/**
 * @readonly
 * @enum {string}
 */
export const WhiteListAnimationProps = {
  alpha: "alpha",
  x: "x",
  y: "y",
  translateX: "translateX",
  translateY: "translateY",
  scaleX: "scaleX",
  scaleY: "scaleY",
  rotation: "rotation",
  blurX: "blurX",
  blurY: "blurY",
  width: "width",
  height: "height",
  uProgress: "uProgress",
};

const RECT_STYLE_ANIMATION_PROPERTY_PATTERN =
  /^rect\.(?:width|height|fill\.(?:color|(?:start|end|innerCenter|outerCenter)\.(?:x|y)|(?:innerRadius|outerRadius|scale|rotation)|stops\.\d+\.(?:offset|color))|border\.(?:width|color|alpha)|cornerRadius\.(?:topLeft|topRight|bottomRight|bottomLeft))$/;

export const isRectStyleAnimationProperty = (property) =>
  typeof property === "string" &&
  RECT_STYLE_ANIMATION_PROPERTY_PATTERN.test(property);

export const isSupportedAnimationProperty = (property) =>
  Boolean(WhiteListAnimationProps[property]) ||
  isRectStyleAnimationProperty(property);

export const WhiteListTransitionProps = WhiteListAnimationProps;

/**
 * @readonly
 * @enum {string[]}
 */
export const TRANSITION_PROPERTY_PATH_MAP = {
  scaleX: ["scale", "x"],
  scaleY: ["scale", "y"],
  x: ["x"],
  y: ["y"],
  alpha: ["alpha"],
  rotation: ["rotation"],
  blurX: ["_routeGraphicsBlur", "x"],
  blurY: ["_routeGraphicsBlur", "y"],
  width: ["width"],
  height: ["height"],
  uProgress: ["uProgress"],
};

export const REPLACE_SUBJECT_PROPERTY_PATH_MAP = {
  x: ["x"],
  y: ["y"],
  translateX: ["x"],
  translateY: ["y"],
  scaleX: ["scale", "x"],
  scaleY: ["scale", "y"],
  alpha: ["alpha"],
  rotation: ["rotation"],
};

export const WhiteListReplaceSubjectProps = {
  x: "x",
  y: "y",
  translateX: "translateX",
  translateY: "translateY",
  alpha: "alpha",
  scaleX: "scaleX",
  scaleY: "scaleY",
  rotation: "rotation",
};

export const AnimationType = {
  UPDATE: "update",
  TRANSITION: "transition",
};

/**
 * @typedef {Object} AnimationPlayback
 * @property {"render" | "persistent"} [continuity="render"] - Whether an in-flight animation may continue across compatible renders
 * @property {number} [speed=1] - Positive finite playback speed multiplier
 * @property {boolean} [loop=false] - Whether an update animation repeats indefinitely without blocking render completion
 * @property {number | "infinite"} [repeat=0] - Additional timeline iterations; infinite is update-only
 * @property {number} [repeatDelay=0] - Non-negative integer milliseconds held between iterations
 * @property {boolean} [yoyo=false] - Alternate forward and reverse iteration direction
 */

/**
 * @readonly
 * @enum {string}
 */
export const ComputedNodeType = {
  RECT: "rect",
  TEXT: "text",
  INPUT: "input",
  CONTAINER: "container",
  SPRITE: "sprite",
  TEXT_REVEALING: "text-revealing",
  SLIDER: "slider",
  PARTICLES: "particles",
  SPRITESHEET_ANIMATION: "spritesheet-animation",
  VIDEO: "video",
};

/**
 * @readonly
 * @enum {string}
 */
export const AudioType = {
  SOUND: "sound",
};

/**
 * Default text style configuration
 * @readonly
 * @type {import('pixi.js').TextStyleOptions}
 */
export const DEFAULT_TEXT_STYLE = {
  fill: "black",
  fontFamily: "Arial",
  fontSize: 16,
  align: "left",
  lineHeight: 1.2,
  wordWrap: false,
  breakWords: false,
  strokeColor: "transparent",
  strokeWidth: 0,
  wordWrapWidth: 0,
};

/**
 * @typedef {Object} BaseAnimation
 * @property {string} id - Unique animation id
 * @property {string} targetId - ID of the element
 * @property {AnimationType[keyof AnimationType]} type - Animation structure
 * @property {AnimationPlayback} [playback] - Playback behavior
 * @property {Object & {filters?: Object<string, ShaderTween>}} [tween] - Standard update properties plus filter parameter timelines grouped by filter id
 * @property {Object} [prev] - Previous transition surface motion
 * @property {Object} [next] - Next transition surface motion
 * @property {(Object & {delay?: number}) | (Object & {delay?: number})[]} [mask] - One transition mask or an ordered mask array; normalized internally to an array
 * @property {ShaderCompositor} [compositor] - Inline transition compositor effect with co-located parameter timelines
 */

/**
 * @typedef {Object} KeyboardEventConfig
 * @property {Object} [payload] - App-defined payload merged into the emitted keyboard event
 */

/**
 * @typedef {Object} KeyboardBindingConfig
 * @property {KeyboardEventConfig} [keydown] - Keydown event configuration for the binding
 * @property {KeyboardEventConfig} [keyup] - Keyup event configuration for the binding
 */

/**
 * @typedef {Object} GlobalConfiguration
 * @property {Object} [cursorStyles] - Global cursor styles configuration
 * @property {string} [cursorStyles.default] - Default cursor style
 * @property {string} [cursorStyles.hover] - Hover cursor style
 * @property {string} [cursorStyles.disabled] - Disabled cursor style
 * @property {string} [cursorStyles.loading] - Loading cursor style
 * @property {Object<string, KeyboardBindingConfig>} [keyboard] - Global hotkey mappings keyed by the hotkeys-js combo string
 */

/**
 * @template {BaseElement} E
 * @template {BaseAnimation} T
 * @typedef {Object} RouteGraphicsState
 * @property {string} id - ID
 * @property {E[]} elements - Array of elements
 * @property {T[]} animations - Array of animations
 * @property {(SoundElement|AudioChannelElement)[]} audio - Array of audio nodes
 * @property {AudioTransition[]} audioEffects - Array of audio effects
 * @property {GlobalConfiguration} [global] - Global configuration options
 */

/**
 * @typedef {Object} RouteGraphicsInitOptions
 * @property {number} width - Width of the renderer
 * @property {number} height - Height of the renderer
 * @property {number} [backgroundColor] - Background color of the renderer as a hex number
 * @property {Function} [eventHandler] - Event handler function
 * @property {RouteGraphicsPlugins} [plugins] - Plugin groups to register
 * @property {boolean} [debug] - Whether debug mode is enabled
 * @property {Function} [onFirstRender] - Callback fired after the first render completes
 * @property {"auto" | "manual"} [animationPlaybackMode] - Initial animation playback mode
 * @property {"webgl" | "webgpu"} [rendererPreference="webgl"] - Preferred Pixi renderer backend
 * @property {boolean} [rendererFallback=true] - Whether initialization may fall back to the other backend
 */

/**
 * @typedef {Object} ElementBounds
 * @property {number} x - Axis-aligned world-space left edge
 * @property {number} y - Axis-aligned world-space top edge
 * @property {number} width - Axis-aligned world-space width
 * @property {number} height - Axis-aligned world-space height
 * @property {{x: number, y: number}[]} corners - Transformed corners in clockwise order from the local top-left
 */

/**
 * @typedef {Object} ElementBoundsPathEntry
 * @property {string} id
 * @property {string} type
 * @property {ElementBounds} bounds
 */

/**
 * @typedef {Object} ElementBoundsHit
 * @property {ElementBoundsPathEntry[]} path - Semantic path from the root element to the deepest hit descendant
 */

/**
 * @typedef {Object} RouteGraphicsPlugins
 * @property {import('./plugins/elements/elementPlugin').ElementPlugin[]} [elements]
 * @property {import('./plugins/animations/animationPlugin').AnimationPlugin[]} [animations]
 * @property {import('./plugins/audio/audioPlugin').AudioPlugin[]} [audio]
 */

/**
 * @typedef {Object} TextStyle
 * @property {'left' | 'center' | 'right'} align - The alignment of the text
 * @property {string} fill - The fill color of the text
 * @property {number} fontSize - The font family of the text
 * @property {string} fontWeight - The font weight of the text
 * @property {string} fontStyle - The font style of the text
 * @property {number} lineHeight - The line height of the text
 * @property {number} wordWrapWidth - Wrap width
 * @property {boolean} wordWrap - Whether to word wrap
 * @property {string | string[]} fontFamily - The font family or ordered fallback list of the text
 * @property {string} strokeColor - The stroke color of the text
 * @property {number} strokeWidth - The stroke width of the text
 * @property {number} [padding] - Extra texture padding around rendered glyphs
 * @property {TextShadow | null} [shadow] - Optional text shadow
 */

/**
 * @abstract
 */
export class BaseRouteGraphics {
  /**
   * Initializes the renderer with the given options
   * @param {RouteGraphicsInitOptions} options - Initialization options
   */
  init(options) {
    throw new Error("Method not implemented.");
  }

  /**
   * Renders the state
   * @param {RouteGraphicsState<any,any>} state - State to render
   */
  render(state) {
    throw new Error("Method not implemented.");
  }

  /**
   * Returns semantic element branches under a renderer-space point in
   * front-to-back paint order.
   * @param {{x: number, y: number}} point
   * @returns {ElementBoundsHit[]}
   */
  hitTestElementBounds(point) {
    throw new Error("Method not implemented.");
  }

  pauseAnimation(_animationId) {
    throw new Error("Method not implemented.");
  }

  resumeAnimation(_animationId) {
    throw new Error("Method not implemented.");
  }

  reverseAnimation(_animationId, _enabled = true) {
    throw new Error("Method not implemented.");
  }

  setAnimationDirection(_animationId, _direction) {
    throw new Error("Method not implemented.");
  }

  seekAnimation(_animationId, _timeMS, _options) {
    throw new Error("Method not implemented.");
  }

  setAnimationProgress(_animationId, _progress, _options) {
    throw new Error("Method not implemented.");
  }

  setAnimationSpeed(_animationId, _speed) {
    throw new Error("Method not implemented.");
  }

  getAnimationState(_animationId) {
    throw new Error("Method not implemented.");
  }
}

/**
 * Renderer plugin for rendering elements
 * @abstract
 * @template {BaseElement} E
 * @template {BaseAnimation} T
 */
export class BaseRendererPlugin {
  /**
   * Name of the renderer
   * @type {string}
   */
  rendererName;

  /**
   * Type of the renderer
   * @type {string}
   *
   */
  rendererType;

  /**
   * Adds an element to the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent - The parent container to add the element to
   * @param {E} options.element - The sprite element to add
   * @param {T[]} [options.animations=[]] - Array of animations
   * @param {Function} options.getAnimationByType - Function to get an animation helper by type
   * @param {Function} options.getRendererByElement
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  add = async (app, options, signal) => {
    throw new Error("Method not implemented.");
  };

  /**
   * Removes an element from the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent
   * @param {Object} options.element - The sprite element to remove
   * @param {E} options.element - The element to remove
   * @param {T[]} [options.animations=[]] - Array of animations
   * @param {Function} options.getAnimationByType - Function to get an animation helper by type
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  remove = async (app, options, signal) => {
    throw new Error("Method not implemented.");
  };

  /**
   * Updates an element on the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent
   * @param {E} options.prevElement - The previous state of the sprite element
   * @param {E} options.nextElement - The next state of the sprite element
   * @param {T[]} [options.animations=[]] - Array of animations
   * @param {Function} options.getRendererByElement
   * @param {Function} options.getAnimationByType - Function to get an animation helper by type
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  update = async (app, options, signal) => {
    throw new Error("Method not implemented.");
  };
}

/**
 *
 */
export class AbstractAnimationPlugin {
  /**
   *
   * @param {Application} app
   * @param {Container} container
   * @param {Object} animation
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  add = async (app, container, animation, signal) => {
    throw new Error("Method not implemented.");
  };

  /**
   *
   * @param {Application} app
   * @param {Container} container
   * @param {Object} animation
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  remove = async (app, container, animation, signal) => {
    throw new Error("Method not implemented.");
  };
}
