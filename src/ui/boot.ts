// 加载页（UI-04）：首帧渲染与外部贴图就绪后淡出。纯展示层，不参与玩法与输入。
// 任何情况下 12 秒后都会移除，绝不挡住标题界面；pointer-events 始终为 none。
const boot = document.getElementById('boot');
if (boot) {
  let done = false;
  const hide = (): void => {
    if (done || !boot.isConnected) return;
    done = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 650);
  };
  const tex = (window as unknown as { __awTexReady?: Promise<unknown> }).__awTexReady;
  if (tex) {
    Promise.resolve(tex).then(() => requestAnimationFrame(() => requestAnimationFrame(hide)));
  }
  setTimeout(hide, 12000);
}