import { GameEngine } from '../games.types';
import { OkeyAction } from './okey.actions';
import {
  OkeyColor,
  OkeyFinishReason,
  OkeyMode,
  OkeyState,
  Tile,
} from './okey.types';

type WinType = 'NONE' | 'NORMAL' | 'CIFT' | 'OKEY_ILE';

export class OkeyEngine implements GameEngine {
  start(players: string[], mode: OkeyMode): OkeyState {
    if (players.length !== 4) {
      throw new Error('OKEY requires 4 players');
    }

    const deck = this.createDeck();
    this.shuffle(deck);

    const indicator = this.pickValidIndicator(deck);
    const okey = this.computeOkey(indicator);

    const playerStates = players.map((userId, seat) => ({
      userId,
      seat,
      hand: [] as Tile[],
    }));

    for (let i = 0; i < playerStates.length; i++) {
      const count = i === 0 ? 15 : 14;
      playerStates[i].hand = deck.splice(0, count);
      this.sortHand(playerStates[i].hand);
    }

    return {
      players: playerStates,
      deck,
      discarded: [],
      indicator,
      okey,
      phase: 'PLAYING',
      mode,
      turn: 0,
      drewThisTurn: false,
      winnerSeat: null,
      winnerTeam: null,
      finishReason: undefined,
      lastDiscardedBySeat: null,
      lastAction: undefined,
      cifteGidiyorSeat: null,

      // yeni alanlar
      justDrawnTileId: null,
      drawSource: null,
    };
  }

  move(state: OkeyState, playerId: string, action: OkeyAction): OkeyState {
    if (action.type === 'FORCE_FINISH') {
      state.phase = 'FINISHED';
      state.winnerSeat = action.winnerSeat ?? null;
      state.winnerTeam =
        typeof action.winnerSeat === 'number' && state.mode === 'TEAM'
          ? this.getTeamOfSeat(action.winnerSeat)
          : null;
      state.finishReason = 'FORCE_FINISH';
      state.lastAction = {
        seat: null,
        type: 'FORCE_FINISH',
        tile: null,
        at: Date.now(),
      };
      return state;
    }

    if (state.phase !== 'PLAYING') return state;

    const seat = state.players.findIndex((p) => p.userId === playerId);
    if (seat === -1) throw new Error('Player not in game');
    if (seat !== state.turn) throw new Error('Not your turn');

    switch (action.type) {
      case 'DRAW_DECK': {
        this.assertCanDraw(state, seat);

        const tile = state.deck.pop() ?? null;
        if (!tile) {
          state.phase = 'FINISHED';
          state.winnerSeat = null;
          state.winnerTeam = null;
          state.finishReason = 'DECK_EXHAUSTED';
          state.lastAction = {
            seat,
            type: 'DRAW_DECK',
            tile: null,
            at: Date.now(),
          };
          return state;
        }

        state.players[seat].hand.push(tile);
        this.sortHand(state.players[seat].hand);

        state.drewThisTurn = true;
        state.justDrawnTileId = tile.id;
        state.drawSource = 'DECK';

        state.lastAction = {
          seat,
          type: 'DRAW_DECK',
          tile,
          at: Date.now(),
        };

        return state;
      }

      case 'DRAW_DISCARD': {
        this.assertCanDraw(state, seat);

        const tile = state.discarded.pop() ?? null;
        if (!tile) {
          throw new Error('Discard pile empty');
        }

        state.players[seat].hand.push(tile);
        this.sortHand(state.players[seat].hand);

        state.drewThisTurn = true;
        state.justDrawnTileId = tile.id;
        state.drawSource = 'DISCARD';

        state.lastAction = {
          seat,
          type: 'DRAW_DISCARD',
          tile,
          at: Date.now(),
        };

        return state;
      }

      case 'DISCARD': {
        this.assertCanDiscard(state, seat);

        const hand = state.players[seat].hand;
        const idx = hand.findIndex((t) => t.id === action.tileId);
        if (idx === -1) {
          throw new Error('Tile not found in hand');
        }

        const tile = hand[idx];

        // discard'tan alınan taşı aynı tur geri atma yasağı
        if (
          state.drawSource === 'DISCARD' &&
          state.justDrawnTileId &&
          tile.id === state.justDrawnTileId
        ) {
          throw new Error('Cannot immediately discard taken discard tile');
        }

        hand.splice(idx, 1);
        this.sortHand(hand);

        state.discarded.push(tile);
        state.lastDiscardedBySeat = seat;
        state.lastAction = {
          seat,
          type: 'DISCARD',
          tile,
          at: Date.now(),
        };

        if (hand.length !== 14) {
          throw new Error(`Hand corrupted after discard (len=${hand.length})`);
        }

        const winType = this.getWinningType(
          hand,
          state.okey,
          tile,
          state.cifteGidiyorSeat === seat,
        );

        if (winType !== 'NONE') {
          this.applyWin(state, seat, winType);
          return state;
        }

        state.turn = this.nextSeat(state.turn);
        state.drewThisTurn = false;
        state.justDrawnTileId = null;
        state.drawSource = null;

        return state;
      }

      case 'DECLARE_CIFT': {
        const hand = state.players[seat].hand;

        if (hand.length !== 14) {
          throw new Error('DECLARE_CIFT requires 14 tiles');
        }

        if (!this.canGoCift(hand, state.okey)) {
          throw new Error('This hand is not eligible to go cift');
        }

        state.cifteGidiyorSeat = seat;
        state.lastAction = {
          seat,
          type: 'DECLARE_CIFT',
          tile: null,
          at: Date.now(),
        };
        return state;
      }

      case 'DECLARE_WIN': {
        const hand = state.players[seat].hand;

        if (hand.length !== 14) {
          throw new Error('DECLARE_WIN requires 14 tiles');
        }

        const winType = this.getWinningType(
          hand,
          state.okey,
          null,
          state.cifteGidiyorSeat === seat,
        );

        if (winType === 'NONE') {
          throw new Error('Not a winning hand');
        }

        state.lastAction = {
          seat,
          type: 'DECLARE_WIN',
          tile: null,
          at: Date.now(),
        };

        this.applyWin(state, seat, winType);
        return state;
      }

      default:
        return state;
    }
  }

