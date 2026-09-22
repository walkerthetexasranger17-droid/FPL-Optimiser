const num=(v,f=null)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function workerSeason(season='2026-27'){
  return String(season).replace(/-/g,'/');
}

export function normaliseV8KnowledgeRow(row,{now=new Date(),maxMinutesAgeHours=72}={}){
  if(!row)return null;
  const payload=row.payload||row;
  const projection=payload.projection||{};
  const snap=payload.currentFplSnapshot||{};
  const availability=snap.availability||{};
  const playerId=num(row.canonicalPlayerId ?? row.player_id ?? payload.fplPlayerId);
  if(!Number.isInteger(playerId))return null;
  const updatedAt=row.updated_at||payload.updated_at||payload.researchedAt||null;
  const ageHours=updatedAt?Math.max(0,(new Date(now).getTime()-new Date(updatedAt).getTime())/36e5):Infinity;
  const storedExpected=num(projection.expectedMinutes);
  const storedChance=num(projection.chanceOfPlayingNextRound ?? availability.chanceOfPlayingNextRound,100);
  const oldAvailability=clamp(storedChance/100,0,1);
  let baseExpectedMinutes=storedExpected;
  if(storedExpected!=null && oldAvailability>0 && oldAvailability<1)baseExpectedMinutes=storedExpected/oldAvailability;
  const freshMinutes=storedExpected!=null && ageHours<=maxMinutesAgeHours;
  return {
    playerId,
    updatedAt,
    ageHours,
    freshMinutes,
    baseExpectedMinutes:freshMinutes?clamp(baseExpectedMinutes,0,90):null,
    minutesConfidence:freshMinutes?clamp(num(projection.confidence,0.5),0,1):null,
    schemaVersion:num(payload.schemaVersion),
    source:'v8-live-knowledge',
    payload
  };
}

export function applyV8KnowledgeRows(players,rows,opts={}){
  const byId=new Map();
  for(const raw of rows||[]){
    const k=normaliseV8KnowledgeRow(raw,opts);
    if(k)byId.set(k.playerId,k);
  }
  let applied=0,stale=0;
  const merged=(players||[]).map(p=>{
    const k=byId.get(Number(p.id));
    if(!k)return p;
    if(!k.freshMinutes){stale++;return {...p,v8Knowledge:k,v8KnowledgeFresh:false};}
    applied++;
    return {...p,v8Knowledge:k,v8KnowledgeFresh:true,v8BaseExpectedMinutes:k.baseExpectedMinutes,v8MinutesConfidence:k.minutesConfidence};
  });
  return {players:merged,applied,stale,rowsById:byId};
}

export class LiveKnowledgeClient{
  constructor({base='/api/knowledge',timeoutMs=8000,retries=1}={}){this.base=base;this.timeoutMs=timeoutMs;this.retries=retries;}
  async request(url){let last;for(let attempt=0;attempt<=this.retries;attempt++){const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs);try{const r=await fetch(url,{signal:c.signal});clearTimeout(t);if(r.status===404)return null;if(!r.ok)throw new Error(`Knowledge request failed (${r.status})`);return await r.json();}catch(e){clearTimeout(t);last=e;if(attempt<this.retries)await new Promise(r=>setTimeout(r,250*(attempt+1)));}}throw last;}
  async recent(){const x=await this.request(this.base);return x?.rows||[];}
  async get(playerId,season='2026-27'){const sep=this.base.includes('?')?'&':'?';return this.request(`${this.base}${sep}season=${encodeURIComponent(workerSeason(season))}&playerId=${encodeURIComponent(playerId)}`);}
}


export class LiveResearchAdminClient{
  constructor({base='/api/research',token='',timeoutMs=90000,retries=0}={}){
    this.base=base.replace(/\/$/,'');this.token=token;this.timeoutMs=timeoutMs;this.retries=retries;
  }
  headers(){if(!this.token)throw new Error('ADMIN_TOKEN is required for research administration');return {'content-type':'application/json','authorization':`Bearer ${this.token}`};}
  async request(path,{method='GET',body}={}){let last;for(let attempt=0;attempt<=this.retries;attempt++){const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs);try{const r=await fetch(`${this.base}/${path.replace(/^\//,'')}`,{method,headers:this.headers(),body:body==null?undefined:JSON.stringify(body),signal:c.signal});clearTimeout(t);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data?.error||`Research admin request failed (${r.status})`);return data;}catch(e){clearTimeout(t);last=e;if(attempt<this.retries)await new Promise(r=>setTimeout(r,300*(attempt+1)));}}throw last;}
  enqueue(task){return this.request('enqueue',{method:'POST',body:{season:workerSeason(task.season),playerId:task.playerId,name:task.name,club:task.team||'',reason:task.reason||'decision-material',force:Boolean(task.force)}});}
  run(limit=1){return this.request('run',{method:'POST',body:{limit:Math.max(1,Math.min(5,Number(limit)||1))}});}
  queue(limit=25){return this.request(`queue?limit=${encodeURIComponent(limit)}`);}
  usage(){return this.request('usage');}
}

export class ScopedResearchClient{
  constructor({base='/api',token='',timeoutMs=180000,retries=0}={}){
    this.base=base.replace(/\/$/,'');this.token=token;this.timeoutMs=timeoutMs;this.retries=retries;
  }
  headers(){if(!this.token)throw new Error('Research access key is required');return {'content-type':'application/json','x-research-session':this.token};}
  async request(path,{method='GET',body}={}){let last;for(let attempt=0;attempt<=this.retries;attempt++){const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs);try{const r=await fetch(`${this.base}/${path.replace(/^\//,'')}`,{method,headers:this.headers(),body:body==null?undefined:JSON.stringify(body),signal:c.signal});clearTimeout(t);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data?.error||`Scoped research request failed (${r.status})`);return data;}catch(e){clearTimeout(t);last=e;if(attempt<this.retries)await new Promise(r=>setTimeout(r,350*(attempt+1)));}}throw last;}
  status(){return this.request('research/session/status');}
  execute({teamId,season='2026-27',tasks=[]}={}){return this.request('decision/research',{method:'POST',body:{teamId:Number(teamId),season:workerSeason(season),tasks:(tasks||[]).map(t=>({playerId:t.playerId,role:t.role||'candidate',reasons:t.reasons||[]}))}});}
}
