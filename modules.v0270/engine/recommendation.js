import { planTransferPath, wildcardWindows, chooseChipSchedule } from './season-planner.js';
import { tripleCaptainWindows, benchBoostWindows, chipWindowEnd } from './chips.js';
import { optimiseLineup } from './lineup.js';
import { freeHitWindows } from './free-hit.js';

export function buildRecommendation(state,players,currentGW,config,{horizon=5,chipHorizon=14}={}){
 const startGW=currentGW+1,end=Math.min(chipWindowEnd(currentGW,config),currentGW+chipHorizon);
 const transfer=planTransferPath(state,players,startGW,{horizon,config});
 const baseSquad=transfer.best?.squad||state.squad;
 const wc=wildcardWindows(state,players,currentGW,{horizon:Math.min(chipHorizon,end-currentGW),config});
 const tc=tripleCaptainWindows(baseSquad,startGW,end),bb=benchBoostWindows(baseSquad,startGW,end);
 const fh=freeHitWindows(state,players,startGW,end,{clubLimit:config.clubLimit});
 const available=state.chipAvailability||{wildcard:true,freeHit:true,benchBoost:true,tripleCaptain:true};
 const chips=chooseChipSchedule({wildcard:wc,freeHit:fh,benchBoost:bb,tripleCaptain:tc},{available,maxGW:end});
 const first=transfer.best?.path?.[0],squad=first?applyMoves(state.squad,first.moves):state.squad,lineup=optimiseLineup(squad,p=>p.projections?.[startGW]||0);
 return {currentGW,startGW,horizon,transfer,chips,lineup,confidence:summariseConfidence(lineup,startGW),warnings:[]};
}
function applyMoves(squad,moves=[]){let s=[...squad];for(const m of moves)s=s.map(p=>p.id===m.out.id?m.in:p);return s;}
function summariseConfidence(lineup,gw){const ds=lineup.xi.map(p=>p.projectionDetail?.[gw]).filter(Boolean);if(!ds.length)return null;const uncertainty=ds.reduce((s,d)=>s+(d.uncertainty||0),0)/ds.length;const minutes=ds.flatMap(d=>d.fixtures||[]).reduce((a,d,i,arr)=>a+(d.minutesConfidence||0)/arr.length,0);return {averageUncertainty:uncertainty,averageMinutesConfidence:minutes};}
