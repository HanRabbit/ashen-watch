// Offline: matching UV quadrants for all 3 PBR maps. Input scans are already shipped
// with the walls. No lit Rodin colour, height-derived shine or extra runtime samplers.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory=fileURLToPath(new URL('../public/textures/',import.meta.url));
const N=706, side=N*2, byte=n=>Math.max(0,Math.min(255,Math.round(n)));
const cache=new Map();
function photo(name,channel){
  const key=name+'_'+channel;
  if(!cache.has(key)) cache.set(key,execFileSync('magick',[directory+key+'.jpg','-resize',`${N}x${N}!`,'-depth','8','RGB:-'],{maxBuffer:8e6}));
  return cache.get(key);
}
function ix(u,v){return 3*((Math.floor(v*N)%N)*N+(Math.floor(u*N)%N));}
const luma=(a,i)=>a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722;
export function scarpStoneAtlas(){
 const result={};
 for(const channel of ['diff','nor','rough']){
  const data=Buffer.alloc(side*side*3), quarry=photo('rock_face',channel), ashlar=photo('medieval_blocks_03',channel),
    lime=photo('grey_plaster',channel),grit=photo('gravel_floor',channel),wall=photo('castle_wall_varriation',channel),
    macro=photo('rock_face','diff');
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
   const u=(x%N+.5)/N,v=(y%N+.5)/N, tile=(x>=N?1:0)+(y>=N?2:0), I=ix(u,v),k=3*(x+y*side);
   // 0: raw break; 1: dressed stones; 2: lime/aggregate core; 3: still bonded masonry.
   const A=[quarry,ashlar,lime,wall][tile];let i=I;
   let g=luma(A,i),detail=0, B=A,j=i, blend=0;
   if(tile===2){i=ix(u*2.8,v*2.3);g=luma(A,i);B=grit;j=ix(u*3.7+.32,v*2.6+.16);blend=.64;}
   if(tile===0){B=lime;j=ix(2.25*u+.16,v*1.72);blend=.34;}
   if(channel==='diff'){
    let value,chrom;
    if(tile===0){value=113+(g-70)*.62+(luma(B,j)-145)*.36;chrom=.12;}
    else if(tile===1){value=120+(g-112)*.74;chrom=.45;}
    else if(tile===2){detail=(luma(macro,ix(u*.86+.34,v*.76+.4))-76)*.43;value=100+(g-145)*.45+(luma(B,j)-145)*.37+detail;chrom=.14;}
    else {value=111+(g-125)*.65;chrom=.40;}
    for(let c=0;c<3;c++)data[k+c]=byte(value+(A[i+c]-g)*chrom+[1,0,-2][c]);
   }else if(channel==='nor'){
    const nx=((A[i]-127.5)*(1-blend)+(B[j]-127.5)*blend)*[.85,.77,.66,.80][tile];
    const ny=((A[i+1]-127.5)*(1-blend)+(B[j+1]-127.5)*blend)*[.85,.77,.66,.80][tile];
    const nz=Math.max(62,(A[i+2]*(1-blend)+B[j+2]*blend)-127.5),len=Math.hypot(nx,ny,nz);
    data[k]=byte(127.5+127.5*nx/len);data[k+1]=byte(127.5+127.5*ny/len);data[k+2]=byte(127.5+127.5*nz/len);
   }else{ data[k]=255;data[k+1]=byte([199,187,216,192][tile]+.19*((1-blend)*A[i+1]+blend*B[j+1]));data[k+2]=0; }
  }
  result[channel]=execFileSync('magick',['-size',`${side}x${side}`,'-depth','8','RGB:-',...(channel==='rough'?['-resize','768x768!']:[]),'-sampling-factor','4:4:4','-strip','-quality',channel==='nor'?'92':'90','jpg:-'],{input:data,maxBuffer:8e6});
 }
 return result;
}
