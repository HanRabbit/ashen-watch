// 合成音（SFX-01…03 的占位）：全部用 Web Audio 现场合成，不依赖音频文件。
// 敌人提示音各有独立音色，并始终配合字幕；受威胁时压低环境声。
type Zone = 'gatehouse' | 'courtyard' | 'chapel' | 'none';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private wind!: GainNode;
  private fire!: GainNode;
  private echo!: GainNode;
  private drone!: GainNode;
  private scrape!: GainNode;
  private noiseBuf!: AudioBuffer;
  private volume = 0.7;
  private stepIdx = 0;

  /** 必须在用户手势里调用（浏览器自动播放策略）。 */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 2147483648) - 1; }
    this.wind = this.loop('lowpass', 420, 0.6, this.amb);
    this.fire = this.loop('bandpass', 1500, 0.8, this.amb);
    this.echo = this.loop('bandpass', 180, 4, this.amb);
    this.drone = this.loop('lowpass', 90, 2, this.sfx);
    this.scrape = this.loop('bandpass', 2300, 1.2, this.sfx);
  }

  private loop(type: BiquadFilterType, freq: number, q: number, out: AudioNode): GainNode {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.loopStart = Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(out);
    src.start();
    return g;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(): void { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx?.state === 'suspended') void this.ctx.resume(); }

  /** 每帧更新环境声与两鬼的持续音。threat 为 0–1。 */
  ambient(zone: Zone, night: boolean, hearthLit: boolean, threat: number, greyNear: number, wraithNear: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const duck = 1 - 0.7 * threat;
    const set = (g: GainNode, v: number): void => { g.gain.setTargetAtTime(v, t, 0.25); };
    set(this.amb, duck);
    set(this.wind, zone === 'none' ? 0 : zone === 'courtyard' ? (night ? 0.2 : 0.13) : 0.045);
    set(this.fire, zone === 'gatehouse' && hearthLit ? 0.07 : 0);
    set(this.echo, zone === 'chapel' ? 0.16 : 0);
    // 灰影巡游：低频摩擦；黑影：高频的布料擦地
    set(this.drone, 0.5 * greyNear);
    set(this.scrape, 0.09 * wraithNear * (0.6 + 0.4 * Math.sin(t * 7)));
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, when = 0, slideTo = 0, attack = 0.008): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  /** 脚步：石板与木板各 3 个变体轮换。 */
  step(surface: 'stone' | 'wood', sprint: boolean): void {
    if (!this.ctx) return;
    const v = this.stepIdx++ % 3;
    const vol = sprint ? 0.2 : 0.12;
    if (surface === 'stone') this.burst(0.07, 'bandpass', 1500 + v * 320, 1.4, vol);
    else {
      this.burst(0.09, 'lowpass', 420 + v * 70, 1, vol * 1.3);
      this.tone(95 + v * 12, 0.08, 'sine', vol * 0.7);
    }
  }

  play(id: string): void {
    if (!this.ctx) return;
    switch (id) {
      case 'pickup': this.tone(520, 0.09, 'triangle', 0.14); this.tone(780, 0.14, 'triangle', 0.12, 0.07); break;
      case 'deny': this.tone(150, 0.12, 'square', 0.06); break;
      case 'repair': for (let i = 0; i < 3; i++) { this.burst(0.06, 'bandpass', 2100, 3, 0.26, i * 0.17); this.tone(330, 0.07, 'square', 0.05, i * 0.17); } break;
      case 'door': this.burst(0.42, 'bandpass', 240, 5, 0.22, 0, 480); this.burst(0.07, 'lowpass', 260, 1, 0.3, 0.4); break;
      case 'gate': this.burst(0.6, 'bandpass', 1300, 9, 0.16, 0, 2300); this.tone(700, 0.5, 'sawtooth', 0.025, 0, 1150); this.burst(0.06, 'highpass', 3000, 1, 0.2, 0.58); break;
      case 'bolt': this.burst(0.16, 'bandpass', 1700, 6, 0.2); this.tone(240, 0.07, 'square', 0.1, 0.16); this.burst(0.05, 'lowpass', 500, 1, 0.3, 0.16); break;
      case 'pour': this.burst(0.75, 'bandpass', 950, 2.5, 0.12, 0, 1700, 0.1); break;
      case 'light': this.burst(0.22, 'highpass', 2600, 1, 0.1, 0, 5200); this.tone(900, 0.1, 'sine', 0.04, 0.05); break;
      case 'snuff': this.burst(0.3, 'lowpass', 1300, 1, 0.1, 0, 180); break;
      case 'eat': this.burst(0.1, 'lowpass', 600, 1, 0.14); this.burst(0.1, 'lowpass', 520, 1, 0.14, 0.22); break;
      case 'chest': this.burst(0.5, 'bandpass', 420, 7, 0.3, 0, 880); this.tone(196, 0.9, 'triangle', 0.16, 0.42); this.tone(294, 1.3, 'sine', 0.12, 0.46); this.burst(0.1, 'lowpass', 300, 1, 0.4, 0.42); break;
      case 'duskWarn': this.tone(330, 0.5, 'sine', 0.13); this.tone(262, 0.8, 'sine', 0.13, 0.4); break;
      case 'ring': this.burst(0.05, 'highpass', 2000, 1, 0.3); this.tone(410, 1.5, 'triangle', 0.14); this.tone(1105, 0.9, 'sine', 0.06); break;
      case 'bell': for (let i = 0; i < 3; i++) for (const [m, v, d] of [[1, 0.3, 4.2], [2.01, 0.16, 3], [2.74, 0.1, 2.2], [0.5, 0.2, 4.6]] as const) this.tone(220 * m, d, 'sine', v, i * 1.25); break;
      // 灰影：短促吸气（警觉）、低沉的呼啸（扑击）
      case 'greyAlert': this.burst(0.34, 'bandpass', 500, 4, 0.34, 0, 2500, 0.12); break;
      case 'greyWindup': this.burst(0.85, 'bandpass', 300, 5, 0.3, 0, 900, 0.5); this.tone(70, 0.85, 'sawtooth', 0.09, 0, 140); break;
      case 'greyStrike': this.burst(0.22, 'lowpass', 1500, 1, 0.42, 0, 150); break;
      // 黑影：干涩的拖擦（警觉与扑击前摇都是高频、断续的）
      case 'wraithAlert': for (let i = 0; i < 3; i++) this.burst(0.11, 'highpass', 3200, 1, 0.2, i * 0.13); break;
      case 'wraithWindup': for (let i = 0; i < 6; i++) this.burst(0.13, 'bandpass', 3800 - i * 260, 7, 0.24, i * 0.17); break;
      case 'wraithStrike': this.burst(0.18, 'highpass', 1800, 1, 0.36, 0, 5200); this.burst(0.12, 'lowpass', 300, 1, 0.3, 0.05); break;
      case 'recoil': this.burst(0.45, 'bandpass', 2400, 3, 0.16, 0, 500); break;
      case 'bang': this.burst(0.13, 'lowpass', 190, 1, 0.75); this.tone(62, 0.2, 'sine', 0.45); break;
      case 'doorBurst': this.burst(0.5, 'lowpass', 700, 1, 0.65, 0, 110); this.tone(48, 0.4, 'sine', 0.5); break;
      case 'hurt': this.tone(190, 0.28, 'sawtooth', 0.16, 0, 70); this.burst(0.12, 'lowpass', 900, 1, 0.3); break;
    }
  }
}
