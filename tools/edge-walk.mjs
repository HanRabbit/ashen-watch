// Hardware-only in-game inspection: follow the player with genuine pointer lock, then
// capture a repeatable close-up alongside each walked view (not a replacement camera).
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.AW_OUT ||= '.cache/edge-walk';
const { BASE, OUT, launch, waitFor, sleep } = await import('./lib.mjs');
const { Bot, startNewGame } = await import('./bot.mjs');
const url = new URL('?preset=dev&probe=1&timescale=1&dayscale=1', BASE);
const { browser, context, page, errors } = await launch({channel:'chromium',headless:true,width:1280,height:720});
const report = { frames:[], errors };
try {
  const root=await browser.newBrowserCDPSession(),target=await context.newCDPSession(page);
  const {targetInfo}=await target.send('Target.getTargetInfo');
  await root.send('Browser.setPermission',{permission:{name:'pointer-lock'},setting:'granted',origin:url.origin,browserContextId:targetInfo.browserContextId});
  await root.detach();await target.detach();
  await page.addInitScript(()=>localStorage.setItem('ashen-watch/settings',JSON.stringify({quality:'cinematic',mode:'kbm',brightness:1})));
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await waitFor(page,()=>!!window.__awTexReady,60000);await page.evaluate(()=>window.__awTexReady);
  await page.getByRole('button',{name:'新游戏'}).first().waitFor({timeout:90000});
  report.gpu=await page.evaluate(()=>window.__awProbe.gpu());
  if (!report.gpu || /unknown|swiftshader|llvmpipe|software|swangle|basic render driver|warp\b/i.test(report.gpu)) throw Error('No game hardware GPU');
  const bot=new Bot(page);await startNewGame(bot);
  for(const route of [
    {from:[-9.2,4,8,'2F'], stops:[['parapet',-9.17,11.6,.80,.22,[-9.04,5.30,11.0],[-8.51,4.56,11.98]],['parapet-return',-9.17,14,2.5,.20,[-9.12,5.18,13.5],[-8.47,4.60,12.4]]]},
    {from:[10,0,15.5,'1F'],stops:[['church-steps',10.13,16.63,1.26,.29,[9.92,.64,15.62],[11.16,.26,16.66]]]},
    {from:[25.2,.45,16.5,'1F'],stops:[['altar',27.14,16.4,1.41,.20,[27.76,1.85,14.98],[28.85,1.47,15.71]]]},
    {from:[.0,0,24.4,'1F'],stops:[['north-arch',.12,26.7,.26,-.20,[1.0,1.85,26.16],[1.68,2.62,27.5]]]},
  ]) {
    await page.evaluate(([x,y,z,floor])=>{const d=window.__awDev,w=d.session.world;d.hud(false);document.getElementById('debug').hidden=true;Object.assign(w.player,{x,y,z,floor,moving:false,sprinting:false});w.phase='day';w.clock=120;w.ghosts.length=0;w.lantern.on=false;},route.from);
    for(const [id,x,z,yaw,pitch,pos,look] of route.stops) {
      await bot.walkTo(x,z,{floor:route.from[3],stop:.16,maxSecs:35});await bot.stop();await bot.aim(yaw,.012,pitch);await sleep(450);
      const {follow,detail,...metrics}=await page.evaluate(({pos,look,x,z,floor})=>{
        const {view:v,input,session}=window.__awDev,p=session.world.player,c=v.camera,r=v.renderer;
        if(v.fixedCam || !input.locked || input.fakeLock || document.pointerLockElement!==r.domElement || p.floor!==floor || Math.hypot(x-p.x,z-p.z)>.40)throw Error(`Missed actual gameplay station (${p.x},${p.z},${p.floor})`);
        const grab=()=>{v.render();return r.domElement.toDataURL('image/png').split(',')[1];};
        const follow=grab(),calls=r.info.render.calls,triangles=r.info.render.triangles,prev=c.position.clone(),rot=c.quaternion.clone();
        let detail;try{c.position.set(pos[0],pos[1],-pos[2]);c.lookAt(look[0],look[1],-look[2]);c.updateMatrixWorld();detail=grab();}
        finally{c.position.copy(prev);c.quaternion.copy(rot);c.updateMatrixWorld();v.render();}
        return {follow,detail,calls,triangles,at:[p.x,p.y,p.z],camera:prev.toArray(),closeUpCamera:pos,closeUpLook:look};
      },{x,z,pos,look,floor:route.from[3]});
      await Promise.all([['play',follow],['detail',detail]].map(([kind,png])=>fs.writeFile(path.join(OUT,`${id}-${kind}.png`),Buffer.from(png,'base64'))));
      report.frames.push({id,...metrics});console.log(id,metrics.calls,metrics.triangles);
    }
  }
  if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();await fs.writeFile(path.join(OUT,'edges.json'),JSON.stringify(report,null,2)+'\n');}
