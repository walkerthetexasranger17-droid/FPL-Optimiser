import {FPLClient} from './modules.v0270/data/fpl-client.js';
import {normaliseBootstrap,normaliseFixtures} from './modules.v0270/data/normalise.js';
import {buildProjections} from './modules.v0270/engine/projection.js';
import {weeklyAdvisor,sensibleLineup} from './modules.v0270/engine/weekly-advisor.js';
import {optimiseLineup} from './modules.v0270/engine/lineup.js';
import {optimiseSquad} from './modules.v0270/engine/squad-optimiser.js';
import {tripleCaptainWindows,benchBoostWindows,chipWindowEnd} from './modules.v0270/engine/chips.js';
import {season2026_27} from './modules.v0270/state/season-config.js';
import {importManagerState} from './modules.v0270/state/manager-import.js';
import {ScopedResearchClient} from './modules.v0270/knowledge/v8-live.js';
import {horizonScore} from './modules.v0270/research/decision-gate.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const API_ORIGIN='https://fpl-optimiser-api.walkerthetexasranger17.workers.dev';
const client=new FPLClient({base:`${API_ORIGIN}/api/fpl`});
const RESEARCH_KEY_STORAGE='fpl-optimiser.research-session.v1';
const ENTRY_STORAGE='fpl-optimiser.entry-id.v1';
let data=null,manager=null,lastPlan=null,busy=false,displayGW=null,playerFilter='ALL',builderMode='balanced',activeView='dashboard',fixtureIndex=new Map();

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMoney=t=>`£${(Number(t||0)/10).toFixed(1)}m`;
const fmtRank=n=>Number(n)>0?new Intl.NumberFormat('en-GB').format(Number(n)):'—';
const fmtPts=n=>Number.isFinite(Number(n))?Number(n).toFixed(1):'—';
const seasonKey=()=> '2026-27';
const researchKey=()=> (localStorage.getItem(RESEARCH_KEY_STORAGE)||'').trim();
const scopedResearchClient=()=>researchKey()?new ScopedResearchClient({base:`${API_ORIGIN}/api`,token:researchKey()}):null;
const nextGW=()=>Number(data?.currentGW||0)+1;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

const CLUB_THEME={
 'Arsenal':['#e30613','#ffffff'],'Aston Villa':['#7a263a','#95bfe5'],'Bournemouth':['#d71920','#111111'],'Brentford':['linear-gradient(90deg,#e30613 0 46%,#fff 46% 56%,#e30613 56%)','#111'],
 'Brighton':['linear-gradient(90deg,#0057b8 0 34%,#fff 34% 66%,#0057b8 66%)','#fff'],'Chelsea':['#034694','#fff'],'Crystal Palace':['linear-gradient(90deg,#1b458f 0 50%,#c4122e 50%)','#fff'],
 'Everton':['#003399','#fff'],'Fulham':['#f5f5f5','#111'],'Hull City':['linear-gradient(90deg,#f28c00 0 50%,#111 50%)','#fff'],'Ipswich Town':['#0054a6','#fff'],'Leeds':['#f5f5f5','#1d428a'],
 'Liverpool':['#c8102e','#fff'],'Man City':['#6cabdd','#10253f'],'Man Utd':['#da291c','#fff'],'Newcastle':['linear-gradient(90deg,#111 0 34%,#fff 34% 66%,#111 66%)','#111'],
 "Nott'm Forest":['#dd0000','#fff'],'Sunderland':['linear-gradient(90deg,#eb172b 0 34%,#fff 34% 66%,#eb172b 66%)','#111'],'Spurs':['#f5f5f5','#132257'],'West Ham':['#7a263a','#1bb1e7'],
 'Wolves':['#fdb913','#231f20'],'Coventry City':['#7fc6e8','#183154']
};
function clubTheme(team){return CLUB_THEME[team]||['#6c2c7a','#fff'];}
function shirtStyle(team){const [shirt,trim]=clubTheme(team);return `--shirt:${shirt};--trim:${trim}`;}
function clubDotStyle(team){const [shirt]=clubTheme(team);return `--club:${shirt}`;}
function initials(name=''){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'FPL';}
function formatDeadline(iso){if(!iso)return 'Deadline TBC';const d=new Date(iso);return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}
function shortKickoff(iso){if(!iso)return 'TBC';const d=new Date(iso);return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}

