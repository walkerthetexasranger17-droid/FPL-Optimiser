// Prices are integer tenths of £m, e.g. £7.5m = 75.
export function sellingPrice(purchase, current) {
  if (current <= purchase) return current;
  return purchase + Math.floor((current - purchase) / 2);
}
