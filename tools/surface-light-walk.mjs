// AW_URL=http://127.0.0.1:4173/ AW_OUT=.cache/surface-light node tools/surface-light-walk.mjs
// Each route is seeded once, then walked with pointer lock and collision. At each
// stop take a beauty/flat scan normals/beauty triplet before the sim can tick.
// Parallax, lighting, shadow maps, GTAO, grade and geometry remain active.
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.AW_OUT ||= '.cache/surface-light';
const { BASE, OUT, launch, sleep, waitFor } = await import('./lib.mjs');
const { Bot, startNewGame } = await import('./bot.mjs');
const url = new URL('?preset=dev&probe=1&timescale=1&dayscale=1', BASE);
const quality = process.env.AW_ROUTE_QUALITY || 'cinematic';
if (!['cinematic', 'high'].includes(quality)) throw Error('Select cinematic or high for the post-pipeline audit');
const { browser, context, page, errors } = await launch({ channel: 'chromium', headless: true, width: 1280, height: 720 });
const report = { quality, frames: [], browserErrors: errors };
try {
  const root = await browser.newBrowserCDPSession(), target = await context.newCDPSession(page);
  const { targetInfo } = await target.send('Target.getTargetInfo');
  await root.send('Browser.setPermission', { permission: { name: 'pointer-lock' }, setting: 'granted', origin: url.origin, browserContextId: targetInfo.browserContextId });
  await target.detach(); await root.detach();
  await page.addInitScript(quality => localStorage.setItem('ashen-watch/settings', JSON.stringify({ mode: 'kbm', brightness: 1, quality })), quality);
  await page.goto(url.href, {waitUntil:'domcontentloaded'});
  await waitFor(page, () => !!window.__awTexReady, 60000); await page.evaluate(() => window.__awTexReady);
  await page.getByRole('button', { name: '新游戏' }).first().waitFor({ timeout: 90000 });
  report.gpu = await page.evaluate(() => window.__awProbe.gpu());
  report.bundle = await page.evaluate(() => new URL(document.querySelector('script[type=module][src]').src).pathname);
  if (!report.gpu || /unknown|swiftshader|llvmpipe|softpipe|lavapipe|software|swangle|basic render driver|warp\b/i.test(report.gpu)) throw Error(`Not a game hardware context: ${report.gpu}`);
  const bot = new Bot(page); await startNewGame(bot);
  async function seed(x,z,y,phase) {
    await page.evaluate(({x,z,y,phase})=>{
      const d=window.__awDev, w=d.session.world;
      d.hud(false); document.getElementById('debug').hidden=true;
      Object.assign(w.player,{x,z,y,floor:'1F',moving:false,sprinting:false});
      w.phase=phase; w.clock=phase==='day'?120:30; w.ghosts.length=0;
      w.inv.hasLantern=true; w.lantern.oil=240; w.lantern.on=phase==='night';
      w.hearth.lit=false; w.hearth.burn=0; w.lampBurn=0;
      for(const k of Object.keys(w.braziers)) w.braziers[k]=0;
    },{x,z,y,phase});
  }
  async function station(id,x,z,yaw,pitch,roi) {
    await bot.walkTo(x,z,{floor:'1F',stop:.18,maxSecs:30}); await bot.stop();
    await bot.aim(yaw,.012,pitch);
    await waitFor(page, ([yaw,pitch])=>{
      const c=window.__awDev.view.camera,d=c.getWorldDirection(c.position.clone()),e=Math.atan2(d.x,-d.z)-yaw;
      return Math.abs(Math.atan2(Math.sin(e),Math.cos(e)))<.035 && Math.abs(-Math.asin(d.y)-pitch)<.045;
    },9000,[yaw,pitch]); await sleep(400);
    const {png,...frame}=await page.evaluate(capture,roi);
    if (Math.hypot(x-frame.pose[0],z-frame.pose[2])>.4) throw Error(`${id}: missed the station`);
    await fs.writeFile(path.join(OUT,id+'.png'),Buffer.from(png,'base64'));
    report.frames.push({id,roi,...frame}); console.log(id,frame.darkTail,frame.brightTail,frame.repeatError);
  }
  const ground=[.40,.52,.85,.82], wall=[.48,.20,.79,.53];
  if (process.env.AW_LAMP_ONLY !== '1') {
    await seed(-.82,2.98,0,'day');
    await station('threshold',-1.7,5.8,-.45,.46,ground);
    await station('cart-run',-.82,12.2,-2.62,.52,ground);
    await station('raking-stone',-5.9,15.8,.71,.34,ground);
    await seed(16.5,12.7,.45,'day');
    await station('chapel-pier',20,12.5,1.01,-.10,wall);
    await station('chapel-floor',24,16.5,1.48,.36,ground);
  }
  await seed(-1.7,5.8,0,'night');
  await station('lantern-paving',-.82,12.2,-2.62,.52,ground);
  if(errors.length) throw Error(errors.join('\n'));
  if (process.env.AW_REQUIRE_LAMP==='1' && !(report.frames.at(-1).soilLampGain > .01)) {
    throw Error('The live lantern is not reaching the recessed earth next to the paving');
  }
} finally { await context.close(); await browser.close(); await fs.writeFile(path.join(OUT,'surface-light.json'),JSON.stringify(report,null,2)+'\n'); }