function showToast(message,error=false){const t=$('#toast');t.textContent=message;t.className=`toast${error?' error':''}`;clearTimeout(showToast._t);showToast._t=setTimeout(()=>t.classList.add('hidden'),3600);t.classList.remove('hidden');}
function setTech(message){$('#technical-status').textContent=message;}
function setConnection(text,show=true){const b=$('#connection-banner');b.textContent=text;b.classList.toggle('hidden',!show);}
function setSync(text){$('#sync-text').textContent=text;$('#side-update').textContent=text;}
function setResearchStatus(text){$('#research-status').textContent=text;}
function showStartup(title='Syncing live FPL data…',copy='Getting your gameweek ready.'){const n=$('#startup-cinematic');if(!n)return;n.classList.remove('hidden');$('#startup-title').textContent=title;$('#startup-copy').textContent=copy;}
function hideStartup(){const n=$('#startup-cinematic');if(n)n.classList.add('hidden');}
function showApp(){ $('#onboarding').classList.add('hidden'); if(manager)setView('dashboard'); else setView('tools',{allowNoManager:true}); }
function showOnboarding(){ $('#onboarding').classList.remove('hidden'); $$('.view').forEach(v=>v.classList.add('hidden')); }
function setView(name,{allowNoManager=false}={}){
  activeView=name;
  const managerRequired=['dashboard','team','transfers','fixtures','stats'];
  if(!manager&&managerRequired.includes(name)&&!allowNoManager){showToast('Connect your FPL team first');showOnboarding();return;}
  $('#onboarding').classList.add('hidden');
  $$('.view').forEach(v=>v.classList.toggle('hidden',v.dataset.view!==name));
  $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='dashboard')renderDashboard();if(name==='team'){renderLineups();renderSquad();}if(name==='transfers'){renderTransferPage();renderTransferIdeas();}if(name==='players')renderPlayers();if(name==='fixtures')renderPlannerAndFixtures();if(name==='stats')renderStats();if(name==='tools')renderTools();
  const labels={dashboard:['Dashboard','Your FPL command centre'],team:['My Team','Best XI, bench and squad'],transfers:['Transfers','Recommendations and alternatives'],fixtures:['Fixtures','Plan the next five gameweeks'],players:['Players','Search, compare and scout'],stats:['Statistics','Your season at a glance'],tools:['Tools','Chips, GW1 builder and utilities']};
  const ctx=labels[name]||labels.dashboard; const t=$('#top-context-title'), sub=$('#top-context-sub'); if(t)t.textContent=ctx[0]; if(sub)sub.textContent=ctx[1];
  window.scrollTo({top:0,behavior:'smooth'});
}
function setBusy(on,title='Analysing your team…',copy='Checking live data and the few players that could change your decision.'){
  busy=on;$$('#optimise, .page-optimise').forEach(b=>b.disabled=on);
  const inline=$('#analysis-progress');if(inline){inline.classList.toggle('hidden',!on);$('#analysis-title').textContent=title;$('#analysis-copy').textContent=copy;}
  const dock=$('#optimiser-dock');if(dock){dock.classList.toggle('hidden',!on);$('#dock-title').textContent=title;$('#dock-copy').textContent=copy;}
}
function squadValueTenths(){return (manager?.squad||[]).reduce((s,p)=>s+Number(p.priceTenths||0),0);}
function rebindManagerSquad(){const byId=new Map(data.players.map(p=>[p.id,p]));manager.squad=manager.squad.map(old=>{const fresh=byId.get(old.id)||old;return {...fresh,purchasePriceTenths:old.purchasePriceTenths,sellingPriceTenths:old.sellingPriceTenths};});}

function buildFixtureIndex(){
  fixtureIndex=new Map();
  for(const f of data?.fixtures||[]){
    if(!f.gameweek)continue;
    fixtureIndex.set(`${f.homeTeamId}:${f.gameweek}`,f);
    fixtureIndex.set(`${f.awayTeamId}:${f.gameweek}`,f);
  }
}
async function loadLiveData({quiet=false}={}){
  try{
    if(!quiet)setConnection('Updating live Fantasy Premier League data…',true);
    const [b,f]=await Promise.all([client.bootstrap(),client.fixtures()]);
    const n=normaliseBootstrap(b);const current=n.events.find(e=>e.isCurrent)?.id||n.events.filter(e=>e.finished).at(-1)?.id||1;
    data={...n,fixtures:normaliseFixtures(f,n.teams),currentGW:current,liveKnowledge:{applied:0,stale:0}};displayGW=current+1;buildFixtureIndex();
    data.players=buildProjections(data.players,data.fixtures,current,Math.max(5,Math.min(14,19-current)));
    setConnection('',false);setSync(`GW${current} • Live data ready`);setTech(`Live FPL connected • GW${current} • weekly assistant v0.27 ready`);
    renderPublicData();
    return true;
  }catch(e){setConnection('Could not refresh live FPL data. Check your connection and try again.',true);setSync('Live data unavailable');setTech(e.message);return false;}
}

async function deriveTeamFromSavedResearch(){const rc=scopedResearchClient();if(!rc)return null;try{const info=await rc.status();setResearchStatus(`Connected • ${info.jobsRemaining} checks remaining`);localStorage.setItem(ENTRY_STORAGE,String(info.teamId));return String(info.teamId);}catch(e){setResearchStatus('Connection needs attention');return null;}}

