import { SpadesPlayer, SpadesRoundScore } from './spades.types';

type TeamIndex = 0 | 1;

function getTeamPlayers(
  players: SpadesPlayer[],
  team: TeamIndex,
): SpadesPlayer[] {
  return players.filter((p) => p.seat % 2 === team);
}

function getNilScore(
  player: SpadesPlayer,
  rules: {
    nilBonus: number;
    nilPenalty: number;
    blindNilBonus: number;
    blindNilPenalty: number;
  },
) {
  if (player.bidType === 'NIL') {
    return player.tricksWon === 0 ? rules.nilBonus : rules.nilPenalty;
  }

  if (player.bidType === 'BLIND_NIL') {
    return player.tricksWon === 0 ? rules.blindNilBonus : rules.blindNilPenalty;
  }

  return 0;
}

function sumNormalBids(players: SpadesPlayer[]) {
  return players.reduce((sum, p) => {
    if (p.bidType === 'NORMAL' && typeof p.bid === 'number') {
      return sum + p.bid;
    }
    return sum;
  }, 0);
}

function sumNormalTricks(players: SpadesPlayer[]) {
  return players.reduce((sum, p) => {
    if (p.bidType === 'NORMAL') {
      return sum + p.tricksWon;
    }
    return sum;
  }, 0);
}

function sumNilFailedTricks(players: SpadesPlayer[]) {
  return players.reduce((sum, p) => {
    if ((p.bidType === 'NIL' || p.bidType === 'BLIND_NIL') && p.tricksWon > 0) {
      return sum + p.tricksWon;
    }
    return sum;
  }, 0);
}

export function calculateRoundScores(params: {
  players: SpadesPlayer[];
  currentTeamScores: [number, number];
  currentTeamBags: [number, number];
  rules: {
    sandbagLimit: number;
    sandbagPenalty: number;
    nilBonus: number;
    nilPenalty: number;
    blindNilBonus: number;
    blindNilPenalty: number;
  };
}) {
  const { players, currentTeamScores, currentTeamBags, rules } = params;

  if (players.length !== 4) {
    throw new Error('Spades requires exactly 4 players');
  }

  const nextTeamScores: [number, number] = [...currentTeamScores];
  const nextTeamBags: [number, number] = [...currentTeamBags];

  const roundScores: SpadesRoundScore[] = [];

  for (const team of [0, 1] as TeamIndex[]) {
    const teamPlayers = getTeamPlayers(players, team);

    const bidTotal = sumNormalBids(teamPlayers);
    const normalTricks = sumNormalTricks(teamPlayers);
    const nilFailedTricks = sumNilFailedTricks(teamPlayers);

    const tricksWon = normalTricks + nilFailedTricks;

    const nilBonusDelta = teamPlayers.reduce(
      (sum, p) => sum + getNilScore(p, rules),
      0,
    );

    let scoreDelta = nilBonusDelta;

    let bagsThisRound = 0;
    let bagPenaltyApplied = false;

    if (tricksWon >= bidTotal) {
      scoreDelta += bidTotal * 10;

      bagsThisRound = tricksWon - bidTotal;

      scoreDelta += bagsThisRound;
    } else {
      scoreDelta -= bidTotal * 10;
    }

    nextTeamBags[team] += bagsThisRound;

    const penalties = Math.floor(nextTeamBags[team] / rules.sandbagLimit);

    if (penalties > 0) {
      scoreDelta -= penalties * rules.sandbagPenalty;

      nextTeamBags[team] = nextTeamBags[team] % rules.sandbagLimit;

      bagPenaltyApplied = true;
    }

    nextTeamScores[team] += scoreDelta;

    roundScores.push({
      team,
      bidTotal,
      tricksWon,
      bagsThisRound,
      bagsTotalAfterRound: nextTeamBags[team],
      scoreDelta,
      nilBonusDelta,
      bagPenaltyApplied,
    });
  }

  return {
    nextTeamScores,
    nextTeamBags,
    roundScores,
  };
}
