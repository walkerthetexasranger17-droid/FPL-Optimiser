import {FPLClient} from './src/data/fpl-client.js';
import {normaliseBootstrap,normaliseFixtures} from './src/data/normalise.js';
import {buildProjections} from './src/engine/projection.js';
import {weeklyPlan} from './src/engine/transfer-planner.js';
import {tripleCaptainWindows,benchBoostWindows,chipWindowEnd} from './src/engine/chips.js';
import {season2026_27} from './src/state/season-config.js';
import {importManagerState} from './src/state/manager-import.js';
import {LiveKnowledgeClient,ScopedResearchClient,applyV8KnowledgeRows} from './src/knowledge/v8-live.js';
import {buildDecisionMaterialResearchPlan} from './src/research/decision-gate.js';

const $=s=>document.querySelector(s);
const API_ORIGIN='https://fpl-optimiser-api.walkerthetexasranger17.workers.dev';
const client=new FPLClient({base:`${API_ORIGIN}/api/fpl`}),knowledgeClient=new LiveKnowledgeClient({base:`${API_ORIGIN}/api/knowledge`}),status=$('#status');
const RESEARCH_KEY_STORAGE='fpl-optimiser.research-session.v1';
let data=null,manager=null;
const card=(t,v,p='')=>`<article class="card"><h3>${t}</h3><div class="metric">${v}</div><p class="muted">${p}</p></article>`;

function researchKey(){return ($('#research-session')?.value||localStorage.getItem(RESEARCH_KEY_STORAGE)||'').trim();}
function scopedResearchClient(){const token=researchKey();return token?new ScopedResearchClient({base:`${API_ORIGIN}/api`,token}):null;}
function seasonKey(){return '2026-27';}
function rebuildResearchPlan(){data.researchPlan=buildDecisionMaterialResearchPlan(manager,data.players,data.currentGW,{horizon:5,clubLimit:season2026_27.clubLimit,maxResearch:6});return data.researchPlan;}
function rebindManagerSquad(){
 const byId=new Map(data.players.map(p=>[p.id,p]));
 manager.squad=manager.squad.map(old=>{const fresh=byId.get(old.id)||old;return {...fresh,purchasePriceTenths:old.purchasePriceTenths,sellingPriceTenths:old.sellingPriceTenths};});
}
function syncManagerInputs(){manager.freeTransfers=Math.max(0,Math.min(5,Number($('#ft').value)||0));manager.bankTenths=Math.round((Number($('#bank').value)||0)*10);}

async function load(){
 try{
  const stored=localStorage.getItem(RESEARCH_KEY_STORAGE)||'';if($('#research-session'))$('#research-session').value=stored;
  status.textContent='Updating live FPL data';
  const [b,f]=await Promise.all([client.bootstrap(),client.fixtures()]);
  const n=normaliseBootstrap(b);
  const current=n.events.find(e=>e.isCurrent)?.id||n.events.filter(e=>e.finished).at(-1)?.id||1;
  data={...n,fixtures:normaliseFixtures(f,n.teams),currentGW:current};
  let knowledgeRows=[];try{knowledgeRows=await knowledgeClient.recent();}catch{}
  const merged=applyV8KnowledgeRows(data.players,knowledgeRows);
  data.players=buildProjections(merged.players,data.fixtures,current,5);
  data.liveKnowledge={applied:merged.applied,stale:merged.stale};
  status.textContent=`GW${current} • Live data ready • ${merged.applied} fresh v8 knowledge rows applied`;
  $('#model').textContent=`${data.players.length} players loaded. Fresh v8 expected-minutes evidence is reused, current official FPL availability is reapplied, and only decision-material gaps are eligible for protected research.`;
 }catch(e){
  status.textContent='Data connection needed';
  $('#model').textContent=e.message+' — deploy the included serverless proxy or configure /api/fpl.';
 }
}

$('#save-research').onclick=async()=>{
 const token=$('#research-session').value.trim();
 if(!token){localStorage.removeItem(RESEARCH_KEY_STORAGE);status.textContent='Research access cleared';return;}
 try{
  status.textContent='Checking scoped research access';
  const info=await new ScopedResearchClient({base:`${API_ORIGIN}/api`,token,timeoutMs:10000}).status();
  const entry=$('#entry').value.trim();
  if(entry&&Number(entry)!==Number(info.teamId))throw new Error(`This key is bound to FPL Team ${info.teamId}`);
  localStorage.setItem(RESEARCH_KEY_STORAGE,token);
  status.textContent=`Research access ready • Team ${info.teamId} • ${info.jobsRemaining} scoped jobs remaining`;
 }catch(e){status.textContent='Research access not saved: '+e.message;}
};

