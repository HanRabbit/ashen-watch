// 道具模型加载器：异步加载 GLB，归一化尺度/朝向/贴地，材质归一到美术圣经第 5 节，失败时回退到程序化几何。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackPending } from './materials';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, THREE.Group>();
const pending: Promise<void>[] = [];

/** 材质归一参数（圣经第 5 节）：覆盖外部模型过亮/过饱和/过光滑的部分。 */
export interface MatNorm {
  color?: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  envMapIntensity?: number;
  wear?: WearOpts;
}

export interface PropSpec {
  /** public/models/props/ 下的文件名（不含 .glb） */
  name: string;
  /** 目标最大尺寸（米），按 bbox 最长边缩放 */
  size: number;
  /** 绕 Y 轴旋转（弧度），修正模型朝向 */
  rotY?: number;
  /** 绕 X 轴旋转（弧度），修正模型 up 轴 */
  rotX?: number;
  /** 只取名字匹配的节点（正则），其余隐藏 */
  only?: RegExp;
  /** 隐藏名字匹配的节点 */
  hide?: RegExp;
  /** 材质覆盖：按材质名替换 */
  matOverride?: Record<string, THREE.Material>;
  /** 材质归一：按材质名施加圣经参数 */
  norm?: Record<string, MatNorm>;
  /** 材质归一：未命中 norm 的材质使用此默认 */
  normDefault?: MatNorm;
  /** 归一化后的非均匀拉伸（如把双人床压窄成行军床） */
  stretch?: [number, number, number];
  /** 额外 Y 偏移（归一化后） */
  yOff?: number;
  /** 加载完成回调（用于对齐火焰/ lid 枢轴等） */
  onReady?: (g: THREE.Group) => void;
  /** 按材质合批（默认 true）；需要保留节点结构（如箱盖枢轴）时设 false */
  merge?: boolean;
}

function applyNorm(mt: THREE.MeshStandardMaterial, n: MatNorm): void {
  if (n.color !== undefined) mt.color.setHex(n.color);
  if (n.roughness !== undefined) { mt.roughness = n.roughness; mt.roughnessMap = null; }
  if (n.metalness !== undefined) { mt.metalness = n.metalness; mt.metalnessMap = null; }
  if (n.emissive !== undefined) mt.emissive.setHex(n.emissive);
  if (n.emissiveIntensity !== undefined) mt.emissiveIntensity = n.emissiveIntensity;
  if (n.opacity !== undefined) { mt.opacity = n.opacity; mt.transparent = n.opacity < 1; }
  mt.envMapIntensity = n.envMapIntensity ?? 0.7;
  if (n.wear) applyWear(mt, n.wear);
  mt.needsUpdate = true;
}


