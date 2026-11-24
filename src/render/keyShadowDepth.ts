import * as THREE from 'three';

type ShadowRender = THREE.WebGLRenderer['shadowMap']['render'];
type DepthClient = (...args: Parameters<ShadowRender>) => void;
type Slot = { key: THREE.DirectionalLight; depth: THREE.DepthTexture | null; refs: number; clients: Set<DepthClient> };

const renderers = new WeakMap<THREE.WebGLRenderer, ReturnType<typeof installDepthHook>>();

/** Three r187 writes the horizontal RG moments into the same target that
 * holds the raw depth. Keep that attachment across the horizontal clear
 * and fullscreen draw. Both consumers share this hook; no new render pass. */
function installDepthHook(renderer: THREE.WebGLRenderer) {
  const slots = new Map<THREE.Light, Slot>();
  const shadowMap = renderer.shadowMap;
  const base = shadowMap.render;
  const wrapped: ShadowRender = function (this: typeof shadowMap, ...args) {
    if (this.type === THREE.VSMShadowMap && this.enabled &&
        (this.autoUpdate !== false || this.needsUpdate) && args[0].some(light => slots.has(light))) {
      const clear = renderer.clear, draw = renderer.renderBufferDirect;
      let vertical: Slot | undefined;
      const slotFor = (target: THREE.WebGLRenderTarget | null, pass: 'map' | 'mapPass') => {
        if (target !== null) for (const slot of slots.values()) {
          if (slot.key.shadow[pass] === target) return { shadow: slot.key.shadow, slot };
        }
      };
      renderer.clear = function (color = true, depth = true, stencil = true) {
        const owner = slotFor(renderer.getRenderTarget(), 'map');
        const reuse = owner !== undefined && owner.slot === vertical;
        if (owner && !reuse) owner.slot.depth = null;
        clear.call(this, color, depth && !reuse, stencil);
      };
      renderer.renderBufferDirect = function (...drawArgs) {
        const material = drawArgs[3] as THREE.ShaderMaterial;
        if (!material.isShaderMaterial || material.defines.VSM_SAMPLES === undefined) return draw.apply(this, drawArgs);
        const input = material.uniforms.shadow_pass?.value;
        const horizontal = !!material.defines.HORIZONTAL_PASS;
        const owner = slotFor(renderer.getRenderTarget(), horizontal ? 'map' : 'mapPass');
        const depth = owner?.shadow.map?.depthTexture;
        if (!owner || !depth || (horizontal ? input !== owner.shadow.mapPass?.texture : input !== depth)) {
          return draw.apply(this, drawArgs);
        }
        if (!horizontal) {
          draw.apply(this, drawArgs);
          vertical = owner.slot;
        } else if (vertical === owner.slot) {
          const { depthTest, depthWrite } = material;
          material.depthTest = material.depthWrite = false;
          try {
            draw.apply(this, drawArgs);
            owner.slot.depth = depth;
          } finally {
            material.depthTest = depthTest;
            material.depthWrite = depthWrite;
            vertical = undefined;
          }
        } else draw.apply(this, drawArgs);
      };
      try { base.apply(this, args); }
      finally {
        renderer.clear = clear;
        renderer.renderBufferDirect = draw;
      }
    } else base.apply(this, args);
    for (const { clients } of slots.values()) for (const client of clients) client(...args);
  };
  shadowMap.render = wrapped;
  return {
    slots,
    dispose() { if (shadowMap.render === wrapped) shadowMap.render = base; },
  };
}

export function retainKeyVSMDepth(renderer: THREE.WebGLRenderer, key: THREE.DirectionalLight, client?: DepthClient) {
  let hook = renderers.get(renderer);
  if (!hook) {
    hook = installDepthHook(renderer);
    renderers.set(renderer, hook);
  }
  let slot = hook.slots.get(key);
  if (!slot) {
    slot = { key, depth: null, refs: 0, clients: new Set() };
    hook.slots.set(key, slot);
  }
  const { slots } = hook;
  const state = slot;
  state.refs++;
  if (client) state.clients.add(client);
  let released = false;
  return {
    getDepth() {
      const depth = key.shadow.map?.depthTexture;
      const { enabled, type } = renderer.shadowMap;
      return !released && enabled && type === THREE.VSMShadowMap && depth?.compareFunction === null &&
        depth === state.depth ? depth : null;
    },
    dispose() {
      if (released) return;
      released = true;
      if (client) state.clients.delete(client);
      if (--state.refs === 0) slots.delete(key);
      if (!slots.size) {
        hook.dispose();
        renderers.delete(renderer);
      }
    },
  };
}
