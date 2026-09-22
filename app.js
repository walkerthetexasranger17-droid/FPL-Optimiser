import {FPLClient} from './src/data/fpl-client.js';
import {normaliseBootstrap,normaliseFixtures} from './src/data/normalise.js';
import {buildProjections} from './src/engine/projection.js';
import {weeklyPlan} from './src/engine/transfer-planner.js';
import {tripleCaptainWindows,benchBoostWindows,chipWindowEnd} from './src/engine/chips.js';
import {season2026_27} from './src/state/season-config.js';
import {importManagerState} from './src/state/manager-import.js';
import {LiveKnowledgeClient,ScopedResearchClient,applyV8KnowledgeRows} from './src/knowledge/v8-live.js';
import {buildDecisionMaterialResearchPlan} from './src/research/decision-gate.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const API_ORIGIN='https://fpl-optimiser-api.walkerthetexasranger17.workers.dev';
const client=new FPLClient({base:`${API_ORIGIN}/api/fpl`});
const knowledgeClient=new LiveKnowledgeClient({base:`${API_ORIGIN}/api/knowledge`});
const RESEARCH_KEY_STORAGE='fpl-optimiser.research-session.v1';
const ENTRY_STORAGE='fpl-optimiser.entry-id.v1';
const MAX_RESEARCH_PASSES=2;
let data=null,manager=null,lastPlan=null,lastResearch=null,busy=false;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMoney=t=>`£${(Number(t||0)/10).toFixed(1)}m`;
const seasonKey=()=> '2026-27';
const researchKey=()=> (localStorage.getItem(RESEARCH_KEY_STORAGE)||'').trim();
const scopedResearchClient=()=>researchKey()?new ScopedResearchClient({base:`${API_ORIGIN}/api`,token:researchKey()}):null;
const nextGW=()=>Number(data?.currentGW||0)+1;

function showToast(message,error=false){const t=$('#toast');t.textContent=message;t.className=`toast${error?' error':''}`;setTimeout(()=>t.classList.add('hidden'),3500);t.classList.remove('hidden');}
function setTech(message){$('#technical-status').textContent=message;}
function setConnection(text,show=true){const b=$('#connection-banner');b.textContent=text;b.classList.toggle('hidden',!show);}
function setView(name){$$('.view').forEach(v=>v.classList.toggle('hidden',v.dataset.view!==name));$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));if(name!=='home'&&!manager){showToast('Connect your FPL team first');setView('home');}}
function showApp(){ $('#onboarding').classList.add('hidden'); $('#home-view').classList.remove('hidden'); setView('home'); }
function showOnboarding(){ $('#onboarding').classList.remove('hidden'); $$('.view').forEach(v=>v.classList.add('hidden')); }
function setBusy(on,title='Analysing your team…',copy='Checking the latest player data and your best options.'){
 busy=on;$('#optimise').disabled=on;$('#analysis-progress').classList.toggle('hidden',!on);$('#analysis-title').textContent=title;$('#analysis-copy').textContent=copy;
}
function setResearchStatus(text){$('#research-status').textContent=text;}
function squadValueTenths(){return (manager?.squad||[]).reduce((s,p)=>s+Number(p.priceTenths||0),0);}
function chipsReadyText(){if(!manager)return '—';const c=manager.chipAvailability||{};return ['WC','FH','BB','TC'].filter((_,i)=>[c.wildcard,c.freeHit,c.benchBoost,c.tripleCaptain][i]).length+'/4 ready';}
function chipBadges(){if(!manager)return '';const c=manager.chipAvailability||{};return [['WC',c.wildcard],['FH',c.freeHit],['BB',c.benchBoost],['TC',c.tripleCaptain]].map(([n,a])=>`<span class="chip ${a?'available':''}">${n} ${a?'READY':'USED'}</span>`).join('');}
function updateSummary(){if(!manager)return;$('#summary-ft').textContent=manager.freeTransfers;$('#summary-bank').textContent=fmtMoney(manager.bankTenths);$('#summary-value').textContent=fmtMoney(squadValueTenths());$('#summary-chips').textContent=chipsReadyText();$('#chip-badges').innerHTML=chipBadges();$('#team-heading').textContent=`${manager.teamName||'My Team'} • GW${nextGW()}`;$('#hero-kicker').textContent=`GAMEWEEK ${nextGW()} PLAN`;$('#hero-title').textContent=`Make ${manager.teamName||'your team'} stronger.`;$('#hero-copy').textContent=`${manager.freeTransfers} free transfer${manager.freeTransfers===1?'':'s'}, ${fmtMoney(manager.bankTenths)} in the bank. One tap checks the best move for the next five gameweeks.`;}
function rebuildResearchPlan(){data.researchPlan=buildDecisionMaterialResearchPlan(manager,data.players,data.currentGW,{horizon:5,clubLimit:season2026_27.clubLimit,maxResearch:6});return data.researchPlan;}
function rebindManagerSquad(){const byId=new Map(data.players.map(p=>[p.id,p]));manager.squad=manager.squad.map(old=>{const fresh=byId.get(old.id)||old;return {...fresh,purchasePriceTenths:old.purchasePriceTenths,sellingPriceTenths:old.sellingPriceTenths};});}

