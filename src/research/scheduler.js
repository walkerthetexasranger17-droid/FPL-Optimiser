import { buildResearchQueue } from './queue.js';
import { researchToKnowledge } from './ingest.js';
export class ResearchScheduler {
 constructor({repository,client,maxPerRun=10,clock=()=>new Date()}={}){this.repository=repository;this.client=client;this.maxPerRun=maxPerRun;this.clock=clock;}
 async run(players,season){const store=await this.repository.load();const queue=buildResearchQueue(players,store,season,{now:this.clock().getTime()}).slice(0,this.maxPerRun);const report={queued:queue.length,succeeded:0,failed:[]};for(const task of queue){try{const result=await this.client.researchPlayer({name:task.name,currentClub:task.team,season});const record=researchToKnowledge(task,result,this.clock().toISOString());record.clubId=players.find(p=>p.id===task.playerId)?.teamId??null;store.upsert(record,{at:this.clock().toISOString(),reason:`research:${task.triggers.join(',')}`});report.succeeded++;}catch(e){report.failed.push({playerId:task.playerId,error:String(e?.message||e)});}}await this.repository.save(store);return report;}
}