async function importTeam(id,{quiet=false}={}){
  if(!data||!id)return false;
  try{
    if(!quiet)setConnection('Syncing your FPL squad…',true);
    manager=await importManagerState({client,players:data.players,entryId:id,currentGW:data.currentGW,maxFreeTransfers:season2026_27.maxFreeTransfers??5});
    localStorage.setItem(ENTRY_STORAGE,String(id));$('#entry').value=String(id);$('#settings-entry').value=String(id);displayGW=nextGW();
    lastPlan=null;showApp();renderDashboard();
    $('#side-team-dot').classList.add('live');$('#side-team-status').textContent='Team imported';setSync(`${manager.teamName} • live squad synced`);setTech(`Connected to ${manager.teamName} • 15-player squad synced`);setConnection('',false);
    return true;
  }catch(e){if(!quiet)showToast('Team import failed: '+e.message,true);setConnection('',false);return false;}
}

function eventFor(gw){return data?.events?.find(e=>Number(e.id)===Number(gw));}
function fixtureForPlayer(player,gw){return fixtureIndex.get(`${player.teamId}:${Number(gw)}`);}
function fixtureLabel(player,gw){const f=fixtureForPlayer(player,gw);if(!f)return '—';const home=f.homeTeamId===player.teamId;return `${home?f.awayShort:f.homeShort} (${home?'H':'A'})`;}
function fixtureDifficulty(player,gw){const f=fixtureForPlayer(player,gw);if(!f)return 3;return f.homeTeamId===player.teamId?Number(f.homeDifficulty||3):Number(f.awayDifficulty||3);}
function chipAvailability(){const c=manager?.chipAvailability||{};return [['WC','Wildcard',c.wildcard,'wc'],['FH','Free Hit',c.freeHit,'fh'],['BB','Bench Boost',c.benchBoost,'bb'],['TC','Triple Captain',c.tripleCaptain,'tc']];}

function renderPublicData(){if(!data)return;renderUpcomingFixtures();if(activeView==='players')renderPlayers();}
function renderManagerHeader(){if(!manager)return;$('#manager-team').textContent=manager.teamName||'My Team';$('#manager-name').textContent=manager.playerName||`Team ID ${manager.entryId}`;$('#metric-rank').textContent=fmtRank(manager.summaryOverallRank);$('#metric-total').textContent=fmtRank(manager.summaryOverallPoints);$('#metric-gwpoints').textContent=fmtRank(manager.summaryEventPoints);$('#metric-gw-label').textContent=`GW${data.currentGW}`;$('#metric-ft').textContent=manager.freeTransfers;$('#metric-bank').textContent=fmtMoney(manager.bankTenths);$('#avatar-button').textContent=initials(manager.playerName);$('#manager-shirt').querySelector('span').textContent=initials(manager.teamName).slice(0,3);}
function renderGameweekCard(){if(!manager||!data)return;const cur=eventFor(data.currentGW)||{};$('#gameweek-title').textContent=`Gameweek ${data.currentGW}`;$('#gw-score').textContent=manager.summaryEventPoints??'—';$('#gw-average').textContent=cur.averageScore||'—';$('#gw-highest').textContent=cur.highestScore||'—';$('#gw-rank').textContent=fmtRank(manager.summaryEventRank);const rows=(manager.historyCurrent||[]).slice(-8);const max=Math.max(1,...rows.map(r=>Number(r.points||0)));$('#history-chart').innerHTML=rows.map(r=>`<div class="history-bar-wrap"><div class="history-bar ${Number(r.event)===Number(data.currentGW)?'current':''}" style="height:${Math.max(10,Math.round((Number(r.points||0)/max)*76))}%"><span>${Number(r.points||0)}</span></div><small>GW${r.event}</small></div>`).join('');}
function renderChips(){if(!manager)return;$('#chip-grid').innerHTML=chipAvailability().map(([code,name,available,cls])=>`<div class="chip-pill ${cls} ${available?'available':''}" title="${esc(name)}">${code}<br><small>${available?'Available':'Used'}</small></div>`).join('');$('#tools-chips').innerHTML=chipAvailability().map(([code,name,available,cls])=>`<div class="chip-tool"><div class="chip-code ${cls}">${code}</div><strong>${name}</strong><span>${available?'Available this chip window':'Already used this chip window'}</span></div>`).join('');}