  getPublicState(state: OkeyState, viewerSeat: number | null) {
    const topDiscard =
      state.discarded.length > 0
        ? state.discarded[state.discarded.length - 1]
        : null;

    return {
      phase: state.phase,
      mode: state.mode,
      turn: state.turn,
      drewThisTurn: state.drewThisTurn,
      indicator: state.indicator,
      okey: state.okey,
      deckCount: state.deck.length,
      discardTop: topDiscard,
      discardCount: state.discarded.length,
      winnerSeat:
        typeof state.winnerSeat === 'number' ? state.winnerSeat : null,
      winnerTeam:
        typeof state.winnerTeam === 'number' ? state.winnerTeam : null,
      finishReason: state.finishReason ?? null,
      lastDiscardedBySeat: state.lastDiscardedBySeat ?? null,
      lastAction: state.lastAction ?? null,
      cifteGidiyorSeat: state.cifteGidiyorSeat ?? null,
      justDrawnTileId: viewerSeat === state.turn ? state.justDrawnTileId : null,
      drawSource: viewerSeat === state.turn ? state.drawSource : null,
      players: state.players.map((p, idx) => ({
        seat: p.seat,
        userId: p.userId,
        count: p.hand.length,
        hand: viewerSeat === idx ? [...p.hand] : undefined,
      })),
    };
  }

  isFinished(state: OkeyState): boolean {
    return state.phase === 'FINISHED';
  }

  // OKEY engine her zaman seat döndürmeli
  getWinner(state: OkeyState): number | null {
    return typeof state.winnerSeat === 'number' ? state.winnerSeat : null;
  }

  private applyWin(state: OkeyState, seat: number, winType: WinType) {
    state.phase = 'FINISHED';
    state.winnerSeat = seat;
    state.winnerTeam = state.mode === 'TEAM' ? this.getTeamOfSeat(seat) : null;
    state.finishReason = this.mapWinTypeToFinishReason(winType);
    state.justDrawnTileId = null;
    state.drawSource = null;
  }

