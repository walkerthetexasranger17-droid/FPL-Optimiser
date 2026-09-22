import {strategicWeeklyPlan} from './src/engine/transfer-planner.js';

self.onmessage=e=>{
  const {id,state,players,nextGW,horizon,config}=e.data||{};
  try{
    const started=performance.now();
    const plan=strategicWeeklyPlan(state,players,nextGW,horizon,{config,beamWidth:120,maxMovesPerGW:2,minGain:.75});
    self.postMessage({id,ok:true,plan,elapsedMs:Math.round(performance.now()-started)});
  }catch(error){
    self.postMessage({id,ok:false,error:error?.message||String(error)});
  }
};
