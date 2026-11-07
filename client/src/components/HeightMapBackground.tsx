import { useEffect, useRef } from 'react';

// The whole picture repeats exactly after this many seconds of its own time, so the loop has no seam.
const LOOP = 40;
// Everything moves by the wave equation, ∂²h/∂t² = c²∇²h: each wave's spatial frequency is its time frequency
// divided by this speed (units a second, see DETAIL), and the swells' rings spread at it too.
const WAVE_SPEED = 0.15;
// The rolling land: plane waves, each [whole cycles per loop, direction in radians, height, starting phase].
// Whole cycles are what make the loop seamless: every wave is back where it started when the loop ends.
const WAVES = [
  [2, 0.4, 0.34, 0],
  [3, 2.1, 0.22, 1.3],
  [4, 3.9, 0.15, 2.2],
  [5, 5.2, 0.11, 0.7],
  [3, 1.1, 0.15, 4.0],
];
// The effect scales in proportion to the whole screen: its unit is the screen's overall size, √(width × height),
// divided by this. Width and height both count, so a phone, a tablet and a wide monitor all hold the same amount of
// the picture, stretched to their own shape, and it never comes out too big to read on a small screen.
const DETAIL = 3.6;
// When the screen's size changes, the scale eases to the new one at this rate (a second) instead of jumping.
const RESIZE_EASE = 4;
// Swells rise at fixed spots (as fractions of the screen, so they keep their place at any size) and times that
// repeat every loop: this many per loop, each lasting this long.
const SWELLS_PER_LOOP = 26;
const SWELL_LIFE = 6;
// The most swells alive at once, given how they're spaced.
const MAX_SWELLS = 12;
// Which heights get colour: the height at the bottom of the scale, and how far up the scale reaches. Chosen so
// about a third of the screen is orange, and no moment is all one colour.
const HEIGHT_MAP = [-0.7, 1.8];
// The picture is soft, so it's drawn at half the screen's size and stretched, which keeps it light on phones.
const RESOLUTION = 0.5;
// The most time one frame may move the picture on, so it doesn't leap after the tab was hidden.
const MAX_STEP = 0.05;
// How fast the picture's time runs against real time: below 1, everything drifts and swells more slowly.
const PACE = 0.6;

// Writes a number the way the shader language needs it: always with a decimal point.
const glsl = (value: number) => value.toFixed(6);

const VERTEX = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';
const FRAGMENT = `
precision highp float;
uniform float uUnit, uT; uniform vec3 uBase, uPeak; uniform vec4 uSwells[${MAX_SWELLS}];
const float W = ${glsl((2 * Math.PI) / LOOP)};
/* The land's height: plane waves that solve the wave equation, plus swells whose rings spread at the same speed. */
float height(vec2 p) {
  float t = uT;
  vec2 q = p + .25 * vec2(sin(p.y * 1.3 + 2. * W * t), cos(p.x * 1.1 - 2. * W * t));
  float h = 0.;
${WAVES.map(([n, angle, size, phase]) => {
  // The wave equation ties each wave's spatial frequency to its time frequency: k = ω / c.
  const [k, dx, dy] = [(n * 2 * Math.PI) / LOOP / WAVE_SPEED, Math.cos(angle), Math.sin(angle)].map(glsl);
  return `  h += ${glsl(size)} * sin(${k} * dot(q, vec2(${dx}, ${dy})) - ${glsl(n)} * W * t + ${glsl(phase)});`;
}).join('\n')}
  for (int i = 0; i < ${MAX_SWELLS}; i++) {
    vec4 d = uSwells[i];
    /* z holds the swell's age, already wrapped around the loop. */
    float age = d.z;
    if (d.w <= 0. || age > ${SWELL_LIFE}.) continue;
    float r = length(p - d.xy), x = r - age * ${WAVE_SPEED};
    float fade = smoothstep(0., .8, age) * (1. - smoothstep(${SWELL_LIFE}. * .5, ${SWELL_LIFE}., age));
    /* A mound rises first, then flattens into a ring that spreads outward. */
    h += d.w * fade * (exp(-x * x * 9.) + .6 * exp(-r * r * 14.) * (1. - smoothstep(0., 2., age)));
  }
  return h;
}
void main() {
  vec2 p = gl_FragCoord.xy / uUnit;
  const float e = .01;
  float h = height(p);
  vec2 g = vec2(height(p + vec2(e, 0.)) - h, height(p + vec2(0., e)) - h) / e;
  /* Colour by height, like a map: the page's colour in the lows, orange on the highs. */
  float v = clamp((h - ${HEIGHT_MAP[0]}) / ${HEIGHT_MAP[1]}, 0., 1.);
  vec3 c = mix(uBase, uPeak, smoothstep(.5, .58, v));
  /* Soft light on the slopes, like relief shading on a map. */
  c *= 1. + dot(g, vec2(-.45, .65)) * .05;
  gl_FragColor = vec4(c, 1.);
}`;

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * The page background: the page's colour as a moving height map, with orange on the highs. The land moves by the
 * wave equation and swells spread out from scattered spots as rings; every part of it repeats each loop, so it plays
 * forever without a visible seam. Without WebGL it's the plain page colour.
 */
