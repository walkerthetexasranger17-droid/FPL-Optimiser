// Selects a mutually-exclusive chip schedule from independently-scored opportunities.
// Each chip can be used at most once in the supplied window and only one chip may occupy a GW.
export function optimiseChipSchedule(opportunities,{available={wildcard:true,freeHit:true,benchBoost:true,tripleCaptain:true}}={}){
  const pools={
    wildcard:opportunities.wildcard||[],
    freeHit:opportunities.freeHit||[],
    benchBoost:opportunities.benchBoost||[],
    tripleCaptain:opportunities.tripleCaptain||[]
  };
  available=available||{wildcard:true,freeHit:true,benchBoost:true,tripleCaptain:true};
  const types=Object.keys(pools).filter(t=>available[t]&&pools[t].length);
  let best={value:0,picks:[]};
  function walk(i,usedGWs,picks,value){
    if(i===types.length){if(value>best.value)best={value,picks:[...picks]};return;}
    const type=types[i];
    // Skipping remains legal: opportunity may be outside current forecast horizon.
    walk(i+1,usedGWs,picks,value);
    for(const row of pools[type]){
      if(usedGWs.has(row.gw))continue;
      usedGWs.add(row.gw);picks.push({chip:type,...row});
      walk(i+1,usedGWs,picks,value+Math.max(0,row.incrementalExpected||0));
      picks.pop();usedGWs.delete(row.gw);
    }
  }
  walk(0,new Set(),[],0);
  best.picks.sort((a,b)=>a.gw-b.gw);
  return best;
}
