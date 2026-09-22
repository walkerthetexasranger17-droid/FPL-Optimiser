import {optimiseLineup} from './lineup.js';
import {sellingPrice} from './selling-price.js';
import {nextFreeTransfers,transferHitCost} from './transfer-cost.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const POSITIONS=['GK','DEF','MID','FWD'];

function availability(p){
  const status=String(p.status||'a').toLowerCase();
  if(['u','i','s'].includes(status)) return 0;
  if(p.chanceNext!=null) return clamp(n(p.chanceNext,100)/100,0,1);
  return 1;
}

function expectedMinutes(p,gw,currentGW){
  const detail=p.projectionDetail?.[gw]?.fixtures||[];
  if(detail.length){
    const total=detail.reduce((s,d)=>s+n(d.expectedMinutes),0);
    if(total>0)return clamp(total,0,180);
  }
  const mpg=n(p.minutes)/Math.max(1,currentGW||1);
  return clamp(mpg*availability(p),0,90);
}

function reliableAttackingRate(p){
  const mins=Math.max(180,n(p.minutes));
  const rel=clamp(n(p.minutes)/450,0,1);
  return clamp((n(p.xGI)*90/mins)*rel,0,1.35);
}

export function captaincyScore(p,gw,{currentGW=5}={}){
  const xp=n(p.projections?.[gw]);
  const mins=expectedMinutes(p,gw,currentGW);
  const avail=availability(p);
  if(avail<=0||mins<35)return -999;
  const attack=reliableAttackingRate(p);
  const roleBoost=(p.position==='MID'||p.position==='FWD')?0.7:0;
  const attackingSignal=attack*1.65;
  const formSignal=clamp(n(p.form),0,12)*0.08;
  const ppgSignal=clamp(n(p.pointsPerGame),0,12)*0.07;
  const minutesSignal=clamp((mins-60)/30,0,1)*0.45;
  const defenderPenalty=(p.position==='GK'||p.position==='DEF')?0.55:0;
  return xp+roleBoost+attackingSignal+formSignal+ppgSignal+minutesSignal-defenderPenalty;
}

export function chooseCaptaincy(lineup,gw,{currentGW=5}={}){
  const ranked=[...(lineup?.xi||[])].map(p=>({p,score:captaincyScore(p,gw,{currentGW})})).sort((a,b)=>b.score-a.score);
  const captain=ranked[0]?.p||lineup?.captain||null;
  const vice=ranked.find(x=>x.p.id!==captain?.id)?.p||lineup?.viceCaptain||null;
  return {captain,viceCaptain:vice,ranking:ranked};
}

export function sensibleLineup(squad,gw,{currentGW=5}={}){
  const lineup=optimiseLineup(squad,p=>n(p.projections?.[gw]));
  const cap=chooseCaptaincy(lineup,gw,{currentGW});
  return {...lineup,captain:cap.captain,viceCaptain:cap.viceCaptain,captaincyRanking:cap.ranking};
}

function squadGWScore(squad,gw,currentGW){
  const l=sensibleLineup(squad,gw,{currentGW});
  return l.value+n(l.captain?.projections?.[gw]);
}

function horizonScore(squad,gws,currentGW,discount=.86){
  return gws.reduce((s,gw,i)=>s+Math.pow(discount,i)*squadGWScore(squad,gw,currentGW),0);
}

function playerHorizon(p,gws,discount=.86){
  return gws.reduce((s,gw,i)=>s+Math.pow(discount,i)*n(p.projections?.[gw]),0);
}

function clubCounts(squad){
  const m=new Map();
  for(const p of squad)m.set(p.teamId,(m.get(p.teamId)||0)+1);
  return m;
}

function transferCandidateEligible(p,nextGW,currentGW){
  if(availability(p)<0.5)return false;
  const mins=expectedMinutes(p,nextGW,currentGW);
  if(currentGW>=3&&mins<35)return false;
  return true;
}

