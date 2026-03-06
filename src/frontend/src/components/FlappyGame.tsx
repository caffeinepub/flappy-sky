import { useActor } from "@/hooks/useActor";
import { useInternetIdentity } from "@/hooks/useInternetIdentity";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bird {
  x: number;
  y: number;
  vy: number; // vertical velocity
  angle: number; // rotation in radians
}

interface Pipe {
  x: number;
  gapY: number; // center Y of the gap
  scored: boolean;
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

interface Hill {
  x: number;
  width: number;
  height: number;
}

interface GameState {
  phase: "start" | "playing" | "dead";
  bird: Bird;
  pipes: Pipe[];
  clouds: Cloud[];
  hills: Hill[];
  score: number;
  bestScore: number;
  frameCount: number;
  groundOffset: number;
  pipeTimer: number;
  speed: number;
  lastTime: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 480;
const CANVAS_H = 640;
const GRAVITY = 1800; // px/s²
const FLAP_VY = -480; // px/s  upward impulse
const PIPE_SPEED_BASE = 180; // px/s
const PIPE_GAP = 155; // gap height px
const PIPE_WIDTH = 68;
const PIPE_SPAWN_INTERVAL = 1.8; // seconds
const GROUND_H = 80;
const BIRD_RADIUS = 18;
const SPEED_INCREMENT = 0.008; // per frame at 60fps

// Bird starting position
const BIRD_START_X = 110;
const BIRD_START_Y = CANVAS_H / 2 - 40;

// ─── Canvas Drawing Helpers ───────────────────────────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, "#0f3a6b");
  grad.addColorStop(0.35, "#1a5fa8");
  grad.addColorStop(0.65, "#3a9fd8");
  grad.addColorStop(0.82, "#7dc8e8");
  grad.addColorStop(0.92, "#b8dff4");
  grad.addColorStop(1, "#d6eef8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const blobs: [number, number, number][] = [
    [0, 0, 28],
    [28, -10, 22],
    [-28, -8, 20],
    [52, 2, 18],
    [-48, 0, 16],
    [12, -22, 18],
  ];

  // Shadow pass
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#6ab0d4";
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx + 3, by + 5, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main cloud
  ctx.globalAlpha = 0.92;
  const cloudGrad = ctx.createRadialGradient(0, -8, 2, 0, 4, 50);
  cloudGrad.addColorStop(0, "#ffffff");
  cloudGrad.addColorStop(0.6, "#e8f4ff");
  cloudGrad.addColorStop(1, "#c8e8f8");
  ctx.fillStyle = cloudGrad;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHills(ctx: CanvasRenderingContext2D, hills: Hill[]) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  const hillGrad = ctx.createLinearGradient(
    0,
    CANVAS_H * 0.55,
    0,
    CANVAS_H - GROUND_H,
  );
  hillGrad.addColorStop(0, "#5c7a5a");
  hillGrad.addColorStop(1, "#3d5e42");
  ctx.fillStyle = hillGrad;

  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H - GROUND_H);

  for (const hill of hills) {
    const peakX = hill.x + hill.width / 2;
    const peakY = CANVAS_H - GROUND_H - hill.height;
    const startX = hill.x;
    const endX = hill.x + hill.width;

    ctx.lineTo(startX, CANVAS_H - GROUND_H);
    ctx.quadraticCurveTo(peakX, peakY, endX, CANVAS_H - GROUND_H);
  }

  ctx.lineTo(CANVAS_W, CANVAS_H - GROUND_H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, offset: number) {
  // Earth band
  const earthGrad = ctx.createLinearGradient(
    0,
    CANVAS_H - GROUND_H,
    0,
    CANVAS_H,
  );
  earthGrad.addColorStop(0, "#5d8a2e");
  earthGrad.addColorStop(0.18, "#4a7a20");
  earthGrad.addColorStop(0.22, "#7a4a1a");
  earthGrad.addColorStop(1, "#5a3412");
  ctx.fillStyle = earthGrad;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, GROUND_H);

