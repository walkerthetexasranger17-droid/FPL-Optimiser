import { sellingPrice } from '../engine/selling-price.js';

const CHIP_ALIASES = {
  wildcard: 'wildcard',
  freehit: 'freeHit',
  bboost: 'benchBoost',
  benchboost: 'benchBoost',
  '3xc': 'tripleCaptain',
  triplecaptain: 'tripleCaptain'
};

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export function normaliseChipName(name = '') {
  return CHIP_ALIASES[String(name).toLowerCase().replace(/[^a-z0-9]/g, '')] || String(name);
}

export function chipEvents(chips = []) {
  const byEvent = new Map();
  for (const c of chips || []) {
    const event = n(c.event, null);
    if (!Number.isInteger(event)) continue;
    const name = normaliseChipName(c.name);
    if (!byEvent.has(event)) byEvent.set(event, new Set());
    byEvent.get(event).add(name);
  }
  return byEvent;
}

export function freeTransfersForNextDeadline({
  startedEvent = 1,
  currentGW,
  transfers = [],
  chips = [],
  maxFreeTransfers = 5
}) {
  if (!Number.isInteger(currentGW) || currentGW < startedEvent) return 1;

  const chipByEvent = chipEvents(chips);
  const counts = new Map();
  for (const t of transfers || []) {
    const event = n(t.event, null);
    if (!Number.isInteger(event)) continue;
    counts.set(event, (counts.get(event) || 0) + 1);
  }

  // A manager receives their first FT after their first scored deadline.
  let available = 1;

  for (let event = startedEvent + 1; event <= currentGW; event++) {
    const active = chipByEvent.get(event) || new Set();
    if (active.has('wildcard') || active.has('freeHit')) {
      // Official FPL rule: banked transfers survive WC/FH. The transfer received
      // for the chip Gameweek is effectively consumed by activating the chip,
      // so the usable FT total for the following GW is unchanged.
      continue;
    }

    const used = counts.get(event) || 0;
    const remaining = Math.max(0, available - used);
    available = Math.min(maxFreeTransfers, remaining + 1);
  }

  // Transfers already confirmed for the open next GW consume its current FT bank.
  const nextEvent = currentGW + 1;
  const nextActive = chipByEvent.get(nextEvent) || new Set();
  if (!nextActive.has('wildcard') && !nextActive.has('freeHit')) {
    available = Math.max(0, available - (counts.get(nextEvent) || 0));
  }

  return available;
}

function initialPriceTenths(player) {
  return Math.max(0, n(player.priceTenths) - n(player.costChangeStart));
}

export function reconstructPermanentTeam({
  players,
  startingPicks,
  transfers = [],
  chips = [],
  startedEvent = 1,
  throughEvent
}) {
  const byId = new Map((players || []).map(p => [p.id, p]));
  const chipByEvent = chipEvents(chips);
  const owned = new Set();
  const purchase = new Map();
  let bankTenths = 1000;
  const warnings = [];

  if (startedEvent !== 1) {
    warnings.push('Late-entry team: original acquisition prices cannot be reconstructed exactly from current public FPL data.');
  }

  for (const pick of startingPicks || []) {
    const id = n(pick.element, null);
    const player = byId.get(id);
    if (!player) continue;
    owned.add(id);
    const price = startedEvent === 1 ? initialPriceTenths(player) : n(player.priceTenths);
    purchase.set(id, price);
    bankTenths -= price;
  }

  const ordered = [...(transfers || [])]
    .filter(t => Number.isInteger(n(t.event, null)) && n(t.event) > startedEvent && n(t.event) <= throughEvent)
    .sort((a, b) => n(a.event) - n(b.event) || String(a.time || '').localeCompare(String(b.time || '')));

  for (const t of ordered) {
    const event = n(t.event);
    const active = chipByEvent.get(event) || new Set();
    if (active.has('freeHit')) continue; // temporary squad only; permanent squad is restored.

    const outId = n(t.element_out, null);
    const inId = n(t.element_in, null);
    if (outId != null) {
      owned.delete(outId);
      purchase.delete(outId);
    }
    if (inId != null) {
      owned.add(inId);
      purchase.set(inId, n(t.element_in_cost, byId.get(inId)?.priceTenths ?? 0));
    }
    bankTenths += n(t.element_out_cost) - n(t.element_in_cost);
  }

  const squad = [...owned]
    .map(id => {
      const p = byId.get(id);
      if (!p) return null;
      const purchasePriceTenths = purchase.get(id) ?? p.priceTenths;
      return {
        ...p,
        purchasePriceTenths,
        sellingPriceTenths: sellingPrice(purchasePriceTenths, p.priceTenths)
      };
    })
    .filter(Boolean);

  return { squad, bankTenths, purchasePrices: purchase, warnings };
}

