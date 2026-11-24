const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uThickness;
uniform float uGlow;
uniform float uRadius;
uniform float uEnergy;
uniform float uBrightness;
uniform float uMotion;
uniform vec3 uPrimary;
uniform vec3 uSecondary;

out vec4 fragColor;

float sdRoundedBox(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 halfSize = uResolution * 0.5;
  vec2 point = gl_FragCoord.xy - halfSize;
  float inset = uThickness * 0.5 + 1.0;
  vec2 boxHalf = halfSize - vec2(inset);
  float radius = min(uRadius, min(boxHalf.x, boxHalf.y) * 0.5);
  float distance = sdRoundedBox(point, boxHalf, radius);

  if (distance > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  float inward = -distance;
  float coreDistance = max(inward, 0.0);
  float core = 1.0 - smoothstep(uThickness * 0.2, uThickness * 0.9, coreDistance);
  core = core * core;

  float spread = max(6.0, uThickness * (1.2 + uGlow * 4.5) * (0.62 + 0.68 * uEnergy));
  float glow = exp(-max(inward - uThickness * 0.15, 0.0) / spread);
  float alpha = clamp(core * 0.95 + glow * (0.16 + 0.52 * uEnergy), 0.0, 1.0) * uBrightness;

  float angle = atan(point.y, point.x);
  float drift = 0.5 + 0.5 * sin(angle * 1.5 + uTime * 0.22 * uMotion);
  float mixAmount = clamp(0.6 + (drift - 0.5) * 0.5, 0.0, 1.0);
  vec3 color = mix(uPrimary, uSecondary, mixAmount);

  // One least-significant-bit of noise breaks 8-bit quantisation in the dark falloff.
  float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  vec3 premultiplied = max(color * alpha + dither, 0.0);
  fragColor = vec4(premultiplied, clamp(alpha + dither, 0.0, 1.0));
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log ?? 'unknown error'}`)
  }
  return shader
}

/** WebGL2 rim: one fullscreen triangle, premultiplied alpha output. */
export class RimRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject

  private readonly uResolution: WebGLUniformLocation | null
  private readonly uTime: WebGLUniformLocation | null
  private readonly uThickness: WebGLUniformLocation | null
  private readonly uGlow: WebGLUniformLocation | null
  private readonly uRadius: WebGLUniformLocation | null
  private readonly uEnergy: WebGLUniformLocation | null
  private readonly uBrightness: WebGLUniformLocation | null
  private readonly uMotion: WebGLUniformLocation | null
  private readonly uPrimary: WebGLUniformLocation | null
  private readonly uSecondary: WebGLUniformLocation | null

  private dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL2 is unavailable')

    this.canvas = canvas
    this.gl = gl

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
    const program = gl.createProgram()
    if (!program) throw new Error('Could not create program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Program link failed: ${log ?? 'unknown error'}`)
    }
    this.program = program

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('Could not allocate geometry')
    this.vao = vao
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    gl.useProgram(program)
    gl.enable(gl.BLEND)
    // Premultiplied "over": the shader already multiplies colour by alpha.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    this.uResolution = gl.getUniformLocation(program, 'uResolution')
    this.uTime = gl.getUniformLocation(program, 'uTime')
    this.uThickness = gl.getUniformLocation(program, 'uThickness')
    this.uGlow = gl.getUniformLocation(program, 'uGlow')
    this.uRadius = gl.getUniformLocation(program, 'uRadius')
    this.uEnergy = gl.getUniformLocation(program, 'uEnergy')
    this.uBrightness = gl.getUniformLocation(program, 'uBrightness')
    this.uMotion = gl.getUniformLocation(program, 'uMotion')
    this.uPrimary = gl.getUniformLocation(program, 'uPrimary')
    this.uSecondary = gl.getUniformLocation(program, 'uSecondary')
  }

  /** Size the drawing buffer to the window, capping the device pixel ratio per quality tier. */
  resize(dprCap: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    const cssWidth = Math.max(1, window.innerWidth)
    const cssHeight = Math.max(1, window.innerHeight)
    const width = Math.round(cssWidth * dpr)
    const height = Math.round(cssHeight * dpr)

    this.dpr = dpr
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.gl.viewport(0, 0, width, height)
    }
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`
  }

  render(
    timeSeconds: number,
    energy: number,
    brightness: number,
    motion: number,
    thicknessCss: number,
    glow: number,
    radiusCss: number,
    primary: Float32Array,
    secondary: Float32Array
  ): void {
    const gl = this.gl
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform1f(this.uBrightness, brightness)

    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.uTime, timeSeconds)
    gl.uniform1f(this.uThickness, thicknessCss * this.dpr)
    gl.uniform1f(this.uGlow, glow)
    gl.uniform1f(this.uRadius, radiusCss * this.dpr)
    gl.uniform1f(this.uEnergy, energy)
    gl.uniform1f(this.uMotion, motion)
    gl.uniform3f(this.uPrimary, primary[0], primary[1], primary[2])
    gl.uniform3f(this.uSecondary, secondary[0], secondary[1], secondary[2])

    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }
}
