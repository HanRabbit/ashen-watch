// Reconstruct the exposed fall on the fitted Rodin surface, in site metres. The old
// rock geometry is the load-bearing core, not an albedo/normal map for dressed stone.
// Work in a chart across the slip face: s=east, u=up the fall, d=out towards the yard.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { SCARP_SOLIDS } from '../src/sim/southScarp.ts';
const C=Math.SQRT1_2, clamp=THREE.MathUtils.clamp, smooth=THREE.MathUtils.smoothstep;
const chart=(s,u,d)=>new THREE.Vector3(s,(u+d)*C,(u-d)*C);
function survey(pos,indices){
 const cells=new Map(),h=.36,key=(i,j)=>i*300+j;
 const points=Array.from({length:pos.count},(_,i)=>[pos.getX(i),C*(pos.getY(i)+pos.getZ(i)),C*(pos.getY(i)-pos.getZ(i))]);
 for(let n=0;n<indices.length;n+=3){const P=[points[indices[n]],points[indices[n+1]],points[indices[n+2]]];
   if(Math.abs((P[1][0]-P[0][0])*(P[2][1]-P[0][1])-(P[2][0]-P[0][0])*(P[1][1]-P[0][1]))<1e-9)continue;
   const xx=P.map(p=>p[0]/h),yy=P.map(p=>p[1]/h);
   for(let i=Math.floor(Math.min(...xx));i<=Math.floor(Math.max(...xx));i++)for(let j=Math.floor(Math.min(...yy));j<=Math.floor(Math.max(...yy));j++){
     const id=key(i,j);if(!cells.has(id))cells.set(id,[]);cells.get(id).push(P);}}
 return (x,y)=>{let depth=-Infinity;for(const [a,b,c] of cells.get(key(Math.floor(x/h),Math.floor(y/h)))??[]){
   const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],det=bx*cy-by*cx;
   const s=((x-a[0])*cy-(y-a[1])*cx)/det,t=(bx*(y-a[1])-by*(x-a[0]))/det;
   if(s>=-1e-5&&t>=-1e-5&&s+t<1.00001)depth=Math.max(depth,a[2]+(b[2]-a[2])*s+(c[2]-a[2])*t);
 }return depth;};
}
export async function dressGateCollapse(base){
 await MeshoptSimplifier.ready;
 const pos=base.attributes.position, indices=base.index.array, sample=survey(pos,indices);
 const [core]=MeshoptSimplifier.simplify(new Uint32Array(indices),pos.array,3,4100*3,.0012);
 const xyz=[],norm=[],uv=[],colors=[],index=[],lookup=new Map();
 const vec=(a,b,c)=>new THREE.Vector3(a,b,c);
 const vert=(p,n,tx,ty,tint)=>{ const attribs=[p.x,p.y,p.z,n.x,n.y,n.z,tx,ty,...tint].map(Math.fround);
   const key=attribs.map(t=>Math.round(t*1e6)).join('/');if(lookup.has(key))return lookup.get(key);
   const i=xyz.length/3;lookup.set(key,i);xyz.push(...attribs.slice(0,3));norm.push(...attribs.slice(3,6));uv.push(tx,ty);colors.push(...tint);return i;};
 let seed=302924;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const span=(a,b)=>a+(b-a)*random();
 // A worn core of lime and infill shows through broken joints. Preserve the surveyed
 // contact toe and end caps; pull the old show face in behind the individual clasts.
 const corePts=new Map();for(const i of core){if(corePts.has(i))continue;const v=new THREE.Vector3().fromBufferAttribute(pos,i);
   const q=smooth(v.y,.13,.63)*smooth(-v.z,.38,.94)*smooth(v.x,-10.05,-9.67)*smooth(-v.x,2.62,3.05);
   v.z+=q*.21;v.y-=q*.10;corePts.set(i,v);}
 const coreGeom=new THREE.BufferGeometry();const coreArr=pos.array.slice();for(const [i,v]of corePts)v.toArray(coreArr,3*i);
 coreGeom.setAttribute('position',new THREE.BufferAttribute(coreArr,3));coreGeom.setIndex(new THREE.BufferAttribute(core,1));coreGeom.computeVertexNormals();
 for(let i=0;i<core.length;i+=3){const tri=[...core.slice(i,i+3)],v=tri.map(k=>corePts.get(k));if(v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).lengthSq()<1e-16)continue;
   for(const k of tri){const v=corePts.get(k),n=new THREE.Vector3().fromBufferAttribute(coreGeom.attributes.normal,k);
    if(n.lengthSq()<.5)n.set(0,1,0);const t=clamp((2.95-(v.y+v.z)*C)/6.45,0,1),s=clamp((v.x+10.1)/7.58,0,1);
    const dirt=1-smooth(v.y,.045,.27+.15*Math.sin(v.x*1.61)**2);
    const dol=.70+.22*smooth(v.y,.01,.92)+.075*Math.sin(v.x*2.2+3*v.y)*Math.cos(v.x*.89-v.y*7.1);
    index.push(vert(v,n,.003+.494*s,.503+.494*t,[dol*(1+.08*dirt),dol*(.98-.14*dirt),dol*(.95-.28*dirt)]));}}
 // Draw every exposed face with a separate bedding/strike/fresh fracture region of the
 // same atlas. UVs stay with the stone, even on a rotated fragment. No rows of brick
 // miniatures on the side of a single stone. Small bevels vary independently per edge.
 const swatches=[[.30,.10],[.59,.092],[.15,.302],[.49,.30],[.81,.31],[.22,.51],[.5,.70],[.73,.90]];
 let stones=0;
 function piece(cx,cu,W,H,rot,kind,force=false){
   const depth=sample(cx,cu);if(!Number.isFinite(depth)|| cx-W*.3< -10.17 || cx+W*.3> -2.68)return;
   const dAt=(x,u)=>{const z=sample(x,u);return Number.isFinite(z)?z:depth;};
   const realY=(cu+depth)*C,front=chart(cx,cu,depth);if(realY<-.05||front.z>-.47)return;
   const T=kind==='panel'?span(.38,.63):kind==='spall'?span(.060,.15):span(.21,.50);
   const gx=clamp((dAt(cx+.22,cu)-dAt(cx-.22,cu))/.44,-.7,.7)+span(-.13,.13);
   const gu=clamp((dAt(cx,cu+.17)-dAt(cx,cu-.17))/.34,-1.05,1.05)+span(-.24,.24);
   const cs=Math.cos(rot),sn=Math.sin(rot),hw=W/2,hh=H/2;
   const rect=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]],ring=[];
   for(let i=0;i<4;i++){const a=rect[(i+3)%4],b=rect[i],c=rect[(i+1)%4],
     m=span(.035,.20),n=span(.05,kind==='panel'?.25:.31);
     const notch=kind==='spall'?0:span(-.052,.031)*Math.min(1,H/.36);
     ring.push([b[0]+(a[0]-b[0])*m,b[1]+(a[1]-b[1])*m], [b[0]+(c[0]-b[0])*n,b[1]+(c[1]-b[1])*n],
       [b[0]+(c[0]-b[0])*.54+(b[0]===c[0]?Math.sign(b[0])*notch:0),b[1]+(c[1]-b[1])*.54+(b[1]===c[1]?Math.sign(b[1])*notch:0)]);}
   const turns=ring.map(([x,y])=>[cs*x-sn*y,sn*x+cs*y]);
   // If an edge hangs too far past the source footprint it would read as a veneer.
   const supported=turns.filter(([x,y])=>Number.isFinite(sample(cx+x*.8,cu+y*.8))).length;
   if(supported<(force?6:9))return;
   let dz=span(-.009,.142)+(kind==='panel'?.09:0); // centre of the struck face is above its broken setting-bed
   const shoulder=turns.map(()=>span(.012,Math.min(.068,H*.15)));const chip=turns.map(()=>span(-.04,.035));
   function vertexRing(level){return turns.map(([S,U],i)=>{const [x,y]=ring[i],inset=level===0?span(.78,.96):level===1?1:1-shoulder[i]/Math.max(.12,Math.hypot(x,y));
     const s=S*inset,u=U*inset,d=depth+dz+gx*s+gu*u+(level===0?-T:level===1?-shoulder[i]*span(.5,1.5):0)+chip[i];
     return chart(cx+s,cu+u,d);});}
   const rings=[vertexRing(0),vertexRing(1),vertexRing(2)];
   if(rings.flat().some(v=>v.x< -10.30||v.x> -2.66||v.z>-.14))return;
   // The very first skirt is also the gameplay collision silhouette. Set stones into it,
   // never add another inaccessible rim on the walking side of the original obstacle.
   const xmin=Math.min(...rings.flat().map(p=>p.x)),xmax=Math.max(...rings.flat().map(p=>p.x));
   const ledges=SCARP_SOLIDS.filter((_,i)=>i%3===0).filter(b=>b.x1>=xmin&&b.x0<=xmax);
   if(!ledges.some(b=>b.h>.1))return;const limit=Math.min(...ledges.map(b=>b.z1))-.018;
   let sink=0;for(const v of rings.flat())if(v.y<1.93)sink=Math.max(sink,-v.z-limit);
   for(const v of rings.flat())v.z+=sink;
   const col=span(.69,1.10),warm=span(-.032,.026), faceUV=swatches[Math.floor(random()*swatches.length)], off=[span(.22,.78),span(.23,.77)],
    panelOffset=[span(.32,.68),span(.31,.69)],rockAngle=span(-1.2,1.2);
   function face(poly,xy,tile,factor){
     const [a,b,c]=poly;const n=b.clone().sub(a).cross(c.clone().sub(a));if(n.lengthSq()<1e-15)return;n.normalize();
     const ids=poly.map((v,i)=>{let [u,w]=xy[i];if(tile===1){u=faceUV[0]+u*.20;w=faceUV[1]-w*.22;}
       else if(tile===3){u=panelOffset[0]+u*.35;w=panelOffset[1]-w*.35;}
       else {const t=u;u=off[0]+.6*(Math.cos(rockAngle)*t-Math.sin(rockAngle)*w);w=off[1]+.6*(Math.sin(rockAngle)*t+Math.cos(rockAngle)*w);}
       const f=col*factor*(.78+.22*smooth(v.y,.03,.72));return vert(v,n,(tile%2+clamp(u,.007,.993))*.5,((tile>>1)+clamp(w,.007,.993))*.5,[f*(1+warm),f,f*(1-warm*.7)]);});
     for(let j=1;j<ids.length-1;j++)index.push(ids[0],ids[j],ids[j+1]);}
   // u is up-slope, so outward normal points toward -Z. Reverse cap winding.
   const tile=kind==='panel'?3:kind==='quoin'?1:0;
   const point=rings[2].reduce((a,v)=>a.add(v),new THREE.Vector3()).multiplyScalar(1/ring.length);
   point.y+=span(-.014,.021)*Math.min(1,H/.31);point.z-=span(-.006,.009);
   for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;
     face([point,rings[2][j],rings[2][i]],[[0,0],ring[j],ring[i]],tile,1);
     for(let l=0;l<2;l++){
       const a=rings[l][i],b=rings[l][j],c=rings[l+1][j],d=rings[l+1][i];const length=a.distanceTo(b);
       // Unwrap perimeter along the *actual* lateral face. Correct face order below
       // uses the lower edge as its topological reverse of the cap edge.
       const gritLedge=l===0&&i%3===1&&kind!=='spall'&&random()<.43;
       const side=gritLedge?2:kind==='quoin'&&((i+1)%2===0)&&l===0?1:0;
       const wrap=ring[i][0]*.25+ring[i][1]*.14, basal=l===1?.14:0;
       const L=wrap-length*.5,R=wrap+length*.5,U=basal+a.distanceTo(d),V=basal+b.distanceTo(c);
       face([a,d,c],[[L,basal],[L,U],[R,V]],side,l===1?1.00:.90);
       face([a,c,b],[[L,basal],[R,V],[R,basal]],side,l===1?1.00:.90);
     }}stones++;
 }
 // A few still-bonded chunks have fallen as units. The rest are individually struck
 // headers and broken through-stones. Their head joints no longer align across faults.
 const relics=[[-8.85,.91,1.34,.64,-.08],[-8.04,.33,.99,.58,-.32],[-6.88,-.43,1.31,.61,.30],[-5.11,-.49,.91,.51,-.79],[-8.48,-1.56,1.18,.52,.59]];
 for(const [x,u,w,h,r] of relics)piece(x,u,w,h,r,'panel',true);
 const avoid=(x,u,w,h)=>relics.some(([s,t,W,H,r])=>{const dx=x-s,dy=u-t;return Math.abs(dx*Math.cos(r)+dy*Math.sin(r))<W*.5+w*.29 && Math.abs(-dx*Math.sin(r)+dy*Math.cos(r))<H*.5+h*.24;});
 for(let row=0;row<17;row++){
   const y=-3.55+row*.425;let x=-10.56+span(-.30,.15);
   while(x< -2.56){const w=span(.38,1.04)*(random()<.15?1.41:1),cx=x+w*.5;
     const fold=Math.sin(cx*.93)*.16+Math.cos(cx*2.26)*.074;
     const sheared=cx< -7.47?.22+.12*(cx+8.8):cx> -5.96?-.12-.17*(cx+5.45):0;
     const u=y+fold+sheared+span(-.12,.12),h=span(.30,.56),r=span(-.54,.51)+(cx< -7.47?.13:-.12);
     if(!avoid(cx,u,w,h)&&random()>.09)piece(cx,u,w,h,r,random()<.54?'quoin':'break');
     x+=w*span(.87,1.04);
   }}
 for(let i=0;i<298;i++){const x=span(-9.95,-2.72),u=span(-3.32,2.33);if(!avoid(x,u,.16,.075)&&random()>.32)piece(x,u,span(.11,.32),span(.062,.16),span(-1.36,1.36),'spall');}
 for(let i=0;i<100;i++){const x=span(-9.82,-3.15),u=span(-3.32,-.35);if(!avoid(x,u,.21,.12)&&Math.sin(x*2.2+u*3.7)>-.31)piece(x,u,span(.19,.43),span(.13,.24),span(-1.02,1.02),'break');}
 // Thin daughter-fragments run out along the two paths that material could fall down.
 // This skirt stops at ankle height; it does not add an invisible physical obstacle.
 for(const [x0,x1,density] of [[-9.57,-8.52,22],[-7.57,-5.64,41],[-5.23,-3.06,28]])for(let i=0;i<density;i++){
   const x=span(x0,x1);const plot=SCARP_SOLIDS.find((b,i)=>i%3===0&&x>=b.x0&&x<b.x1);if(!plot)continue;
   const spread=random()**2, z=plot.z1+span(-.065,.05)+spread*.62;
   if(z>4.96)continue; // keep the entrance lane clear
   const radius=span(.041,.14)*(1-.57*spread), h=span(.028,.088)*(1-.56*spread), a=span(-Math.PI,Math.PI);
   const outline=Array.from({length:5+(i%2)},(_,j)=>{const ang=a+j*2*Math.PI/(5+i%2),r=radius*span(.57,1.31);return [Math.cos(ang)*r,Math.sin(ang)*r*span(.60,1.20)];});
   const dry=span(.49,.86),top=vec(x+radius*.16,h,-z+radius*.12);
   for(let j=0;j<outline.length;j++){
     const [A,B]=[outline[j],outline[(j+1)%outline.length]],p=vec(x+A[0],span(-.006,.012),-z+A[1]),q=vec(x+B[0],span(-.006,.012),-z+B[1]);
     const n=top.clone().sub(p).cross(q.clone().sub(p)).normalize(), u=span(.10,.39),v=span(.59,.91);
     index.push(vert(p,n,u,v,[dry*.66,dry*.63,dry*.59]),vert(top,n,u+.023,v-.018,[dry,dry*.98,dry*.94]),vert(q,n,u+.043,v,[dry*.71,dry*.69,dry*.66]));
   }
 }
 const g=new THREE.BufferGeometry();g.setIndex(index);g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeBoundingBox();
 g.userData.stones=stones;console.log(`Collapse: ${stones} masonry fragments on ${core.length/3} core triangles`);return g;
}
