const keyOf=(season,playerId)=>`${season}:${playerId}`;
export class KnowledgeStore {
  constructor(seed=[]){this.players=new Map(seed.map(x=>[keyOf(x.season,x.playerId),structuredClone(x)]));this.audit=[];}
  get(season,playerId){return this.players.get(keyOf(season,playerId))||null;}
  upsert(record,{at=new Date().toISOString(),reason='update'}={}){if(!record?.season||record.playerId==null)throw new Error('season/playerId required');const k=keyOf(record.season,record.playerId),prev=this.players.get(k)||{};const next={...prev,...structuredClone(record),updatedAt:at};this.players.set(k,next);this.audit.push({at,key:k,reason});return next;}
  all(){return [...this.players.values()].map(x=>structuredClone(x));}
  export(){return {schemaVersion:1,players:this.all(),audit:structuredClone(this.audit)};}
  static import(x){const s=new KnowledgeStore(x?.players||[]);s.audit=structuredClone(x?.audit||[]);return s;}
}