function makePools(allPlayers,gws,nextGW,currentGW,perPosition=18){
  const pools={};
  for(const pos of POSITIONS){
    pools[pos]=allPlayers
      .filter(p=>p.position===pos&&transferCandidateEligible(p,nextGW,currentGW))
      .map(p=>({p,score:playerHorizon(p,gws)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0,perPosition)
      .map(x=>x.p);
  }
  return pools;
}

function applyMove(squad,oldP,newP){
  return squad.map(p=>p.id===oldP.id?{...newP,purchasePriceTenths:newP.priceTenths,sellingPriceTenths:newP.priceTenths}:p);
}

function evaluateAction(baseState,squad,moves,gws,currentGW,{discount=.86,hitPoints=4}={}){
  const baseline=horizonScore(baseState.squad,gws,currentGW,discount);
  const score=horizonScore(squad,gws,currentGW,discount);
  const hit=transferHitCost(moves.length,baseState.freeTransfers,hitPoints);
  const nextGwBase=squadGWScore(baseState.squad,gws[0],currentGW);
  const nextGwScore=squadGWScore(squad,gws[0],currentGW);
  const rawGain=score-baseline;
  const netGain=rawGain-hit;
  return {
    squad,moves,hit,rawGain,netGain,
    nextGWGain:nextGwScore-nextGwBase,
    horizonScore:score,
    nextFT:nextFreeTransfers(baseState.freeTransfers,moves.length,5)
  };
}

function singleTransferActions(state,allPlayers,gws,currentGW,{clubLimit=3,hitPoints=4,poolSize=18}={}){
  const pools=makePools(allPlayers,gws,gws[0],currentGW,poolSize);
  const owned=new Set(state.squad.map(p=>p.id));
  const clubs=clubCounts(state.squad);
  const out=[];
  for(const old of state.squad){
    const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);
    for(const p of pools[old.position]||[]){
      if(owned.has(p.id))continue;
      const newClubCount=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);
      if(newClubCount>clubLimit)continue;
      const funds=state.bankTenths+sale;
      if(n(p.priceTenths)>funds)continue;
      const squad=applyMove(state.squad,old,p);
      const a=evaluateAction(state,squad,[{out:old,in:p}],gws,currentGW,{hitPoints});
      a.bankTenths=funds-n(p.priceTenths);
      out.push(a);
    }
  }
  return out.sort((a,b)=>b.netGain-a.netGain);
}

function twoTransferActions(state,allPlayers,gws,currentGW,singles,{clubLimit=3,hitPoints=4,poolSize=14,maxFirst=28}={}){
  if(state.freeTransfers<2)return [];
  const pools=makePools(allPlayers,gws,gws[0],currentGW,poolSize);
  const out=[];
  for(const first of singles.slice(0,maxFirst)){
    const firstMove=first.moves[0];
    const owned=new Set(first.squad.map(p=>p.id));
    const clubs=clubCounts(first.squad);
    for(const old of first.squad){
      if(old.id===firstMove.in.id)continue;
      if(old.id===firstMove.out.id)continue;
      const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);
      for(const p of pools[old.position]||[]){
        if(owned.has(p.id)||p.id===firstMove.out.id)continue;
        const newClubCount=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);
        if(newClubCount>clubLimit)continue;
        const funds=first.bankTenths+sale;
        if(n(p.priceTenths)>funds)continue;
        const squad=applyMove(first.squad,old,p);
        const a=evaluateAction(state,squad,[firstMove,{out:old,in:p}],gws,currentGW,{hitPoints});
        a.bankTenths=funds-n(p.priceTenths);
        out.push(a);
      }
    }
  }
  return out.sort((a,b)=>b.netGain-a.netGain);
}

function urgentProblemCount(squad){
  return squad.filter(p=>{
    const status=String(p.status||'a').toLowerCase();
    return ['i','u','s'].includes(status)||(p.chanceNext!=null&&n(p.chanceNext,100)<=25);
  }).length;
}

function acceptAction(action,state){
  if(!action?.moves?.length)return false;
  const urgent=urgentProblemCount(state.squad)>0;
  if(action.hit>0){
    return urgent&&action.netGain>=6&&action.nextGWGain>=2.5;
  }
  if(action.moves.length===1){
    return action.netGain>=2.25&&action.nextGWGain>=0.65;
  }
  return action.netGain>=3.25&&action.nextGWGain>=0.75;
}

function reasonForAction(action,state,nextGW){
  if(!action?.moves?.length){
    const ft=Math.min(5,n(state.freeTransfers,1)+1);
    return `No transfer clears the value threshold this week. Keep the squad and carry ${ft} free transfer${ft===1?'':'s'} into the next deadline.`;
  }
  const first=action.moves[0];
  const extra=action.moves.length>1?` The second move also improves the squad without taking a hit.`:'';
  return `${first.in.name} improves the projected XI over ${first.out.name} for GW${nextGW} and the short fixture run.${extra}`;
}

function futureCaptainCandidate(squad,startGW,endGW,currentGW){
  let best=null;
  for(let gw=startGW;gw<=endGW;gw++){
    for(const p of squad){
      if(!['MID','FWD'].includes(p.position))continue;
      const xp=n(p.projections?.[gw]);
      if(xp<=0)continue;
      const mins=expectedMinutes(p,gw,currentGW);
      if(mins<65||availability(p)<.75)continue;
      const score=captaincyScore(p,gw,{currentGW});
      if(!best||score>best.score)best={gw,player:p,score,xp};
    }
  }
  return best;
}

