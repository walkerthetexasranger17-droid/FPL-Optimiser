export function transferHitCost(transfersMade, freeTransfers, pointsPerHit = 4) {
  return Math.max(0, transfersMade - freeTransfers) * pointsPerHit;
}
export function nextFreeTransfers(freeTransfers, transfersMade, maxFT = 5) {
  const freeUsed = Math.min(freeTransfers, transfersMade);
  const remaining = freeTransfers - freeUsed;
  return Math.min(maxFT, remaining + 1);
}
