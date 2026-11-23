const software = /swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i;

export function hardwareArgs() {
  const angle = process.env.AW_ANGLE ?? (process.platform === 'darwin' ? 'metal' : '');
  if (software.test(angle)) throw new Error(`Hardware GPU required, received AW_ANGLE=${angle}`);
  return ['--enable-gpu', '--disable-software-rasterizer',
    ...(angle ? ['--use-gl=angle', `--use-angle=${angle}`, '--ignore-gpu-blocklist'] : [])];
}

export async function verifyHardware(page) {
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  });
  if (!renderer || software.test(renderer)) throw new Error(`Hardware WebGL 2 unavailable (${renderer || 'unknown renderer'})`);
  console.log(`GPU: ${renderer}`);
  return renderer;
}