function playerShirt(p,extra=''){return `<div class="team-shirt ${extra}" style="${shirtStyle(p.team)}"><span>${esc(p.teamShort||p.team?.slice(0,3)||'FPL')}</span></div>`;}
function pitchPlayer(p,lineup,gw){const cap=p.id===lineup.captain?.id,vice=p.id===lineup.viceCaptain?.id;return `<div class="pitch-player">${playerShirt(p)}${cap?'<span class="armband">C</span>':vice?'<span class="armband vice">V</span>':''}<div class="player-tag"><strong>${esc(p.name)}</strong><span>${esc(fixtureLabel(p,gw))}</span><small>${fmtPts(p.projections?.[gw])} pts</small></div></div>`;}
function renderPitchTo(target,lineup,gw){const root=$(target);if(!root||!lineup){if(root)root.innerHTML='<div class="pitch-placeholder">No lineup available</div>';return;}const by={GK:[],DEF:[],MID:[],FWD:[]};lineup.xi.forEach(p=>by[p.position].push(p));root.innerHTML=['GK','DEF','MID','FWD'].map(pos=>`<div class="pitch-row">${by[pos].map(p=>pitchPlayer(p,lineup,gw)).join('')}</div>`).join('');}
function renderBenchTo(target,lineup,gw){const root=$(target);if(!root||!lineup)return;const bench=[lineup.benchGK,...lineup.bench].filter(Boolean);root.innerHTML=bench.map((p,i)=>`<div class="bench-player">${playerShirt(p,'tiny')}<strong>${esc(p.name)}</strong><span>${i===0?'GK':i} • ${fmtPts(p.projections?.[gw])} pts</span></div>`).join('');}
function lineupFor(gw){if(!manager)return null;return sensibleLineup(manager.squad,gw,{currentGW:data.currentGW});}
function renderLineups(){if(!manager)return;const gw=displayGW||nextGW();const lineup=lineupFor(gw);$('#gw-label').textContent=`GW${gw}`;renderPitchTo('#pitch',lineup,gw);renderBenchTo('#bench',lineup,gw);renderPitchTo('#team-page-pitch',lineup,gw);renderBenchTo('#team-page-bench',lineup,gw);$('#formation-value').textContent=lineup.formation||'—';$('#captain-name').textContent=lineup.captain?.name||'—';$('#captain-meta').textContent=lineup.captain?`${lineup.captain.team} • ${fixtureLabel(lineup.captain,gw)}`:'—';$('#captain-points').textContent=lineup.captain?`${fmtPts(lineup.captain.projections?.[gw])} pts`:'—';$('#vice-name').textContent=lineup.viceCaptain?.name||'—';$('#vice-meta').textContent=lineup.viceCaptain?`${lineup.viceCaptain.team} • ${fixtureLabel(lineup.viceCaptain,gw)}`:'—';$('#vice-points').textContent=lineup.viceCaptain?`${fmtPts(lineup.viceCaptain.projections?.[gw])} pts`:'—';$('#captain-orb').textContent=initials(lineup.captain?.name);$('#vice-orb').textContent=initials(lineup.viceCaptain?.name);$('#team-list-inline').innerHTML=lineup.xi.map(p=>`<div class="inline-player">${playerShirt(p,'tiny')}<div><strong>${esc(p.name)}</strong><small>${esc(p.position)} • ${esc(fixtureLabel(p,gw))}</small></div><b class="proj-value">${fmtPts(p.projections?.[gw])}</b></div>`).join('');}

function renderUpcomingFixtures(){if(!data)return;const gw=nextGW();const rows=data.fixtures.filter(f=>Number(f.gameweek)===gw).slice(0,6);$('#upcoming-fixtures').innerHTML=rows.length?rows.map(f=>`<div class="fixture-row"><div class="fixture-team"><span class="club-dot" style="${clubDotStyle(f.homeTeam)}"></span>${esc(f.homeShort)}</div><span class="fixture-vs">VS</span><div class="fixture-team away">${esc(f.awayShort)}<span class="club-dot" style="${clubDotStyle(f.awayTeam)}"></span></div><span class="fixture-time">${esc(shortKickoff(f.kickoff))}</span></div>`).join(''):'<div class="empty-compact">Fixtures not available yet.</div>';}
function renderNextChecks(){if(!manager)return;const flagged=manager.squad.filter(p=>['d','i','u','s'].includes(String(p.status||'').toLowerCase())||(p.chanceNext!=null&&Number(p.chanceNext)<100));const movers=manager.squad.filter(p=>Math.abs(Number(p.costChangeEvent||0))>0);const rows=[];if(flagged.length)rows.push({t:`Monitor ${flagged.slice(0,2).map(p=>p.name).join(' & ')} availability`,c:'warn'});if(movers.length)rows.push({t:'Review price changes before the deadline',c:'warn'});rows.push({t:`Review GW${nextGW()+1} fixture swing`,c:''});$('#next-checks').innerHTML=rows.slice(0,4).map(r=>`<div class="check-row"><span class="check-bullet ${r.c}"></span><span>${esc(r.t)}</span></div>`).join('');}

function renderSquad(){if(!manager)return;const gw=displayGW||nextGW();const order={GK:1,DEF:2,MID:3,FWD:4};const rows=[...manager.squad].sort((a,b)=>order[a.position]-order[b.position]||(b.projections?.[gw]||0)-(a.projections?.[gw]||0));$('#squad-overview-count').textContent=`${rows.length} players`;$('#squad-list').innerHTML=rows.map(p=>`<div class="squad-row"><span class="position-badge">${p.position}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.team)} • ${esc(fixtureLabel(p,gw))}</small></div><span class="price">${fmtMoney(p.sellingPriceTenths??p.priceTenths)}</span><span class="proj">${fmtPts(p.projections?.[gw])} pts</span></div>`).join('');}

