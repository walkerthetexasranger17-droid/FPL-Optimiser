import {optimiseLineup} from './lineup.js';
import {sellingPrice} from './selling-price.js';
import {nextFreeTransfers,transferHitCost} from './transfer-cost.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const POSITIONS=['GK','DEF','MID','FWD'];
function availability(p){const s=String(p.status||'a').toLowerCase();if(['u','i','s'].includes(s))return 0;return clamp(n(p.chanceNext,100)/100,0,1);}
function expMins(p,gw,currentGW){const fs=p.projectionDetail?.[gw]?.fixtures||[];if(fs.length){const v=fs.reduce((s,d)=>s+n(d.expectedMinutes),0);if(v>0)return clamp(v,0,180);}const mpg=n(p.minutes)/Math.max(1,currentGW);return clamp(mpg*availability(p),0,90);}
function xgi90(p){const mins=Math.max(1,n(p.minutes));const raw=clamp(n(p.xGI)*90/mins,0,1.6);const rel=clamp(mins/(mins+300),0,1);const base=p.position==='FWD'?.5:p.position==='MID'?.4:p.position==='DEF'?.13:.02;return raw*rel+base*(1-rel);}
function setPieceScore(p){let s=0;if(n(p.penaltiesOrder)===1)s+=1.1;else if(n(p.penaltiesOrder)===2)s+=.25;if(n(p.directFreeKicksOrder)===1)s+=.22;if(n(p.cornersOrder)===1)s+=.16;return s;}
function reliability(p,currentGW){const starts=clamp(n(p.starts)/Math.max(1,currentGW),0,1),mins=clamp(n(p.minutes)/(Math.max(1,currentGW)*75),0,1);return .45*starts+.55*mins;}

