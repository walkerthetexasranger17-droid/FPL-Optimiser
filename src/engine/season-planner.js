import { optimiseLineup } from './lineup.js';
import { sellingPrice } from './selling-price.js';
import { transferHitCost, nextFreeTransfers } from './transfer-cost.js';
import { optimiseSquad } from './squad-optimiser.js';
import { chipWindowEnd } from './chips.js';

const scoreGW=(squad,gw)=>{const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);return l.value+(l.captain?.projections?.[gw]||0)};
const sig=s=>s.map(p=>p.id).sort((a,b)=>a-b).join(',');
const clubCounts=s=>{const m=new Map();for(const p of s)m.set(p.teamId,(m.get(p.teamId)||0)+1);return m};
const horizonPlayer=(p,gws,discount)=>gws.reduce((s,g,i)=>s+Math.pow(discount,i)*(p.projections?.[g]||0),0);

function transferSuccessors(node,players,gws,{clubLimit=3,maxMovesPerGW=2,candidatesPerPos=18,discount=.9,hitPoints=4}={}){
  const out=[{...node,movesThisGW:[],hit:0}];
  let frontier=[{...node,movesThisGW:[]}];
  const rank={};for(const pos of ['GK','DEF','MID','FWD'])rank[pos]=players.filter(p=>p.position===pos).sort((a,b)=>horizonPlayer(b,gws,discount)-horizonPlayer(a,gws,discount)).slice(0,candidatesPerPos);
  for(let depth=1;depth<=maxMovesPerGW;depth++){
    const next=[],seen=new Set();
    for(const st of frontier){const owned=new Set(st.squad.map(p=>p.id));const clubs=clubCounts(st.squad);for(const old of st.squad){if(st.movesThisGW.some(m=>m.out.id===old.id))continue;const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);for(const p of rank[old.position]){if(owned.has(p.id))continue;const nc=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);if(nc>clubLimit)continue;const funds=st.bankTenths+sale;if(p.priceTenths>funds)continue;const squad=st.squad.map(x=>x.id===old.id?{...p,purchasePriceTenths:p.priceTenths}:x);const k=sig(squad);if(seen.has(k))continue;seen.add(k);next.push({...st,squad,bankTenths:funds-p.priceTenths,movesThisGW:[...st.movesThisGW,{out:old,in:p}]});}}}
    frontier=next.sort((a,b)=>scoreGW(b.squad,gws[0])-scoreGW(a.squad,gws[0])).slice(0,120);
    for(const x of frontier)out.push({...x,hit:transferHitCost(x.movesThisGW.length,node.freeTransfers,hitPoints)});
  }
  return out;
}

export function planTransferPath(state,players,startGW,{horizon=5,beamWidth=160,maxMovesPerGW=2,discount=.9,config}={}){
  const gws=Array.from({length:horizon},(_,i)=>startGW+i);let beam=[{squad:state.squad,bankTenths:state.bankTenths,freeTransfers:state.freeTransfers,total:0,path:[]}];
  for(let i=0;i<gws.length;i++){const gw=gws[i],remaining=gws.slice(i);const next=[];for(const node of beam){for(const cand of transferSuccessors(node,players,remaining,{clubLimit:config?.clubLimit??3,maxMovesPerGW,candidatesPerPos:18,discount,hitPoints:config?.transferHitPoints??4})){const ftNext=nextFreeTransfers(node.freeTransfers,cand.movesThisGW.length,config?.maxFreeTransfers??5);const pts=scoreGW(cand.squad,gw)-cand.hit;next.push({squad:cand.squad,bankTenths:cand.bankTenths,freeTransfers:ftNext,total:node.total+Math.pow(discount,i)*pts,path:[...node.path,{gw,moves:cand.movesThisGW,hit:cand.hit,expected:pts,freeTransfersAfter:ftNext,bankTenths:cand.bankTenths}]});}}
    const seen=new Map();for(const n of next.sort((a,b)=>b.total-a.total)){const k=`${sig(n.squad)}:${n.freeTransfers}:${n.bankTenths}`;if(!seen.has(k))seen.set(k,n);}beam=[...seen.values()].slice(0,beamWidth);
  }return {gws,best:beam[0],alternatives:beam.slice(1,5)};
}

export function wildcardWindows(state,players,currentGW,{horizon=8,config,discount=.9}={}){
  const end=Math.min(chipWindowEnd(currentGW,config),currentGW+horizon),rows=[];for(let gw=currentGW+1;gw<=end;gw++){
    const future=Array.from({length:Math.max(1,end-gw+1)},(_,i)=>gw+i);const score=p=>horizonPlayer(p,future,discount);let best;try{best=optimiseSquad(players,{budgetTenths:state.squad.reduce((s,p)=>s+sellingPrice(p.purchasePriceTenths??p.priceTenths,p.priceTenths),state.bankTenths),clubLimit:config.clubLimit,score,maxPerPosition:35,beamWidth:8000});}catch{continue}
    const old=future.reduce((s,g,i)=>s+Math.pow(discount,i)*scoreGW(state.squad,g),0);const neo=future.reduce((s,g,i)=>s+Math.pow(discount,i)*scoreGW(best.players,g),0);rows.push({gw,incrementalExpected:neo-old,squad:best.players,costTenths:best.costTenths});
  }return rows.sort((a,b)=>b.incrementalExpected-a.incrementalExpected);
}

export function chooseChipSchedule(opportunities,{available={wildcard:true,freeHit:true,benchBoost:true,tripleCaptain:true},maxGW=19}={}){
  const pools=[];for(const [chip,key] of [['wildcard','wildcard'],['freeHit','freeHit'],['benchBoost','benchBoost'],['tripleCaptain','tripleCaptain']])if(available[chip])pools.push([chip,(opportunities[key]||[]).filter(x=>x.gw<=maxGW).slice(0,8)]);
  let best={value:0,uses:[]};function walk(i,used,value,uses){if(i===pools.length){if(value>best.value)best={value,uses:[...uses]};return}const [chip,rows]=pools[i];walk(i+1,used,value,uses);for(const r of rows){if(used.has(r.gw))continue;used.add(r.gw);walk(i+1,used,value+Math.max(0,r.incrementalExpected||0),[...uses,{chip,...r}]);used.delete(r.gw);}}walk(0,new Set(),0,[]);return {...best,uses:best.uses.sort((a,b)=>a.gw-b.gw)};
}