async function loadLiveData({quiet=false}={}){
 try{
  if(!quiet)setConnection('Updating live FPL data…',true);
  const [b,f]=await Promise.all([client.bootstrap(),client.fixtures()]);
  const n=normaliseBootstrap(b);const current=n.events.find(e=>e.isCurrent)?.id||n.events.filter(e=>e.finished).at(-1)?.id||1;
  data={...n,fixtures:normaliseFixtures(f,n.teams),currentGW:current};
  let rows=[];try{rows=await knowledgeClient.recent();}catch{}
  const merged=applyV8KnowledgeRows(data.players,rows);data.players=buildProjections(merged.players,data.fixtures,current,5);data.liveKnowledge={applied:merged.applied,stale:merged.stale};
  setConnection('',false);setTech(`Live FPL connected • GW${current} • ${merged.applied} fresh player intelligence rows`);
  return true;
 }catch(e){setConnection('Could not refresh live FPL data. Check your connection and try again.',true);setTech(e.message);return false;}
}

async function deriveTeamFromSavedResearch(){const rc=scopedResearchClient();if(!rc)return null;try{const info=await rc.status();setResearchStatus(`Connected • ${info.jobsRemaining} checks remaining`);localStorage.setItem(ENTRY_STORAGE,String(info.teamId));return String(info.teamId);}catch(e){setResearchStatus('Connection needs attention');return null;}}

async function importTeam(id,{quiet=false}={}){
 if(!data||!id)return false;
 try{
  if(!quiet)setConnection('Syncing your FPL squad…',true);
  manager=await importManagerState({client,players:data.players,entryId:id,currentGW:data.currentGW,maxFreeTransfers:season2026_27.maxFreeTransfers??5});
  localStorage.setItem(ENTRY_STORAGE,String(id));$('#entry').value=String(id);$('#settings-entry').value=String(id);rebuildResearchPlan();updateSummary();renderSquad();renderIdlePlanner();showApp();
  setConnection('',false);setTech(`Connected to ${manager.teamName} • 15-player squad synced`);
  return true;
 }catch(e){if(!quiet)showToast('Team import failed: '+e.message,true);setConnection('',false);return false;}
}

