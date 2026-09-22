import { optimiseSquad } from './squad-optimiser.js';
import { optimiseLineup } from './lineup.js';

export function discountedSquadScore(squad,gws,discount=.9){
  return gws.reduce((sum,gw,i)=>{
    const l=optimiseLineup(squad,p=>p.projections?.[gw]||0);
    const cap=l.captain?.projections?.[gw]||0;
    return sum+Math.pow(discount,i)*(l.value+cap);
  },0);
}

export function evaluateWildcard({currentSquad,allPlayers,gws,budgetTenths,config,discount=.9}){
  const score=p=>gws.reduce((s,gw,i)=>s+Math.pow(discount,i)*(p.projections?.[gw]||0),0);
  const best=optimiseSquad(allPlayers,{budgetTenths,clubLimit:config.clubLimit,score,maxPerPosition:45,beamWidth:16000});
  const baseline=discountedSquadScore(currentSquad,gws,discount);
  const wildcardScore=discountedSquadScore(best.players,gws,discount);
  return {squad:best.players,costTenths:best.costTenths,baselineExpected:baseline,wildcardExpected:wildcardScore,incrementalExpected:wildcardScore-baseline,gws};
}
