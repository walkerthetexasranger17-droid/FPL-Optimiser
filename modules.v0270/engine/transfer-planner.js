import {optimiseLineup} from './lineup.js';
import {generateTransferPlans} from './multi-transfer.js';
import {sellingPrice} from './selling-price.js';
import {nextFreeTransfers,transferHitCost} from './transfer-cost.js';

const POSITIONS=['GK','DEF','MID','FWD'];
const scoreGW=(squad,gw)=>{const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);return l.value+(l.captain?.projections?.[gw]||0)};
const sig=s=>s.map(p=>p.id).sort((a,b)=>a-b).join(',');
const actionKey=moves=>moves?.length?moves.map(m=>`${m.out.id}>${m.in.id}`).sort().join('|'):'ROLL';
const playerHorizon=(p,gws,discount=.9)=>gws.reduce((s,g,i)=>s+Math.pow(discount,i)*(p.projections?.[g]||0),0);

// Legacy immediate optimiser retained for tests/tools that only need a static horizon.
export function weeklyPlan(state,allPlayers,nextGW,horizon=5){
  const gws=Array.from({length:horizon},(_,i)=>nextGW+i);
  const lineup=optimiseLineup(state.squad,p=>p.projections?.[nextGW]||0);
  const plans=generateTransferPlans(state,allPlayers,gws,{maxTransfers:Math.min(5,state.freeTransfers+1)});
  const best=plans[0];
  const action=!best||best.moves.length===0||best.netGain<0.75?'roll':'transfer';
  return {action,bestPlan:best,alternatives:plans.slice(0,5),lineup,nextFreeTransfers:action==='roll'?Math.min(5,state.freeTransfers+1):best.nextFT,gws,mode:'static'};
}

function clubCounts(squad){const m=new Map();for(const p of squad)m.set(p.teamId,(m.get(p.teamId)||0)+1);return m;}

function makeFuturePools(allPlayers,gws,discount,candidatesPerPos=12){
  const pools={};
  for(const pos of POSITIONS){
    pools[pos]=allPlayers.filter(p=>p.position===pos)
      .map(p=>({p,score:playerHorizon(p,gws,discount)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0,candidatesPerPos)
      .map(x=>x.p);
  }
  return pools;
}

function bestFutureStep(state,allPlayers,gw,remainingGws,{clubLimit=3,maxFT=5,hitPoints=4,discount=.9,candidatesPerPos=12,minTransferGain=.6}={}){
  const pools=makeFuturePools(allPlayers,remainingGws,discount,candidatesPerPos);
  const baseline=remainingGws.reduce((s,g,i)=>s+Math.pow(discount,i)*scoreGW(state.squad,g),0);
  const owned=new Set(state.squad.map(p=>p.id));
  const clubs=clubCounts(state.squad);
  let best=null;
  for(const old of state.squad){
    const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);
    for(const p of pools[old.position]){
      if(owned.has(p.id))continue;
      const nc=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);
      if(nc>clubLimit)continue;
      const funds=state.bankTenths+sale;
      if(p.priceTenths>funds)continue;
      const squad=state.squad.map(x=>x.id===old.id?{...p,purchasePriceTenths:p.priceTenths,sellingPriceTenths:p.priceTenths}:x);
      const horizon=remainingGws.reduce((s,g,i)=>s+Math.pow(discount,i)*scoreGW(squad,g),0);
      const hit=transferHitCost(1,state.freeTransfers,hitPoints);
      const gain=horizon-baseline-hit;
      if(!best||gain>best.gain)best={gain,squad,bankTenths:funds-p.priceTenths,moves:[{out:old,in:p}],hit};
    }
  }
  if(!best||best.gain<minTransferGain){
    return {squad:state.squad,bankTenths:state.bankTenths,freeTransfers:Math.min(maxFT,state.freeTransfers+1),moves:[],hit:0};
  }
  return {...best,freeTransfers:nextFreeTransfers(state.freeTransfers,1,maxFT)};
}

function simulateFuture(first,state,allPlayers,gws,{discount=.9,clubLimit=3,maxFT=5,hitPoints=4,candidatesPerPos=12,minTransferGain=.6}={}){
  const firstMoves=first.moves||[];
  const firstHit=first.hit??transferHitCost(firstMoves.length,state.freeTransfers,hitPoints);
  let squad=first.squad||state.squad;
  let bankTenths=first.bankTenths??state.bankTenths;
  let freeTransfers=first.nextFT??nextFreeTransfers(state.freeTransfers,firstMoves.length,maxFT);
  let total=scoreGW(squad,gws[0])-firstHit;
  const path=[{gw:gws[0],moves:firstMoves,hit:firstHit,expected:scoreGW(squad,gws[0])-firstHit,freeTransfersAfter:freeTransfers,bankTenths}];
  for(let i=1;i<gws.length;i++){
    const gw=gws[i],remaining=gws.slice(i);
    const step=bestFutureStep({squad,bankTenths,freeTransfers},allPlayers,gw,remaining,{discount,clubLimit,maxFT,hitPoints,candidatesPerPos,minTransferGain});
    squad=step.squad;bankTenths=step.bankTenths;freeTransfers=step.freeTransfers;
    const pts=scoreGW(squad,gw)-step.hit;
    total+=Math.pow(discount,i)*pts;
    path.push({gw,moves:step.moves,hit:step.hit,expected:pts,freeTransfersAfter:freeTransfers,bankTenths});
  }
  return {total,path,squad,bankTenths,freeTransfers};
}

