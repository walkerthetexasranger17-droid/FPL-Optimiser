import { optimiseLineup } from '../engine/lineup.js';
import { sellingPrice } from '../engine/selling-price.js';
import { normaliseV8KnowledgeRow } from '../knowledge/v8-live.js';

const POSITIONS=['GK','DEF','MID','FWD'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;

export function horizonScore(player,gws,{discount=.9}={}){
  return (gws||[]).reduce((sum,gw,i)=>sum+Math.pow(discount,i)*n(player?.projections?.[gw]),0);
}

export function projectionUncertainty(player,gws){
  const rows=(gws||[]).map(gw=>player?.projectionDetail?.[gw]).filter(Boolean);
  if(!rows.length)return 0;
  return rows.reduce((s,r)=>s+n(r.uncertainty),0)/rows.length;
}

export function currentEvidenceProfile(player,currentGW){
  const games=Math.max(1,n(currentGW,1));
  const minutes=n(player?.minutes);
  const starts=n(player?.starts);
  const mpg=minutes/games;
  const startRate=starts/games;
  const established=minutes>=Math.max(270,games*50)&&startRate>=.55;
  const sparse=minutes<Math.max(180,games*36)||startRate<.4;
  return {games,minutes,starts,minutesPerFixture:mpg,startRate,established,sparse};
}

export function researchNeed(player,currentGW,{candidate=false,gws=[]}={}){
  if(player?.v8KnowledgeFresh===true)return {needed:false,reasons:[],profile:currentEvidenceProfile(player,currentGW)};
  const profile=currentEvidenceProfile(player,currentGW);
  const chance=player?.chanceNext==null?null:n(player.chanceNext,100);
  const flagged=['d','i','u','s'].includes(String(player?.status||'').toLowerCase())||(chance!=null&&chance<100);
  const stale=player?.v8KnowledgeFresh===false||Boolean(player?.v8Knowledge&&!player?.v8KnowledgeFresh);
  const reasons=[];
  if(flagged)reasons.push('availability-uncertain');
  if(profile.sparse)reasons.push('sparse-current-evidence');
  if(candidate&&projectionUncertainty(player,gws)>4.5)reasons.push('high-projection-uncertainty');
  if(stale&&(flagged||profile.sparse||candidate))reasons.push('stale-v8-knowledge');
  // Established, healthy players with enough current PL evidence do not need historical research.
  const needed=reasons.length>0 && !(profile.established&&!flagged&&!candidate&&reasons.every(r=>r==='stale-v8-knowledge'));
  return {needed,reasons:[...new Set(reasons)],profile,flagged,stale};
}

function marketScore(p){
  const transfers=Math.max(0,n(p?.transfersInEvent));
  const selected=Math.max(0,n(p?.selectedBy));
  // Market signals only broaden the discovery shortlist; they never become projected points.
  return Math.log1p(transfers)*1.6+Math.sqrt(selected)*2+Math.max(0,n(p?.priceTenths)-40)*.025;
}

function clubCounts(squad){const m=new Map();for(const p of squad||[])m.set(p.teamId,(m.get(p.teamId)||0)+1);return m;}

function feasibleSwap(candidate,state,old,clubLimit){
  const sale=old.sellingPriceTenths??sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);
  if(n(candidate.priceTenths)>n(state.bankTenths)+n(sale))return false;
  const clubs=clubCounts(state.squad);
  const after=(clubs.get(candidate.teamId)||0)+(candidate.teamId===old.teamId?0:1);
  return after<=clubLimit;
}

function squadHorizonScore(squad,gws,{discount=.9}={}){
  return (gws||[]).reduce((sum,gw,i)=>{
    const l=optimiseLineup(squad,p=>n(p?.projections?.[gw]));
    return sum+Math.pow(discount,i)*(l.value+n(l.captain?.projections?.[gw]));
  },0);
}

function candidateUniverse(state,players,gws,{clubLimit=3,projectedPerPosition=8,marketPerPosition=5,discount=.9}={}){
  const owned=new Set((state.squad||[]).map(p=>p.id));
  const out=[];
  const baseline=squadHorizonScore(state.squad,gws,{discount});
  const playerScores=new Map((players||[]).map(p=>[p.id,horizonScore(p,gws,{discount})]));
  for(const pos of POSITIONS){
    const pool=(players||[]).filter(p=>p.position===pos&&!owned.has(p.id));
    const projected=[...pool].sort((a,b)=>n(playerScores.get(b.id))-n(playerScores.get(a.id))).slice(0,projectedPerPosition);
    const market=[...pool].sort((a,b)=>marketScore(b)-marketScore(a)).slice(0,marketPerPosition);
    const union=new Map([...projected,...market].map(p=>[p.id,p]));
    for(const p of union.values()){
      let bestSwap=null;
      for(const old of state.squad||[]){
        if(old.position!==pos||!feasibleSwap(p,state,old,clubLimit))continue;
        const squad=state.squad.map(x=>x.id===old.id?p:x);
        const gain=squadHorizonScore(squad,gws,{discount})-baseline;
        if(!bestSwap||gain>bestSwap.gain)bestSwap={old,gain};
      }
      if(!bestSwap)continue;
      out.push({player:p,swapOut:bestSwap.old,gain:bestSwap.gain,marketScore:marketScore(p),projectedScore:n(playerScores.get(p.id))});
    }
  }
  return out;
}