// In-page synchronous readback: no RAF, camera or weather change between these
// frames. File saved is the first (unaltered) final WebGL backbuffer, not the diagnostic.
function capture([x0,y0,x1,y1]) {
  const {view,input,session}=window.__awDev, {renderer,camera}=view;
  if(view.fixedCam || !input.locked || input.fakeLock || document.pointerLockElement!==renderer.domElement) throw Error('Not a live follow camera');
  const mats=new Map(); view.scene.traverse(o=>{
    for (const m of [].concat(o.material||[])) if(m.userData?.aw && m.normalMap && !mats.has(m)) mats.set(m,m.normalScale.clone());
  });
  if(!mats.size) throw Error('No scanned stone materials to compare');
  const canvas=renderer.domElement, w=canvas.width,h=canvas.height;
  const l=Math.floor(w*x0),t=Math.floor(h*y0),nx=Math.floor(w*x1)-l,ny=Math.floor(h*y1)-t;
  const ctx=new OffscreenCanvas(nx,ny).getContext('2d',{willReadFrequently:true});
  const read=()=>{ ctx.drawImage(canvas,l,t,nx,ny,0,0,nx,ny); return ctx.getImageData(0,0,nx,ny).data; };
  view.render(); const png=canvas.toDataURL('image/png').split(',')[1], beauty=read();
  let flat; try { for(const m of mats.keys()) m.normalScale.set(0,0); view.render(); flat=read(); }
  finally { for(const [m,v] of mats) m.normalScale.copy(v); }
  view.render(); const repeat=read();
  // Positive tails of separately sorted darkening and brightening. Units are
  // weighted display code values (0..255), not radiance or ambient occlusion.
  const dark=[],bright=[]; let repeatError=0;
  for(let i=0;i<flat.length;i+=4){
    const delta=.2126*(beauty[i]-flat[i])+.7152*(beauty[i+1]-flat[i+1])+.0722*(beauty[i+2]-flat[i+2]);
    dark.push(Math.max(0,-delta)); bright.push(Math.max(0,delta));
    for(let c=0;c<3;c++) repeatError=Math.max(repeatError,Math.abs(beauty[i+c]-repeat[i+c]));
  }
  if(repeatError>1) throw Error(`A/B repeat noise too large: ${repeatError}`);
  const tail=a=>+a.sort((x,y)=>x-y)[Math.floor(.97*a.length)].toFixed(2);
  const {player,phase,lantern}=session.world;
  let soilLampGain=null, lampPower=null;
  if (phase==='night' && lantern.on) {
    // The unbroken patch of exposed bedding immediately right of the player,
    // framed at this station only. Isolate direct light, not a day/night change.
    const lamp=view.player.lanternLight, power=lamp.intensity;
    lampPower=power;
    if (!(power>0)) throw Error('Lantern was not contributing to the beauty render');
    let off;
    try { lamp.intensity=0; view.render(); off=read(); }
    finally { lamp.intensity=power; view.render(); }
    // sRGB decoded below; Y is display-relative, not lux.
    const lut=Float64Array.from({length:256},(_,v)=>v<=10?v/(255*12.92):((v/255+.055)/1.055)**2.4);
    let gain=0,count=0;
    for(let y=Math.floor(h*.70);y<Math.floor(h*.80);y++) for(let x=Math.floor(w*.635);x<Math.floor(w*.70);x++) {
      const i=4*((y-t)*nx+x-l);
      gain+=.2126*(lut[beauty[i]]-lut[off[i]])+.7152*(lut[beauty[i+1]]-lut[off[i+1]])+.0722*(lut[beauty[i+2]]-lut[off[i+2]]); count++;
    }
    soilLampGain=gain/count;
  }
  return {png,phase,lantern:lantern.on,pose:[player.x,player.y,player.z],camera:camera.position.toArray(),rotation:camera.quaternion.toArray(),
    exposure:renderer.toneMappingExposure,key:view.sun.intensity,ao:view.post.gtao?.blendIntensity,materials:mats.size,
    darkTail:tail(dark),brightTail:tail(bright),repeatError,soilLampGain,lampPower,calls:renderer.info.render.calls};
}
