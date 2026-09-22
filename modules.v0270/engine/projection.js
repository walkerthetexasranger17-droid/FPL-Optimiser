import { applyKnowledgePrior } from '../knowledge/priors.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;

function availability(p){
  const status=String(p.status||'a').toLowerCase();
  if(['u','i','s'].includes(status))return 0;
  return clamp(n(p.chanceNext,100)/100,0,1);
}
function fixtureFactor(diff,home){const map={1:1.18,2:1.09,3:1,4:.92,5:.84};return (map[diff]||1)*(home?1.025:.985);}
function strengthRatio(own,opp,s=.16){
  if(!own||!opp)return 1;
  const d=(own-opp)/Math.max(1,(own+opp)/2);
  return clamp(1+d*s,.80,1.20);
}
function minutesModel(p,seasonGames){
  const live=n(p.v8BaseExpectedMinutes,NaN);
  if(Number.isFinite(live))return {expected:clamp(live,0,90)*availability(p),confidence:clamp(n(p.v8MinutesConfidence,.55),.1,1),source:'v8-live'};
  const games=Math.max(1,seasonGames);
  const mpg=n(p.minutes)/games;
  const startRate=clamp(n(p.starts)/games,0,1);
  const startMinutes=82*startRate;
  let expected=.58*mpg+.42*startMinutes;
  if(n(p.starts)>=Math.max(2,Math.ceil(games*.6)))expected=Math.max(expected,Math.min(86,mpg+8));
  const prior=n(p.priorExpectedMinutes,NaN),w=clamp(n(p.knowledgePriorWeight),0,.5);
  if(Number.isFinite(prior)&&w>0)expected=(1-w)*expected+w*clamp(prior,0,90);
  expected=clamp(expected,0,90)*availability(p);
  const confidence=clamp(.25+.5*startRate+.25*clamp(n(p.minutes)/(games*80),0,1),.1,1);
  return {expected,confidence,source:'season-role'};
}
function shrunkPer90(total,p,baseline,cap){
  const mins=Math.max(1,n(p.minutes));
  const raw=clamp(n(total)*90/mins,0,cap);
  const rel=clamp(mins/(mins+300),0,1);
  return raw*rel+baseline*(1-rel);
}
function positionBaselines(pos){
  if(pos==='FWD')return {xg:.34,xa:.16};
  if(pos==='MID')return {xg:.20,xa:.20};
  if(pos==='DEF')return {xg:.06,xa:.09};
  return {xg:.01,xa:.01};
}
function roleBoost(p,share){
  let v=0;
  if(n(p.penaltiesOrder)===1)v+=.55;
  else if(n(p.penaltiesOrder)===2)v+=.16;
  if(n(p.directFreeKicksOrder)===1)v+=.16;
  if(n(p.cornersOrder)===1)v+=.12;
  return v*share;
}
function teamFactors(fixture,pos){
  if(!fixture)return {attack:1,defence:1};
  const home=Boolean(fixture.home);
  const ownAttack=home?n(fixture.teamAttack,n(fixture.teamStrength)):n(fixture.teamAttack,n(fixture.teamStrength));
  const oppDef=n(fixture.opponentDefence,n(fixture.opponentStrength));
  const ownDef=n(fixture.teamDefence,n(fixture.teamStrength));
  const oppAttack=n(fixture.opponentAttack,n(fixture.opponentStrength));
  return {attack:strengthRatio(ownAttack,oppDef,.18),defence:strengthRatio(ownDef,oppAttack,.15)};
}
export function projectionComponents(raw,fixture,{seasonGames=5}={}){
  const p=raw,mins=minutesModel(p,seasonGames),share=mins.expected/90,avail=availability(p);
  const ff=fixtureFactor(fixture?.difficulty||3,fixture?.home),tf=teamFactors(fixture,p.position);
  const base=positionBaselines(p.position);
  const xg90=Number.isFinite(Number(p.xG90PriorAdjusted))?Number(p.xG90PriorAdjusted):shrunkPer90(p.xG,p,base.xg,p.position==='FWD'?1.2:p.position==='MID'?.9:.55);
  const xa90=Number.isFinite(Number(p.xA90PriorAdjusted))?Number(p.xA90PriorAdjusted):shrunkPer90(p.xA,p,base.xa,p.position==='MID'?.9:.7);
  const ppg=n(p.pointsPerGame),form=n(p.form),games=Math.max(1,seasonGames);
  let appearance=share>=.67?2*share:share;
  let attack=0,defence=0,bonus=clamp((n(p.bonus)/Math.max(1,n(p.minutes))*90)*share,0,1.1),defCon=0;
  if(p.position==='GK'){defence=(1.55+.018*n(p.saves)/games)*share;}
  if(p.position==='DEF'){attack=(4.7*xg90+2.9*xa90)*share;defence=1.7*share;defCon=clamp(n(p.defCon)/games*.15,0,1.1)*share;}
  if(p.position==='MID'){attack=(4.9*xg90+2.9*xa90)*share;defence=.48*share;defCon=clamp(n(p.defCon)/games*.12,0,1.0)*share;}
  if(p.position==='FWD'){attack=(3.9*xg90+2.9*xa90)*share;defCon=clamp(n(p.defCon)/games*.12,0,1.0)*share;}
  attack*=ff*tf.attack;
  defence*=((fixture?.difficulty||3)<=2?1.10:(fixture?.difficulty||3)>=4?.82:1)*tf.defence;
  const formSignal=clamp((.6*ppg+.4*form)-4,-2.2,2.8)*.14*share;
  const setPiece=roleBoost(p,share)*ff;
  const fplEp=Number.isFinite(n(p.epNext,NaN))?clamp(n(p.epNext),0,12):NaN;
  let expected=appearance+attack+defence+bonus+defCon+formSignal+setPiece;
  if(Number.isFinite(fplEp)) expected=.88*expected+.12*fplEp;
  const established=n(p.minutes)>=Math.max(240,games*48)&&n(p.starts)>=Math.ceil(games*.5);
  const healthy=avail>=.75;
  const observed=Math.max(ppg,n(p.totalPoints)/games);
  const floor=established&&healthy?clamp(observed*.66*clamp(ff,.84,1.13)*clamp(mins.expected/75,.72,1.08),0,8.5):0;
  expected=clamp(Math.max(expected,floor),0,14);
  const uncertainty=clamp(1.7+(1-mins.confidence)*3+(avail<1?1.2:0)+(fixture?.difficulty===3?.25:0),1.2,5.5);
  return {expected,expectedMinutes:mins.expected,minutesConfidence:mins.confidence,minutesSource:mins.source,fixtureFactor:ff,matchupFactors:tf,uncertainty,knowledgePriorWeight:n(p.knowledgePriorWeight),components:{appearance,attack,defence,bonus,defensiveContribution:defCon,form:formSignal,setPiece,empiricalFloor:floor,xg90,xa90}};
}
export function projectPlayerGW(p,fixture,opts={}){return projectionComponents(p,fixture,opts);}
export function buildProjections(players,fixtures,currentGW,horizon=5,{knowledgeStore=null,season='2026-27'}={}){
  const teamFix=new Map();
  for(const f of fixtures){
    if(!f.gameweek||f.gameweek<=currentGW||f.gameweek>currentGW+horizon)continue;
    const pairs=[
      [f.homeTeamId,f.awayTeamId,true,f.homeDifficulty,f.homeStrength,f.awayStrength,f.homeAttack,f.awayDefence,f.homeDefence,f.awayAttack],
      [f.awayTeamId,f.homeTeamId,false,f.awayDifficulty,f.awayStrength,f.homeStrength,f.awayAttack,f.homeDefence,f.awayDefence,f.homeAttack]
    ];
    for(const [teamId,opp,home,difficulty,teamStrength,opponentStrength,teamAttack,opponentDefence,teamDefence,opponentAttack] of pairs){
      const k=`${teamId}:${f.gameweek}`,arr=teamFix.get(k)||[];
      arr.push({opponentId:opp,home,difficulty,teamStrength,opponentStrength,teamAttack,opponentDefence,teamDefence,opponentAttack});teamFix.set(k,arr);
    }
  }
  const games=Math.max(1,currentGW);
  return players.map(raw=>{
    const knowledge=knowledgeStore?.get?.(season,raw.id);const p=knowledge?applyKnowledgePrior(raw,knowledge):{...raw};
    if(knowledge?.prior?.expectedMinutes!=null)p.priorExpectedMinutes=knowledge.prior.expectedMinutes;
    const weeks={},projectionDetail={};let total=0;
    for(let gw=currentGW+1;gw<=currentGW+horizon;gw++){
      const fs=teamFix.get(`${p.teamId}:${gw}`)||[];const ds=fs.map(f=>projectPlayerGW(p,f,{seasonGames:games}));
      const xp=ds.reduce((s,d)=>s+d.expected,0);weeks[gw]=xp;projectionDetail[gw]={expected:xp,uncertainty:Math.sqrt(ds.reduce((s,d)=>s+d.uncertainty**2,0)),fixtures:ds};total+=xp;
    }
    return {...p,projections:weeks,projectionDetail,projectedPoints:total};
  });
}