function playerPitchChip(p,lineup,gw){const cap=p.id===lineup.captain?.id,vice=p.id===lineup.viceCaptain?.id;const x=Number(p.projections?.[gw]||0);return `<div class="player-chip" title="${esc(p.team)}"><div class="shirt ${cap?'captain':vice?'vice':''}"></div><div class="player-tag"><strong>${esc(p.name)}</strong><span>${x.toFixed(1)} pts</span></div></div>`;}
function renderPitch(lineup,gw){const by={GK:[],DEF:[],MID:[],FWD:[]};lineup.xi.forEach(p=>by[p.position].push(p));$('#pitch').innerHTML=['GK','DEF','MID','FWD'].map(pos=>`<div class="pitch-row">${by[pos].map(p=>playerPitchChip(p,lineup,gw)).join('')}</div>`).join('');const bench=[lineup.benchGK,...lineup.bench].filter(Boolean);$('#bench').innerHTML=bench.map((p,i)=>`<div class="bench-player"><strong>${i+1}. ${esc(p.name)}</strong><span>${esc(p.position)} • ${(Number(p.projections?.[gw]||0)).toFixed(1)} pts</span></div>`).join('');}
function renderSquad(){if(!manager)return;const gw=nextGW();const order={GK:1,DEF:2,MID:3,FWD:4};const rows=[...manager.squad].sort((a,b)=>order[a.position]-order[b.position]||(b.projections?.[gw]||0)-(a.projections?.[gw]||0));$('#squad-list').innerHTML=rows.map(p=>`<article class="player-card"><div class="player-card-head"><span class="position-badge">${p.position}</span><strong>${(Number(p.projections?.[gw]||0)).toFixed(1)} pts</strong></div><h3>${esc(p.name)}</h3><div class="club">${esc(p.team)}</div><div class="player-card-stats"><div class="player-stat"><span>Price</span><strong>${fmtMoney(p.priceTenths)}</strong></div><div class="player-stat"><span>Sell</span><strong>${fmtMoney(p.sellingPriceTenths)}</strong></div><div class="player-stat"><span>Form</span><strong>${Number(p.form||0).toFixed(1)}</strong></div></div></article>`).join('');}
function renderIdlePlanner(){if(!data)return;const gws=Array.from({length:5},(_,i)=>nextGW()+i);$('#planner-list').innerHTML=gws.map(gw=>`<article class="gw-card"><span>GAMEWEEK</span><strong>GW${gw}</strong><div class="gw-captain">Run optimiser for plan</div></article>`).join('');}
function renderPlanner(plan){const gws=plan.gws||[];$('#planner-list').innerHTML=gws.map(gw=>{const l=(manager?.squad?.length)?weeklyPlan(manager,data.players,gw,1).lineup:null;return `<article class="gw-card"><span>GAMEWEEK</span><strong>GW${gw}</strong><div class="gw-captain">${l?`Captain: ${esc(l.captain.name)}<br>${(l.value+(l.captain.projections?.[gw]||0)).toFixed(1)} projected pts`:'—'}</div></article>`;}).join('');}
function renderTransferDetail(plan,gateClear){const bp=plan?.bestPlan;if(!gateClear){$('#transfer-detail').innerHTML='<span class="section-label">ANALYSIS IN PROGRESS</span><h2>Transfer advice is being held back.</h2><p class="muted">The app still needs to verify a few players that could change the answer. It will not show a confident transfer just to fill the screen.</p>';return;}if(plan.action==='roll'||!bp?.moves?.length){$('#transfer-detail').innerHTML=`<span class="section-label">BEST MOVE</span><h2>Roll the transfer</h2><p class="muted">Keep your squad and carry the free transfer forward. You would have ${plan.nextFreeTransfers} FT next gameweek.</p>`;return;}$('#transfer-detail').innerHTML=`<span class="section-label">BEST MOVE</span><h2>${bp.moves.length} transfer${bp.moves.length===1?'':'s'}</h2>${bp.moves.map(m=>`<div class="transfer-detail-row"><div><strong>Sell ${esc(m.out.name)}</strong><div class="muted">${esc(m.out.team)} • ${fmtMoney(m.out.sellingPriceTenths??m.out.priceTenths)}</div></div><div>→</div><div style="text-align:right"><strong>Buy ${esc(m.in.name)}</strong><div class="muted">${esc(m.in.team)} • ${fmtMoney(m.in.priceTenths)}</div></div></div>`).join('')}<p class="muted">Projected 5-GW improvement: ${bp.netGain.toFixed(1)} points ${bp.hit?`after a -${bp.hit} hit`:'with no hit'}.</p>`;}

