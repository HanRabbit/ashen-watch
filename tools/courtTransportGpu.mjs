// Runs in a blank Playwright page. The scene input and shader source are plain data.
export function runCourtTransport({ input, fragmentSource }) {
  const start = performance.now();
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  if (!renderer || /swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i.test(renderer)) {
    throw new Error(`Hardware WebGL 2 required for court transport (${renderer || 'unknown renderer'})`);
  }

  const { grid, bvh, probes, rays, reflectance } = input;
  const width = grid.nx, height = grid.nz * grid.ny;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (Math.max(width, height, bvh.width, bvh.height) > maxTextureSize) {
    throw new Error(`Court transport atlas exceeds GPU texture limit ${maxTextureSize}`);
  }
  function assertGl(stage) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`Court transport ${stage} failed (WebGL ${error})`);
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const vertexSource = `#version 300 es
    void main() {
      vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
    }`;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.disable(gl.DITHER);
  gl.viewport(0, 0, width, height);
  const uniform = name => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform('uBvh'), 0);
  gl.uniform1i(uniform('uProbes'), 1);
  gl.uniform1i(uniform('uSky'), 2);
  gl.uniform1i(uniform('uBvhEntries'), bvh.entries);
  gl.uniform3fv(uniform('uRays[0]'), rays);
  gl.uniform3fv(uniform('uReflectance[0]'), reflectance);
  gl.uniform3f(uniform('uGridOrigin'), grid.x, grid.y, grid.z);
  gl.uniform3f(uniform('uGridSpacing'), grid.dx, grid.dy, grid.dx);
  gl.uniform3i(uniform('uGridSize'), grid.nx, grid.ny, grid.nz);

  function texture(unit, w, h, data) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, new Float32Array(data));
    else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, w, h);
    return texture;
  }
  texture(0, bvh.width, bvh.height, bvh.pixels);
  texture(1, width, height, probes.pixels);
  const sky = texture(2, width, height), bounce = texture(2, width, height);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  function attach(output) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Court transport integer framebuffer is incomplete');
    }
  }
  function draw(pass, output, sample) {
    attach(output);
    gl.bindTexture(gl.TEXTURE_2D, sample);
    gl.uniform1i(uniform('uPass'), pass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assertGl(`pass ${pass}`);
  }
  const drawStart = performance.now();
  draw(0, sky, bounce);
  draw(1, bounce, sky);

  // RGBA_INTEGER/UNSIGNED_INT is valid for unsigned-integer color attachments in WebGL 2.
  const bankSize = width * height * 4;
  const data = new Uint8Array(bankSize * 2);
  const readback = new Uint32Array(bankSize);
  for (const [pass, output] of [sky, bounce].entries()) {
    attach(output);
    gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, readback);
    assertGl(`readback ${pass}`);
    data.set(readback, pass * bankSize);
  }
  const end = performance.now();
  let bytes = '';
  for (let i = 0; i < data.length; i += 0x8000) bytes += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { renderer, drawReadbackMs: end - drawStart, setupMs: drawStart - start, bytes: btoa(bytes) };
}
