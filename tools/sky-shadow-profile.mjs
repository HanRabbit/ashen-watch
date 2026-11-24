// GPU fixture, separate from gameplay screenshots. Serve the build to measure via AW_URL.
// Orthographic scan of a straight edge over a matte card at two blocker heights,
// using the game's actual key, shadow camera, WebGLShadowMap and material shaders.
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.AW_OUT ||= '.cache/sky-shadow-profile';
const { BASE, OUT, launch, waitFor } = await import('./lib.mjs');
const { page, browser, errors } = await launch({channel:'chromium',headless:true,width:960,height:540});
try {
  await page.goto(new URL('?preset=dev&probe=1',BASE).href,{waitUntil:'domcontentloaded'});
  await waitFor(page,()=>!!window.__awTexReady,60000); await page.evaluate(()=>window.__awTexReady);
  const report=await page.evaluate(scan);
  if(errors.length) throw Error(errors.join('\n'));
  if(process.env.AW_REQUIRE_DISK==='1') {
    const [near,far]=report.profiles;
    if(!near.diskActive || !far.diskActive || near.widthCm>8 || far.widthCm<2*near.widthCm || far.widthCm>48) {
      throw Error(`Invalid contact or distant penumbra: ${JSON.stringify(report.profiles)}`);
    }
  }
  await fs.writeFile(path.join(OUT,'shadow-profile.json'),JSON.stringify(report,null,2)+'\n');
  console.log(report.gpu, report.profiles.map(p=>[p.height,p.widthCm]));
} finally { await browser.close(); }

function scan(){
  const {view,session}=window.__awDev,{renderer,scene,sun}=view;
  const w=session.world; w.phase='day';w.clock=120;
  for(let i=0;i<80;i++) view.applyLighting(w,.1,12);
  view.render();
  let box,MeshType,Mat;
  scene.traverse(o=>{
    if(o.type==='Mesh') MeshType??=o.constructor;
    if(o.geometry?.type==='BoxGeometry') box??=o.geometry;
    if(o.material?.type==='MeshStandardMaterial') Mat??=o.material.constructor;
  });
  if(!box||!Mat||!MeshType) throw Error('Game did not expose receiver primitives');
  const geom=box.clone(); geom.center(); geom.computeBoundingBox();
  const size=geom.boundingBox.getSize(sun.position.clone()); geom.scale(1/size.x,1/size.y,1/size.z);
  const matte=new Mat({color:0xaaaaaa,roughness:1,metalness:0});
  let diskActive=false;
  matte.onBeforeRender=()=>{
    // Read at draw time. The shared attachment is deliberately unstaged after the scene.
    const u=renderer.properties.get(matte).uniforms;
    diskActive ||= (u?.uAwDiskState?.value[0]>=0 && !!u?.uAwDiskDepth?.value[0]);
  };
  const invisible=new Mat({colorWrite:false,depthWrite:false});
  const card=new MeshType(geom,matte), plate=new MeshType(geom,invisible);
  for(const o of scene.children) o.visible=(o===sun||o===sun.target);
  scene.environment=null; scene.fog=null; scene.background=null;
  renderer.toneMapping=0; renderer.setRenderTarget(null);
  card.scale.set(7,.03,7); card.position.set(-3,-.015,-10); card.receiveShadow=true;
  plate.scale.set(3,.015,3); plate.castShadow=true;
  scene.add(card,plate);
  const C=sun.shadow.camera.constructor,{width,height}=renderer.domElement,span=1.6;
  const cam=new C(-span/2,span/2,span*height/width/2,-span*height/width/2,.1,30);
  cam.position.set(-3,12,-10); cam.up.set(0,0,-1); cam.lookAt(-3,0,-10);
  const dir=sun.position.clone().sub(sun.target.position).normalize();
  const gl=renderer.getContext(),profiles=[];
  const lut=Float64Array.from({length:256},(_,n)=>n<=10?n/(255*12.92):((n/255+.055)/1.055)**2.4);
  for(const heightOfPlate of [.20,4]) {
    // Project the east edge to the same point on the card for both heights.
    plate.position.set(-3-1.5,heightOfPlate,-10);
    plate.position.x+=dir.x/dir.y*heightOfPlate; plate.position.z+=dir.z/dir.y*heightOfPlate;
    diskActive=false; renderer.render(scene,cam); renderer.render(scene,cam);
    const rows=64, raw=new Uint8Array(width*rows*4);
    gl.readPixels(0,(height-rows)>>1,width,rows,gl.RGBA,gl.UNSIGNED_BYTE,raw);
    if(gl.getError()!==gl.NO_ERROR) throw Error('GPU shadow profile read failed');
    const profile=Array.from({length:width},(_,x)=>{
      let y=0; for(let i=x*4;i<raw.length;i+=4*width) y+=.2126*lut[raw[i]]+.7152*lut[raw[i+1]]+.0722*lut[raw[i+2]];
      return y/rows;
    });
    const avg=a=>a.reduce((sum,v)=>sum+v,0)/a.length;
    const dark=avg(profile.slice(20,100)),bright=avg(profile.slice(-100,-20));
    if(bright-dark<.02) throw Error(`No isolated shadow edge: ${dark} ${bright}`);
    const crossing=q=>{
      const target=dark+(bright-dark)*q,i=profile.findIndex((y,i)=>i>100&&y>=target);
      if(i<=0||i>=width-100) throw Error(`Missing ${q} crossing`);
      return i-1+(target-profile[i-1])/(profile[i]-profile[i-1]);
    };
    const x10=crossing(.1),x90=crossing(.9);
    profiles.push({height:heightOfPlate,diskActive,rayGap:heightOfPlate/dir.y,shadeY:dark,litY:bright,
      widthCm:(x90-x10)*span/width*100,x10,x90});
  }
  return {gpu:window.__awProbe.gpu(),width,height,span,rows:64,direction:dir.toArray(),profiles};
}