// —— 圣经 5.2 使用痕迹/风化：世界空间局部遮罩（人用磨亮 / 水潮湿锈流 / 火烟熏 / 时间苔裂）——
// 单条痕迹覆盖 5%–25%，不满铺；磨亮只降 roughness，潮湿压明度降 roughness，熏黑压明度保持高 rough。
const WEAR_VERT = /* glsl */`
varying vec3 vWearPos; varying vec3 vWearNrm;
`;
const WEAR_FRAG = /* glsl */`
uniform float uWearKind, uWearSeed, uWearRimY, uWearSootY;
uniform vec2 uWearCenter;
varying vec3 vWearPos; varying vec3 vWearNrm;
float wearHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wearNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wearHash(i), wearHash(i+vec2(1,0)), f.x), mix(wearHash(i+vec2(0,1)), wearHash(i+vec2(1,1)), f.x), f.y);
}
float wearFbm(vec2 p){ return 0.6*wearNoise(p) + 0.3*wearNoise(p*2.3+7.0) + 0.1*wearNoise(p*5.1+3.0); }
`;
const WEAR_BODY = /* glsl */`
{
  vec3 wp = vWearPos; vec3 wn = normalize(vWearNrm);
  float sd = uWearSeed;
  float up = smoothstep(0.25, 0.7, wn.y);
  float side = 1.0 - abs(wn.y);
  if (uWearKind < 0.5) {
    // 木：桶底潮湿发黑 + 端面裂纹 + 边角磨亮露暖褐 + 侧面锈流斑
    float damp = smoothstep(0.30, 0.06, wp.y);
    diffuseColor.rgb *= mix(1.0, 0.45, damp);
    roughnessFactor = mix(roughnessFactor, 0.38, damp);
    float crack = smoothstep(0.78, 0.86, wearFbm(wp.xz * 22.0 + sd)) * up;
    diffuseColor.rgb *= 1.0 - crack * 0.5;
    float polish = smoothstep(0.62, 0.85, wearFbm(wp.xz * 3.0 + wp.y * 2.0 + sd)) * up;
    roughnessFactor = mix(roughnessFactor, 0.6, polish);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.12, 0.95), polish * 0.6);
    float rust = smoothstep(0.70, 0.82, wearFbm(vec2((wp.x + wp.z) * 5.0, wp.y * 1.6) + sd)) * side;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.106, 0.045, 0.017), rust * 0.55);
    roughnessFactor = mix(roughnessFactor, 0.88, rust);
  } else if (uWearKind < 1.5) {
    // 铁：凸起磨亮 + 凹处/下缘锈 + 滴水锈流
    float polish = smoothstep(0.66, 0.86, wearFbm(wp.xz * 4.0 + wp.y * 3.0 + sd)) * up;
    roughnessFactor = mix(roughnessFactor, 0.4, polish);
    float rust = smoothstep(0.62, 0.80, wearFbm(vec2((wp.x + wp.z) * 3.0, wp.y * 0.9) + sd)) * (1.0 - up);
    float drip = wearNoise(vec2((wp.x + wp.z) * 16.0, sd)) * smoothstep(0.55, 0.05, wp.y);
    rust = clamp(rust + drip * 0.7, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.106, 0.045, 0.017), rust * 0.7);
    roughnessFactor = mix(roughnessFactor, 0.88, rust);
    metalnessFactor = mix(metalnessFactor, 0.25, rust);
  } else if (uWearKind < 2.5) {
    // 石：背阴苔藓地衣 + 井台溅湿环 + 井沿绳磨凹槽
    float shade = smoothstep(0.1, 0.5, -dot(wn, normalize(vec3(0.6, 0.25, 0.5))));
    float moss = smoothstep(0.60, 0.82, wearFbm(wp.xz * 2.6 + wp.y * 1.4 + sd)) * shade;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.105, 0.048), moss * 0.6);
    float dc = distance(wp.xz, uWearCenter);
    float splash = smoothstep(0.5, 0.12, wp.y) * smoothstep(2.3, 1.2, dc);
    diffuseColor.rgb *= mix(1.0, 0.5, splash);
    roughnessFactor = mix(roughnessFactor, 0.4, splash);
    float groove = smoothstep(0.07, 0.0, abs(wp.y - uWearRimY)) * smoothstep(1.35, 0.95, dc);
    diffuseColor.rgb *= 1.0 - groove * 0.35;
    roughnessFactor = mix(roughnessFactor, 0.55, groove);
  } else {
    // 火与烟：热源上方熏黑（压明度、保持高 rough）+ 铁锈
    float soot = smoothstep(0.35, 0.8, wearFbm(wp.xz * 3.0 + wp.y * 1.2 + sd)) * smoothstep(uWearSootY, uWearSootY + 0.9, wp.y);
    diffuseColor.rgb *= 1.0 - soot * 0.55;
    float rust = smoothstep(0.66, 0.82, wearFbm(vec2((wp.x + wp.z) * 3.5, wp.y) + sd)) * side;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.106, 0.045, 0.017), rust * 0.6);
    roughnessFactor = mix(roughnessFactor, 0.88, rust);
    metalnessFactor = mix(metalnessFactor, 0.25, rust);
  }
}
`;
export interface WearOpts { kind: 'wood' | 'iron' | 'stone' | 'soot'; seed?: number; center?: [number, number]; rimY?: number; sootY?: number; }
const wearKindId = { wood: 0, iron: 1, stone: 2, soot: 3 };
/** 给材质叠加上圣经 5.2 的痕迹层（共享材质只注入一次）。 */
export function applyWear(mat: THREE.MeshStandardMaterial, o: WearOpts): void {
  if (mat.userData.awWear) return;
  mat.userData.awWear = true;
  const u = {
    uWearKind: { value: wearKindId[o.kind] },
    uWearSeed: { value: o.seed ?? 1 },
    uWearRimY: { value: o.rimY ?? 0.85 },
    uWearSootY: { value: o.sootY ?? 1.0 },
    uWearCenter: { value: new THREE.Vector2(o.center?.[0] ?? 0, o.center?.[1] ?? 0) },
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = WEAR_VERT + shader.vertexShader
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWearPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWearNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = WEAR_FRAG + shader.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + WEAR_BODY);
  };
  mat.customProgramCacheKey = () => 'aw-wear-' + wearKindId[o.kind];
  mat.needsUpdate = true;
}