export function buildDecisionMaterialResearchPlan(state,players,currentGW,{
  horizon=5,
  maxResearch=6,
  clubLimit=3,
  discount=.9,
  candidateGainFloor=-2.5
}={}){
  const startGW=currentGW+1;
  const gws=Array.from({length:horizon},(_,i)=>startGW+i);
  const tasks=[];
  const lineup=optimiseLineup(state.squad,p=>n(p?.projections?.[startGW]));
  const starters=new Set(lineup.xi.map(p=>p.id));
  const bench=new Set(lineup.bench.map(p=>p.id));

  for(const p of state.squad||[]){
    const need=researchNeed(p,currentGW,{candidate:false,gws});
    if(!need.needed)continue;
    const importance=starters.has(p.id)?55:bench.has(p.id)?25:15;
    const priority=140+importance+Math.min(30,projectionUncertainty(p,gws)*4)+(need.flagged?35:0);
    tasks.push({
      playerId:p.id,name:p.name,team:p.team,role:'owned',priority,
      reasons:need.reasons,
      reason:'decision-material-owned',
      force:need.stale,
      context:{starter:starters.has(p.id),horizonScore:horizonScore(p,gws,{discount}),profile:need.profile}
    });
  }

  const candidates=candidateUniverse(state,players,gws,{clubLimit,discount});
  const maxMarket=Math.max(1,...candidates.map(x=>x.marketScore));
  // Research only candidates that are genuinely close to becoming a transfer decision.
  // Market popularity can help rank a candidate but can no longer make a weak/negative
  // preliminary swap "material" by itself. This prevents endless waves of speculative
  // research after the first six players have been refreshed.
  const frontier=candidates
    .filter(row=>row.gain>=Math.max(.5,candidateGainFloor))
    .sort((a,b)=>b.gain-a.gain || b.marketScore-a.marketScore)
    .slice(0,Math.max(4,maxResearch));
  for(const row of frontier){
    const need=researchNeed(row.player,currentGW,{candidate:true,gws});
    if(!need.needed)continue;
    const priority=90+clamp(row.gain,0,8)*10+(row.marketScore/maxMarket)*12+Math.min(20,projectionUncertainty(row.player,gws)*3)+(need.flagged?20:0);
    tasks.push({
      playerId:row.player.id,name:row.player.name,team:row.player.team,role:'candidate',priority,
      reasons:need.reasons,
      reason:'decision-material-candidate',
      force:need.stale,
      context:{possibleSwapOutId:row.swapOut.id,possibleSwapOutName:row.swapOut.name,preliminaryGain:row.gain,horizonScore:row.projectedScore,marketDiscoveryScore:row.marketScore,profile:need.profile}
    });
  }

  const dedup=new Map();
  for(const task of tasks.sort((a,b)=>b.priority-a.priority))if(!dedup.has(task.playerId))dedup.set(task.playerId,task);
  const selected=[...dedup.values()].slice(0,maxResearch);
  return {
    startGW,gws,
    tasks:selected,
    totalMaterialGaps:dedup.size,
    deferred:Math.max(0,dedup.size-selected.length),
    maxResearch,
    preliminaryLineup:{xiIds:lineup.xi.map(p=>p.id),benchIds:lineup.bench.map(p=>p.id),captainId:lineup.captain?.id??null},
    policy:{researchWholeDatabase:false,ownedSparseOrFlagged:true,candidateShortlistOnly:true,marketSignalsNeverMakeWeakCandidatesMaterial:true,freshV8Reused:true,establishedHealthyPlayersSkipHistoricalRefresh:true}
  };
}


export function blockingResearchTasks(plan,{candidateGainThreshold=2.5}={}){
  return (plan?.tasks||[]).filter(task=>{
    if(task.role==='owned')return Boolean(task.context?.starter)||task.reasons?.includes('availability-uncertain');
    if(task.role==='candidate')return n(task.context?.preliminaryGain)>=candidateGainThreshold||task.reasons?.includes('availability-uncertain');
    return true;
  });
}

export async function executeDecisionMaterialResearch(plan,{
  researchClient,
  knowledgeClient,
  season='2026-27',
  runQueue=true,
  maxRunCalls=3
}={}){
  if(!researchClient)throw new Error('researchClient is required');
  const enqueued=[],skippedFresh=[];
  for(const task of plan?.tasks||[]){
    if(knowledgeClient){
      try{
        const existing=await knowledgeClient.get(task.playerId,season);
        const k=normaliseV8KnowledgeRow(existing);
        if(k?.freshMinutes){skippedFresh.push({task,knowledge:existing});continue;}
      }catch{}
    }
    enqueued.push(await researchClient.enqueue({...task,season}));
  }
  const runs=[];
  if(runQueue&&enqueued.length){
    let remaining=enqueued.length;
    for(let i=0;i<maxRunCalls&&remaining>0;i++){
      const run=await researchClient.run(Math.min(5,remaining));
      runs.push(run);
      const attempted=n(run?.attempted,run?.processed);
      if(attempted<=0)break;
      remaining=Math.max(0,remaining-attempted);
    }
  }
  const refreshed=[];
  if(knowledgeClient){
    for(const task of plan?.tasks||[]){
      try{const row=await knowledgeClient.get(task.playerId,season);if(row)refreshed.push(row);}catch{}
    }
  }
  return {enqueued,runs,refreshed,skippedFresh,requested:(plan?.tasks||[]).length};
}