function benchBoostCandidate(squad,startGW,endGW,currentGW){
  let best=null;
  for(let gw=startGW;gw<=endGW;gw++){
    const l=sensibleLineup(squad,gw,{currentGW});
    const bench=[l.benchGK,...l.bench].filter(Boolean);
    const pts=bench.reduce((s,p)=>s+n(p.projections?.[gw]),0);
    const allLikely=bench.every(p=>expectedMinutes(p,gw,currentGW)>=50&&availability(p)>=.75);
    if(allLikely&&(!best||pts>best.points))best={gw,points:pts,bench};
  }
  return best;
}

export function simpleChipAdvice(state,{nextGW,currentGW,firstSetLastGW=19}={}){
  const end=Math.min(firstSetLastGW,nextGW+13);
  const available=state.chipAvailability||{};
  const rows=[];
  const tc=futureCaptainCandidate(state.squad,nextGW,end,currentGW);
  if(available.tripleCaptain){
    if(tc&&tc.xp>=7.5) rows.push({chip:'Triple Captain',action:'HOLD FOR WINDOW',gw:tc.gw,player:tc.player,reason:`Best current first-half captain window in your squad is GW${tc.gw} for ${tc.player.name}. Recheck close to the deadline before activating it.`});
    else rows.push({chip:'Triple Captain',action:'HOLD',reason:'No strong Triple Captain window is clear enough yet.'});
  }
  const bb=benchBoostCandidate(state.squad,nextGW,end,currentGW);
  if(available.benchBoost){
    if(bb&&bb.points>=14)rows.push({chip:'Bench Boost',action:'WATCH',gw:bb.gw,reason:`GW${bb.gw} currently gives the strongest playable bench (${bb.points.toFixed(1)} projected points). Recheck injuries and rotation first.`});
    else rows.push({chip:'Bench Boost',action:'HOLD',reason:'Your current bench does not justify using Bench Boost yet.'});
  }
  if(available.wildcard){
    const problems=urgentProblemCount(state.squad);
    rows.push({chip:'Wildcard',action:problems>=4?'CONSIDER':'HOLD',reason:problems>=4?`${problems} squad members have major availability problems, so a wider rebuild may be justified.`:'No major squad overhaul is required from the current availability picture.'});
  }
  if(available.freeHit)rows.push({chip:'Free Hit',action:'HOLD',reason:'Keep Free Hit for a later blank/double Gameweek or an unusually difficult one-week squad problem.'});
  return rows;
}

export function weeklyAdvisor(state,allPlayers,nextGW,{currentGW=nextGW-1,horizon=5,clubLimit=3,hitPoints=4,firstSetLastGW=19}={}){
  const gws=Array.from({length:horizon},(_,i)=>nextGW+i);
  const baselineLineup=sensibleLineup(state.squad,nextGW,{currentGW});
  const roll={squad:state.squad,moves:[],hit:0,rawGain:0,netGain:0,nextGWGain:0,horizonScore:horizonScore(state.squad,gws,currentGW),nextFT:Math.min(5,n(state.freeTransfers,1)+1),bankTenths:state.bankTenths};
  const singles=singleTransferActions(state,allPlayers,gws,currentGW,{clubLimit,hitPoints});
  const doubles=twoTransferActions(state,allPlayers,gws,currentGW,singles,{clubLimit,hitPoints});
  const actions=[roll,...singles.slice(0,24),...doubles.slice(0,18)].sort((a,b)=>b.netGain-a.netGain);
  const rawBest=actions[0]||roll;
  const chosen=acceptAction(rawBest,state)?rawBest:roll;
  const action=chosen.moves.length?'transfer':'roll';
  const chosenLineup=sensibleLineup(chosen.squad,nextGW,{currentGW});
  const alternatives=actions.filter(a=>a!==chosen&&a.moves.length&&a.hit===0&&a.netGain>0).slice(0,5);
  const chips=simpleChipAdvice({...state,squad:chosen.squad},{nextGW,currentGW,firstSetLastGW});
  return {
    action,bestPlan:chosen,alternatives,lineup:chosenLineup,nextFreeTransfers:chosen.nextFT,gws,
    mode:'simple-weekly-advisor',reason:reasonForAction(chosen,state,nextGW),chips,
    diagnostics:{rawBest:{moves:rawBest.moves.map(m=>({out:m.out.name,in:m.in.name})),netGain:rawBest.netGain,nextGWGain:rawBest.nextGWGain,hit:rawBest.hit},urgentProblems:urgentProblemCount(state.squad),evaluatedSingles:singles.length,evaluatedDoubles:doubles.length}
  };
}
