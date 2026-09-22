export function validateSquad(players, config, budgetTenths) {
  const errors = [];
  if (players.length !== 15) errors.push('Squad must contain 15 players');
  const counts = { GK:0, DEF:0, MID:0, FWD:0 };
  const clubs = new Map();
  let cost = 0;
  for (const p of players) {
    if (counts[p.position] === undefined) errors.push(`Unknown position: ${p.position}`);
    else counts[p.position]++;
    clubs.set(p.team, (clubs.get(p.team) || 0) + 1);
    cost += p.priceTenths;
  }
  for (const [pos, required] of Object.entries(config.squad)) if (counts[pos] !== required) errors.push(`${pos} must equal ${required}`);
  for (const [club, count] of clubs) if (count > config.clubLimit) errors.push(`${club} exceeds club limit`);
  if (cost > budgetTenths) errors.push('Squad exceeds budget');
  return { valid: errors.length === 0, errors, costTenths: cost };
}