// Fast strategic planner: today's action is assessed with a bounded, greedy future simulation.
// It explicitly values rolling an FT without the combinatorial explosion of a full 5-week tree.
export function strategicWeeklyPlan(state,allPlayers,nextGW,horizon=5,{config={clubLimit:3,maxFreeTransfers:5,transferHitPoints:4},discount=.9,beamWidth=100,maxMovesPerGW=2,minGain=.75,futureCandidatesPerPos=12}={}){
  const gws=Array.from({length:horizon},(_,i)=>nextGW+i);
  const lineup=optimiseLineup(state.squad,p=>p.projections?.[nextGW]||0);
  const maxFT=config?.maxFreeTransfers??5,hitPoints=config?.transferHitPoints??4,clubLimit=config?.clubLimit??3;
  const immediate=generateTransferPlans(state,allPlayers,gws,{maxTransfers:Math.min(maxMovesPerGW,state.freeTransfers+1),beamWidth,clubLimit,hitPoints,discount});
  const selected=[];const seen=new Set();
  const roll=immediate.find(p=>!p.moves.length)||{squad:state.squad,bankTenths:state.bankTenths,moves:[],hit:0,nextFT:Math.min(maxFT,state.freeTransfers+1)};
  selected.push(roll);seen.add('ROLL');
  for(const p of immediate){const k=actionKey(p.moves);if(seen.has(k))continue;seen.add(k);selected.push(p);if(selected.length>=18)break;}
  const simulations=selected.map(first=>({first,...simulateFuture(first,state,allPlayers,gws,{discount,clubLimit,maxFT,hitPoints,candidatesPerPos:futureCandidatesPerPos,minTransferGain:.6})}));
  const rollSim=simulations.find(x=>!x.first.moves.length)||simulations[0];
  const actions=simulations.map(x=>({
    moves:x.first.moves||[],hit:x.first.hit||0,nextFT:x.path[0]?.freeTransfersAfter??Math.min(maxFT,state.freeTransfers+1),bankTenths:x.path[0]?.bankTenths??state.bankTenths,
    strategicTotal:x.total,netGain:x.total-rollSim.total,directNetGain:Number(x.first.netGain||0),path:x.path,squad:x.squad
  })).sort((a,b)=>b.strategicTotal-a.strategicTotal);
  const rawBest=actions[0]||{moves:[],hit:0,nextFT:Math.min(maxFT,state.freeTransfers+1),netGain:0,directNetGain:0,path:rollSim.path,squad:state.squad};
  // A transfer must be good in its own right, not only because two greedy future paths diverged.
  // Hits are held to a higher bar. This prevents spectacular-looking but unstable +40/+50
  // recommendations caused by projection noise or future-path compounding.
  const directFloor=rawBest.hit>0?4:Math.max(.75,minGain);
  const pathGap=rawBest.netGain-rawBest.directNetGain;
  const stablePath=pathGap<=12 || rawBest.directNetGain>=rawBest.netGain*.55;
  const plausibleGain=rawBest.netGain<=30 || rawBest.directNetGain>=18;
  const transferAccepted=rawBest.moves.length&&rawBest.netGain>=minGain&&rawBest.directNetGain>=directFloor&&stablePath&&plausibleGain;
  const action=transferAccepted?'transfer':'roll';
  const chosen=action==='transfer'?rawBest:(actions.find(x=>!x.moves.length)||rawBest);
  const alternatives=actions.filter(x=>actionKey(x.moves)!==actionKey(chosen.moves)).slice(0,5);
  const decisionSafety={accepted:transferAccepted,directFloor,pathGap,stablePath,plausibleGain,rejectedAction:transferAccepted?null:(rawBest.moves.length?actionKey(rawBest.moves):null),rejectedStrategicGain:transferAccepted?null:rawBest.netGain,rejectedDirectGain:transferAccepted?null:rawBest.directNetGain};
  return {action,bestPlan:chosen,alternatives,lineup,nextFreeTransfers:chosen.nextFT,gws,mode:'strategic-fast-safe',rollBaseline:rollSim.total,decisionSafety};
}
