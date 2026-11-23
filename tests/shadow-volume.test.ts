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
