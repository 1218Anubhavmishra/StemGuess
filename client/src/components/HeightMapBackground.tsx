import { useEffect, useRef } from 'react';

// The whole picture repeats exactly after this many seconds of its own time, so the loop has no seam: everything that
// moves turns a whole number of times per loop.
const LOOP = 40;
// The effect scales in proportion to the whole screen: its unit is the screen's overall size, √(width × height),
// divided by this. A phone, a tablet and a wide monitor all hold the same amount of it, stretched to their own shape.
const DETAIL = 3.6;
// The glass in front of the light: this many small facets across each unit, each bending the light behind it its own
// way. Every facet acts as a small lens (LENS), tilted by up to TILT units, and splits the light's colours slightly
// (SPLIT), so light seems to diffract everywhere through the glass. Neighbouring facets blend over BLEND of a facet's
// width, so the glass reads as fine texture rather than tiles, and their edges catch a little light (EDGE_GLOW).
const FACETS = 16;
const LENS = -1.2;
const TILT = 0.07;
const SPLIT = 0.18;
const BLEND = 0.32;
const EDGE_GLOW = 0.07;
// When the screen's size changes, the scale eases to the new one at this rate (a second) instead of jumping.
const RESIZE_EASE = 4;
// The facets' edges are fine, so the picture is drawn at the screen's full size, one point per pixel.
const RESOLUTION = 1;
// The most time one frame may move the picture on, so it doesn't leap after the tab was hidden.
const MAX_STEP = 0.05;
// How fast the picture's time runs against real time: below 1, everything flows more slowly.
const PACE = 0.6;

// Writes a number the way the shader language needs it: always with a decimal point.
const glsl = (value: number) => value.toFixed(6);

const VERTEX = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';
const FRAGMENT = `
precision highp float;
uniform float uUnit, uT; uniform vec3 uBase, uWater, uPeak, uCore;
const float W = ${glsl((2 * Math.PI) / LOOP)};

/* The light behind the glass: soft ribbons that fold and flow across the screen, 0 for dark to 1 for brightest. */
float light(vec2 p) {
  float t = uT;
  vec2 q = p;
  q += .35 * vec2(sin(q.y * 1.7 + W * t), cos(q.x * 1.3 - 2. * W * t));
  q += .22 * vec2(sin(q.y * 2.9 - 3. * W * t + 1.3), cos(q.x * 2.3 + 2. * W * t + .7));
  return .5 + .27 * sin(q.x * 1.9 + q.y * .8 + W * t) + .23 * sin(q.y * 2.4 - q.x * 1.1 - 2. * W * t + 2.);
}
/* Light's brightness to colour: black, then deep blue, sky blue, and a pale core on the brightest ribbons. */
vec3 shade(float v) {
  vec3 c = mix(uBase, uWater, smoothstep(.22, .55, v));
  c = mix(c, uPeak, smoothstep(.58, .86, v));
  return mix(c, uCore, smoothstep(.9, 1., v) * .55);
}
vec2 random2(vec2 cell) {
  return fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
}
void main() {
  vec2 p = gl_FragCoord.xy / uUnit;
  /* Which facet this point is in: the nearest of the scattered facet centres, and the next nearest. */
  vec2 grid = p * ${glsl(FACETS)}, home = floor(grid), at = fract(grid);
  float nearest = 8., second = 8.;
  vec2 fromNearest = vec2(0.), nearestCell = vec2(0.), fromSecond = vec2(0.), secondCell = vec2(0.);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = home + vec2(float(x), float(y));
      vec2 toPoint = at - (vec2(float(x), float(y)) + .15 + .7 * random2(cell));
      float d = dot(toPoint, toPoint);
      if (d < nearest) {
        second = nearest; fromSecond = fromNearest; secondCell = nearestCell;
        nearest = d; fromNearest = toPoint; nearestCell = cell;
      } else if (d < second) { second = d; fromSecond = toPoint; secondCell = cell; }
    }
  }
  /* Each facet bends the light behind it: as a small lens around its centre, and tilted its own way. Near an edge
     the two facets' bends blend, so the glass softens rather than tiles. */
  vec2 bendNearest = fromNearest / ${glsl(FACETS)} * ${glsl(LENS)} + (random2(nearestCell + 17.) - .5) * ${glsl(2 * TILT)};
  vec2 bendSecond = fromSecond / ${glsl(FACETS)} * ${glsl(LENS)} + (random2(secondCell + 17.) - .5) * ${glsl(2 * TILT)};
  float edge = sqrt(second) - sqrt(nearest);
  vec2 bend = mix((bendNearest + bendSecond) * .5, bendNearest, smoothstep(0., ${glsl(BLEND)}, edge));
  /* Each colour bends a little differently, which fringes the light like a prism. */
  float r = light(p + bend), g = light(p + bend * ${glsl(1 + SPLIT)}), b = light(p + bend * ${glsl(1 + 2 * SPLIT)});
  vec3 c = vec3(shade(r).r, shade(g).g, shade(b).b);
  /* Facet edges catch a little of the light passing through them. */
  c += uPeak * ${glsl(EDGE_GLOW)} * (1. - smoothstep(0., .06, edge)) * smoothstep(.3, .9, g);
  gl_FragColor = vec4(c, 1.);
}`;

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * The page background: soft ribbons of blue light flowing behind a sheet of faceted glass, a fine mosaic. Each small
 * facet bends and splits the light its own way, so it looks diffracted everywhere. Everything that moves turns a whole
 * number of times per loop, so it plays forever without a visible seam. Without WebGL it's the plain dark colour.
 */
export default function HeightMapBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { alpha: false, antialias: false });
    if (!el || !gl) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let colours = { base: [0, 0, 0], water: [0, 0, 0], peak: [0, 0, 0], core: [0, 0, 0] };
    const readColours = () => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => rgbOf(style.getPropertyValue(name).trim());
      colours = { base: read('--bg-base'), water: read('--bg-water'), peak: read('--bg-peak'), core: read('--bg-core') };
    };

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
        ['uUnit', 'uT', 'uBase', 'uWater', 'uPeak', 'uCore'].map((name) => [name, gl.getUniformLocation(program, name)]),
      );
      el.width = el.height = 0;
      readColours();
    };

    // Starts somewhere random in the loop, so it doesn't open on the same picture every time.
    let clock = Math.random() * LOOP;
    // The effect's unit in screen pixels, eased toward √(width × height) / DETAIL whenever the size changes.
    let unit = 0;

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
      gl.uniform1f(uniforms.uUnit, unit * (width / innerWidth));
      gl.uniform1f(uniforms.uT, clock);
      gl.uniform3fv(uniforms.uBase, colours.base);
      gl.uniform3fv(uniforms.uWater, colours.water);
      gl.uniform3fv(uniforms.uPeak, colours.peak);
      gl.uniform3fv(uniforms.uCore, colours.core);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const seconds = Math.min(MAX_STEP, last ? (now - last) / 1000 : 0);
      // Wrapped around the loop, which everything repeats on, so the wrap can't be seen.
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
