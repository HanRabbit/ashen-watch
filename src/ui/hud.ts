// HUD（UI-01、UI-02）：生命、冷量、油量、时段、交互提示、物品栏、字幕与提示。
// 状态区别不只依赖颜色：低量时同时给出文字与斜纹。
import { HEARTH, LANTERN, PHASE, PLAYER } from '../config';
import { STAIRS } from '../sim/level'; // map:
import { node } from '../sim/nav'; // map:
import { Target } from '../sim/sim';
import { World } from '../sim/state';
import { keyName, Settings } from '../settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export const fmtTime = (s: number): string => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const PHASE_NAME: Record<string, string> = {
  tutorial: '清晨', day: '白天', dusk: '黄昏', night: '夜间', dawn: '晨曦', ended: '晨曦', failed: '夜间',
};

// 时段图标（装饰，不改变文字含义）：阴天圆盘 / 月牙 / 地平线半日。
const PHASE_ICON: Record<string, string> = {
  tutorial: 'dawn', day: 'day', dusk: 'dawn', night: 'night', dawn: 'dawn', ended: 'dawn', failed: 'night',
};

const DIRS = ['前方', '右前', '右侧', '右后', '后方', '左后', '左侧', '左前'];

export function goalText(w: World): string {
  const q = w.quest, inv = w.inv;
  if (w.phase === 'tutorial') {
    if (!inv.hasLantern) return '拾取床边矮凳上的<b>提灯</b>';
    return '查看门边的<b>任务板</b>';
  }
  if (w.phase === 'day' || w.phase === 'dusk') {
    const n = Number(w.repairs.lamp) + Number(w.repairs.gate) + Number(w.repairs.bolt);
    const head = w.phase === 'day' ? '搜集物资，抢修设施' : '回门房补油、做热食，准备入夜';
    const skip = w.phase === 'day' ? '忙完可回<b>床铺</b>休息到黄昏' : '准备好了可在<b>壁炉</b>旁等到入夜';
    return `${head}（已修 ${n}/2）<br>${skip}`;
  }
  if (q.rung) return '晨钟响了';
  if (q.installed) return '再交互一次，<b>敲响晨钟</b>';
  if (w.phase === 'night') {
    if (!inv.hasClapper) return '到礼拜堂<b>祭台匣</b>取出钟舌';
    if (!q.returnedBeforeDawn) return '带着钟舌<b>回门房</b>';
    return '守住炉火，<b>等到晨曦</b>（可在壁炉旁等待）';
  }
  if (!inv.hasClapper) return '天亮了。到礼拜堂<b>祭台匣</b>取出钟舌';
  return '到门房外的<b>晨钟</b>装上钟舌';
}

export class Hud {
  private root = $('hud');
  private phase = $('hud-phase');
  private goal = $('hud-goal');
  private prompt = $('hud-prompt');
  private toasts = $('hud-toasts');
  private subs = $('hud-subs');
  private inv = $('hud-inv');
  private hint = $('hud-mousehint');
  private fxThreat = $('fx-threat');
  private fxCold = $('fx-cold');
  private fxHurt = $('fx-hurt');
  private last = new Map<string, string>();
  private bars = ['hp', 'cold', 'oil'].map((k) => {
    const el = $(`bar-${k}`);
    return { el, fill: el.querySelector('i') as HTMLElement, val: el.querySelector('.bar-val') as HTMLElement };
  });

  constructor(private settings: Settings) {}

  show(v: boolean): void {
    this.root.hidden = !v;
    if (!v) { this.fxThreat.style.opacity = this.fxCold.style.opacity = this.fxHurt.style.opacity = '0'; }
  }

  private set(key: string, el: HTMLElement, html: string): void {
    if (this.last.get(key) === html) return;
    this.last.set(key, html);
    el.innerHTML = html;
  }

  private bar(i: number, ratio: number, text: string, low: boolean): void {
    const b = this.bars[i];
    const w = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    if (b.fill.style.width !== w) b.fill.style.width = w;
    this.set(`bar${i}`, b.val, text);
    b.el.classList.toggle('low', low);
  }