$('#clear-research').onclick=()=>{localStorage.removeItem(RESEARCH_KEY_STORAGE);$('#research-session').value='';status.textContent='Research access cleared';};

$('#import').onclick=async()=>{
 if(!data)return;
 const id=$('#entry').value.trim();
 if(!id)return;
 try{
  status.textContent='Importing permanent squad, prices, bank, transfers and chips';
  manager=await importManagerState({client,players:data.players,entryId:id,currentGW:data.currentGW,maxFreeTransfers:season2026_27.maxFreeTransfers??5});
  $('#bank').value=(manager.bankTenths/10).toFixed(1);
  $('#ft').value=manager.freeTransfers;
  const warning=manager.warnings.length?` • ${manager.warnings.join(' ')}`:'';
  const gate=rebuildResearchPlan();
  const gateText=gate.tasks.length?` • ${gate.tasks.length} decision-material research gap${gate.tasks.length===1?'':'s'}`:' • research gate clear';
  status.textContent=`Imported ${manager.teamName||'team'} • ${manager.squad.length} players • ${manager.freeTransfers} FT • £${(manager.bankTenths/10).toFixed(1)}m bank${gateText}${warning}`;
 }catch(e){status.textContent='Import failed: '+e.message;}
};

function renderRecommendation(){
 const next=data.currentGW+1;
 const plan=weeklyPlan(manager,data.players,next,5);
 const end=chipWindowEnd(data.currentGW,season2026_27);
 const tc=tripleCaptainWindows(manager.squad,next,Math.min(end,next+4))[0];
 const bb=benchBoostWindows(manager.squad,next,Math.min(end,next+4))[0];
 const l=plan.lineup,bp=plan.bestPlan;
 const moveText=bp?.moves?.map(m=>`${m.out.name} → ${m.in.name}`).join('<br>')||'ROLL TRANSFER';
 const gate=data.researchPlan;
 const gateCard=gate.tasks.length
  ?card('Research gate',`${gate.tasks.length} material refresh${gate.tasks.length===1?'':'es'} still needed`,`${gate.tasks.map(t=>t.name).join(', ')}. Recommendation remains PRELIMINARY.`)
  :card('Research gate','CLEAR','Decision-material v8 evidence is fresh. Established healthy players with enough current FPL evidence were not researched again.');
 $('#result').innerHTML=gateCard
  +card(gate.tasks.length?'Preliminary action':'Recommended action',plan.action==='roll'?'ROLL TRANSFER':moveText,plan.action==='roll'?`${manager.freeTransfers} FT → ${plan.nextFreeTransfers} FT`:`Projected net 5-GW gain ${bp.netGain.toFixed(1)} pts • ${bp.hit?'-'+bp.hit+' hit':'no hit'}`)
  +card('Captain',l.captain.name,`${(l.captain.projections[next]||0).toFixed(1)} projected points • Vice: ${l.viceCaptain.name}`)
  +card('Starting XI',l.formation,`${l.value.toFixed(1)} projected GW${next} points before captain multiplier`)
  +card('Chip watch',`TC GW${tc?.gw||'—'}`,`Current 5-GW scan • BB best GW${bb?.gw||'—'}. Chip planner recalculates every refresh.`);
 status.textContent=gate.tasks.length
  ?`Preliminary decision • ${gate.tasks.length} decision-material player${gate.tasks.length===1?'':'s'} still require protected v8 refresh`
  :'Final decision inputs ready • research gate clear';
}

async function refreshDecisionMaterialResearch(){
 const gate=data.researchPlan;
 if(!gate?.tasks?.length)return null;
 const rc=scopedResearchClient();
 if(!rc)throw new Error('Add the scoped Research Access Key once, then Optimise becomes one-click research + finalise');
 status.textContent=`Refreshing ${gate.tasks.length} decision-material player${gate.tasks.length===1?'':'s'} securely`;
 const result=await rc.execute({teamId:manager.entryId,season:seasonKey(),tasks:gate.tasks});
 const merged=applyV8KnowledgeRows(data.players,result.refreshed||[]);
 data.players=buildProjections(merged.players,data.fixtures,data.currentGW,5);
 rebindManagerSquad();
 rebuildResearchPlan();
 return result;
}

$('#optimise').onclick=async()=>{
 if(!data||!manager){status.textContent='Import your team first';return;}
 syncManagerInputs();
 rebuildResearchPlan();
 if(data.researchPlan.tasks.length){
  try{await refreshDecisionMaterialResearch();}
  catch(e){renderRecommendation();status.textContent='Preliminary only • '+e.message;return;}
 }
 renderRecommendation();
};

load();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
