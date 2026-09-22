export class FPLClient{
 constructor({base='/api/fpl',timeoutMs=12000,retries=2}={}){this.base=base.replace(/\/$/,'');this.timeoutMs=timeoutMs;this.retries=retries;}
 async get(path){let last;for(let attempt=0;attempt<=this.retries;attempt++){const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs);try{const r=await fetch(`${this.base}/${path.replace(/^\//,'')}`,{signal:c.signal});if(!r.ok)throw new Error(`FPL data request failed (${r.status})`);const data=await r.json();clearTimeout(t);return data;}catch(e){clearTimeout(t);last=e;if(attempt<this.retries)await new Promise(r=>setTimeout(r,300*(attempt+1)));}}throw last;}
 bootstrap(){return this.get('bootstrap-static');} fixtures(){return this.get('fixtures');}
 entry(id){return this.get(`entry/${id}`);} history(id){return this.get(`entry/${id}/history`);} transfers(id){return this.get(`entry/${id}/transfers`);} picks(id,gw){return this.get(`entry/${id}/event/${gw}/picks`);}
}