  update(w: World, target: Target | null, threat: number, sprintLocked: boolean): void {
    // 时段
    let phase = PHASE_NAME[w.phase] ?? '';
    if (w.phase === 'day') phase += ` · 距黄昏 ${fmtTime(PHASE.dayLength - w.clock)}`;
    else if (w.phase === 'dusk') phase += ` · 距入夜 ${fmtTime(PHASE.duskLength - w.clock)}`;
    else if (w.phase === 'night') phase += ` · 距晨曦 ${fmtTime(PHASE.nightLength - w.clock)}`;
    const icon = PHASE_ICON[w.phase] ?? 'day';
    // map: 楼层提示（UI-04）+ 楼梯去向
    let floorTxt = ` · ${w.player.floor}`;
    for (const st of STAIRS) for (const nid of [st.a, st.b]) {
      const n = node(nid);
      if (n.floor === w.player.floor && Math.hypot(n.x - w.player.x, n.z - w.player.z) < 2.2 && Math.abs(n.y - w.player.y) < 1.2) {
        const on = node(nid === st.a ? st.b : st.a);
        floorTxt += `（楼梯→${on.floor}）`;
      }
    }
    this.set('phase', this.phase, `<svg class="ph-ic ${icon}" aria-hidden="true"><use href="#i-phase-${icon}"/></svg>${phase}${floorTxt}`);
    this.set('goal', this.goal, goalText(w));

    // 状态条
    const p = w.player, lan = w.lantern;
    this.bar(0, p.hp / PLAYER.maxHp, `${Math.ceil(p.hp)}${p.hp <= 30 ? ' 危险' : ''}`, p.hp <= 30);
    const coldR = p.cold / HEARTH.coldThreshold;
    const coldTxt = coldR >= 1 ? '冻伤中！' : coldR >= 0.75 ? '快冻僵了' : coldR > 0.02 ? `${Math.round(coldR * 100)}%` : '暖和';
    this.bar(1, coldR, coldTxt, coldR >= 0.75);
    const oilTxt = !w.inv.hasLantern ? '无提灯'
      : `${fmtTime(lan.oil)}${lan.oil <= 0 ? ' 耗尽' : lan.raised ? ` 举灯×${LANTERN.raiseMultiplier}` : lan.on ? (lan.oil < 30 ? ' 将尽' : '') : ' 已熄'}`;
    this.bar(2, lan.oil / LANTERN.maxOil, oilTxt, w.inv.hasLantern && lan.oil < 30);

    // 物品栏与独立任务槽
    const b = this.settings.binds;
    const mouse = this.settings.mode === 'mouse';
    const slot = (icon: string, name: string, val: string, cls = ''): string =>
      `<div class="slot ${cls}"><svg><use href="#i-${icon}"/></svg>${name}<b>${val}</b></div>`;
    const inv = w.inv;
    this.set('inv', this.inv,
      slot('wood', '木料', `${inv.wood}`, inv.wood ? '' : 'empty')
      + slot('iron', '铁件', `${inv.iron}`, inv.iron ? '' : 'empty')
      + slot('oil', '灯油', `${inv.oil}`, inv.oil ? '' : 'empty')
      + slot('meal', '热食', inv.meal ? `${inv.meal} <span class="key">${mouse ? '工具栏' : keyName(b.eat)}</span>` : '0', inv.meal ? '' : 'empty')
      + slot('lantern', '提灯', !inv.hasLantern ? '无' : lan.on ? '点亮' : '熄灭', !inv.hasLantern ? 'empty' : lan.on ? 'lit' : '')
      + slot('clapper', '钟舌', w.quest.installed ? '已装' : inv.hasClapper ? '持有' : '未取', `task ${inv.hasClapper || w.quest.installed ? 'held' : 'empty'}`));

    // 交互提示
    if (target) {
      const key = mouse ? '右键' : keyName(b.interact);
      this.prompt.hidden = false;
      this.prompt.classList.toggle('off', !target.enabled);
      this.set('prompt', this.prompt, target.enabled
        ? `<kbd>${key}</kbd>${target.label}`
        : `${target.label}<small>${target.reason}</small>`);
    } else this.prompt.hidden = true;

    this.hint.hidden = !mouse;
    if (mouse) {
      this.set('hint', this.hint,
        `按住<b>左键</b>前进 · <b>右键</b>短按交互／长按举灯 · <b>滚轮</b>↑冲刺${sprintLocked ? '（已开）' : ''} ↓步行 · <b>中键</b>工具栏`);
    }

    this.fxThreat.style.opacity = threat.toFixed(2);
    this.fxCold.style.opacity = (coldR > 0.6 ? (coldR - 0.6) * 1.6 : 0).toFixed(2);
    this.fxHurt.style.opacity = (w.hurtFlash * 1.5).toFixed(2);
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  /** 声音线索的字幕，带相对玩家朝向的方位。 */
  subtitle(text: string, w: World, yaw: number, x?: number, z?: number): void {
    const el = document.createElement('div');
    el.className = `sub${text.startsWith('【灰影】') ? ' grey' : text.startsWith('【黑影】') ? ' wraith' : ''}`;
    el.textContent = text;
    if (x !== undefined && z !== undefined) {
      const dx = x - w.player.x, dz = z - w.player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.5) {
        let a = Math.atan2(dx, dz) - yaw;
        a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const dir = document.createElement('span');
        dir.className = 'dir';
        dir.textContent = `${DIRS[Math.round(a / (Math.PI / 4)) % 8]} ${Math.round(dist)} 米`;
        el.appendChild(dir);
      }
    }
    this.subs.appendChild(el);
    while (this.subs.children.length > 3) this.subs.firstElementChild?.remove();
    setTimeout(() => el.remove(), 3800);
  }

  clearTransient(): void {
    this.toasts.innerHTML = '';
    this.subs.innerHTML = '';
  }
}