export function chipAvailabilityForGW(chips = [], planningGW) {
  const firstHalf = planningGW <= 19;
  const used = new Set(
    (chips || [])
      .filter(c => firstHalf ? n(c.event) <= 19 : n(c.event) >= 20)
      .map(c => normaliseChipName(c.name))
  );
  return {
    wildcard: !used.has('wildcard'),
    freeHit: !used.has('freeHit'),
    benchBoost: !used.has('benchBoost'),
    tripleCaptain: !used.has('tripleCaptain')
  };
}

export async function importManagerState({ client, players, entryId, currentGW, maxFreeTransfers = 5 }) {
  const [entry, history, transfers] = await Promise.all([
    client.entry(entryId),
    client.history(entryId),
    client.transfers(entryId)
  ]);

  const startedEvent = n(entry.started_event, 1);
  const starting = await client.picks(entryId, startedEvent);
  const throughEvent = currentGW + 1; // includes any confirmed transfers for the open next deadline.
  const rebuilt = reconstructPermanentTeam({
    players,
    startingPicks: starting.picks,
    transfers,
    chips: history.chips || [],
    startedEvent,
    throughEvent
  });

  const warnings = [...rebuilt.warnings];
  if (rebuilt.squad.length !== 15) {
    warnings.push(`Reconstructed permanent squad contains ${rebuilt.squad.length} players instead of 15; manual review is required.`);
  }

  const freeTransfers = freeTransfersForNextDeadline({
    startedEvent,
    currentGW,
    transfers,
    chips: history.chips || [],
    maxFreeTransfers
  });

  const currentRows = history.current || [];
  const latest = currentRows.find(r => n(r.event) === currentGW) || currentRows.at(-1) || {};

  return {
    entryId: String(entryId),
    teamName: entry.name || '',
    playerName: [entry.player_first_name, entry.player_last_name].filter(Boolean).join(' '),
    startedEvent,
    squad: rebuilt.squad,
    bankTenths: rebuilt.bankTenths,
    freeTransfers,
    chips: history.chips || [],
    chipAvailability: chipAvailabilityForGW(history.chips || [], currentGW + 1),
    summaryOverallPoints: n(entry.summary_overall_points, n(latest.total_points)),
    summaryOverallRank: n(entry.summary_overall_rank, n(latest.overall_rank)),
    summaryEventPoints: n(entry.summary_event_points, n(latest.points)),
    summaryEventRank: n(entry.summary_event_rank, n(latest.rank)),
    currentValueTenths: n(entry.last_deadline_value, n(latest.value)),
    totalTransfers: n(entry.last_deadline_total_transfers, (transfers || []).length),
    historyCurrent: currentRows,
    pastSeasons: history.past || [],
    warnings,
    provenance: {
      squad: 'Public FPL starting picks + permanent transfer history (Free Hit transfers excluded)',
      purchasePrices: startedEvent === 1 ? 'Season-start prices reconstructed from now_cost - cost_change_start, then exact transfer-in prices' : 'Best-effort for late-entry team',
      bank: startedEvent === 1 ? '£100.0m starting bank replayed through permanent transfer transaction costs' : 'Best-effort for late-entry team',
      freeTransfers: 'Replayed from public transfer counts and chip history under 2026/27 max-5 FT rules'
    }
  };
}
