// 页面与浮层（UI-03）：标题、亮度校准、暂停设置、任务资源、修复确认、失败重试、通关结算、纯鼠标工具栏。
// 界面按栈管理：只有栈顶接受输入。所有按钮都可点击，纯鼠标可以从标题走到结算。
import { REPAIR_COST, REPAIR_NAME, RepairId, WALL_LAMP } from '../config';
import { BIND_LABEL, BindAction, DEFAULT_BINDS, keyName, Settings } from '../settings';
import { canRepairNow, repairGap } from '../sim/sim';
import { World } from '../sim/state';
import { fmtTime, goalText } from './hud';

export type ScreenId =
  | 'title' | 'calibrate' | 'resume' | 'pause' | 'settings' | 'tasks' | 'board' | 'repair'
  | 'toolbar' | 'failed' | 'ended' | 'confirmNew';

export interface ScreenHost {
  world(): World;
  settings: Settings;
  retries(): number;
  hasSnapshot(): boolean;
  saveNotice(): string;
  storageNote(): string;
  lockFailed(): boolean;
  settingsChanged(): void;
  captureKey(cb: (code: string) => void): void;
  cancelCapture(): void;
  // 动作
  startNew(): void;
  continueGame(): void;
  resume(): void;
  toTitle(): void;
  retryNight(): void;
  restartDay(): void;
  confirmRepair(id: RepairId): void;
  boardClosed(): void;
  toggleLantern(): void;
  eat(): void;
}

