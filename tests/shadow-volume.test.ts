import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ShadowVolumePass } from '../src/render/post/shadowVolume';

it.each([true,false])('gathers the live beauty shadow without refreshing casters (cinematic=%s)', cinematic => {
  const light = new THREE.DirectionalLight(); light.castShadow = true;
  const ready = vi.fn(), pass = new ShadowVolumePass(cinematic, () => light, ready);
  const render = vi.fn(), setRenderTarget = vi.fn();
  const renderer = {shadowMap:{enabled:true},render,setRenderTarget} as unknown as THREE.WebGLRenderer;
  pass.setSize(1001,601);
  expect(pass.needsSwap).toBe(false);
  expect([pass.target.width,pass.target.height]).toEqual(cinematic ? [501,301] : [334,201]);
  pass.uniforms.tDepth.value = new THREE.DepthTexture(4,4);
  pass.render(renderer); // also covers first draw and shadow reallocation
  expect(ready).toHaveBeenLastCalledWith(false);
  const target=new THREE.WebGLRenderTarget(4,4);
  light.shadow.map=target;
  pass.render(renderer);
  expect(ready).toHaveBeenLastCalledWith(false); // reject sampling the wrong format
  expect(render).not.toHaveBeenCalled();
  if (cinematic) target.texture.format=THREE.RGFormat;
  else { target.depthTexture=new THREE.DepthTexture(4,4);target.depthTexture.compareFunction=THREE.LessEqualCompare; }
  light.shadow.matrix.makeTranslation(.1,.2,.3);
  pass.render(renderer);
  expect(ready).toHaveBeenLastCalledWith(true);
  expect(pass.uniforms.tKey.value).toBe(cinematic?target.texture:target.depthTexture);
  expect(pass.uniforms.uShadow.value.equals(light.shadow.matrix)).toBe(true);
  expect(setRenderTarget).toHaveBeenLastCalledWith(pass.target);
  expect(render).toHaveBeenCalledTimes(1);
  light.castShadow=false; pass.render(renderer);
  expect(ready).toHaveBeenLastCalledWith(false);
  expect(render).toHaveBeenCalledTimes(1);
  pass.dispose(); target.dispose(); pass.uniforms.tDepth.value.dispose();
});

it('filters a seamless deterministic weather volume, including the wrapping edge on every axis', () => {
  const pass = () => new ShadowVolumePass(true, () => new THREE.DirectionalLight(), () => {});
  const a = pass(), b = pass();
  try {
    const field = a.uniforms.tWeather.value;
    expect(field.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(field.generateMipmaps).toBe(true);
    expect([field.wrapS, field.wrapT, field.wrapR]).toEqual(Array(3).fill(THREE.RepeatWrapping));
    const { width: n, height, depth, data } = field.image;
    expect([height, depth]).toEqual([n, n]);
    expect(data).toEqual(b.uniforms.tWeather.value.image.data);
    const bytes = data as Uint8Array;
    // A repeated copy of non-periodic noise makes the last→first texel step an
    // outlier. Compare its mean squared gradient to interior steps on each axis.
    for (const stride of [1, n, n * n]) {
      let edge = 0, interior = 0;
      for (let i = 0; i < bytes.length; ++i) {
        const wraps = Math.floor(i / stride) % n === n - 1;
        const step = bytes[i] - bytes[i + (wraps ? 1 - n : 1) * stride];
        if (wraps) edge += step * step; else interior += step * step;
      }
      expect(interior).toBeGreaterThan(0);
      expect(edge * (n - 1) / interior).toBeLessThan(2);
    }
  } finally { a.dispose(); b.dispose(); }
});
