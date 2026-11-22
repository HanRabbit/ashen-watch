// 加载页（UI-04）：显示真实加载百分比（main.ts 经 THREE.DefaultLoadingManager 统计），
// 贴图链就绪后淡出。纯展示层，不参与玩法与输入；pointer-events 始终 none，12 秒兜底绝不挡界面。
interface LoadState { loaded: number; total: number; done: boolean }

const boot = document.getElementById('boot');
if (boot) {
  const line = boot.querySelector('.boot-line i') as HTMLElement | null;
  const pctEl = boot.querySelector('.boot-pct') as HTMLElement | null;
  let done = false;
  let shown = 0;
  const hide = (): void => {
    if (done || !boot.isConnected) return;
    done = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 650);
  };
  const render = (s: LoadState): void => {
    const pct = s.done ? 100 : s.total > 0 ? Math.round((s.loaded / s.total) * 100) : 0;
    // 资源总数会随加载动态增长，显示值只增不减，避免百分比回跳。
    shown = Math.max(shown, Math.min(100, pct));
    if (line) line.style.width = `${shown}%`;
    if (pctEl) pctEl.textContent = `${shown}%`;
    if (s.done) hide();
  };
  window.addEventListener('aw-load', (e) => render((e as CustomEvent<LoadState>).detail));
  const initial = (window as unknown as { __awLoad?: LoadState }).__awLoad;
  if (initial) render(initial);
  const tex = (window as unknown as { __awTexReady?: Promise<unknown> }).__awTexReady;
  if (tex) Promise.resolve(tex).then(() => requestAnimationFrame(() => requestAnimationFrame(hide)));
  setTimeout(hide, 12000);
}