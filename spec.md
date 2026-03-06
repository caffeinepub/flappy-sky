# Flappy Sky

## Current State
New project. No existing code.

## Requested Changes (Diff)

### Add
- A Flappy Bird-style 2D side-scrolling game with HD visuals rendered on an HTML5 Canvas
- Bird character that flaps upward on tap/click/spacebar and falls with gravity
- Endless scrolling pipe obstacles with randomized gap positions
- Score counter that increments each time the bird passes a pipe pair
- High score persistence (stored on-chain via backend)
- Start screen, game-over screen with score, and restart functionality
- HD parallax background (sky, clouds, distant hills, ground layer)
- Smooth animations: bird rotation based on velocity, pipe scroll, background layers at different speeds
- Mobile-friendly touch controls
- Sound-effect-free visual-only experience

### Modify
- N/A (new project)

### Remove
- N/A (new project)

## Implementation Plan
1. Backend: store and retrieve high score per user (anonymous principal)
2. Frontend:
   - Canvas-based game loop using requestAnimationFrame
   - Time-based physics (gravity, flap impulse, terminal velocity)
   - Bird sprite drawn with canvas arcs and gradients (no external images)
   - Pipes drawn with gradients and highlights for HD look
   - Multi-layer parallax background (sky gradient, cloud layer, hill layer, ground)
   - Collision detection (AABB with slight forgiveness margin)
   - Score display on canvas; React UI for start/game-over overlays
   - High score fetched from and saved to backend
   - Keyboard (Space/ArrowUp) + mouse click + touch support