  private nextSeat(seat: number): number {
    return (seat + 1) % 4;
  }

  private getTeamOfSeat(seat: number): number {
    return seat % 2;
  }

  private assertCanDraw(state: OkeyState, seat: number) {
    if (seat !== state.turn) throw new Error('Not your turn');
    if (state.drewThisTurn) throw new Error('Already drew this turn');

    const handLen = state.players[seat]?.hand.length;
    if (handLen !== 14) {
      throw new Error(`Must have 14 tiles to draw (len=${handLen})`);
    }
  }

  private assertCanDiscard(state: OkeyState, seat: number) {
    if (seat !== state.turn) throw new Error('Not your turn');

    const handLen = state.players[seat]?.hand.length;
    if (handLen === undefined) throw new Error('Invalid turn');

    // ilk oyuncu ilk turda 15 taşla direkt atabilir
    if (handLen === 15) return;

    if (handLen === 14) {
      throw new Error('Must draw before discard');
    }

    throw new Error(`Hand corrupted (len=${handLen})`);
  }

  private getWinningType(
    hand: Tile[],
    okey: Tile,
    lastDiscardedTile: Tile | null,
    declaredCift: boolean,
  ): WinType {
    if (hand.length !== 14) return 'NONE';

    if (declaredCift && this.isPairWinningHand(hand, okey)) {
      return 'CIFT';
    }

    if (this.isNormalWinningHand(hand, okey)) {
      if (lastDiscardedTile && this.isRealOkeyTile(lastDiscardedTile, okey)) {
        return 'OKEY_ILE';
      }
      return 'NORMAL';
    }

    return 'NONE';
  }

  private mapWinTypeToFinishReason(winType: WinType): OkeyFinishReason {
    switch (winType) {
      case 'NORMAL':
        return 'NORMAL_WIN';
      case 'CIFT':
        return 'CIFTTEN_BITIS';
      case 'OKEY_ILE':
        return 'OKEY_ILE_BITIS';
      default:
        return 'FORCE_FINISH';
    }
  }

  /**
   * Çifte gitme ilanı için daha yumuşak uygunluk:
   * - hazır 7 çift varsa true
   * - ya da güçlü çift potansiyeli varsa true
   */
  private canGoCift(hand: Tile[], okey: Tile): boolean {
    if (this.isPairWinningHand(hand, okey)) return true;

    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const jokerCount = normalized.filter((t) =>
      this.isRealOkeyTile(t, okey),
    ).length;
    const normals = normalized.filter((t) => !this.isRealOkeyTile(t, okey));

    const counts = new Map<string, number>();
    for (const t of normals) {
      const k = this.tileKey(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    let pairishCount = 0;
    for (const c of counts.values()) {
      if (c >= 2) pairishCount++;
    }

    return pairishCount + jokerCount >= 5;
  }

  private isNormalWinningHand(hand: Tile[], okey: Tile): boolean {
    if (hand.length !== 14) return false;

    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));
    const { jokers, normals } = this.splitJokers(normalized, okey);

    const counts = this.toCounts(normals);
    const memo = new Map<string, boolean>();

    return this.canPartition(counts, jokers, memo);
  }

  /**
   * Sahte okey joker değildir.
   * Sahte okey = gösterge taşının aynısı gibi davranır.
   */
  private normalizeTileForHand(tile: Tile, okey: Tile): Tile {
    if (!tile.isFakeOkey) return tile;

    const indicatorValue = okey.value === 1 ? 13 : okey.value - 1;

    return {
      ...tile,
      color: okey.color,
      value: indicatorValue,
      isFakeOkey: false,
    };
  }