  // Grass highlight top stripe
  ctx.fillStyle = "#6db33a";
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, 8);

  // Scrolling grass tufts
  ctx.fillStyle = "#82cc46";
  const tuftsSpacing = 60;
  const tuftsCount = Math.ceil(CANVAS_W / tuftsSpacing) + 2;
  const base = CANVAS_H - GROUND_H + 8;
  for (let i = 0; i < tuftsCount; i++) {
    const tx =
      (i * tuftsSpacing - (offset % tuftsSpacing) + CANVAS_W) % CANVAS_W;
    // Small grass blade triangle
    ctx.beginPath();
    ctx.moveTo(tx, base);
    ctx.lineTo(tx - 5, base - 10);
    ctx.lineTo(tx + 3, base - 7);
    ctx.lineTo(tx + 8, base - 12);
    ctx.lineTo(tx + 12, base);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPipe(ctx: CanvasRenderingContext2D, pipe: Pipe) {
  const topH = pipe.gapY - PIPE_GAP / 2;
  const botY = pipe.gapY + PIPE_GAP / 2;
  const botH = CANVAS_H - GROUND_H - botY;
  const capH = 24;
  const capOverhang = 6;

  function drawPipeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    isTop: boolean,
  ) {
    if (h <= 0) return;
    // Pipe body gradient
    const bodyGrad = ctx.createLinearGradient(x, 0, x + w, 0);
    bodyGrad.addColorStop(0, "#4dc838");
    bodyGrad.addColorStop(0.15, "#72e84e");
    bodyGrad.addColorStop(0.45, "#3dba28");
    bodyGrad.addColorStop(0.75, "#2a8a18");
    bodyGrad.addColorStop(1, "#1a6010");
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x, y, w, h);

    // Inner sheen
    const sheenGrad = ctx.createLinearGradient(x, 0, x + w * 0.3, 0);
    sheenGrad.addColorStop(0, "rgba(255,255,255,0.18)");
    sheenGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheenGrad;
    ctx.fillRect(x, y, w * 0.3, h);

    // Cap
    const capY = isTop ? y + h - capH : y;
    const capGrad = ctx.createLinearGradient(
      x - capOverhang,
      0,
      x + w + capOverhang,
      0,
    );
    capGrad.addColorStop(0, "#3dba28");
    capGrad.addColorStop(0.12, "#72e84e");
    capGrad.addColorStop(0.45, "#4dc838");
    capGrad.addColorStop(0.75, "#2a8a18");
    capGrad.addColorStop(1, "#1a5010");
    ctx.fillStyle = capGrad;
    // Rounded cap
    const capX = x - capOverhang;
    const capW = w + capOverhang * 2;
    ctx.beginPath();
    const r = 4;
    if (isTop) {
      ctx.moveTo(capX + r, capY);
      ctx.lineTo(capX + capW - r, capY);
      ctx.quadraticCurveTo(capX + capW, capY, capX + capW, capY + r);
      ctx.lineTo(capX + capW, capY + capH);
      ctx.lineTo(capX, capY + capH);
      ctx.lineTo(capX, capY + r);
      ctx.quadraticCurveTo(capX, capY, capX + r, capY);
    } else {
      ctx.moveTo(capX, capY);
      ctx.lineTo(capX + capW, capY);
      ctx.lineTo(capX + capW, capY + capH - r);
      ctx.quadraticCurveTo(
        capX + capW,
        capY + capH,
        capX + capW - r,
        capY + capH,
      );
      ctx.lineTo(capX + r, capY + capH);
      ctx.quadraticCurveTo(capX, capY + capH, capX, capY + capH - r);
      ctx.lineTo(capX, capY);
    }
    ctx.closePath();
    ctx.fill();

    // Cap sheen
    const cSheenGrad = ctx.createLinearGradient(capX, 0, capX + capW * 0.25, 0);
    cSheenGrad.addColorStop(0, "rgba(255,255,255,0.22)");
    cSheenGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cSheenGrad;
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(capX + r, capY);
      ctx.lineTo(capX + capW * 0.25, capY);
      ctx.lineTo(capX + capW * 0.25, capY + capH);
      ctx.lineTo(capX, capY + capH);
      ctx.lineTo(capX, capY + r);
      ctx.quadraticCurveTo(capX, capY, capX + r, capY);
    } else {
      ctx.rect(capX, capY, capW * 0.25, capH);
    }
    ctx.fill();

    // Shadow on right edge
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + w - 8, y, 8, h);
  }

  drawPipeRect(pipe.x, 0, PIPE_WIDTH, topH, true);
  drawPipeRect(pipe.x, botY, PIPE_WIDTH, botH, false);
}

