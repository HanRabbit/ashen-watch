// Side-on moving review of the actual game rig. Only the initial spawn and
// travelling witness camera are staged. Translation and changes of gait use keys.
// AW_URL=http://127.0.0.1:4199/ AW_VIDEO=1 AW_OUT=.cache/watchman-profile node tools/watchman-profile.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { launch, BASE, OUT } from './lib.mjs';
const {page,browser,context,errors}=await launch({channel:'chromium',headless:true,width:1152,height:648});
try {
  await page.addInitScript(()=>localStorage.setItem('ashen-watch/settings',JSON.stringify({quality:'high'})));
  await page.goto(BASE+'?preset=dev&dayscale=1');
  await page.waitForFunction(()=>window.__awDev?.view.player.asset);
  await page.evaluate(async()=>{await window.__awTexReady;window.__awDev.fakeLock(true);});
  await page.getByRole('button',{name:'新游戏'}).click();await page.getByRole('button',{name:'开始'}).click();
  await page.evaluate(reverse=>{
    const d=window.__awDev,v=d.view,w=d.session.world;
    Object.assign(w,{phase:'day',clock:160,ghosts:[]});
    Object.assign(w.player,{x:-.35,z:4.5,y:0,yaw:0,pitch:0,floor:'1F'});
    Object.assign(d.input,{yaw:0,pitch:0}); w.inv.hasLantern=true;w.lantern.on=true;w.lantern.oil=240;
    d.screens.closeAll();d.hud(false);document.querySelector('#debug').style.display='none';
    window.__profile={stage:'idle',samples:[]};
    const viewUpdate=v.update.bind(v),temp=v.camera.position.clone();
    v.update=function(world,pose,...rest){
      // Use level coordinates, with a walking camera looking across the direction of travel.
      d.fixedCam([pose.x+(reverse ? -2.25 : 2.3),pose.y+(reverse ? 1.12 : 1.01),pose.z+(reverse ? 0.85 : 0.42)],[pose.x,pose.y+.95,pose.z]);
      viewUpdate(world,pose,...rest);
      const read=k=>v.player.asset.bones[k].getWorldPosition(temp).toArray();
      window.__profile.samples.push({stage:window.__profile.stage,t:performance.now(),at:[pose.x,pose.y,pose.z],
        moving:world.player.moving,sprinting:world.player.sprinting,
        cycle:v.player.pace.clipPhase, authored:v.player.pace.clipWeight, jog:v.player.pace.jog, sprint:v.player.pace.sprint, bones:Object.fromEntries(
          ['hips','head','handL','handR','upLegL','upLegR','legL','legR','footL','footR'].map(k=>[k,read(k)]))});
    };
  }, process.env.AW_PROFILE_REVERSE==='1');
  const label=s=>page.evaluate(s=>{window.__profile.stage=s;},s);
  const wait=ms=>page.waitForTimeout(ms);
  await wait(400);await label('walk');await page.keyboard.down('w');await wait(2300);
  await label('sprint');await page.keyboard.down('Shift');await wait(2600);
  await label('ease');await page.keyboard.up('Shift');await wait(750);
  await label('stop');await page.keyboard.up('w');await wait(720);
  const samples=await page.evaluate(()=>window.__profile.samples);
  const gpu=await page.evaluate(()=>window.__awProbe.gpu());
  const volume=await page.evaluate(()=>window.__awDev.view.post.glow.uniforms.uHasVolume.value);
  if(volume!==1)throw Error('High-quality shadow volume did not run');
  if(errors.length || !samples.every(s=>Object.values(s.bones).flat().every(Number.isFinite))) throw Error('Invalid rig/render: '+errors.join(';'));
  const measurements={};
  for(const stage of ['walk','sprint']){
    const f=samples.filter(s=>s.stage===stage);
    if(!f.some(s=>s.authored>.75 && (stage==='walk' ? s.jog<.5 : s.sprint>.5)))throw Error('Reference performance did not drive '+stage);
    if(f.length<45 || f.at(-1).at[2]-f[0].at[2]<2.0 || (stage==='sprint'&&!f.some(s=>s.sprinting)))throw Error('Did not exercise '+stage);
    const steady=f.filter(s=>s.t-f[0].t>=450), flex=[], pelvis=steady.map(s=>s.bones.hips[1]);
    for(const {bones:b} of steady)for(const side of ['L','R']){
      const k=b['leg'+side]; const a=b['upLeg'+side].map((v,i)=>v-k[i]), l=b['foot'+side].map((v,i)=>v-k[i]);
      const cosine=a.reduce((sum,v,i)=>sum+v*l[i],0)/(Math.hypot(...a)*Math.hypot(...l));
      flex.push(180-Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI);
    }
    flex.sort((a,b)=>a-b);
    const heightRange=Math.max(...pelvis)-Math.min(...pelvis);
    measurements[stage]={medianKneeFlexDeg:flex[Math.floor(flex.length/2)],hipRangeMetres:heightRange};
    if(heightRange>.17)throw Error(`${stage}: pelvis dropped ${heightRange.toFixed(3)} m over the flat-ground cycle`);
  }
  await fs.writeFile(path.join(OUT,'profile.json'),JSON.stringify({gpu,volume,measurements,errors,samples}));
  const video=page.video();await context.close();if(video)await video.saveAs(path.join(OUT,'profile.webm'));
  console.log('Profile samples:',samples.length);
} finally {await browser.close();}
