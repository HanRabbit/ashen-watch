import {describe,it,expect} from 'vitest';
import {assessThreat} from '../tools/threat.mjs';
import {GHOST} from '../src/config';
const rules={grey:GHOST.grey.repelRange,wraith:GHOST.wraith.repelRange,holdMargin:GHOST.repelHoldMargin};
const world=(mode,distance,oil=100)=>({player:{x:0,z:0},lantern:{oil},ghosts:[{kind:'grey',mode,x:distance,z:0}]});
describe('browser bot lantern policy',()=>{
 it('keeps lighting a recoiling ghost beyond the initial repel range',()=>{expect(assessThreat(world('recoil',5.5),rules).raise).toBe(true);});
 it('releases after it gives up, not when it merely backs away',()=>{expect(assessThreat(world('patrol',5.5),rules).raise).toBe(false);});
 it('does not keep consuming oil outside the hold range or without oil',()=>{expect(assessThreat(world('recoil',8),rules).raise).toBe(false);expect(assessThreat(world('recoil',3,0),rules).raise).toBe(false);});
 it('does not classify investigation as an active chase target',()=>{expect(assessThreat(world('investigate',3),rules)).toEqual({chased:false,raise:false});});
 it('reads actual game distances rather than a second hardcoded configuration',()=>{expect(assessThreat(world('chase',5),{...rules,grey:6}).raise).toBe(true);});
});