function moveMarkup(m){return `<div class="recommendation-row"><div class="recommendation-player">${playerShirt(m.out,'tiny')}<div><strong>${esc(m.out.name)}</strong><small>${esc(m.out.team)} • OUT</small></div></div><div class="move-arrow">→</div><div class="recommendation-player">${playerShirt(m.in,'tiny')}<div><strong>${esc(m.in.name)}</strong><small>${esc(m.in.team)} • IN</small></div></div></div>`;}
function renderHomeRecommendation(){
  const root=$('#home-recommendations'),gain=$('#home-gain');
  gain.classList.add('hidden');
  if(!manager){root.innerHTML='<div class="empty-compact">Connect your team to begin.</div>';return;}
  if(!lastPlan){root.innerHTML='<div class="empty-compact"><b>Ready to analyse</b><br>Press Optimise Team for this week’s recommendation.</div>';return;}
  if(lastPlan.action==='roll'||!lastPlan.bestPlan?.moves?.length){
    root.innerHTML=`<div class="recommendation-row"><div class="recommendation-player"><div class="player-orb">✓</div><div><strong>Roll transfer</strong><small>${esc(lastPlan.reason||'No transfer clears the value threshold this week.')}</small></div></div><div></div><div class="recommendation-player"><div><strong>Keep flexibility</strong><small>Bank the free transfer for next week.</small></div></div></div>`;
    gain.innerHTML=`Projected strategy: <strong>${lastPlan.nextFreeTransfers||Math.min(5,manager.freeTransfers+1)} FT next gameweek</strong>`;
    gain.classList.remove('hidden');
    return;
  }
  root.innerHTML=lastPlan.bestPlan.moves.map(moveMarkup).join('')+`<div class="decision-reason">${esc(lastPlan.reason||'')}</div>`;
  gain.innerHTML=`Estimated edge <strong>+${lastPlan.bestPlan.nextGWGain.toFixed(1)} this GW</strong> • +${lastPlan.bestPlan.directGain.toFixed(1)} across the 5-GW player comparison${lastPlan.bestPlan.hit?` • -${lastPlan.bestPlan.hit} hit`:''}`;
  gain.classList.remove('hidden');
}
function renderTransferIdeas(){const root=$('#transfer-ideas');if(!lastPlan?.alternatives?.length){root.innerHTML='<div class="empty-compact">Alternatives appear after analysis.</div>';return;}const alts=lastPlan.alternatives.filter(p=>p?.moves?.length).slice(0,3);root.innerHTML=alts.length?alts.map(p=>{const m=p.moves[0];return `<div class="compact-row"><div class="player-orb">${initials(m.in.name)}</div><div><strong>${esc(m.in.name)}</strong><span>${esc(m.in.team)} • ${esc(m.in.position)} • for ${esc(m.out.name)}</span></div><b>+${p.netGain.toFixed(1)}</b></div>`;}).join(''):'<div class="empty-compact">No transfer alternative beats the current squad.</div>';}
function renderTransferPage(){if(!manager)return;const primary=$('#transfer-primary'),alts=$('#transfer-alternatives');$('#transfer-position').innerHTML=`<div class="detail-row"><span>Free transfers</span><strong>${manager.freeTransfers}</strong></div><div class="detail-row"><span>Bank</span><strong>${fmtMoney(manager.bankTenths)}</strong></div><div class="detail-row"><span>Squad value</span><strong>${fmtMoney(manager.currentValueTenths||squadValueTenths())}</strong></div><div class="detail-row"><span>Hit cost</span><strong>-4 pts per extra transfer</strong></div>`;if(!lastPlan){primary.innerHTML='<div class="eyebrow">READY</div><h2>Analyse this gameweek</h2><p class="empty-compact">Press Optimise Team for a simple roll / transfer / hit decision.</p>';alts.innerHTML='<div class="empty-compact">Alternatives appear after analysis.</div>';return;}if(lastPlan.action==='roll'||!lastPlan.bestPlan?.moves?.length){primary.innerHTML='<div class="eyebrow">BEST MOVE</div><h2>Roll your transfer</h2><p class="empty-compact">Keep the current squad and carry the free transfer forward.</p>';alts.innerHTML='<div class="empty-compact">No alternative transfer currently beats rolling.</div>';return;}const bp=lastPlan.bestPlan;primary.innerHTML=`<div class="eyebrow">TOP TRANSFER RECOMMENDATION</div><div class="transfer-main-grid">${bp.moves.slice(0,1).map(m=>`<div class="transfer-player-card">${playerShirt(m.out)}<strong>${esc(m.out.name)}</strong><span>${esc(m.out.team)} • ${fmtMoney(m.out.sellingPriceTenths??m.out.priceTenths)}</span></div><div class="transfer-arrow-big">→</div><div class="transfer-player-card">${playerShirt(m.in)}<strong>${esc(m.in.name)}</strong><span>${esc(m.in.team)} • ${fmtMoney(m.in.priceTenths)}</span></div>`).join('')}</div><div class="transfer-gain-line"><div class="gain-stat"><strong>+${bp.netGain.toFixed(1)}</strong><span>value vs hold / 5 GWs</span></div><div class="gain-stat"><strong>${bp.hit?`-${bp.hit}`:'0'}</strong><span>hit points</span></div></div>`;alts.innerHTML=lastPlan.alternatives.filter(p=>p.moves?.length).slice(1,5).map(p=>{const m=p.moves[0];return `<div class="transfer-alt"><div><strong>${esc(m.out.name)}</strong><small> OUT</small></div><span>→</span><div><strong>${esc(m.in.name)}</strong><small> IN</small></div><b class="proj-value">+${p.netGain.toFixed(1)}</b></div>`;}).join('')||'<div class="empty-compact">No close alternatives.</div>';}

