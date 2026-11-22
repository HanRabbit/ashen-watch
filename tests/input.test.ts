import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Input} from '../src/input';
import {defaultSettings} from '../src/settings';
import {LANTERN} from '../src/config';
let doc:EventTarget,win:EventTarget,input:Input,now:number;
function mouse(type:string,button=2){const e=new Event(type,{cancelable:true});Object.defineProperty(e,'button',{value:button});doc.dispatchEvent(e);}
beforeEach(()=>{doc=new EventTarget();win=new EventTarget();vi.stubGlobal('document',doc);vi.stubGlobal('window',win);now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);const settings=defaultSettings();settings.mode='mouse';input=new Input({} as HTMLCanvasElement,settings);input.locked=true;});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('纯鼠标短按与举灯边界',()=>{
 it('短按释放只交互一次',()=>{mouse('mousedown');now=200;mouse('mouseup');expect(input.takePresses()).toEqual(['interact']);expect(input.takePresses()).toEqual([]);});
 it('跨越长按阈值，即使期间没有渲染帧，也不能误交互',()=>{mouse('mousedown');now=LANTERN.raiseLongPressMs;mouse('mouseup');expect(input.takePresses()).toEqual([]);expect(input.poll().raise).toBe(false);});
 it('长按举灯，释放不误开门或触发菜单',()=>{mouse('mousedown');now=300;expect(input.poll().raise).toBe(true);mouse('mouseup');expect(input.takePresses()).toEqual([]);expect(input.poll().raise).toBe(false);});
 it('失焦清空长按，回到游戏后的释放不交互',()=>{mouse('mousedown');now=300;input.poll();win.dispatchEvent(new Event('blur'));mouse('mouseup');expect(input.takePresses()).toEqual([]);expect(input.poll().raise).toBe(false);});
});