function renderDecision({gateClear}){
 const gw=nextGW();const plan=weeklyPlan(manager,data.players,gw,5);lastPlan=plan;const end=chipWindowEnd(data.currentGW,season2026_27);const tc=tripleCaptainWindows(manager.squad,gw,Math.min(end,gw+4))[0];const bb=benchBoostWindows(manager.squad,gw,Math.min(end,gw+4))[0];const l=plan.lineup,bp=plan.bestPlan;
 const panel=$('#decision-panel');panel.classList.remove('empty-state','final','incomplete');panel.classList.add(gateClear?'final':'incomplete');
 if(!gateClear){$('#decision-badge').textContent='STILL CHECKING';$('#decision-title').textContent='A few player checks could still change the answer.';$('#decision-copy').textContent='I’m holding back the transfer recommendation rather than showing you something that may be wrong. Tap Optimise again to continue the remaining checks.';$('#gain-value').textContent='—';$('#gain-label').textContent='not final yet';$('#transfer-list').innerHTML='';}
 else if(plan.action==='roll'||!bp?.moves?.length){$('#decision-badge').textContent='FINAL';$('#decision-title').textContent='Roll your transfer';$('#decision-copy').textContent=`Your current squad is strong enough to hold. Keep the ${manager.freeTransfers} FT and move into GW${gw+1} with ${plan.nextFreeTransfers}.`;$('#gain-value').textContent=`${plan.nextFreeTransfers} FT`;$('#gain-label').textContent='next gameweek';$('#transfer-list').innerHTML='';}
 else {$('#decision-badge').textContent='FINAL';$('#decision-title').textContent=bp.moves.length===1?'Make 1 transfer':`Make ${bp.moves.length} transfers`;$('#decision-copy').textContent=`Best projected move across the next five gameweeks${bp.hit?` including a -${bp.hit} hit`:''}.`;$('#gain-value').textContent=`+${bp.netGain.toFixed(1)}`;$('#gain-label').textContent='projected 5-GW pts';$('#transfer-list').innerHTML=bp.moves.map(m=>`<div class="transfer-row"><div class="transfer-player"><strong>${esc(m.out.name)}</strong><span>SELL • ${fmtMoney(m.out.sellingPriceTenths??m.out.priceTenths)}</span></div><div class="transfer-arrow">→</div><div class="transfer-player in"><strong>${esc(m.in.name)}</strong><span>BUY • ${fmtMoney(m.in.priceTenths)}</span></div></div>`).join('');}
 $('#captain-status').textContent=`GW${gw}`;$('#captain-name').textContent=l.captain.name;$('#captain-points').textContent=`${Number(l.captain.projections?.[gw]||0).toFixed(1)} projected points before captain double`;$('#vice-name').textContent=l.viceCaptain.name;$('#lineup-title').textContent=`${l.formation} for GW${gw}`;$('#lineup-total').textContent=`${(l.value+(l.captain.projections?.[gw]||0)).toFixed(1)} pts`;renderPitch(l,gw);
 $('#chip-title').textContent=tc?.gw?`Triple Captain: GW${tc.gw}`:'No immediate chip push';$('#chip-copy').textContent=bb?.gw?`Bench Boost currently peaks in GW${bb.gw}. Keep reviewing as fixtures and availability change.`:'Chip timing updates automatically.';renderTransferDetail(plan,gateClear);renderPlanner(plan);renderSquad();
 return plan;
}