function renderPlannerAndFixtures(){if(!data)return;const gws=Array.from({length:5},(_,i)=>nextGW()+i);$('#planner-range').textContent=`GW${gws[0]} – GW${gws.at(-1)}`;if(manager){const featured=[...manager.squad].sort((a,b)=>horizonScore(b,gws)-horizonScore(a,gws)).slice(0,8);$('#planner-table').innerHTML=`<div class="planner-grid"><div class="planner-cell head">Player</div>${gws.map(g=>`<div class="planner-cell head">GW${g}</div>`).join('')}${featured.map(p=>`<div class="planner-cell player">${esc(p.name)}</div>${gws.map(g=>`<div class="planner-cell">${esc(fixtureLabel(p,g))}<br><span class="fdr f${fixtureDifficulty(p,g)}">${fixtureDifficulty(p,g)}</span> <b>${fmtPts(p.projections?.[g])}</b></div>`).join('')}`).join('')}</div>`;const lines=gws.map(g=>{const l=lineupFor(g);return `<div class="long-term-card"><b>GW${g}</b> • ${l.formation} • Captain ${esc(l.captain?.name||'—')} • ${fmtPts(l.value+(l.captain?.projections?.[g]||0))} projected pts</div>`;}).join('');$('#long-term-view').innerHTML=`Your current squad is mapped across the next five gameweeks. Use fixture swings and transfer flexibility rather than chasing one-week scores.${lines}`;}else{$('#planner-table').innerHTML='<div class="empty-compact">Connect your team for personalised planning.</div>';$('#long-term-view').innerHTML='Connect a team to see your five-gameweek outlook.';}
 const rows=data.fixtures.filter(f=>gws.includes(Number(f.gameweek))).slice(0,30);$('#fixture-browser').innerHTML=rows.map(f=>`<div class="fixture-row"><div class="fixture-team"><span class="club-dot" style="${clubDotStyle(f.homeTeam)}"></span>${esc(f.homeShort)}</div><span class="fixture-vs">GW${f.gameweek}</span><div class="fixture-team away">${esc(f.awayShort)}<span class="club-dot" style="${clubDotStyle(f.awayTeam)}"></span></div><span class="fixture-time">${esc(shortKickoff(f.kickoff))}</span></div>`).join('');}

function renderPlayers(){if(!data)return;const gw=nextGW();const q=($('#player-search')?.value||'').trim().toLowerCase();const rows=[...data.players].filter(p=>(playerFilter==='ALL'||p.position===playerFilter)&&(!q||`${p.name} ${p.team}`.toLowerCase().includes(q))).sort((a,b)=>(b.projections?.[gw]||0)-(a.projections?.[gw]||0)).slice(0,140);$('#player-table').innerHTML=`<div class="player-table-head"><div>Player</div><div>Pos</div><div>Price</div><div>Form</div><div>Proj. GW${gw}</div><div>Owned</div></div>${rows.map(p=>`<div class="player-table-row"><div class="player-name-cell">${playerShirt(p,'tiny')}<div><strong>${esc(p.name)}</strong><small>${esc(p.team)}</small></div></div><div>${p.position}</div><div>${fmtMoney(p.priceTenths)}</div><div>${Number(p.form||0).toFixed(1)}</div><div class="proj-value">${fmtPts(p.projections?.[gw])}</div><div>${Number(p.selectedBy||0).toFixed(1)}%</div></div>`).join('')}`;}
function renderStats(){if(!manager)return;const value=manager.currentValueTenths||squadValueTenths();$('#stats-grid').innerHTML=[['Overall Rank',fmtRank(manager.summaryOverallRank)],['Total Points',fmtRank(manager.summaryOverallPoints)],['Team Value',fmtMoney(value)],['Transfers',fmtRank(manager.totalTransfers)],['Bank',fmtMoney(manager.bankTenths)]].map(([l,v])=>`<div class="stat-tile"><span>${l}</span><strong>${v}</strong></div>`).join('');const rows=manager.historyCurrent||[];$('#stats-history').innerHTML=`<div class="history-row header"><span>GW</span><span>Points</span><span>Total</span><span>Rank</span><span>Bank</span><span>Value</span></div>${rows.map(r=>`<div class="history-row"><strong>GW${r.event}</strong><span>${r.points}</span><span>${r.total_points}</span><span>${fmtRank(r.rank)}</span><span>${fmtMoney(r.bank)}</span><span>${fmtMoney(r.value)}</span></div>`).join('')}`;}
function renderTools(){renderChips();}
function renderDeadlineAndChecks(){const ev=eventFor(nextGW());const deadline=formatDeadline(ev?.deadline);$('#sync-text').textContent=manager?`GW${nextGW()} • Team imported • Live data ready`:`GW${data?.currentGW||'—'} • Live data ready`;renderNextChecks();const node=$('#long-term-view');if(node&&manager&&!node.innerHTML)node.innerHTML=`Next deadline: ${deadline}`;}