const REPAIR_GAIN: Record<RepairId, string> = {
  lamp: `修好后可投入 1 份油点亮 ${WALL_LAMP.burnTime / 60} 分钟。点亮期间两只鬼都不敢进入庭院西侧的光区。`,
  gate: '解锁通往礼拜堂侧门的近路（单程约 17 秒，主路约 31 秒）。栅门可手动开合，关上能挡住通行和视线。',
  bolt: '在门房内关门后可加闩。加闩的门，灰影拍不开；两只鬼都进不来。',
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Screens {
  private el = document.getElementById('overlay') as HTMLElement;
  private stack: { id: ScreenId; arg?: unknown }[] = [];
  private rebinding: BindAction | null = null;

  constructor(private host: ScreenHost) {
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      this.act(btn.dataset.act!, btn.dataset.arg);
    });
    this.el.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      const s = this.host.settings;
      const v = Number(inp.value);
      if (inp.name === 'sensitivity') s.sensitivity = v;
      else if (inp.name === 'brightness') s.brightness = v;
      else if (inp.name === 'volume') s.volume = v;
      else return;
      const out = this.el.querySelector(`[data-out="${inp.name}"]`);
      if (out) out.textContent = v.toFixed(2);
      this.host.settingsChanged();
    });
    // 界面按钮上的点击不传入游戏
    for (const ev of ['mousedown', 'mouseup', 'contextmenu', 'wheel']) this.el.addEventListener(ev, (e) => e.stopPropagation());
  }

  top(): ScreenId | null {
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(id: ScreenId, arg?: unknown): void {
    if (this.top() === id) { this.stack[this.stack.length - 1].arg = arg; this.render(); return; }
    this.stack.push({ id, arg });
    this.render();
  }

  replace(id: ScreenId, arg?: unknown): void {
    this.stack = [{ id, arg }];
    this.render();
  }

  back(): void {
    if (this.rebinding) { this.rebinding = null; this.host.cancelCapture(); }
    this.stack.pop();
    this.render();
  }

  closeAll(): void {
    this.rebinding = null;
    this.host.cancelCapture();
    this.stack = [];
    this.render();
  }

  refresh(): void {
    if (this.stack.length) this.render();
  }

  private act(act: string, arg?: string): void {
    const h = this.host, s = h.settings;
    switch (act) {
      case 'new': if (h.hasSnapshot()) this.open('confirmNew'); else this.open('calibrate', 'new'); break;
      case 'newConfirmed': this.back(); this.open('calibrate', 'new'); break;
      case 'continue': h.continueGame(); break;
      case 'calibDone': h.startNew(); break;
      case 'resume': h.resume(); break;
      case 'settings': this.open('settings'); break;
      case 'tasks': this.open('tasks'); break;
      case 'back': this.back(); break;
      case 'title': h.toTitle(); break;
      case 'retry': h.retryNight(); break;
      case 'restart': h.restartDay(); break;
      case 'repairOk': h.confirmRepair(arg as RepairId); break;
      case 'boardClose': h.boardClosed(); break;
      case 'lantern': h.toggleLantern(); h.resume(); break;
      case 'eat': h.eat(); h.resume(); break;
      case 'mode': s.mode = arg === 'mouse' ? 'mouse' : 'kbm'; h.settingsChanged(); this.render(); break;
      case 'quality': s.quality = arg === 'low' ? 'low' : arg === 'high' ? 'high' : 'cinematic'; h.settingsChanged(); this.render(); break;
      case 'resetBinds': s.binds = { ...DEFAULT_BINDS }; h.settingsChanged(); this.render(); break;
      case 'rebind': {
        this.rebinding = arg as BindAction;
        this.render();
        h.captureKey((code) => {
          const a = this.rebinding;
          this.rebinding = null;
          if (a && code !== 'Escape') {
            // 同一按键只绑定一个动作：与旧绑定互换
            const other = (Object.keys(s.binds) as BindAction[]).find((k) => k !== a && s.binds[k] === code);
            if (other) s.binds[other] = s.binds[a];
            s.binds[a] = code;
            h.settingsChanged();
          }
          this.render();
        });
        break;
      }
    }
  }

  private render(): void {
    const cur = this.stack[this.stack.length - 1];
    this.el.hidden = !cur;
    if (!cur) { this.el.innerHTML = ''; return; }
    this.el.className = cur.id === 'title' || cur.id === 'calibrate' || cur.id === 'confirmNew' ? 'title' : cur.id === 'toolbar' ? 'light' : '';
    this.el.innerHTML = this.html(cur.id, cur.arg);
    (this.el.querySelector('button.primary:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private settingsBody(): string {
    const s = this.host.settings;
    const slider = (name: string, label: string, min: number, max: number, v: number): string =>
      `<div class="row"><span>${label}</span><input type="range" name="${name}" min="${min}" max="${max}" step="0.05" value="${v}"><span data-out="${name}">${v.toFixed(2)}</span></div>`;
    const binds = (Object.keys(BIND_LABEL) as BindAction[]).map((a) =>
      `<button class="small ${this.rebinding === a ? 'on' : ''}" data-act="rebind" data-arg="${a}">${BIND_LABEL[a]}：${this.rebinding === a ? '请按键…' : esc(keyName(s.binds[a]))}</button>`).join('');
    return `
      <h3>操作方式</h3>
      <div class="btns">
        <button class="${s.mode === 'kbm' ? 'on' : ''}" data-act="mode" data-arg="kbm">键盘 + 鼠标<small>WASD 移动，E 交互，按住右键举灯</small></button>
        <button class="${s.mode === 'mouse' ? 'on' : ''}" data-act="mode" data-arg="mouse">纯鼠标<small>左键前进，右键短按交互／长按举灯，中键工具栏</small></button>
      </div>
      <h3>镜头与显示</h3>
      <div class="btns">
        <button class="${s.quality === 'cinematic' ? 'on' : ''}" data-act="quality" data-arg="cinematic">电影画质<small>屏幕空间反射、环境光遮蔽、带阴影的体积雾、LUT 调色与 MSAA。推荐独立显卡</small></button>
        <button class="${s.quality === 'high' ? 'on' : ''}" data-act="quality" data-arg="high">高画质<small>环境光遮蔽、低分辨率体积雾、泛光与调色，关闭屏幕空间反射</small></button>
        <button class="${s.quality === 'low' ? 'on' : ''}" data-act="quality" data-arg="low">低画质<small>关闭后期与粒子，降低阴影分辨率。集成显卡保帧率</small></button>
      </div>
      ${slider('sensitivity', '鼠标灵敏度', 0.2, 3, s.sensitivity)}
      ${slider('brightness', '亮度', 0.5, 2, s.brightness)}
      ${slider('volume', '音量', 0, 1, s.volume)}
      <h3>键位（点击后按下新按键，Esc 取消）</h3>
      <div class="binds">${binds}</div>
      <div class="btns"><button class="small" data-act="resetBinds">恢复默认键位</button></div>`;
  }

  private tasksBody(w: World): string {
    const { inv, quest } = w;
    const repairs = (['lamp', 'gate', 'bolt'] as RepairId[]).map((id) => {
      const { wood, iron } = REPAIR_COST[id];
      return `<tr><th>${REPAIR_NAME[id]}</th><td>${w.repairs[id] ? '已修' : `${wood} 木 · ${iron} 铁`}</td></tr>`;
    }).join('');
    return `
      <p class="ok">${goalText(w)}</p>
      <table class="kv">
        <tr><th>物资</th><td>木 ${inv.wood} · 铁 ${inv.iron} · 油 ${inv.oil} · 热食 ${inv.meal}</td></tr>
        <tr><th>钟舌</th><td>${quest.installed ? '已装' : inv.hasClapper ? '持有' : '待取'}</td></tr>
        ${repairs}
      </table>`;
  }

  private html(id: ScreenId, arg: unknown): string {
    const h = this.host, w = h.world();
    const note = h.storageNote();
    const noteHtml = note ? `<p class="warn">${esc(note)}</p>` : '';
    switch (id) {
      case 'title':
        return `<div class="embers" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="panel title-panel">
          <h1>灰烬守夜</h1><p class="sub-title">ASHEN WATCH · 首夜</p>
          <p>接手一座被遗弃的城堡。白天抢修，入夜取回礼拜堂的钟舌，天亮时敲响晨钟。</p>
          ${noteHtml}
          <div class="btns col">
            <button class="primary" data-act="new">新游戏</button>
            <button data-act="continue" ${h.hasSnapshot() ? '' : 'disabled'}>继续<small>${h.hasSnapshot() ? `从黄昏起点恢复（已重试 ${h.retries()} 次）` : '到达黄昏后才有存档'}</small></button>
            <button data-act="settings">设置<small>操作方式、键位、灵敏度、亮度</small></button>
          </div>
          <p class="note">当前操作方式：${h.settings.mode === 'mouse' ? '纯鼠标' : '键盘 + 鼠标'}。可在设置中切换。</p>
        </div>`;
      case 'confirmNew':
        return `<div class="panel"><h2>开始新游戏？</h2>
          <p>现有的黄昏存档会被清除，重试计数归零。操作和显示设置会保留。</p>
          <div class="btns"><button class="primary" data-act="newConfirmed">清除并开始</button><button data-act="back">返回</button></div></div>`;
      case 'calibrate': {
        const s = h.settings;
        return `<div class="panel"><h2>亮度校准</h2>
          <p>拖动滑块，直到<b>左边的格子几乎看不见</b>、中间的格子隐约可辨、右边的格子清楚可见。夜里关灯后，你要靠这样的暗部辨路。</p>
          <div class="calib">
            <div style="background:#000;color:rgb(${Math.round(9 * s.brightness)},${Math.round(9 * s.brightness)},${Math.round(10 * s.brightness)})">灰</div>
            <div style="background:#000;color:rgb(${Math.round(24 * s.brightness)},${Math.round(25 * s.brightness)},${Math.round(27 * s.brightness)})">烬</div>
            <div style="background:#000;color:rgb(${Math.round(70 * s.brightness)},${Math.round(72 * s.brightness)},${Math.round(76 * s.brightness)})">守夜</div>
          </div>
          <div class="row"><span>亮度</span><input type="range" name="brightness" min="0.5" max="2" step="0.05" value="${s.brightness}"><span data-out="brightness">${s.brightness.toFixed(2)}</span></div>
          <div class="btns"><button class="primary" data-act="calibDone">开始</button><button data-act="back">返回</button></div>
          <p class="note">点击「开始」后鼠标会被游戏捕获；按 Esc 可随时释放。</p></div>`;
      }
      case 'resume':
        return `<div class="panel"><h2>${h.lockFailed() ? '未能捕获鼠标' : '已暂停'}</h2>
          ${h.lockFailed() ? '<p class="warn">浏览器拒绝了鼠标捕获（刚按过 Esc 时需要稍等片刻）。请再点一次「继续游戏」。</p>' : '<p>游戏时钟已停。点击下面的按钮回到游戏；这一次点击不会让角色移动。</p>'}
          <div class="btns col">
            <button class="primary" data-act="resume">继续游戏</button>
            <button data-act="tasks">任务与资源</button>
            <button data-act="settings">设置</button>
            <button data-act="title">回到标题<small>${h.hasSnapshot() ? '可从标题「继续」回到黄昏起点' : '尚未到黄昏，本次进度不会保留'}</small></button>
          </div></div>`;
      case 'pause': return this.html('resume', arg);
      case 'settings':
        return `<div class="panel wide"><h2>设置</h2>${this.settingsBody()}
          <div class="btns"><button class="primary" data-act="back">完成</button></div></div>`;
      case 'tasks':
        return `<div class="panel wide"><h2>任务与资源</h2>${this.tasksBody(w)}
          <div class="btns"><button class="primary" data-act="${this.stack.length > 1 ? 'back' : 'resume'}">${this.stack.length > 1 ? '返回' : '继续游戏'}</button></div></div>`;
      case 'board':
        return `<div class="panel wide"><h2>任务板</h2>
          <ol class="steps">
            <li><b>白天</b> · 搜集木、铁和油，最多修两处。回床铺可等到黄昏。</li>
            <li><b>入夜</b> · 到礼拜堂祭台匣取钟舌。长按右键举灯驱鬼。</li>
            <li><b>晨曦</b> · 回门房，装好钟舌后敲响晨钟。</li>
          </ol>
          <p>门房可补油，点着的壁炉能回暖，也可等到入夜。</p>
          <div class="btns"><button class="primary" data-act="boardClose">收起任务板${w.phase === 'tutorial' ? '，开始白天' : ''}</button></div></div>`;
      case 'repair': {
        const rid = arg as RepairId;
        const c = REPAIR_COST[rid], gap = repairGap(w, rid);
        const short = gap.wood > 0 || gap.iron > 0;
        const done = w.repairs[rid], late = !canRepairNow(w);
        const lack = [gap.wood && `木料缺 ${gap.wood}`, gap.iron && `铁件缺 ${gap.iron}`].filter(Boolean).join('、');
        return `<div class="panel"><h2>修复${REPAIR_NAME[rid]}</h2>
          <p>${REPAIR_GAIN[rid]}</p>
          <table class="kv">
            <tr><th>需要</th><td>${c.wood} 木、${c.iron} 铁</td></tr>
            <tr><th>你有</th><td>${w.inv.wood} 木、${w.inv.iron} 铁</td></tr>
            <tr><th>修完剩余</th><td>${short ? '—' : `${w.inv.wood - c.wood} 木、${w.inv.iron - c.iron} 铁`}</td></tr>
          </table>
          ${done ? '<p class="ok">已经修好了。</p>' : late ? '<p class="warn">入夜后无法再修复。</p>' : short ? `<p class="warn">材料不足：${lack}。全图共 4 木 4 铁，三处只能修两处。</p>` : '<p class="note">确认后一次性扣除材料。取消不会扣料。</p>'}
          <div class="btns">
            <button class="primary" data-act="repairOk" data-arg="${rid}" ${done || late || short ? 'disabled' : ''}>确认修复</button>
            <button data-act="resume">${done || late || short ? '返回' : '取消'}</button>
          </div></div>`;
      }
      case 'toolbar': {
        const inv = w.inv, lan = w.lantern;
        const ic = (n: string): string => `<svg><use href="#i-${n}"/></svg>`;
        return `<div class="toolbar">
          <button class="primary" data-act="resume">继续游戏</button>
          <button data-act="lantern" ${inv.hasLantern && (lan.on || lan.oil > 0) ? '' : 'disabled'}>${ic('lantern')}提灯：${!inv.hasLantern ? '无' : lan.on ? '熄灭' : '点亮'}</button>
          <button data-act="eat" ${inv.meal > 0 ? '' : 'disabled'}>${ic('meal')}热食 ×${inv.meal}</button>
          <button data-act="tasks">${ic('clapper')}任务</button>
          <button data-act="settings">设置</button>
        </div>`;
      }
      case 'failed':
        return `<div class="panel"><h2>守夜失败</h2>
          <p class="warn">${esc(w.failReason || '你没能撑到天亮')}</p>
          ${noteHtml}
          <div class="btns col">
            <button class="primary" data-act="retry" ${h.hasSnapshot() ? '' : 'disabled'}>重试当晚<small>${h.hasSnapshot() ? `回到黄昏起点：黄昏后的修复和拾取会撤销，可以重选。已重试 ${h.retries()} 次` : '尚无黄昏存档'}</small></button>
            <button data-act="restart">重开当天<small>回到清晨，白天的修复也可重选；重试计数归零</small></button>
            <button data-act="title">回到标题</button>
          </div></div>`;
      case 'ended': {
        const reps = (['lamp', 'gate', 'bolt'] as RepairId[]).filter((r) => w.repairs[r]).map((r) => REPAIR_NAME[r]);
        const at = w.quest.clapperAt === 'night' ? '夜间' : '晨曦';
        return `<div class="panel"><h2>晨钟响了</h2>
          <p>钟声越过庭院和礼拜堂的残顶。灰烬守夜的第一夜，结束了。</p>
          <table class="kv">
            <tr><th>用时</th><td>${fmtTime(w.played)}</td></tr>
            <tr><th>修复</th><td>${reps.length ? reps.join('、') : '没有修复任何设施'}</td></tr>
            <tr><th>首夜重试</th><td>${h.retries()} 次</td></tr>
            <tr><th>钟舌取回</th><td>${at}${w.quest.returnedBeforeDawn ? '，并在晨曦前带回了门房' : w.quest.clapperAt === 'night' ? '，但没在晨曦前带回门房' : ''}</td></tr>
          </table>
          <div class="btns"><button class="primary" data-act="restart">再守一夜</button><button data-act="title">回到标题</button></div></div>`;
      }
    }
  }
}
