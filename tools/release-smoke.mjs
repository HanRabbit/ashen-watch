// Exercises both character packs and the merged low-tier lighting policy in the actual WebGL game.
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.AW_OUT ||= '.cache/release-smoke';
const { BASE,OUT,launch,waitFor,sleep }=await import('./lib.mjs');
const { Bot,startNewGame }=await import('./bot.mjs');
for(const cast of ['original','tripo']){
  const {browser,context,page,errors}=await launch({channel:'chromium',headless:true,width:1280,height:720});
  const url=new URL('?preset=dev&probe=1&dayscale=1',BASE);if(cast==='tripo')url.searchParams.set('cast',cast);
  const requests=[];page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.includes('/characters/')) requests.push(decodeURIComponent(p));});
  try {
    const root=await browser.newBrowserCDPSession(),target=await context.newCDPSession(page);const {targetInfo}=await target.send('Target.getTargetInfo');
    await root.send('Browser.setPermission',{permission:{name:'pointer-lock'},setting:'granted',origin:url.origin,browserContextId:targetInfo.browserContextId});await root.detach();await target.detach();
    await page.addInitScript(()=>localStorage.setItem('ashen-watch/settings',JSON.stringify({quality:'low',mode:'kbm'})));
    await page.goto(url.href,{waitUntil:'domcontentloaded'});await waitFor(page,()=>!!window.__awDev?.view.player.asset && !!window.__awDev.view.ghosts.reaper,90000);
    const bot=new Bot(page);await startNewGame(bot);
    const info=await page.evaluate(()=>{
      const v=window.__awDev.view,c=v.renderer.domElement;
      const w=window.__awDev.session.world;
      Object.assign(w,{phase:'day',clock:120,ghosts:[]}); Object.assign(w.player,{x:-.82,z:3.2,y:0,floor:'1F'});
      return {gpu:window.__awProbe.gpu(),buffer:[c.width,c.height],viewport:[innerWidth,innerHeight],hip:v.player.asset.bones.hips.name,ghostSkinned:!!v.ghosts.reaper.body.isSkinnedMesh};
    });
    if(info.buffer.join(',')!=='960,540' || info.ghostSkinned!==(cast==='tripo') || (info.hip==='Hip')!==(cast==='tripo'))throw Error('Unexpected character or drawing buffer: '+JSON.stringify(info));
    if(requests.some(p=>p.includes('tripo'))!==(cast==='tripo'))throw Error('Wrong character pack requested');
    if(cast==='tripo') {
      const maps=requests.filter(p=>p.includes('.fbm/') && p.endsWith('.jpg'));
      if(maps.length!==2 || new Set(maps).size!==2)throw Error('Missing or duplicate requests for FBX textures');
    }
    await bot.aim(0,.012,.10);await sleep(1100);
    // Observe actual shadow submissions, not the scheduler's intention. Observe
    // the final canvas also, so a 5 Hz application can't masquerade as reuse.
    await page.evaluate(()=>{
      const v=window.__awDev.view, shadow=v.sun.shadow; const update=shadow.updateMatrices.bind(shadow),render=v.render.bind(v);
      window.__cadence={frames:0,shadows:0};shadow.updateMatrices=(...a)=>{window.__cadence.shadows++;return update(...a);};v.render=(...a)=>{window.__cadence.frames++;return render(...a);};
    });
    await sleep(820);const idle=await page.evaluate(()=>({...window.__cadence}));
    await page.keyboard.down('KeyW');await sleep(200);await page.evaluate(()=>{window.__cadence={frames:0,shadows:0};});await sleep(620);
    const moving=await page.evaluate(()=>({...window.__cadence}));await page.keyboard.up('KeyW');await bot.stop();
    if(!idle.shadows || idle.shadows>=idle.frames || moving.frames<2 || moving.shadows<moving.frames-1)throw Error(`Unexpected refresh rate: ${JSON.stringify({idle,moving})}`);
    // Make the actual character visible and run its forward/depth materials.
    await page.evaluate(()=>{
      const {session}=window.__awDev,w=session.world,p=w.player;
      w.phase='night';w.lantern.on=true;w.lantern.oil=180;w.inv.hasLantern=true;
      w.ghosts=[{kind:'grey',x:p.x+.6,y:0,z:p.z+3.6,floor:'1F',yaw:Math.PI,mode:'recover',t:0,patrolIdx:0,path:[],goal:null,lastKnown:null,canSee:false,loseT:0,senseT:0,repathT:0,stuckT:0,repelCd:0,lightT:0,cowed:0,sawSprint:false,flankSide:1,bangOpens:false,waiting:false}];
    });
    await waitFor(page,()=>window.__awDev.view.ghosts.reaper.root.visible,6000);
    await page.evaluate(()=>window.__awDev.view.setQuality('cinematic'));await sleep(550);
    await page.screenshot({path:path.join(OUT,`${cast}-night.png`)});
    if(errors.length)throw Error(errors.join('\n'));
    const report={...info,idle,moving,requests,errors};await fs.writeFile(path.join(OUT,cast+'.json'),JSON.stringify(report,null,2)+'\n');console.log(cast,JSON.stringify({info,idle,moving}));
  }finally{await browser.close();}
}
