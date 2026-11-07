import { useEffect, useRef } from 'react';

// Up to this many swells at once; how fast their rings spread (screen heights a second) and how long each lasts.
const MAX_SWELLS = 6;
const SWELL_SPEED = 0.22;
const SWELL_LIFE = 6;
// A new swell rises somewhere every this many seconds, give or take.
const SWELL_EVERY = [0.7, 1.6];
// Which heights get colour: the height at the bottom of the scale, and how far up the scale reaches.
const HEIGHT_MAP = [0.08, 1.8];
// The picture is soft, so it's drawn at half the screen's size and stretched, which keeps it light on phones.
const RESOLUTION = 0.5;
// The most time one frame may move the picture on, so it doesn't leap after the tab was hidden.
const MAX_STEP = 0.05;
// How fast the picture's time runs against real time: below 1, everything drifts and swells more slowly.
const PACE = 0.6;

const VERTEX = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';
const FRAGMENT = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform vec3 uBase, uPeak; uniform vec4 uSwells[${MAX_SWELLS}];
/* The land's height: rolling hills that keep shifting, plus swells that rise at random spots and spread out as rings. */
float height(vec2 p) {
  float t = uT;
  vec2 q = p + .25 * vec2(sin(p.y * 1.3 + t * .35), cos(p.x * 1.1 - t * .3));
  float h = .45 * sin(q.x * 2.2 + t * .4) * cos(q.y * 1.9 - t * .33)
          + .3 * sin(q.x * 3.7 - q.y * 2.9 + t * .55)
          + .2 * cos(q.x * 5.3 + q.y * 4.1 - t * .7);
  for (int i = 0; i < ${MAX_SWELLS}; i++) {
    vec4 d = uSwells[i];
    float age = uT - d.z;
    if (d.w <= 0. || age < 0. || age > ${SWELL_LIFE}.) continue;
    float r = length(p - d.xy), x = r - age * ${SWELL_SPEED};
    float fade = smoothstep(0., .8, age) * (1. - smoothstep(${SWELL_LIFE}. * .5, ${SWELL_LIFE}., age));
    /* A mound rises first, then flattens into a ring that spreads outward. */
    h += d.w * fade * (exp(-x * x * 9.) + .6 * exp(-r * r * 14.) * (1. - smoothstep(0., 2., age)));
  }
  return h;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, p = vec2(uv.x * uRes.x / uRes.y, uv.y);
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
 * The page background: the page's colour as a moving height map, with orange on the highs. Swells rise at random
 * spots and spread out as rings, so the land keeps shifting. Without WebGL it's the plain page colour.
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
        ['uRes', 'uT', 'uBase', 'uPeak', 'uSwells'].map((name) => [name, gl.getUniformLocation(program, name)]),
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

    // Each swell is x, y, the time it started and how strong it is.
    const swells = new Float32Array(MAX_SWELLS * 4);
    let swellAt = 0;
    const addSwell = (when: number) => {
      swells.set([Math.random() * (innerWidth / innerHeight), Math.random(), when, 0.35 + Math.random() * 0.25], swellAt * 4);
      swellAt = (swellAt + 1) % MAX_SWELLS;
    };
    let clock = 12;
    for (const age of [4.5, 3.2, 2, 0.8]) addSwell(clock - age);
    let nextSwell = clock + 0.5;

    const draw = () => {
      if (!uniforms) return;
      const width = Math.max(1, Math.round(innerWidth * RESOLUTION));
      const height = Math.max(1, Math.round(innerHeight * RESOLUTION));
      if (el.width !== width || el.height !== height) {
        el.width = width;
        el.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(uniforms.uRes, width, height);
      gl.uniform1f(uniforms.uT, clock);
      gl.uniform3fv(uniforms.uBase, base);
      gl.uniform3fv(uniforms.uPeak, peak);
      gl.uniform4fv(uniforms.uSwells, swells);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      clock += Math.min(MAX_STEP, last ? (now - last) / 1000 : 0) * PACE;
      last = now;
      while (clock >= nextSwell) {
        addSwell(nextSwell);
        nextSwell += SWELL_EVERY[0] + Math.random() * (SWELL_EVERY[1] - SWELL_EVERY[0]);
      }
      draw();
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
