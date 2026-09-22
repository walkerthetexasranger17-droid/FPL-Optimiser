import { optimiseSquad } from './squad-optimiser.js';
import { optimiseLineup } from './lineup.js';

const saleValue=(squad,bankTenths=0)=>bankTenths+squad.reduce((sum,p)=>sum+(p.priceTenths||0),0);
const gwScore=(squad,gw)=>{const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);return {lineup:l,score:l.value+(l.captain?.projections?.[gw]||0)};};

/** Dedicated one-week Free Hit optimiser. The temporary squad is built only for `gw` and
 * does not mutate the manager's permanent squad, bank, purchase prices or FT state. */
export function optimiseFreeHit(state,players,gw,{budgetTenths,clubLimit=3,maxPerPosition=45,beamWidth=12000}={}){
  const budget=budgetTenths??saleValue(state.squad,state.bankTenths||0);
  const score=p=>p.projections?.[gw]||0;
  const normal=gwScore(state.squad,gw);
  const best=optimiseSquad(players,{budgetTenths:budget,clubLimit,score,maxPerPosition,beamWidth});
  const temporary=gwScore(best.players,gw);
  return {gw,budgetTenths:budget,normalExpected:normal.score,freeHitExpected:temporary.score,incrementalExpected:temporary.score-normal.score,squad:best.players,lineup:temporary.lineup};
}

export function freeHitWindows(state,players,startGW,endGW,opts={}){const rows=[];for(let gw=startGW;gw<=endGW;gw++){try{rows.push(optimiseFreeHit(state,players,gw,opts));}catch{/* no legal temporary squad for this snapshot */}}return rows.sort((a,b)=>b.incrementalExpected-a.incrementalExpected);}