export default function HeightMapBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { alpha: false, antialias: false });
    if (!el || !gl) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let uniforms: Record<string, WebGLUniformLocation | null> | undefined;
    const setUp = () => {
      const compile = (type: number, text: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        return shader;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.bindAttribLocation(program, 0, 'a');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(
        ['uUnit', 'uT', 'uBase', 'uPeak', 'uSwells'].map((name) => [name, gl.getUniformLocation(program, name)]),
      );
      el.width = el.height = 0;
      readColours();
    };

    let base = [0, 0, 0];
    let peak = [0, 0, 0];
    const readColours = () => {
      const style = getComputedStyle(document.documentElement);
      base = rgbOf(style.getPropertyValue('--bg-base').trim());
      peak = rgbOf(style.getPropertyValue('--bg-peak').trim());
    };

    // The loop's swells: across the screen and up it (as fractions), when in the loop, how strong. They're spread
    // evenly through the loop with a little jitter, from a seeded random sequence, the same on every screen.
    let seed = 0x5eed;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    const schedule = Array.from({ length: SWELLS_PER_LOOP }, (_, i) => [
      random(),
      random(),
      ((i + (random() - 0.5) * 0.5) * LOOP) / SWELLS_PER_LOOP,
      0.35 + random() * 0.25,
    ]);
    // The swells alive right now, as x and y (in units), age and strength.
    const swells = new Float32Array(MAX_SWELLS * 4);
    const findSwells = (t: number, across: number, up: number) => {
      swells.fill(0);
      let slot = 0;
      for (const [x, y, start, strength] of schedule) {
        const age = (((t - start) % LOOP) + LOOP) % LOOP;
        if (age >= SWELL_LIFE || slot >= MAX_SWELLS) continue;
        swells.set([x * across, y * up, age, strength], slot++ * 4);
      }
    };
    // The effect's unit in screen pixels, eased toward √(width × height) / DETAIL whenever the size changes.
    let unit = 0;
    // Starts somewhere random in the loop, so it doesn't open on the same picture every time.
    let clock = Math.random() * LOOP;

    const draw = (seconds = 0) => {
      if (!uniforms) return;
      const width = Math.max(1, Math.round(innerWidth * RESOLUTION));
      const height = Math.max(1, Math.round(innerHeight * RESOLUTION));
      if (el.width !== width || el.height !== height) {
        el.width = width;
        el.height = height;
        gl.viewport(0, 0, width, height);
      }
      const target = Math.sqrt(innerWidth * innerHeight) / DETAIL;
      unit = unit && !still ? unit + (target - unit) * Math.min(1, seconds * RESIZE_EASE) : target;
      const pixels = unit * (width / innerWidth);
      gl.uniform1f(uniforms.uUnit, pixels);
      findSwells(clock, width / pixels, height / pixels);
      gl.uniform1f(uniforms.uT, clock);
      gl.uniform3fv(uniforms.uBase, base);
      gl.uniform3fv(uniforms.uPeak, peak);
      gl.uniform4fv(uniforms.uSwells, swells);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      // Wrapped around the loop, which every wave and swell repeats on, so the wrap can't be seen.
      const seconds = Math.min(MAX_STEP, last ? (now - last) / 1000 : 0);
      clock = (clock + seconds * PACE) % LOOP;
      last = now;
      draw(seconds);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      setUp();
      if (still) draw();
      else frame = requestAnimationFrame(tick);
    };
    // A still picture still has to follow the theme and the screen's size.
    const redraw = () => {
      readColours();
      if (still) draw();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      uniforms = undefined;
    };

    start();
    const theme = matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', redraw);
    window.addEventListener('resize', redraw);
    el.addEventListener('webglcontextlost', lost);
    el.addEventListener('webglcontextrestored', start);
    return () => {
      cancelAnimationFrame(frame);
      theme.removeEventListener('change', redraw);
      window.removeEventListener('resize', redraw);
      el.removeEventListener('webglcontextlost', lost);
      el.removeEventListener('webglcontextrestored', start);
    };
  }, []);

  return (
    <div className="height-map-bg" aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
