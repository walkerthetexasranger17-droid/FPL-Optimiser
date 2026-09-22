import {sellingPrice} from './selling-price.js';
import {transferHitCost,nextFreeTransfers} from './transfer-cost.js';
import {optimiseLineup} from './lineup.js';

const signature=s=>s.map(p=>p.id).sort((a,b)=>a-b).join(',');

export function generateTransferPlans(state,allPlayers,gws,{maxTransfers=5,beamWidth=180,clubLimit=3,hitPoints=4,discount=.9}={}){
  const weights=new Map((gws||[]).map((gw,i)=>[gw,Math.pow(discount,i)]));
  const playerHorizon=p=>(gws||[]).reduce((s,gw)=>s+(weights.get(gw)||1)*(p.projections?.[gw]||0),0);
  const scoreCache=new Map();
  const scoreSquad=squad=>{
    const sig=signature(squad);
    if(scoreCache.has(sig))return scoreCache.get(sig);
    let total=0;
    for(const gw of gws||[]){
      const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);
      total+=(weights.get(gw)||1)*(l.value+(l.captain?.projections?.[gw]||0));
    }
    scoreCache.set(sig,total);
    return total;
  };

  const baseline=scoreSquad(state.squad);
  const candidatesByPos={};
  for(const pos of ['GK','DEF','MID','FWD']){
    candidatesByPos[pos]=allPlayers
      .filter(p=>p.position===pos)
      .map(p=>({p,score:playerHorizon(p)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0,35)
      .map(x=>x.p);
  }

  let beam=[{squad:state.squad,bankTenths:state.bankTenths,moves:[],score:baseline}];
  const complete=[];
  for(let depth=0;depth<=maxTransfers;depth++){
    for(const st of beam){
      const hit=transferHitCost(st.moves.length,state.freeTransfers,hitPoints);
      complete.push({...st,hit,netGain:st.score-baseline-hit,nextFT:nextFreeTransfers(state.freeTransfers,st.moves.length)});
    }
    if(depth===maxTransfers)break;
    const next=[],seen=new Set();
    for(const st of beam){
      const owned=new Set(st.squad.map(p=>p.id));
      const clubs=new Map();for(const p of st.squad)clubs.set(p.teamId,(clubs.get(p.teamId)||0)+1);
      for(const old of st.squad){
        if(st.moves.some(m=>m.out.id===old.id))continue;
        const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);
        for(const p of candidatesByPos[old.position]){
          if(owned.has(p.id))continue;
          const newClubCount=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);
          if(newClubCount>clubLimit)continue;
          const funds=st.bankTenths+sale;
          if(p.priceTenths>funds)continue;
          const squad=st.squad.map(x=>x.id===old.id?p:x);
          const sig=signature(squad);
          if(seen.has(sig))continue;
          seen.add(sig);
          next.push({squad,bankTenths:funds-p.priceTenths,moves:[...st.moves,{out:old,in:p}],score:scoreSquad(squad)});
        }
      }
    }
    next.sort((a,b)=>b.score-a.score);
    beam=next.slice(0,beamWidth);
    if(!beam.length)break;
  }
  const uniq=new Map();
  for(const x of complete){const k=signature(x.squad);if(!uniq.has(k)||uniq.get(k).netGain<x.netGain)uniq.set(k,x);}
  return [...uniq.values()].sort((a,b)=>b.netGain-a.netGain);
}
