export const season2026_27 = Object.freeze({
  season: '2026/27',
  initialBudgetTenths: 1000,
  squad: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
  clubLimit: 3,
  maxFreeTransfers: 5,
  transferHitPoints: 4,
  xi: { players: 11, GK: 1, minDEF: 3, minMID: 2, minFWD: 1 },
  chips: {
    types: ['wildcard', 'freeHit', 'benchBoost', 'tripleCaptain'],
    sets: 2,
    firstSetLastGameweek: 19,
    oneChipPerGameweek: true,
    freeHitConsecutiveAllowed: false,
    wildcardRetainsSavedFT: true,
    freeHitRetainsSavedFT: true
  },
  defensiveContributions: {
    DEF: { threshold: 10, points: 2, metrics: ['clearances','blocks','interceptions','tackles'] },
    MID: { threshold: 12, points: 2, metrics: ['clearances','blocks','interceptions','tackles','recoveries'] },
    FWD: { threshold: 12, points: 2, metrics: ['clearances','blocks','interceptions','tackles','recoveries'] }
  }
});