function renderAdvisorChipNote(){const node=$('#long-term-view');if(!node||!manager)return;if(!lastPlan?.chips?.length){node.innerHTML=`Next deadline: ${formatDeadline(eventFor(nextGW())?.deadline)}`;return;}const tc=lastPlan.chips.find(x=>x.chip==='Triple Captain');const wc=lastPlan.chips.find(x=>x.chip==='Wildcard');const parts=[];if(tc)parts.push(`<b>${esc(tc.chip)}:</b> ${esc(tc.action)}${tc.gw?` • GW${tc.gw}${tc.player?` ${esc(tc.player.name)}`:''}`:''}<br>${esc(tc.reason)}`);if(wc)parts.push(`<b>${esc(wc.chip)}:</b> ${esc(wc.action)}<br>${esc(wc.reason)}`);node.innerHTML=parts.join('<br><br>');}

function renderDashboard(){if(!data||!manager)return;renderManagerHeader();renderGameweekCard();renderChips();renderLineups();renderHomeRecommendation();renderTransferIdeas();renderUpcomingFixtures();renderNextChecks();renderAdvisorChipNote();}
function renderAll(){if(!data)return;renderPublicData();if(!manager)return;renderDashboard();if(activeView==='team')renderSquad();else if(activeView==='transfers')renderTransferPage();else if(activeView==='fixtures')renderPlannerAndFixtures();else if(activeView==='stats')renderStats();else if(activeView==='players')renderPlayers();else if(activeView==='tools')renderTools();}

const yieldToUI=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
async function calculateWeeklyAdvice(){
  return weeklyAdvisor(manager,data.players,nextGW(),{currentGW:data.currentGW,horizon:5,clubLimit:season2026_27.clubLimit,hitPoints:season2026_27.transferHitPoints,firstSetLastGW:season2026_27.chips.firstSetLastGameweek});
}
async function optimiseTeam(){
  if(busy)return;
  if(!data||!manager){showToast('Connect your FPL team first',true);return;}
  setBusy(true,'Analysing this gameweek…','Comparing hold, sensible free transfers, your best XI, captaincy and chip timing.');
  try{
    await yieldToUI();
    lastPlan=await calculateWeeklyAdvice();
    renderAll();
    setTech(`Weekly advisor ready • ${lastPlan.diagnostics.evaluatedSingles} single-transfer options checked`);
    showToast(lastPlan.action==='roll'?'Recommendation: roll the transfer':'Recommendation ready');
  }catch(e){
    showToast('Could not finish analysis: '+e.message,true);setTech('Weekly advisor issue: '+e.message);
  }finally{setBusy(false);}
}

async function saveResearch(){const token=$('#research-session').value.trim();if(!token){showToast('Paste the research access key first',true);return;}try{const info=await new ScopedResearchClient({base:`${API_ORIGIN}/api`,token,timeoutMs:10000}).status();localStorage.setItem(RESEARCH_KEY_STORAGE,token);localStorage.setItem(ENTRY_STORAGE,String(info.teamId));setResearchStatus(`Connected • ${info.jobsRemaining} checks remaining`);$('#research-session').value='';showToast('Player intelligence connected');if(!manager)await importTeam(info.teamId,{quiet:true});}catch(e){showToast('Could not connect player intelligence: '+e.message,true);}}
function clearResearch(){localStorage.removeItem(RESEARCH_KEY_STORAGE);$('#research-session').value='';setResearchStatus('Not connected');showToast('Player intelligence disconnected');}
function openSettings(){const token=researchKey();$('#settings-entry').value=localStorage.getItem(ENTRY_STORAGE)||manager?.entryId||'';$('#research-session').value='';setResearchStatus(token?'Connected on this browser':'Not connected');$('#settings-drawer').classList.add('open');$('#settings-drawer').setAttribute('aria-hidden','false');$('#settings-backdrop').classList.remove('hidden');}
function closeSettings(){$('#settings-drawer').classList.remove('open');$('#settings-drawer').setAttribute('aria-hidden','true');$('#settings-backdrop').classList.add('hidden');}

