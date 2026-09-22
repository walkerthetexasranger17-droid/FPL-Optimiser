import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KnowledgeStore } from './store.js';
export class JsonKnowledgeRepository {
  constructor(path){this.path=path;}
  async load(){try{return KnowledgeStore.import(JSON.parse(await readFile(this.path,'utf8')));}catch(e){if(e.code==='ENOENT')return new KnowledgeStore();throw e;}}
  async save(store){await mkdir(dirname(this.path),{recursive:true});const tmp=`${this.path}.tmp`;await writeFile(tmp,JSON.stringify(store.export(),null,2));await rename(tmp,this.path);return this.path;}
}