  /**
   * Çiftten bitiş:
   * 14 taş = 7 çift
   * gerçek okey joker gibi çift tamamlayabilir
   * fake okey normalize sonrası normal taş sayılır
   */
  private isPairWinningHand(hand: Tile[], okey: Tile): boolean {
    if (hand.length !== 14) return false;

    const normalized = hand.map((t) => this.normalizeTileForHand(t, okey));

    const jokerCount = normalized.filter((t) =>
      this.isRealOkeyTile(t, okey),
    ).length;
    const normals = normalized.filter((t) => !this.isRealOkeyTile(t, okey));

    const counts = new Map<string, number>();
    for (const t of normals) {
      const k = this.tileKey(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    let pairCount = 0;
    let singleCount = 0;

    for (const c of counts.values()) {
      pairCount += Math.floor(c / 2);
      singleCount += c % 2;
    }

    if (singleCount > jokerCount) return false;

    const remainingJokers = jokerCount - singleCount;
    pairCount += singleCount;
    pairCount += Math.floor(remainingJokers / 2);

    return pairCount >= 7;
  }

  /**
   * Burada sadece gerçek okey jokerdir.
   * Fake okey daha önce normalize edildi.
   */
  private splitJokers(hand: Tile[], okey: Tile) {
    let jokers = 0;
    const normals: Tile[] = [];

    for (const t of hand) {
      if (this.isRealOkeyTile(t, okey)) {
        jokers++;
      } else {
        normals.push(t);
      }
    }

    return { jokers, normals };
  }

  private isRealOkeyTile(tile: Tile, okey: Tile): boolean {
    return (
      !tile.isFakeOkey && tile.color === okey.color && tile.value === okey.value
    );
  }

  private toCounts(tiles: Tile[]) {
    const map = new Map<string, number>();
    for (const t of tiles) {
      const k = this.tileKey(t);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }

  private tileKey(tile: Tile): string {
    return `${tile.color}:${tile.value}`;
  }

  private memoKey(counts: Map<string, number>, jokers: number): string {
    const parts: string[] = [];
    const keys = [...counts.keys()].sort();

    for (const k of keys) {
      const c = counts.get(k)!;
      if (c > 0) {
        parts.push(`${k}x${c}`);
      }
    }

    return `J${jokers}|${parts.join(',')}`;
  }

  private canPartition(
    counts: Map<string, number>,
    jokers: number,
    memo: Map<string, boolean>,
  ): boolean {
    const key = this.memoKey(counts, jokers);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const remaining = this.totalCount(counts);
    if (remaining === 0) {
      const ok = jokers === 0;
      memo.set(key, ok);
      return ok;
    }

    const anchor = this.firstTileKey(counts);
    if (!anchor) {
      const ok = jokers === 0;
      memo.set(key, ok);
      return ok;
    }

    const [anchorColorRaw, anchorValueRaw] = anchor.split(':');
    const anchorColor = anchorColorRaw as OkeyColor;
    const anchorValue = Number(anchorValueRaw);

    for (const size of [3, 4] as const) {
      if (
        this.trySetGroup(counts, jokers, anchorColor, anchorValue, size, memo)
      ) {
        memo.set(key, true);
        return true;
      }
    }

    for (let len = 3; len <= 5; len++) {
      if (
        this.tryRunGroup(counts, jokers, anchorColor, anchorValue, len, memo)
      ) {
        memo.set(key, true);
        return true;
      }
    }

    memo.set(key, false);
    return false;
  }

  private trySetGroup(
    counts: Map<string, number>,
    jokers: number,
    anchorColor: OkeyColor,
    value: number,
    size: 3 | 4,
    memo: Map<string, boolean>,
  ): boolean {
    const colors: OkeyColor[] = ['RED', 'BLUE', 'BLACK', 'YELLOW'];

    const available = colors.filter(
      (c) => (counts.get(`${c}:${value}`) ?? 0) > 0,
    );

    if (!available.includes(anchorColor)) return false;

    const others = available.filter((c) => c !== anchorColor);
    const subsets = this.subsets(others);

    for (const sub of subsets) {
      const realCount = 1 + sub.length;
      if (realCount > size) continue;

      const needJ = size - realCount;
      if (needJ > jokers) continue;

      const usedKeys = [
        `${anchorColor}:${value}`,
        ...sub.map((c) => `${c}:${value}`),
      ];

      for (const k of usedKeys) {
        this.dec(counts, k);
      }

      const ok = this.canPartition(counts, jokers - needJ, memo);

      for (const k of usedKeys) {
        this.inc(counts, k);
      }

      if (ok) return true;
    }

    return false;
  }

  private tryRunGroup(
    counts: Map<string, number>,
    jokers: number,
    color: OkeyColor,
    anchorValue: number,
    len: number,
    memo: Map<string, boolean>,
  ): boolean {
    const minStart = Math.max(1, anchorValue - (len - 1));
    const maxStart = Math.min(anchorValue, 14 - len);

    for (let start = minStart; start <= maxStart; start++) {
      const end = start + len - 1;
      if (end > 13) continue;

      const anchorKey = `${color}:${anchorValue}`;
      if ((counts.get(anchorKey) ?? 0) <= 0) continue;

      const realKeys: string[] = [];
      let missing = 0;

      for (let v = start; v <= end; v++) {
        const k = `${color}:${v}`;
        if ((counts.get(k) ?? 0) > 0) {
          realKeys.push(k);
        } else {
          missing++;
        }
      }

      if (missing > jokers) continue;

      const consumeSet = new Set<string>(realKeys);
      consumeSet.add(anchorKey);

      for (const k of consumeSet) {
        this.dec(counts, k);
      }

      const ok = this.canPartition(counts, jokers - missing, memo);

      for (const k of consumeSet) {
        this.inc(counts, k);
      }

      if (ok) return true;
    }

    return false;
  }

  private totalCount(counts: Map<string, number>): number {
    let sum = 0;
    for (const v of counts.values()) sum += v;
    return sum;
  }

  private firstTileKey(counts: Map<string, number>): string | null {
    const keys = [...counts.keys()].sort();
    for (const k of keys) {
      if ((counts.get(k) ?? 0) > 0) return k;
    }
    return null;
  }

  private dec(counts: Map<string, number>, k: string, n = 1) {
    const cur = counts.get(k) ?? 0;
    if (cur < n) throw new Error('Count underflow');

    if (cur === n) counts.delete(k);
    else counts.set(k, cur - n);
  }

  private inc(counts: Map<string, number>, k: string, n = 1) {
    counts.set(k, (counts.get(k) ?? 0) + n);
  }

  private subsets<T>(arr: T[]): T[][] {
    const res: T[][] = [[]];

    for (const x of arr) {
      const curLen = res.length;
      for (let i = 0; i < curLen; i++) {
        res.push([...res[i], x]);
      }
    }

    return res;
  }

  private createDeck(): Tile[] {
    const colors: OkeyColor[] = ['RED', 'BLUE', 'BLACK', 'YELLOW'];
    const deck: Tile[] = [];
    let idCounter = 1;

    for (const color of colors) {
      for (let v = 1; v <= 13; v++) {
        deck.push({ id: `T${idCounter++}`, color, value: v });
        deck.push({ id: `T${idCounter++}`, color, value: v });
      }
    }

    deck.push({
      id: `T${idCounter++}`,
      color: 'JOKER',
      value: 0,
      isFakeOkey: true,
    });

    deck.push({
      id: `T${idCounter++}`,
      color: 'JOKER',
      value: 0,
      isFakeOkey: true,
    });

    return deck;
  }

  private pickValidIndicator(deck: Tile[]): Tile {
    let indicator: Tile | undefined;

    do {
      indicator = deck.pop();
    } while (indicator && indicator.isFakeOkey);

    if (!indicator) {
      throw new Error('Failed to pick valid indicator');
    }

    return indicator;
  }

  private computeOkey(indicator: Tile): Tile {
    if (indicator.isFakeOkey || indicator.color === 'JOKER') {
      throw new Error('Indicator cannot be fake okey');
    }

    return {
      id: `OKEY_${indicator.color}_${indicator.value}`,
      color: indicator.color,
      value: indicator.value === 13 ? 1 : indicator.value + 1,
    };
  }

  private sortHand(hand: Tile[]) {
    const colorRank: Record<OkeyColor, number> = {
      RED: 1,
      BLUE: 2,
      BLACK: 3,
      YELLOW: 4,
      JOKER: 5,
    };

    hand.sort((a, b) => {
      const c = colorRank[a.color] - colorRank[b.color];
      if (c !== 0) return c;

      if (a.value !== b.value) return a.value - b.value;
      return a.id.localeCompare(b.id);
    });
  }

  private shuffle(deck: Tile[]) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
}
