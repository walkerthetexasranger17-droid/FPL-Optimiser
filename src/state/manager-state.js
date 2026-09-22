export function createManagerState({ season, gameweek, squad, bankTenths, freeTransfers, chips }) {
  if (!Number.isInteger(freeTransfers) || freeTransfers < 0 || freeTransfers > 5) throw new Error('freeTransfers must be 0..5');
  if (!Array.isArray(squad) || squad.length !== 15) throw new Error('squad must contain exactly 15 players');
  return { season, gameweek, squad, bankTenths, freeTransfers, chips };
}
