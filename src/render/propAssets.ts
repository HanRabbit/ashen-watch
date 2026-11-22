// 道具模型加载器：异步加载 GLB，归一化尺度/朝向/贴地，失败时回退到程序化几何。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, THREE.Group>();
const pending: Promise<void>[] = [];

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
  /** 额外 Y 偏移（归一化后） */
  yOff?: number;
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
      // 材质覆盖
      if (spec.matOverride) {
        root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const m = o as THREE.Mesh;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            const replaced = mats.map((mt) => spec.matOverride![mt.name] ?? mt);
            m.material = Array.isArray(m.material) ? replaced : replaced[0];
          }
        });
      }
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
      // 阴影
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // 确保 PBR 材质有环境贴图响应
          const m = o as THREE.Mesh;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mt of mats) {
            if ((mt as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
              (mt as THREE.MeshStandardMaterial).envMapIntensity = 1.0;
            }
          }
        }
      });
      g.add(root);
      cache.set(spec.name, g);
      resolve();
    }, undefined, () => resolve());
  });
  pending.push(p);
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