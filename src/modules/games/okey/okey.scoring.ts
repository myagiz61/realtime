import { OkeyMode, OkeyState, Tile } from './okey.types';

export type OkeyScoreConfig = {
  realOkeyPenalty: number;
  fakeOkeyPenalty: number;

  normalFinishMultiplier: number;
  ciftFinishMultiplier: number;
  okeyIleFinishMultiplier: number;

  deckExhaustedMultiplier: number;
  forceFinishMultiplier: number;
};

export type OkeyPenaltyBreakdown = {
  tileId: string;
  label: string;
  value: number;
};

export type OkeyPlayerPenaltyResult = {
  seat: number;
  userId: string;

  team: number | null;

  isWinner: boolean;
  isWinnerTeam: boolean;

  rawPenalty: number;
  multiplier: number;
  finalPenalty: number;

  breakdown: OkeyPenaltyBreakdown[];
};

export type OkeyScoreResult = {
  mode: OkeyMode;

  winnerSeat: number | null;
  winnerTeam: number | null;
  finishReason: string | null;

  multiplier: number;

  penalties: OkeyPlayerPenaltyResult[];

  totalLoserRawPenalty: number;
  totalLoserFinalPenalty: number;
};

export const DEFAULT_OKEY_SCORE_CONFIG: OkeyScoreConfig = {
  realOkeyPenalty: 30,
  fakeOkeyPenalty: 20,

  normalFinishMultiplier: 1,
  ciftFinishMultiplier: 2,
  okeyIleFinishMultiplier: 2,

  deckExhaustedMultiplier: 1,
  forceFinishMultiplier: 1,
};

export function calculateOkeyScore(
  state: OkeyState,
  config: OkeyScoreConfig = DEFAULT_OKEY_SCORE_CONFIG,
): OkeyScoreResult {
  const winnerSeat =
    typeof state.winnerSeat === 'number' ? state.winnerSeat : null;

  const winnerTeam =
    typeof state.winnerTeam === 'number' ? state.winnerTeam : null;

  const finishReason = state.finishReason ?? null;
  const multiplier = getFinishMultiplier(finishReason, config);

  const penalties: OkeyPlayerPenaltyResult[] = state.players.map((player) => {
    const team = state.mode === 'TEAM' ? getTeamOfSeat(player.seat) : null;

    const isWinner = winnerSeat !== null && player.seat === winnerSeat;
    const isWinnerTeam =
      state.mode === 'TEAM' &&
      winnerTeam !== null &&
      team !== null &&
      team === winnerTeam;

    // SOLO’da kazanan oyuncu ceza almaz
    if (state.mode === 'SOLO' && isWinner) {
      return {
        seat: player.seat,
        userId: player.userId,
        team,
        isWinner: true,
        isWinnerTeam: false,
        rawPenalty: 0,
        multiplier,
        finalPenalty: 0,
        breakdown: [],
      };
    }

    // TEAM’de kazanan takım ceza almaz
    if (state.mode === 'TEAM' && isWinnerTeam) {
      return {
        seat: player.seat,
        userId: player.userId,
        team,
        isWinner,
        isWinnerTeam: true,
        rawPenalty: 0,
        multiplier,
        finalPenalty: 0,
        breakdown: [],
      };
    }

    const { total, breakdown } = calculateHandPenaltyDetailed(
      player.hand ?? [],
      state.okey,
      config,
    );

    return {
      seat: player.seat,
      userId: player.userId,
      team,
      isWinner,
      isWinnerTeam,
      rawPenalty: total,
      multiplier,
      finalPenalty: total * multiplier,
      breakdown,
    };
  });

  const losers = penalties.filter((p) => p.finalPenalty > 0);

  const totalLoserRawPenalty = losers.reduce((sum, p) => sum + p.rawPenalty, 0);
  const totalLoserFinalPenalty = losers.reduce(
    (sum, p) => sum + p.finalPenalty,
    0,
  );

  return {
    mode: state.mode,
    winnerSeat,
    winnerTeam,
    finishReason,
    multiplier,
    penalties,
    totalLoserRawPenalty,
    totalLoserFinalPenalty,
  };
}

export function calculateHandPenalty(
  hand: Tile[],
  okey: Tile,
  config: OkeyScoreConfig = DEFAULT_OKEY_SCORE_CONFIG,
): number {
  return calculateHandPenaltyDetailed(hand, okey, config).total;
}

export function calculateHandPenaltyDetailed(
  hand: Tile[] | undefined,
  okey: Tile,
  config: OkeyScoreConfig = DEFAULT_OKEY_SCORE_CONFIG,
): {
  total: number;
  breakdown: OkeyPenaltyBreakdown[];
} {
  if (!hand || !Array.isArray(hand)) {
    return { total: 0, breakdown: [] };
  }

  const breakdown: OkeyPenaltyBreakdown[] = [];

  for (const tile of hand) {
    const value = getTilePenalty(tile, okey, config);

    breakdown.push({
      tileId: tile.id,
      label: formatTileLabel(tile, okey),
      value,
    });
  }

  const total = breakdown.reduce((sum, x) => sum + x.value, 0);

  return { total, breakdown };
}

export function getTilePenalty(
  tile: Tile,
  okey: Tile,
  config: OkeyScoreConfig = DEFAULT_OKEY_SCORE_CONFIG,
): number {
  // Sahte okey = sabit ceza
  if (tile.isFakeOkey) {
    return config.fakeOkeyPenalty;
  }

  // Gerçek okey = sabit ceza
  if (isRealOkeyTile(tile, okey)) {
    return config.realOkeyPenalty;
  }

  // Normal taş = üzerindeki sayı
  return tile.value;
}

export function getFinishMultiplier(
  finishReason: string | null,
  config: OkeyScoreConfig = DEFAULT_OKEY_SCORE_CONFIG,
): number {
  switch (finishReason) {
    case 'CIFTTEN_BITIS':
      return config.ciftFinishMultiplier;

    case 'OKEY_ILE_BITIS':
      return config.okeyIleFinishMultiplier;

    case 'DECK_EXHAUSTED':
      return config.deckExhaustedMultiplier;

    case 'FORCE_FINISH':
      return config.forceFinishMultiplier;

    case 'NORMAL_WIN':
    default:
      return config.normalFinishMultiplier;
  }
}

export function isRealOkeyTile(tile: Tile, okey: Tile): boolean {
  return (
    !tile.isFakeOkey && tile.color === okey.color && tile.value === okey.value
  );
}

export function getTeamOfSeat(seat: number): number {
  return seat % 2;
}

export function formatTileLabel(tile: Tile, okey: Tile): string {
  if (tile.isFakeOkey) {
    return 'FAKE_OKEY';
  }

  if (isRealOkeyTile(tile, okey)) {
    return `OKEY(${tile.color}-${tile.value})`;
  }

  return `${tile.color}-${tile.value}`;
}
