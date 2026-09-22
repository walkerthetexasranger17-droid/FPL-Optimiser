const POS={1:'GK',2:'DEF',3:'MID',4:'FWD'};
const num=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
export function normaliseBootstrap(raw){
 const teams=new Map((raw.teams||[]).map(t=>[t.id,t]));
 const players=(raw.elements||[]).map(p=>{const t=teams.get(p.team)||{};return {
  id:p.id,code:p.code,name:p.web_name,firstName:p.first_name,lastName:p.second_name,
  teamId:p.team,team:t.name||String(p.team),teamShort:t.short_name||String(p.team),teamCode:t.code||null,
  position:POS[p.element_type],priceTenths:p.now_cost,totalPoints:num(p.total_points),minutes:num(p.minutes),starts:num(p.starts),
  form:num(p.form),pointsPerGame:num(p.points_per_game),selectedBy:num(p.selected_by_percent),goals:num(p.goals_scored),assists:num(p.assists),
  cleanSheets:num(p.clean_sheets),saves:num(p.saves),bonus:num(p.bonus),bps:num(p.bps),xG:num(p.expected_goals),xA:num(p.expected_assists),
  xGI:num(p.expected_goal_involvements),xGC:num(p.expected_goals_conceded),defCon:num(p.defensive_contribution),
  influence:num(p.influence),creativity:num(p.creativity),threat:num(p.threat),ictIndex:num(p.ict_index),
  epNext:num(p.ep_next,NaN),epThis:num(p.ep_this,NaN),
  penaltiesOrder:num(p.penalties_order,0),directFreeKicksOrder:num(p.direct_freekicks_order,0),cornersOrder:num(p.corners_and_indirect_freekicks_order,0),
  status:p.status,chanceNext:p.chance_of_playing_next_round,news:p.news||'',transfersInEvent:num(p.transfers_in_event),transfersOutEvent:num(p.transfers_out_event),
  costChangeEvent:num(p.cost_change_event),costChangeStart:num(p.cost_change_start)
 }});
 const events=(raw.events||[]).map(e=>({id:e.id,name:e.name,deadline:e.deadline_time,finished:e.finished,isCurrent:e.is_current,isNext:e.is_next,averageScore:num(e.average_entry_score),highestScore:num(e.highest_score),finishedProvisional:Boolean(e.finished_provisional)}));
 return {players,teams:[...teams.values()],events,elementTypes:raw.element_types||[],gameSettings:raw.game_settings||{}};
}
export function normaliseFixtures(raw,teams=[]){const tm=new Map(teams.map(t=>[t.id,t]));return (raw||[]).map(f=>{const h=tm.get(f.team_h)||{},a=tm.get(f.team_a)||{};return {
 id:f.id,gameweek:f.event,homeTeamId:f.team_h,awayTeamId:f.team_a,homeTeam:h.name||String(f.team_h),awayTeam:a.name||String(f.team_a),homeShort:h.short_name||String(f.team_h),awayShort:a.short_name||String(f.team_a),kickoff:f.kickoff_time,
 homeDifficulty:f.team_h_difficulty,awayDifficulty:f.team_a_difficulty,
 homeStrength:num(h.strength_overall_home,h.strength),awayStrength:num(a.strength_overall_away,a.strength),
 homeAttack:num(h.strength_attack_home,h.strength_overall_home||h.strength),awayAttack:num(a.strength_attack_away,a.strength_overall_away||a.strength),
 homeDefence:num(h.strength_defence_home,h.strength_overall_home||h.strength),awayDefence:num(a.strength_defence_away,a.strength_overall_away||a.strength),
 finished:f.finished
};});}
