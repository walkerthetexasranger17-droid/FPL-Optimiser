import { generateTransferPlans } from './multi-transfer.js';
import { optimiseLineup } from './lineup.js';
import { nextFreeTransfers } from './transfer-cost.js';

const weekScore=(squad,gw)=>{const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);return l.value+(l.captain?.projections?.[gw]||0)};
const sig=s=>s.map(p=>p.id).sort((a,b)=>a-b).join(',');

// Beam-searches actual week-by-week states. A state carries squad, bank and FT into the next GW.
// This makes "roll now for a stronger double/triple move later" an explicit option.
export function planWeeklyPath(initial,allPlayers,gws,{beamWidth=80,maxTransfersPerWeek=3,clubLimit=3,hitPoints=4,maxFT=5}={}){
  let beam=[{squad:initial.squad,bankTenths:initial.bankTenths,freeTransfers:initial.freeTransfers,total:0,weeks:[]}];
  for(let wi=0;wi<gws.length;wi++){
    const gw=gws[wi],next=[];
    for(const state of beam){
      const remaining=gws.slice(wi);
      const plans=generateTransferPlans(state,allPlayers,remaining,{maxTransfers:maxTransfersPerWeek,beamWidth:70,clubLimit,hitPoints}).slice(0,28);
      // generateTransferPlans includes the zero-transfer state.
      for(const p of plans){
        const n=p.moves.length;
        const hit=Math.max(0,n-state.freeTransfers)*hitPoints;
        const gross=weekScore(p.squad,gw);
        const nft=nextFreeTransfers(state.freeTransfers,n,maxFT);
        next.push({squad:p.squad,bankTenths:p.bankTenths,freeTransfers:nft,total:state.total+gross-hit,weeks:[...state.weeks,{gw,transfers:p.moves,hit,gross,net:gross-hit,freeTransfersBefore:state.freeTransfers,freeTransfersAfter:nft,bankTenths:p.bankTenths}]});
      }
    }
    const unique=new Map();
    for(const s of next){const k=`${sig(s.squad)}|${s.bankTenths}|${s.freeTransfers}`;if(!unique.has(k)||unique.get(k).total<s.total)unique.set(k,s);}
    beam=[...unique.values()].sort((a,b)=>b.total-a.total).slice(0,beamWidth);
    if(!beam.length)throw new Error(`No legal path at GW${gw}`);
  }
  return beam[0];
}