async function runResearchPass(plan){const rc=scopedResearchClient();if(!rc)throw new Error('Player intelligence connection is not set up on this browser');const result=await rc.execute({teamId:manager.entryId,season:seasonKey(),tasks:plan.tasks});const merged=applyV8KnowledgeRows(data.players,result.refreshed||[]);data.players=buildProjections(merged.players,data.fixtures,data.currentGW,5);rebindManagerSquad();lastResearch=result;return result;}

async function optimiseTeam(){if(busy)return;if(!data||!manager){showToast('Connect your FPL team first',true);return;}setBusy(true);try{
 let gate=rebuildResearchPlan();let pass=0;
 while(gate.tasks.length&&pass<MAX_RESEARCH_PASSES){pass++;setBusy(true,pass===1?'Checking the players that can change your decision…':'Finishing the last important player checks…',`Pass ${pass} of ${MAX_RESEARCH_PASSES}. Only players that can materially affect your team are checked.`);await runResearchPass(gate);gate=rebuildResearchPlan();}
 const clear=gate.tasks.length===0;renderDecision({gateClear:clear});if(clear)showToast('Your gameweek plan is ready');else showToast(`${gate.tasks.length} important player checks remain — recommendation held back`,false);
 }catch(e){const gate=rebuildResearchPlan();renderDecision({gateClear:gate.tasks.length===0});showToast(e.message,true);setTech('Optimisation issue: '+e.message);}finally{setBusy(false);}}

async function saveResearch(){const token=$('#research-session').value.trim();if(!token){showToast('Paste the research access key first',true);return;}try{const info=await new ScopedResearchClient({base:`${API_ORIGIN}/api`,token,timeoutMs:10000}).status();localStorage.setItem(RESEARCH_KEY_STORAGE,token);localStorage.setItem(ENTRY_STORAGE,String(info.teamId));setResearchStatus(`Connected • ${info.jobsRemaining} checks remaining`);$('#research-session').value='';showToast('Player research connected');if(!manager)await importTeam(info.teamId,{quiet:true});}catch(e){showToast('Could not save research access: '+e.message,true);}}
function clearResearch(){localStorage.removeItem(RESEARCH_KEY_STORAGE);$('#research-session').value='';setResearchStatus('Not connected');showToast('Research connection cleared');}
function openSettings(){const token=researchKey();$('#settings-entry').value=localStorage.getItem(ENTRY_STORAGE)||manager?.entryId||'';$('#research-session').value='';setResearchStatus(token?'Connected on this browser':'Not connected');$('#settings-drawer').classList.add('open');$('#settings-drawer').setAttribute('aria-hidden','false');$('#settings-backdrop').classList.remove('hidden');}
function closeSettings(){$('#settings-drawer').classList.remove('open');$('#settings-drawer').setAttribute('aria-hidden','true');$('#settings-backdrop').classList.add('hidden');}

async function bootstrapApp(){const ok=await loadLiveData();if(!ok){showOnboarding();return;}let id=localStorage.getItem(ENTRY_STORAGE);if(!id&&researchKey())id=await deriveTeamFromSavedResearch();else if(researchKey())deriveTeamFromSavedResearch();if(id){const imported=await importTeam(id,{quiet:true});if(!imported)showOnboarding();}else showOnboarding();}

$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.tab)));
$('#import').onclick=()=>importTeam($('#entry').value.trim());
$('#settings-import').onclick=async()=>{const id=$('#settings-entry').value.trim();if(await importTeam(id)){closeSettings();showToast('Team reconnected');}};
$('#optimise').onclick=optimiseTeam;
$('#settings-open').onclick=openSettings;$('#settings-close').onclick=closeSettings;$('#settings-backdrop').onclick=closeSettings;
$('#save-research').onclick=saveResearch;$('#clear-research').onclick=clearResearch;
$('#refresh-data').onclick=async()=>{if(await loadLiveData()){if(manager)await importTeam(manager.entryId,{quiet:true});showToast('Live data refreshed');}};
$('#gw1-mode').onclick=()=>showToast('New-season squad builder is the next dedicated mode being added.');

bootstrapApp();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