export function captaincyScore(p,gw,{currentGW=5}={}){
  const xp=n(p.projections?.[gw]),mins=expMins(p,gw,currentGW),avail=availability(p);
  if(avail<.5||mins<45)return -999;
  const attack=xgi90(p),rel=reliability(p,currentGW),price=clamp((n(p.priceTenths)-55)/80,0,1);
  const attackingRole=['MID','FWD'].includes(p.position)?1:0;
  const defenderPenalty=['GK','DEF'].includes(p.position)?1.05:0;
  const upside=attack*2.1+setPieceScore(p)+attackingRole*.55+price*.35+clamp(n(p.pointsPerGame),0,10)*.07;
  return xp*1.08+upside+rel*.45+clamp((mins-60)/30,0,1)*.35-defenderPenalty;
}
export function chooseCaptaincy(lineup,gw,{currentGW=5}={}){
  const ranked=[...(lineup?.xi||[])].map(p=>({p,score:captaincyScore(p,gw,{currentGW})})).sort((a,b)=>b.score-a.score);
  return {captain:ranked[0]?.p||lineup?.captain||null,viceCaptain:ranked[1]?.p||lineup?.viceCaptain||null,ranking:ranked};
}
export function sensibleLineup(squad,gw,{currentGW=5}={}){
  const lineup=optimiseLineup(squad,p=>n(p.projections?.[gw]));const cap=chooseCaptaincy(lineup,gw,{currentGW});
  return {...lineup,captain:cap.captain,viceCaptain:cap.viceCaptain,captaincyRanking:cap.ranking};
}
function gwScore(squad,gw,currentGW){const l=sensibleLineup(squad,gw,{currentGW});return l.value+n(l.captain?.projections?.[gw]);}
function horizonScore(squad,gws,currentGW,discount=.84){return gws.reduce((s,gw,i)=>s+Math.pow(discount,i)*gwScore(squad,gw,currentGW),0);}
function playerHorizon(p,gws,discount=.84){return gws.reduce((s,gw,i)=>s+Math.pow(discount,i)*n(p.projections?.[gw]),0);}
function clubCounts(squad){const m=new Map();for(const p of squad)m.set(p.teamId,(m.get(p.teamId)||0)+1);return m;}
function isUrgent(p){const s=String(p.status||'a').toLowerCase();return ['i','u','s'].includes(s)||(p.chanceNext!=null&&n(p.chanceNext,100)<=25);}
function isRisky(p,nextGW,currentGW){return availability(p)<.75||expMins(p,nextGW,currentGW)<50;}
function established(p,currentGW){return n(p.starts)>=Math.ceil(currentGW*.6)&&n(p.minutes)>=currentGW*55&&availability(p)>=.75;}
function candidateEligible(p,nextGW,currentGW){return availability(p)>=.75&&expMins(p,nextGW,currentGW)>=50;}
function pools(allPlayers,gws,nextGW,currentGW,perPos=22){const out={};for(const pos of POSITIONS)out[pos]=allPlayers.filter(p=>p.position===pos&&candidateEligible(p,nextGW,currentGW)).map(p=>({p,s:playerHorizon(p,gws)})).sort((a,b)=>b.s-a.s).slice(0,perPos).map(x=>x.p);return out;}
function applyMove(squad,oldP,newP){return squad.map(p=>p.id===oldP.id?{...newP,purchasePriceTenths:newP.priceTenths,sellingPriceTenths:newP.priceTenths}:p);}
function directMoveGain(move,gws,discount=.84){return playerHorizon(move.in,gws,discount)-playerHorizon(move.out,gws,discount);}
function currentGwDirectGain(move,gw){return n(move.in.projections?.[gw])-n(move.out.projections?.[gw]);}
function protectionPenalty(out,currentGW){
  if(!established(out,currentGW))return 0;
  let p=.8;
  if(['MID','FWD'].includes(out.position))p+=.45;
  if(n(out.penaltiesOrder)===1)p+=.45;
  if(n(out.pointsPerGame)>=5)p+=.35;
  if(n(out.priceTenths)>=85)p+=.35;
  return p;
}
function evaluate(state,squad,moves,gws,currentGW,{hitPoints=4}={}){
  const base=horizonScore(state.squad,gws,currentGW),score=horizonScore(squad,gws,currentGW),hit=transferHitCost(moves.length,state.freeTransfers,hitPoints);
  const nextBase=gwScore(state.squad,gws[0],currentGW),nextScore=gwScore(squad,gws[0],currentGW);
  const raw=score-base,net=raw-hit;
  const direct=moves.reduce((s,m)=>s+directMoveGain(m,gws),0),directNow=moves.reduce((s,m)=>s+currentGwDirectGain(m,gws[0]),0);
  const protection=moves.reduce((s,m)=>s+protectionPenalty(m.out,currentGW),0);
  return {squad,moves,hit,rawGain:raw,netGain:net,nextGWGain:nextScore-nextBase,directGain:direct,directNextGWGain:directNow,protectionPenalty:protection,decisionValue:net-protection,horizonScore:score,nextFT:nextFreeTransfers(state.freeTransfers,moves.length,5)};
}
function singles(state,all,gws,currentGW,opts={}){
  const ps=pools(all,gws,gws[0],currentGW,opts.poolSize||22),owned=new Set(state.squad.map(p=>p.id)),clubs=clubCounts(state.squad),out=[];
  for(const old of state.squad){const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);for(const p of ps[old.position]||[]){if(owned.has(p.id))continue;const cnt=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);if(cnt>(opts.clubLimit||3))continue;const funds=n(state.bankTenths)+sale;if(n(p.priceTenths)>funds)continue;const squad=applyMove(state.squad,old,p);const a=evaluate(state,squad,[{out:old,in:p}],gws,currentGW,opts);a.bankTenths=funds-n(p.priceTenths);out.push(a);}}
  return out.sort((a,b)=>b.decisionValue-a.decisionValue);
}
function doubles(state,all,gws,currentGW,singleList,opts={}){
  const allowFree=state.freeTransfers>=2,urgentCount=state.squad.filter(isUrgent).length;
  if(!allowFree&&urgentCount<2)return [];
  const ps=pools(all,gws,gws[0],currentGW,14),out=[];
  for(const first of singleList.slice(0,24)){
    const firstMove=first.moves[0],owned=new Set(first.squad.map(p=>p.id)),clubs=clubCounts(first.squad);
    for(const old of first.squad){if(old.id===firstMove.in.id||old.id===firstMove.out.id)continue;const sale=sellingPrice(old.purchasePriceTenths??old.priceTenths,old.priceTenths);for(const p of ps[old.position]||[]){if(owned.has(p.id)||p.id===firstMove.out.id)continue;const cnt=(clubs.get(p.teamId)||0)+(p.teamId===old.teamId?0:1);if(cnt>(opts.clubLimit||3))continue;const funds=first.bankTenths+sale;if(n(p.priceTenths)>funds)continue;const a=evaluate(state,applyMove(first.squad,old,p),[firstMove,{out:old,in:p}],gws,currentGW,opts);a.bankTenths=funds-n(p.priceTenths);out.push(a);}}
  }
  return out.sort((a,b)=>b.decisionValue-a.decisionValue);
}
function accept(a,state,nextGW,currentGW){
  if(!a?.moves?.length)return false;
  const urgentMoves=a.moves.filter(m=>isUrgent(m.out)).length;
  const riskyMoves=a.moves.filter(m=>isRisky(m.out,nextGW,currentGW)).length;
  if(a.hit>0){return urgentMoves>=1&&a.netGain>=8&&a.nextGWGain>=4&&a.directNextGWGain>=3.5&&a.directGain>=9;}
  if(a.moves.length===1){
    if(urgentMoves)return a.netGain>=1.5&&a.nextGWGain>=.5&&a.directGain>=2;
    return a.decisionValue>=4.5&&a.nextGWGain>=1.15&&a.directNextGWGain>=1&&a.directGain>=5;
  }
  return state.freeTransfers>=2&&a.decisionValue>=6.5&&a.nextGWGain>=1.8&&a.directGain>=7;
}
function reason(chosen,state,nextGW){
  if(!chosen.moves.length){const ft=Math.min(5,n(state.freeTransfers,1)+1);return `No move is strong enough to beat keeping this squad. Roll the transfer and go into GW${nextGW+1} with ${ft} free transfer${ft===1?'':'s'}.`;}
  const m=chosen.moves[0];const urgent=isUrgent(m.out);return urgent?`${m.out.name} has a major availability problem. ${m.in.name} is the strongest affordable replacement without forcing an unnecessary extra move.`:`${m.in.name} is a clear enough upgrade on ${m.out.name} this week and across the next few fixtures to justify using the free transfer.`;
}
function tcCandidate(squad,start,end,currentGW){let best=null;for(let gw=start;gw<=end;gw++){for(const p of squad){if(!['MID','FWD'].includes(p.position)||availability(p)<.75||expMins(p,gw,currentGW)<65)continue;const fixtures=p.projectionDetail?.[gw]?.fixtures||[],xp=n(p.projections?.[gw]);const score=captaincyScore(p,gw,{currentGW})+(fixtures.length>1?2.5:0);if(!best||score>best.score)best={gw,player:p,xp,score,double:fixtures.length>1};}}return best;}
function bbCandidate(squad,start,end,currentGW){let best=null;for(let gw=start;gw<=end;gw++){const l=sensibleLineup(squad,gw,{currentGW}),bench=[l.benchGK,...l.bench].filter(Boolean);if(bench.length!==4)continue;const pts=bench.reduce((s,p)=>s+n(p.projections?.[gw]),0),likely=bench.every(p=>availability(p)>=.75&&expMins(p,gw,currentGW)>=50);if(likely&&(!best||pts>best.points))best={gw,points:pts};}return best;}
export function simpleChipAdvice(state,{nextGW,currentGW,firstSetLastGW=19}={}){
  const end=Math.min(firstSetLastGW,nextGW+13),av=state.chipAvailability||{},rows=[],tc=tcCandidate(state.squad,nextGW,end,currentGW),bb=bbCandidate(state.squad,nextGW,end,currentGW),problems=state.squad.filter(p=>isUrgent(p)||isRisky(p,nextGW,currentGW)).length;
  if(av.tripleCaptain){if(tc&&(tc.double||tc.xp>=8.5))rows.push({chip:'Triple Captain',action:'WATCH',gw:tc.gw,player:tc.player,reason:`Best current window is GW${tc.gw} with ${tc.player.name}${tc.double?' in a Double Gameweek':''}. Hold the chip for now and confirm close to that deadline.`});else rows.push({chip:'Triple Captain',action:'HOLD',reason:'No standout Triple Captain window is strong enough yet.'});}
  if(av.benchBoost){if(bb&&bb.points>=15)rows.push({chip:'Bench Boost',action:'WATCH',gw:bb.gw,reason:`GW${bb.gw} currently has the strongest playable bench. Recheck minutes and injuries before using it.`});else rows.push({chip:'Bench Boost',action:'HOLD',reason:'The bench is not strong enough to justify Bench Boost yet.'});}
  if(av.wildcard)rows.push({chip:'Wildcard',action:problems>=5?'CONSIDER':'HOLD',reason:problems>=5?`${problems} squad places currently look weak or unavailable, so a wider rebuild deserves consideration.`:'The squad does not currently need a full rebuild.'});
  if(av.freeHit)rows.push({chip:'Free Hit',action:'HOLD',reason:'Keep Free Hit for a Blank/Double Gameweek or a severe one-week squad problem.'});
  return rows;
}
export function weeklyAdvisor(state,allPlayers,nextGW,{currentGW=nextGW-1,horizon=5,clubLimit=3,hitPoints=4,firstSetLastGW=19}={}){
  const gws=Array.from({length:horizon},(_,i)=>nextGW+i),baseScore=horizonScore(state.squad,gws,currentGW),roll={squad:state.squad,moves:[],hit:0,rawGain:0,netGain:0,nextGWGain:0,directGain:0,directNextGWGain:0,protectionPenalty:0,decisionValue:0,horizonScore:baseScore,nextFT:Math.min(5,n(state.freeTransfers,1)+1),bankTenths:state.bankTenths};
  const one=singles(state,allPlayers,gws,currentGW,{clubLimit,hitPoints}),two=doubles(state,allPlayers,gws,currentGW,one,{clubLimit,hitPoints});
  const candidates=[...one.slice(0,28),...two.slice(0,20)].sort((a,b)=>b.decisionValue-a.decisionValue),rawBest=candidates[0]||roll,chosen=accept(rawBest,state,nextGW,currentGW)?rawBest:roll;
  const lineup=sensibleLineup(chosen.squad,nextGW,{currentGW}),alts=candidates.filter(a=>a!==chosen&&a.hit===0&&a.netGain>0).slice(0,4),chips=simpleChipAdvice({...state,squad:chosen.squad},{nextGW,currentGW,firstSetLastGW});
  return {action:chosen.moves.length?'transfer':'roll',bestPlan:chosen,alternatives:alts,lineup,nextFreeTransfers:chosen.nextFT,gws,mode:'weekly-advisor-v027',reason:reason(chosen,state,nextGW),chips,diagnostics:{rawBest:{moves:rawBest.moves.map(m=>({out:m.out.name,in:m.in.name})),netGain:rawBest.netGain,decisionValue:rawBest.decisionValue,nextGWGain:rawBest.nextGWGain,directGain:rawBest.directGain,directNextGWGain:rawBest.directNextGWGain,protectionPenalty:rawBest.protectionPenalty,hit:rawBest.hit},urgentProblems:state.squad.filter(isUrgent).length,evaluatedSingles:one.length,evaluatedDoubles:two.length}};
}
