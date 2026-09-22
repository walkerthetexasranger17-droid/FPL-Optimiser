/** Historical FPL dataset adapter.
 * Expected source is a deadline-safe archive such as vaastav/Fantasy-Premier-League.
 * IMPORTANT: post-GW `xP`/`ep_this` is intentionally excluded because archive maintainers
 * warn it may contain information updated after the deadline (look-ahead leakage).
 */
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
export const SAFE_HISTORY_FIELDS=['element','name','position','team','value','minutes','starts','goals_scored','assists','expected_goals','expected_assists','expected_goal_involvements','clean_sheets','goals_conceded','saves','bonus','bps','defensive_contribution','recoveries','tackles','clearances_blocks_interceptions','was_home','opponent_team','total_points'];
export function historicalRowToPlayer(r,prior={}){return {id:num(r.element??prior.id),name:r.name??prior.name,position:r.position??prior.position,team:r.team??prior.team,teamId:num(r.teamId??prior.teamId),priceTenths:num(r.value??prior.priceTenths),minutes:num(prior.minutes),starts:num(prior.starts),xG:num(prior.expected_goals),xA:num(prior.expected_assists),bonus:num(prior.bonus),defCon:num(prior.defensive_contribution),saves:num(prior.saves),pointsPerGame:num(prior.pointsPerGame),form:num(prior.form),status:'a'};}
export function assertHistoricalRowSafe(r){if('xP' in r||'ep_this' in r)throw new Error('Unsafe historical expected-points field: potential post-deadline leakage');return true;}
export function cumulativePrior(rows,playerId,beforeGW){const xs=rows.filter(r=>num(r.element)===num(playerId)&&num(r.round)<beforeGW);const sum=k=>xs.reduce((s,r)=>s+num(r[k]),0);const games=Math.max(1,xs.length);return {minutes:sum('minutes'),starts:sum('starts'),expected_goals:sum('expected_goals'),expected_assists:sum('expected_assists'),bonus:sum('bonus'),defensive_contribution:sum('defensive_contribution'),saves:sum('saves'),pointsPerGame:sum('total_points')/games,form:xs.slice(-4).reduce((s,r)=>s+num(r.total_points),0)/Math.max(1,Math.min(4,xs.length))};}