/** 按材质实例合批 root 下的所有网格（烘焙变换），减少 draw calls。保留 root 自身变换。 */
export function mergeByMaterial(root: THREE.Object3D): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length !== 1) continue;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
    }
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    const list = byMat.get(mats[0]) ?? [];
    list.push(geo);
    byMat.set(mats[0], list);
  }
  for (const m of meshes) m.parent?.remove(m);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !(mat.transparent && mat.opacity < 0.9);
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** 加载并归一化一个道具模型。返回的 Group 已居中 XZ、贴地（minY=0）、缩放到 spec.size。 */
export function loadProp(spec: PropSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = `prop_${spec.name}`;
  const p = new Promise<void>((resolve) => {
    loader.load(`models/props/${spec.name}.glb`, (gltf) => {
      const root = gltf.scene;
      // 节点过滤
      if (spec.only || spec.hide) {
        root.traverse((o) => {
          if (spec.only && !spec.only.test(o.name)) o.visible = false;
          if (spec.hide && spec.hide.test(o.name)) o.visible = false;
        });
      }
      // 材质覆盖 + 归一
      root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const m = o as THREE.Mesh;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const next = mats.map((mt) => {
          const replaced = spec.matOverride?.[mt.name] ?? mt;
          if ((replaced as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = replaced as THREE.MeshStandardMaterial;
            const n = spec.norm?.[std.name] ?? spec.normDefault;
            if (n) applyNorm(std, n);
            else std.envMapIntensity = 0.7;
          }
          return replaced;
        });
        m.material = Array.isArray(m.material) ? next : next[0];
      });
      // 旋转修正
      if (spec.rotX) root.rotation.x = spec.rotX;
      if (spec.rotY) root.rotation.y = spec.rotY;
      root.updateMatrixWorld(true);
      // 归一化：计算可见部分的 bbox
      const box = new THREE.Box3();
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) {
          const m = o as THREE.Mesh;
          m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
          box.union(b);
        }
      });
      if (box.isEmpty()) { resolve(); return; }
      const sz = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(sz.x, sz.y, sz.z);
      const scale = spec.size / maxDim;
      const center = box.getCenter(new THREE.Vector3());
      // 居中 XZ，贴地
      root.position.set(-center.x * scale, -box.min.y * scale + (spec.yOff ?? 0), -center.z * scale);
      root.scale.setScalar(scale);
      if (spec.stretch) {
        root.scale.multiply(new THREE.Vector3(...spec.stretch));
        // 拉伸后重新贴地/居中（绕原点缩放会移动 bbox）
        root.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(root);
        const c2 = b2.getCenter(new THREE.Vector3());
        root.position.x -= c2.x; root.position.z -= c2.z;
        root.position.y -= b2.min.y - (spec.yOff ?? 0);
      }
      // 阴影：透明玻璃不投影
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          const transparent = mats.some((mt) => mt.transparent && mt.opacity < 0.9);
          o.castShadow = !transparent;
          o.receiveShadow = true;
        }
      });
      // 按材质合批：烘焙变换后合并，压低 draw calls（静态道具）
      if (spec.merge !== false) mergeByMaterial(root);
      g.add(root);
      cache.set(spec.name, g);
      spec.onReady?.(g);
      resolve();
    }, undefined, () => resolve());
  });
  pending.push(p);
  trackPending(p);
  return g;
}

/** 所有道具模型加载完成（含失败回退）。供截图工具等待。 */
export const propsReady: Promise<void> = Promise.all(pending).then(() => undefined);

/** 按名字取已加载的模型（用于动态道具需要引用子节点的场景）。 */
export function getProp(name: string): THREE.Group | undefined { return cache.get(name); }

/** 在已加载的模型里按名字找子节点。 */
export function findNode(root: THREE.Object3D, pattern: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => { if (!found && pattern.test(o.name)) found = o; });
  return found;
}