function drawBird(ctx: CanvasRenderingContext2D, bird: Bird) {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.angle);

  // Drop shadow
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;

  // Body gradient (warm yellow-orange)
  const bodyGrad = ctx.createRadialGradient(-4, -6, 2, 0, 0, BIRD_RADIUS + 4);
  bodyGrad.addColorStop(0, "#ffe066");
  bodyGrad.addColorStop(0.4, "#ffb820");
  bodyGrad.addColorStop(0.75, "#f07a00");
  bodyGrad.addColorStop(1, "#cc5500");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_RADIUS + 4, BIRD_RADIUS, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Wing (darker, slightly offset)
  const wingGrad = ctx.createRadialGradient(2, 6, 1, 2, 8, 14);
  wingGrad.addColorStop(0, "#e06000");
  wingGrad.addColorStop(1, "#a03800");
  ctx.fillStyle = wingGrad;
  ctx.beginPath();
  ctx.ellipse(2, 8, 12, 7, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Belly highlight
  const bellyGrad = ctx.createRadialGradient(-2, 4, 1, -2, 4, 10);
  bellyGrad.addColorStop(0, "rgba(255,255,200,0.5)");
  bellyGrad.addColorStop(1, "rgba(255,255,200,0)");
  ctx.fillStyle = bellyGrad;
  ctx.beginPath();
  ctx.ellipse(-2, 4, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // White eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(10, -5, 7, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Iris
  ctx.fillStyle = "#1a3a6a";
  ctx.beginPath();
  ctx.arc(12, -5, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(13, -5.5, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Eye shine
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(14, -7, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Beak (orange triangle)
  ctx.fillStyle = "#ff8c00";
  ctx.beginPath();
  ctx.moveTo(18, -2);
  ctx.lineTo(26, 1);
  ctx.lineTo(18, 5);
  ctx.closePath();
  ctx.fill();

  // Beak shine
  ctx.fillStyle = "rgba(255,200,50,0.5)";
  ctx.beginPath();
  ctx.moveTo(18, -2);
  ctx.lineTo(24, 0);
  ctx.lineTo(18, 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, score: number) {
  const text = String(score);
  ctx.save();
  ctx.font = "bold 52px 'Outfit', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillText(text, CANVAS_W / 2 + 3, 28 + 3);

  // White text
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, CANVAS_W / 2, 28);

  // Subtle outline
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  ctx.strokeText(text, CANVAS_W / 2, 28);

  ctx.restore();
}

function initHills(): Hill[] {
  const hills: Hill[] = [];
  let x = 0;
  while (x < CANVAS_W + 200) {
    const w = 180 + Math.random() * 220;
    const h = 60 + Math.random() * 120;
    hills.push({ x, width: w, height: h });
    x += w * 0.7;
  }
  return hills;
}

function initClouds(): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 4; i++) {
    clouds.push({
      x: Math.random() * CANVAS_W,
      y: 40 + Math.random() * 160,
      scale: 0.6 + Math.random() * 0.8,
      speed: 0.85 + Math.random() * 0.3,
    });
  }
  return clouds;
}

function initGameState(bestScore: number): GameState {
  return {
    phase: "start",
    bird: { x: BIRD_START_X, y: BIRD_START_Y, vy: 0, angle: 0 },
    pipes: [],
    clouds: initClouds(),
    hills: initHills(),
    score: 0,
    bestScore,
    frameCount: 0,
    groundOffset: 0,
    pipeTimer: 0,
    speed: 1.0,
    lastTime: 0,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FlappyGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(initGameState(0));
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const [uiPhase, setUiPhase] = useState<"start" | "playing" | "dead">("start");
  const [uiScore, setUiScore] = useState(0);
  const [uiBest, setUiBest] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Array<[string, bigint]>>([]);

  const { actor, isFetching } = useActor();
  const { identity, login } = useInternetIdentity();
  const isAuthenticated = !!identity;

  // Load best score and leaderboard on mount
  useEffect(() => {
    if (!actor || isFetching) return;
    actor
      .getScore()
      .then((s) => {
        const n = Number(s);
        stateRef.current.bestScore = n;
        setUiBest(n);
      })
      .catch(() => {});
  }, [actor, isFetching]);

  const fetchLeaderboard = useCallback(async () => {
    if (!actor || isFetching) return;
    try {
      const lb = await actor.getLeaderboard();
      setLeaderboard(lb);
    } catch {}
  }, [actor, isFetching]);

  // ── Game loop ──────────────────────────────────────────────────────────────

  const flap = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "dead") return;
    if (s.phase === "start") {
      // Start the game on first flap
      s.phase = "playing";
      s.lastTime = 0;
      setUiPhase("playing");
    }
    s.bird.vy = FLAP_VY;
    s.bird.angle = -0.45; // tilt up
  }, []);

  const resetGame = useCallback(() => {
    const best = stateRef.current.bestScore;
    const newState = initGameState(best);
    stateRef.current = newState;
    setUiPhase("start");
    setUiScore(0);
    setShowLeaderboard(false);
  }, []);

  const saveScore = useCallback(
    async (score: number) => {
      if (!actor || !isAuthenticated) return;
      try {
        await actor.saveScore(BigInt(score));
        const newBest = await actor.getScore();
        const n = Number(newBest);
        stateRef.current.bestScore = n;
        setUiBest(n);
      } catch {}
    },
    [actor, isAuthenticated],
  );
  const saveScoreRef = useRef(saveScore);
  saveScoreRef.current = saveScore;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle DPR for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    let animId = 0;

    function loop(timestamp: number) {
      const s = stateRef.current;

      // Delta time
      if (s.lastTime === 0) s.lastTime = timestamp;
      const dt = Math.min((timestamp - s.lastTime) / 1000, 0.05);
      s.lastTime = timestamp;

      // ── Update ──────────────────────────────────────────────────────────

      if (s.phase === "playing") {
        s.frameCount++;
        s.speed = Math.min(1.0 + s.frameCount * SPEED_INCREMENT * 0.5, 2.0);
        const pipeSpeed = PIPE_SPEED_BASE * s.speed;

        // Bird physics
        s.bird.vy += GRAVITY * dt;
        s.bird.y += s.bird.vy * dt;

        // Bird rotation: gradually tilt nose down when falling
        const targetAngle =
          s.bird.vy > 0
            ? Math.min((s.bird.vy / 600) * 1.1, Math.PI * 0.4)
            : s.bird.angle;
        if (s.bird.vy > 0) {
          s.bird.angle += (targetAngle - s.bird.angle) * 8 * dt;
        }

        // Ground offset
        s.groundOffset = (s.groundOffset + pipeSpeed * dt) % (CANVAS_W + 200);

        // Pipe timer
        s.pipeTimer += dt;
        if (s.pipeTimer >= PIPE_SPAWN_INTERVAL / s.speed) {
          s.pipeTimer = 0;
          const minGap = GROUND_H + PIPE_GAP / 2 + 30;
          const maxGap = CANVAS_H - GROUND_H - PIPE_GAP / 2 - 30;
          const gapY = minGap + Math.random() * (maxGap - minGap);
          s.pipes.push({ x: CANVAS_W + 10, gapY, scored: false });
        }

        // Move pipes
        for (const pipe of s.pipes) {
          pipe.x -= pipeSpeed * dt;

          // Score when bird passes center of pipe
          if (!pipe.scored && pipe.x + PIPE_WIDTH < s.bird.x) {
            pipe.scored = true;
            s.score++;
            setUiScore(s.score);
          }
        }
        // Remove off-screen pipes
        s.pipes = s.pipes.filter((p) => p.x > -PIPE_WIDTH - 20);

        // Move clouds (parallax 0.2x)
        for (const cloud of s.clouds) {
          cloud.x -= pipeSpeed * 0.2 * cloud.speed * dt;
          if (cloud.x < -120) {
            cloud.x = CANVAS_W + 80;
            cloud.y = 40 + Math.random() * 160;
            cloud.scale = 0.6 + Math.random() * 0.8;
          }
        }

        // Move hills (parallax 0.4x)
        for (const hill of s.hills) {
          hill.x -= pipeSpeed * 0.4 * dt;
        }
        // Recycle hills
        s.hills = s.hills.filter((h) => h.x + h.width > -50);
        const lastHill = s.hills[s.hills.length - 1];
        if (!lastHill || lastHill.x + lastHill.width < CANVAS_W + 200) {
          const w = 180 + Math.random() * 220;
          const h = 60 + Math.random() * 120;
          const startX = lastHill
            ? lastHill.x + lastHill.width * 0.7
            : CANVAS_W + 50;
          s.hills.push({ x: startX, width: w, height: h });
        }

        // Collision detection
        // Ground
        if (s.bird.y + BIRD_RADIUS >= CANVAS_H - GROUND_H) {
          s.bird.y = CANVAS_H - GROUND_H - BIRD_RADIUS;
          s.phase = "dead";
          setUiPhase("dead");
          void saveScoreRef.current(s.score);
        }
        // Ceiling
        if (s.bird.y - BIRD_RADIUS <= 0) {
          s.bird.y = BIRD_RADIUS;
          s.bird.vy = 0;
        }
        // Pipe AABB
        for (const pipe of s.pipes) {
          const bx = s.bird.x;
          const by = s.bird.y;
          const hitR = BIRD_RADIUS - 4; // slight forgiveness

          const topCollide =
            bx + hitR > pipe.x &&
            bx - hitR < pipe.x + PIPE_WIDTH &&
            by - hitR < pipe.gapY - PIPE_GAP / 2;

          const botCollide =
            bx + hitR > pipe.x &&
            bx - hitR < pipe.x + PIPE_WIDTH &&
            by + hitR > pipe.gapY + PIPE_GAP / 2;

          if (topCollide || botCollide) {
            s.phase = "dead";
            setUiPhase("dead");
            void saveScoreRef.current(s.score);
            break;
          }
        }
      } else if (s.phase === "start") {
        // Idle bob for bird
        s.bird.y = BIRD_START_Y + Math.sin(timestamp / 400) * 8;
        s.bird.angle = Math.sin(timestamp / 600) * 0.1;

        // Scroll clouds even on start screen
        for (const cloud of s.clouds) {
          cloud.x -= 36 * 0.2 * cloud.speed * dt;
          if (cloud.x < -120) {
            cloud.x = CANVAS_W + 80;
            cloud.y = 40 + Math.random() * 160;
            cloud.scale = 0.6 + Math.random() * 0.8;
          }
        }
      }

      // ── Render ──────────────────────────────────────────────────────────

      drawSky(ctx);

      // Clouds
      for (const cloud of s.clouds) {
        drawCloud(ctx, cloud.x, cloud.y, cloud.scale);
      }

      // Hills
      drawHills(ctx, s.hills);

      // Pipes (behind ground, above hills)
      for (const pipe of s.pipes) {
        drawPipe(ctx, pipe);
      }

      // Ground
      drawGround(ctx, s.groundOffset);

      // Bird
      drawBird(ctx, s.bird);

      // Score overlay on canvas
      if (s.phase === "playing") {
        drawScore(ctx, s.score);
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    rafRef.current = animId;

    return () => {
      cancelAnimationFrame(animId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Input handling ─────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flap]);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      flap();
    },
    [flap],
  );

  // ── Leaderboard open ───────────────────────────────────────────────────────

  const handleLeaderboard = useCallback(() => {
    setShowLeaderboard(true);
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayBest = Math.max(uiBest, uiScore);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, #0a1628 0%, #0d2040 50%, #0a1628 100%)",
      }}
    >
      <div
        ref={containerRef}
        className="relative select-none"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          boxShadow:
            "0 0 60px rgba(0,120,255,0.3), 0 0 120px rgba(0,80,200,0.15)",
        }}
      >
        {/* Game Canvas */}
        <canvas
          ref={canvasRef}
          data-ocid="game.canvas_target"
          className="block rounded-xl overflow-hidden"
          style={{ width: CANVAS_W, height: CANVAS_H }}
          onPointerDown={handlePointer}
          tabIndex={0}
        />

        {/* START SCREEN */}
        {uiPhase === "start" && !showLeaderboard && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-between py-10 pointer-events-none rounded-xl"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,20,60,0.45) 0%, rgba(0,10,30,0.1) 40%, rgba(0,10,30,0.1) 70%, rgba(0,20,60,0.5) 100%)",
            }}
          >
            {/* Title */}
            <div className="flex flex-col items-center mt-6">
              <div
                className="text-6xl font-black tracking-tight leading-none"
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  background:
                    "linear-gradient(135deg, #ffe066, #ff9a00, #ff6a00)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 4px 12px rgba(255,150,0,0.5))",
                }}
              >
                FLAPPY
              </div>
              <div
                className="text-5xl font-black tracking-widest leading-none mt-1"
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  background:
                    "linear-gradient(135deg, #7eeaff, #38b8ff, #0088ee)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 4px 12px rgba(0,180,255,0.5))",
                }}
              >
                SKY ✦
              </div>
              {displayBest > 0 && (
                <div
                  className="mt-3 px-4 py-1 rounded-full text-sm font-semibold"
                  style={{
                    background: "rgba(255,200,0,0.18)",
                    color: "#ffe066",
                    border: "1px solid rgba(255,200,0,0.3)",
                  }}
                >
                  Best: {displayBest}
                </div>
              )}
            </div>

            {/* Tap to Play */}
            <div className="flex flex-col items-center gap-3 pointer-events-auto">
              <button
                type="button"
                data-ocid="game.start_button"
                onClick={flap}
                className="relative px-10 py-4 text-xl font-bold rounded-2xl transition-all duration-150 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #ff9a00, #ff6a00)",
                  color: "#1a0800",
                  boxShadow:
                    "0 8px 32px rgba(255,120,0,0.5), 0 2px 0 rgba(255,220,100,0.4) inset",
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  letterSpacing: "0.05em",
                }}
              >
                ▶ TAP TO PLAY
              </button>

              <div className="text-sm opacity-60 text-white">
                Space / Arrow Up / Click
              </div>

              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  data-ocid="game.leaderboard_button"
                  onClick={handleLeaderboard}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                  style={{
                    background: "rgba(100,200,255,0.15)",
                    color: "#7eeaff",
                    border: "1px solid rgba(100,200,255,0.3)",
                  }}
                >
                  🏆 Leaderboard
                </button>
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={login}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.7)",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}
                  >
                    Login to Save
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="text-xs opacity-30 text-white">
              © {new Date().getFullYear()}. Built with love using{" "}
              <a
                href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(typeof window !== "undefined" ? window.location.hostname : "")}`}
                className="underline"
                target="_blank"
                rel="noreferrer"
                style={{ pointerEvents: "auto" }}
              >
                caffeine.ai
              </a>
            </div>
          </div>
        )}

        {/* GAME OVER OVERLAY */}
        {uiPhase === "dead" && !showLeaderboard && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center rounded-xl"
            style={{
              background: "rgba(0,10,30,0.75)",
              backdropFilter: "blur(6px)",
            }}
          >
            <div
              className="flex flex-col items-center gap-5"
              style={{
                background: "rgba(5,20,50,0.85)",
                border: "1px solid rgba(100,200,255,0.2)",
                borderRadius: 24,
                padding: "40px 52px",
                boxShadow:
                  "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05) inset",
              }}
            >
              <div
                className="text-5xl font-black"
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  background: "linear-gradient(135deg, #ff6a6a, #ff3333)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 4px 12px rgba(255,80,80,0.5))",
                }}
              >
                GAME OVER
              </div>

              <div className="flex gap-8">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    Score
                  </div>
                  <div
                    className="text-4xl font-black"
                    style={{
                      color: "#ffe066",
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                    }}
                  >
                    {uiScore}
                  </div>
                </div>
                <div
                  style={{ width: 1, background: "rgba(255,255,255,0.1)" }}
                />
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    Best
                  </div>
                  <div
                    className="text-4xl font-black"
                    style={{
                      color: "#7eeaff",
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                    }}
                  >
                    {Math.max(displayBest, uiScore)}
                  </div>
                </div>
              </div>

              {!isAuthenticated && (
                <div
                  className="text-xs text-center"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  Login to save your score to the leaderboard
                </div>
              )}

              <button
                type="button"
                data-ocid="game.restart_button"
                onClick={resetGame}
                className="px-10 py-4 text-xl font-bold rounded-2xl transition-all duration-150 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #ff9a00, #ff6a00)",
                  color: "#1a0800",
                  boxShadow:
                    "0 8px 32px rgba(255,120,0,0.4), 0 2px 0 rgba(255,220,100,0.4) inset",
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  letterSpacing: "0.05em",
                }}
              >
                ↺ PLAY AGAIN
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  data-ocid="game.leaderboard_button"
                  onClick={handleLeaderboard}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                  style={{
                    background: "rgba(100,200,255,0.15)",
                    color: "#7eeaff",
                    border: "1px solid rgba(100,200,255,0.3)",
                  }}
                >
                  🏆 Leaderboard
                </button>
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={login}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.6)",
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  >
                    Login
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LEADERBOARD PANEL */}
        {showLeaderboard && (
          <div
            data-ocid="game.leaderboard_panel"
            className="absolute inset-0 flex flex-col items-center justify-center rounded-xl"
            style={{
              background: "rgba(0,10,30,0.88)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              className="flex flex-col items-center gap-4 w-full max-w-xs"
              style={{
                background: "rgba(5,20,50,0.9)",
                border: "1px solid rgba(100,200,255,0.2)",
                borderRadius: 24,
                padding: "32px 36px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
              }}
            >
              <div
                className="text-3xl font-black"
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  background: "linear-gradient(135deg, #ffe066, #ffaa00)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                🏆 LEADERBOARD
              </div>

              {leaderboard.length === 0 ? (
                <div
                  className="text-sm py-4"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  No scores yet — be the first!
                </div>
              ) : (
                <div className="w-full flex flex-col gap-2">
                  {leaderboard.map(([principal, score], i) => {
                    const medals = ["🥇", "🥈", "🥉"];
                    const medal = medals[i] ?? `${i + 1}.`;
                    const shortPrincipal =
                      principal.length > 14
                        ? `${principal.slice(0, 6)}…${principal.slice(-4)}`
                        : principal;
                    return (
                      <div
                        key={principal}
                        className="flex items-center justify-between px-3 py-2 rounded-xl"
                        style={{
                          background:
                            i === 0
                              ? "rgba(255,200,0,0.1)"
                              : "rgba(255,255,255,0.05)",
                          border:
                            i === 0
                              ? "1px solid rgba(255,200,0,0.2)"
                              : "1px solid transparent",
                        }}
                      >
                        <span className="text-lg w-8">{medal}</span>
                        <span
                          className="text-sm flex-1 font-mono"
                          style={{ color: "rgba(255,255,255,0.6)" }}
                        >
                          {shortPrincipal}
                        </span>
                        <span
                          className="text-lg font-bold"
                          style={{
                            color: "#ffe066",
                            fontFamily: "'Bricolage Grotesque', sans-serif",
                          }}
                        >
                          {Number(score)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                data-ocid="game.leaderboard_panel"
                onClick={() => setShowLeaderboard(false)}
                className="mt-2 px-8 py-3 rounded-xl font-bold text-base transition-all duration-150 active:scale-95"
                style={{
                  background: "rgba(100,200,255,0.15)",
                  color: "#7eeaff",
                  border: "1px solid rgba(100,200,255,0.3)",
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                }}
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
