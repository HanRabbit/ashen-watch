/** Cap just the WebGL drawing buffer. Canvas CSS size, input and HUD stay native. */
export function displayPixelRatio(quality:'cinematic'|'high'|'low',width:number,height:number,dpr:number):number {
  return quality==='cinematic'?dpr:quality==='high'?Math.min(dpr,1.5):Math.min(dpr,1,960/Math.max(1,width,height),540/Math.max(1,Math.min(width,height)));
}

/** The 5 Hz budget is for a settled scene, not for walking feet or swinging doors.
 * Only applies to the low tier's directional light, never the lantern or HDR passes. */
export class SettledKeyBudget {
  private next=0;
  private liveUntil=0;
  private state=-1;
  private yaw=NaN;
  private x=NaN; private y=NaN; private z=NaN;
  private sx=NaN; private sy=NaN; private sz=NaN;
  reset():void { this.state=-1;this.next=0; }
  due(now:number,moving:boolean,state:number,yaw:number,x:number,y:number,z:number,sx:number,sy:number,sz:number):boolean {
    if(state!==this.state || moving || Math.abs(yaw-this.yaw)>.001 || x!==this.x || y!==this.y || z!==this.z) this.liveUntil=now+650;
    this.state=state;this.yaw=yaw;this.x=x;this.y=y;this.z=z;
    const shift=(sx-this.sx)**2+(sy-this.sy)**2+(sz-this.sz)**2;
    if(now<this.liveUntil || now>=this.next || shift>.0001) {
      this.sx=sx;this.sy=sy;this.sz=sz;this.next=now+200;return true;
    }
    return false;
  }
}