function buildNewSquad(){if(!data)return;const gws=Array.from({length:5},(_,i)=>nextGW()+i);const score=p=>{const h=horizonScore(p,gws);if(builderMode==='aggressive')return h+Number(p.form||0)*1.5+Number(p.xGI||0)*2;if(builderMode==='safe')return h+Math.min(90,Number(p.minutes||0)/Math.max(1,data.currentGW))*0.15+Number(p.selectedBy||0)*.08;return h;};try{const result=optimiseSquad(data.players,{budgetTenths:1000,clubLimit:season2026_27.clubLimit||3,score,maxPerPosition:50,beamWidth:15000});const lineup=optimiseLineup(result.players,p=>p.projections?.[nextGW()]||0);$('#builder-output').innerHTML=`<div class="builder-summary"><b>${fmtMoney(result.costTenths)}</b> spent • ${fmtMoney(1000-result.costTenths)} bank • Best XI ${fmtPts(lineup.value+(lineup.captain?.projections?.[nextGW()]||0))} projected GW${nextGW()} pts</div><div class="builder-list">${result.players.map(p=>`<div class="builder-player"><b>${esc(p.name)}</b><br>${p.position} • ${esc(p.teamShort)} • ${fmtMoney(p.priceTenths)}</div>`).join('')}</div>`;}catch(e){showToast('Could not build a legal squad: '+e.message,true);}}

async function bootstrapApp(){
  showStartup('Syncing live FPL data…','Loading prices, fixtures and the current gameweek. The app shell stays responsive while this runs.');
  const ok=await loadLiveData();
  if(!ok){hideStartup();showOnboarding();return;}
  let id=localStorage.getItem(ENTRY_STORAGE);
  if(!id&&researchKey())id=await deriveTeamFromSavedResearch();else if(researchKey())deriveTeamFromSavedResearch();
  if(id){showStartup('Rebuilding your FPL squad…','Restoring your 15 players, bank, free transfers and purchase prices.');const imported=await importTeam(id,{quiet:true});hideStartup();if(!imported)showOnboarding();}
  else{hideStartup();showOnboarding();}
}

$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.tab)));
$('#import').onclick=()=>importTeam($('#entry').value.trim());
$('#settings-import').onclick=async()=>{const id=$('#settings-entry').value.trim();if(await importTeam(id)){closeSettings();showToast('Team reconnected');}};
$('#optimise').onclick=optimiseTeam;$$('.page-optimise').forEach(b=>b.onclick=optimiseTeam);
$('#settings-open').onclick=openSettings;$('#avatar-button').onclick=openSettings;$('#settings-close').onclick=closeSettings;$('#settings-backdrop').onclick=closeSettings;
$('#save-research').onclick=saveResearch;$('#clear-research').onclick=clearResearch;
$('#refresh-data').onclick=async()=>{if(await loadLiveData()){if(manager)await importTeam(manager.entryId,{quiet:true});showToast('Live FPL data refreshed');}};
$('#gw1-mode').onclick=()=>{showApp();setView('tools',{allowNoManager:true});showToast('New-season squad builder opened');};
$('#gw-prev').onclick=()=>{if(!manager)return;displayGW=clamp((displayGW||nextGW())-1,nextGW(),nextGW()+4);renderLineups();};
$('#gw-next').onclick=()=>{if(!manager)return;displayGW=clamp((displayGW||nextGW())+1,nextGW(),nextGW()+4);renderLineups();};
$$('[data-team-view]').forEach(b=>b.onclick=()=>{const pitch=b.dataset.teamView==='pitch';$$('[data-team-view]').forEach(x=>x.classList.toggle('active',x===b));$('#pitch').classList.toggle('hidden',!pitch);$('#bench').classList.toggle('hidden',!pitch);$('#team-list-inline').classList.toggle('hidden',pitch);});
$('#player-search').addEventListener('input',renderPlayers);$$('#position-filters .filter').forEach(b=>b.onclick=()=>{playerFilter=b.dataset.pos;$$('#position-filters .filter').forEach(x=>x.classList.toggle('active',x===b));renderPlayers();});
$$('[data-builder-mode]').forEach(b=>b.onclick=()=>{builderMode=b.dataset.builderMode;$$('[data-builder-mode]').forEach(x=>x.classList.toggle('active',x===b));});$('#build-new-squad').onclick=buildNewSquad;

bootstrapApp();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js?v=0270').catch(()=>{});
