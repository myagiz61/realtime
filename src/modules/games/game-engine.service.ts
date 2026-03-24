import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GamePlayer, GameState } from './games.types';
import { getEngine } from './engines';
import { GameType, LedgerRefType, LedgerType } from '@prisma/client';
import { ReplayLogService } from './replay-log.service';
import { RedisService } from '../../common/redis/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

type StoredGame = {
  state: GameState;
  engineState: unknown;
  players: GamePlayer[];
  finished: boolean;
  lastActionAt: number;
  locked: boolean;
  finishedHandled: boolean;
  stake?: number;
};

export type ActiveGameSnapshot = {
  roomId: string;
  state: GameState;
  players: GamePlayer[];
  finished: boolean;
  lastActionAt: number;
  finishedHandled: boolean;
};

type Okey101StartOptions = {
  mode?: 'SOLO' | 'TEAM';
  maxRounds?: number;
  scoringMode?: 'KATLAMALI' | 'KATLAMASIZ';
};

@Injectable()
export class GameEngineService implements OnModuleInit {
  private readonly logger = new Logger(GameEngineService.name);
  private games = new Map<string, StoredGame>();

  private readonly ACTIVE_GAMES_SET_KEY = 'games:active_rooms';
  private readonly ROOM_LOCK_TTL_MS = 5000;

  constructor(
    private readonly replayLog: ReplayLogService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.restoreGamesFromRedis();
  }

  private getRedisGameKey(roomId: string) {
    return `game:state:${roomId}`;
  }

  private getRoomLockKey(roomId: string) {
    return `lock:room:${roomId}`;
  }

  private async persistGameToRedis(roomId: string, entry: StoredGame) {
    await this.redis.setJson(this.getRedisGameKey(roomId), {
      state: entry.state,
      engineState: entry.engineState,
      players: entry.players,
      finished: entry.finished,
      lastActionAt: entry.lastActionAt,
      locked: false,
      finishedHandled: entry.finishedHandled,
      stake: entry.stake,
    });

    await this.redis.sadd(this.ACTIVE_GAMES_SET_KEY, roomId);
  }

  private async removeGameFromRedis(roomId: string) {
    await this.redis.del(this.getRedisGameKey(roomId));
    await this.redis.srem(this.ACTIVE_GAMES_SET_KEY, roomId);
  }

  private async restoreGamesFromRedis() {
    const roomIds = await this.redis.smembers(this.ACTIVE_GAMES_SET_KEY);

    if (!roomIds.length) {
      this.logger.log('No active games found in Redis');
      return;
    }

    for (const roomId of roomIds) {
      try {
        const data = await this.redis.getJson<StoredGame>(
          this.getRedisGameKey(roomId),
        );

        if (!data) continue;

        const engine = getEngine(data.state.gameType as GameType);
        const normalizedFinished =
          data.finished ||
          data.state?.phase === 'FINISHED' ||
          engine.isFinished(data.engineState);

        this.games.set(roomId, {
          state: data.state,
          engineState: data.engineState,
          players: data.players,
          finished: normalizedFinished,
          lastActionAt: data.lastActionAt,
          locked: false,
          finishedHandled: data.finishedHandled,
          stake: data.stake,
        });

        this.logger.warn(`Game restored from Redis room=${roomId}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to restore game from Redis room=${roomId}: ${err?.message ?? err}`,
        );
      }
    }
  }

  private async logGameStarted(
    roomId: string,
    gameType: GameType,
    players: GamePlayer[],
    state: GameState,
  ) {
    await this.replayLog.createLog({
      roomId,
      gameType,
      eventType: 'GAME_STARTED',
      phase: state.phase,
      turnIndex: state.turnIndex,
      payload: {
        players: players.map((p, i) => ({
          userId: p.userId,
          walletId: p.walletId,
          seat: i,
        })),
        payload: state.payload,
      },
    });
  }

  private async logAction(
    roomId: string,
    gameType: GameType,
    playerId: string,
    seat: number,
    action: any,
    state: GameState,
  ) {
    await this.replayLog.createLog({
      roomId,
      gameType,
      userId: playerId,
      seat,
      eventType: 'ACTION_DISPATCHED',
      actionType: action?.type ?? null,
      phase: state.phase,
      turnIndex: state.turnIndex,
      payload: {
        action,
        statePayload: state.payload,
      },
    });
  }

  private async logGameFinished(
    roomId: string,
    gameType: GameType,
    winnerSeat: number | null,
    state: GameState,
    eventType:
      | 'GAME_FINISHED'
      | 'GAME_FORCE_FINISHED'
      | 'ROUND_FINISHED'
      | 'MATCH_FINISHED' = 'GAME_FINISHED',
  ) {
    await this.replayLog.createLog({
      roomId,
      gameType,
      eventType,
      phase: state.phase,
      turnIndex: state.turnIndex,
      seat: winnerSeat,
      payload: {
        winnerSeat,
        payload: state.payload,
      },
    });
  }

  private normalizeWinner(winner: any): number | null {
    if (typeof winner === 'number') return winner;
    if (winner === 'P0') return 0;
    if (winner === 'P1') return 1;
    if (winner === null || winner === undefined) return null;
    return null;
  }

  async startGame(
    roomId: string,
    gameType: GameType,
    players: GamePlayer[],
    mode?: 'SOLO' | 'TEAM',
    options?: Okey101StartOptions,
    stake?: number,
  ): Promise<GameState> {
    if (stake !== undefined && stake <= 0) {
      throw new Error('Invalid stake');
    }

    if (this.games.has(roomId)) {
      throw new Error('Game already started');
    }

    if (!players.length) {
      throw new Error('Cannot start game without players');
    }

    const engine = getEngine(gameType);
    let engineState: unknown;

    const resolvedMode = options?.mode ?? mode;

    if (gameType === GameType.OKEY101) {
      engineState = (engine as any).start(
        players.map((p) => p.userId),
        {
          mode: resolvedMode ?? 'TEAM',
          maxRounds: options?.maxRounds ?? 1,
          scoringMode: options?.scoringMode ?? 'KATLAMASIZ',
        },
      );
    } else if (gameType === GameType.TEXAS_POKER) {
      const numericStake = Number(stake ?? 100);

      engineState = engine.start(
        players.map((p) => p.userId),
        resolvedMode,
        {
          stake: numericStake,
          smallBlind: Math.max(1, Math.floor(numericStake / 20)),
          bigBlind: Math.max(2, Math.floor(numericStake / 10)),
          maxPlayers: players.length,
        },
      );
    } else {
      engineState = engine.start(
        players.map((p) => p.userId),
        resolvedMode,
      );
    }
    const pub = engine.getPublicState(engineState, null);

    const state: GameState = {
      roomId,
      gameType,
      phase: pub.phase ?? (engineState as any)?.phase,
      players,
      turnIndex: typeof pub.turnIndex === 'number' ? pub.turnIndex : 0,
      payload: pub.payload,
      mode: resolvedMode,
    };

    const isFinished = engine.isFinished(engineState);

    this.games.set(roomId, {
      state,
      engineState,
      players,
      finished: isFinished,
      lastActionAt: Date.now(),
      locked: false,
      finishedHandled: false,
      stake,
    });

    const saved = this.games.get(roomId)!;
    await this.persistGameToRedis(roomId, saved);

    try {
      await this.logGameStarted(roomId, gameType, players, state);
    } catch (err: any) {
      this.logger.error(
        `logGameStarted failed room=${roomId}: ${err?.message ?? err}`,
      );
    }

    this.logger.log(`Game started room=${roomId} gameType=${gameType}`);
    return state;
  }

  getState(roomId: string): GameState | undefined {
    return this.games.get(roomId)?.state;
  }

  getInternalState(roomId: string): unknown {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    return entry.engineState;
  }

  hasGame(roomId: string): boolean {
    return this.games.has(roomId);
  }

  isFinished(roomId: string): boolean {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    return entry.finished;
  }

  getLastActionAt(roomId: string): number {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    return entry.lastActionAt;
  }

  isFinishedHandled(roomId: string): boolean {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    return entry.finishedHandled;
  }

  async markFinishedHandled(roomId: string): Promise<void> {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    entry.finishedHandled = true;
    await this.persistGameToRedis(roomId, entry);
  }

  async clearFinishedHandled(roomId: string): Promise<void> {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');
    entry.finishedHandled = false;
    await this.persistGameToRedis(roomId, entry);
  }

  getActiveGamesSnapshot(): ActiveGameSnapshot[] {
    return Array.from(this.games.entries()).map(([roomId, entry]) => ({
      roomId,
      state: entry.state,
      players: entry.players,
      finished: entry.finished,
      lastActionAt: entry.lastActionAt,
      finishedHandled: entry.finishedHandled,
    }));
  }

  private getSeat(entry: StoredGame, userId: string): number {
    const seat = entry.players.findIndex((p) => p.userId === userId);
    if (seat === -1) throw new Error('Player not in game');
    return seat;
  }

  private assertCanAct(entry: StoredGame, playerId: string, action: any) {
    const seat = this.getSeat(entry, playerId);

    if (entry.state.gameType === 'TAVLA') {
      const s = entry.engineState as any;

      if (s?.phase === 'FINISHED') {
        throw new Error('Game finished');
      }

      if (s?.phase === 'OPENING') {
        if (action?.type !== 'ROLL_START') {
          throw new Error('Opening: only ROLL_START');
        }

        if (typeof s.turn === 'number' && s.turn !== seat) {
          throw new Error('Not your turn (opening roll)');
        }

        return;
      }

      if (s?.phase === 'PLAYING') {
        if (action?.type === 'ROLL_START') {
          throw new Error('Already started');
        }

        if (typeof s.turn === 'number' && s.turn !== seat) {
          throw new Error('Not your turn');
        }

        return;
      }
    }
  }

  async dispatch(
    roomId: string,
    playerId: string,
    action: any,
  ): Promise<GameState> {
    if (!action || typeof action.type !== 'string') {
      throw new Error('Invalid action');
    }

    const distributedLocked = await this.acquireRoomLock(roomId);
    if (!distributedLocked) {
      throw new Error('Room locked by another worker');
    }

    const entry = this.games.get(roomId);
    if (!entry) {
      await this.releaseRoomLock(roomId);
      throw new Error('Game not found');
    }

    if (entry.finished) {
      await this.releaseRoomLock(roomId);
      throw new Error('Game already finished');
    }

    if (entry.locked) {
      await this.releaseRoomLock(roomId);
      throw new Error('Action already processing');
    }

    entry.locked = true;

    try {
      const engine = getEngine(entry.state.gameType);

      this.assertCanAct(entry, playerId, action);

      entry.engineState = engine.move(entry.engineState, playerId, action);
      entry.lastActionAt = Date.now();

      const roomPub = engine.getPublicState(entry.engineState, null);

      entry.state = {
        ...entry.state,
        payload: roomPub.payload,
        phase: roomPub.phase,
        turnIndex:
          typeof roomPub.turnIndex === 'number'
            ? roomPub.turnIndex
            : entry.state.turnIndex,
      };

      const seat = this.getSeat(entry, playerId);

      try {
        await this.logAction(
          roomId,
          entry.state.gameType,
          playerId,
          seat,
          action,
          entry.state,
        );
      } catch (err: any) {
        this.logger.error(
          `logAction failed room=${roomId}: ${err?.message ?? err}`,
        );
      }

      if (engine.isFinished(entry.engineState) && !entry.finished) {
        entry.finished = true;

        if (entry.state.gameType === GameType.BLACKJACK) {
          try {
            const bjSettlement = await this.settleBlackjack(roomId);

            if ((bjSettlement as any)?.missingHold) {
              this.logger.warn(`Blackjack missing active hold room=${roomId}`);
            }
          } catch (e: any) {
            this.logger.error(
              `Blackjack settlement failed room=${roomId}: ${e?.message ?? e}`,
            );
          }
        }

        const winnerSeat = this.getWinnerSeat(roomId);

        try {
          await this.logGameFinished(
            roomId,
            entry.state.gameType,
            winnerSeat,
            entry.state,
          );
        } catch (err: any) {
          this.logger.error(
            `logGameFinished failed room=${roomId}: ${err?.message ?? err}`,
          );
        }
      }

      await this.persistGameToRedis(roomId, entry);

      return entry.state;
    } finally {
      entry.locked = false;
      await this.releaseRoomLock(roomId);
    }
  }

  async forceFinish(
    roomId: string,
    winnerSeat: number | null,
  ): Promise<GameState> {
    const distributedLocked = await this.acquireRoomLock(roomId);
    if (!distributedLocked) {
      throw new Error('Room locked by another worker');
    }

    const entry = this.games.get(roomId);
    if (!entry) {
      await this.releaseRoomLock(roomId);
      throw new Error('Game not found');
    }

    if (entry.locked) {
      await this.releaseRoomLock(roomId);
      throw new Error('Action already processing');
    }

    if (entry.finished) {
      await this.releaseRoomLock(roomId);
      return entry.state;
    }

    entry.locked = true;

    try {
      const engine = getEngine(entry.state.gameType);

      entry.engineState = engine.move(entry.engineState, '__SYSTEM__', {
        type: 'FORCE_FINISH',
        winnerSeat,
      });

      entry.lastActionAt = Date.now();
      const roomPub = engine.getPublicState(entry.engineState, null);

      entry.state = {
        ...entry.state,
        payload: roomPub.payload,
        phase: roomPub.phase,
        turnIndex:
          typeof roomPub.turnIndex === 'number'
            ? roomPub.turnIndex
            : entry.state.turnIndex,
      };

      entry.finished = engine.isFinished(entry.engineState);

      try {
        await this.logGameFinished(
          roomId,
          entry.state.gameType,
          winnerSeat,
          entry.state,
          'GAME_FORCE_FINISHED',
        );
      } catch (err: any) {
        this.logger.error(
          `logGameFinished(force) failed room=${roomId}: ${err?.message ?? err}`,
        );
      }

      await this.persistGameToRedis(roomId, entry);

      this.logger.warn(
        `Game force finished room=${roomId} winnerSeat=${winnerSeat}`,
      );

      return entry.state;
    } finally {
      entry.locked = false;
      await this.releaseRoomLock(roomId);
    }
  }

  async finishGame(roomId: string): Promise<GameState> {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');

    const engine = getEngine(entry.state.gameType);

    if (!engine.isFinished(entry.engineState)) {
      throw new Error('Cannot finish: engine not finished');
    }

    this.games.delete(roomId);
    await this.removeGameFromRedis(roomId);

    this.logger.log(`Game removed from memory room=${roomId}`);
    return entry.state;
  }

  getPublicState(roomId: string, viewerUserId: string) {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');

    const viewerIndex = entry.players.findIndex(
      (p) => p.userId === viewerUserId,
    );

    const safeViewerIndex = viewerIndex === -1 ? null : viewerIndex;

    const engine = getEngine(entry.state.gameType);
    const pub = engine.getPublicState(entry.engineState, safeViewerIndex);

    return {
      roomId: entry.state.roomId,
      gameType: entry.state.gameType,
      players: entry.state.players,
      phase: pub.phase,
      turnIndex:
        typeof pub.turnIndex === 'number'
          ? pub.turnIndex
          : entry.state.turnIndex,
      payload: pub.payload ?? {},
    };
  }

  getWinnerSeat(roomId: string): number | null {
    const entry = this.games.get(roomId);
    if (!entry) throw new Error('Game not found');

    const engine = getEngine(entry.state.gameType);
    const rawWinner = engine.getWinner(entry.engineState);

    return this.normalizeWinner(rawWinner);
  }

  async settleBlackjack(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) throw new Error('Game not found');

    const state: any = game.engineState;
    const baseStake = new Decimal(game.stake ?? 10);

    return this.prisma.$transaction(async (tx) => {
      const playerRefId = roomId;
      const houseRefId = `${roomId}:HOUSE`;

      const alreadySettled = await tx.ledgerEntry.findFirst({
        where: {
          OR: [
            { refType: LedgerRefType.GAME, refId: playerRefId },
            { refType: LedgerRefType.GAME, refId: houseRefId },
          ],
          type: { in: [LedgerType.WIN, LedgerType.LOSS] },
        },
      });

      if (alreadySettled) {
        return {
          alreadySettled: true,
          result: state.result,
        };
      }

      const holds = await tx.hold.findMany({
        where: {
          roomId,
          status: 'ACTIVE',
        },
      });

      if (!holds.length) {
        return {
          alreadySettled: false,
          missingHold: true,
          result: state.result,
        };
      }

      const hold = holds[0];

      const houseUser = await tx.user.findUnique({
        where: { email: 'house@system.local' },
        include: { wallet: true },
      });

      if (!houseUser?.wallet) {
        throw new Error('House wallet not found');
      }

      let totalStake = new Decimal(0);
      let totalPayout = new Decimal(0);

      for (const hand of state.hands ?? []) {
        const multiplier = new Decimal(hand.betMultiplier ?? 1);
        const effectiveStake = baseStake.mul(multiplier);

        totalStake = totalStake.plus(effectiveStake);

        let payout = new Decimal(0);

        switch (hand.result) {
          case 'BLACKJACK':
            payout = effectiveStake.mul(2.5);
            break;
          case 'WIN':
            payout = effectiveStake.mul(2);
            break;
          case 'PUSH':
            payout = effectiveStake;
            break;
          case 'SURRENDER':
            payout = effectiveStake.div(2);
            break;
          case 'LOSE':
          case 'BUST':
          default:
            payout = new Decimal(0);
            break;
        }

        totalPayout = totalPayout.plus(payout);
      }

      if (state.insuranceTaken) {
        const insuranceStake = baseStake.mul(0.5);

        const dealerBlackjack =
          Array.isArray(state.dealerHand) &&
          state.dealerHand.length === 2 &&
          state.dealerScore === 21;

        totalStake = totalStake.plus(insuranceStake);

        if (dealerBlackjack) {
          totalPayout = totalPayout.plus(insuranceStake.mul(2));
        }
      }

      if (totalPayout.gt(0)) {
        await tx.ledgerEntry.create({
          data: {
            walletId: hold.walletId,
            type: LedgerType.WIN,
            amount: totalPayout,
            refType: LedgerRefType.GAME,
            refId: playerRefId,
          },
        });
      } else {
        await tx.ledgerEntry.create({
          data: {
            walletId: hold.walletId,
            type: LedgerType.LOSS,
            amount: totalStake,
            refType: LedgerRefType.GAME,
            refId: playerRefId,
          },
        });
      }

      const houseProfit = totalStake.minus(totalPayout);

      if (houseProfit.gt(0)) {
        await tx.ledgerEntry.create({
          data: {
            walletId: houseUser.wallet.id,
            type: LedgerType.WIN,
            amount: houseProfit,
            refType: LedgerRefType.GAME,
            refId: houseRefId,
          },
        });
      } else if (houseProfit.lt(0)) {
        await tx.ledgerEntry.create({
          data: {
            walletId: houseUser.wallet.id,
            type: LedgerType.LOSS,
            amount: houseProfit.abs(),
            refType: LedgerRefType.GAME,
            refId: houseRefId,
          },
        });
      }

      await tx.hold.updateMany({
        where: {
          roomId,
          status: 'ACTIVE',
        },
        data: {
          status: 'CONSUMED',
        },
      });

      return {
        result: state.result,
        totalStake: totalStake.toFixed(),
        totalPayout: totalPayout.toFixed(),
        houseProfit: houseProfit.toFixed(),
        playerRefId,
        houseRefId,
      };
    });
  }

  private async acquireRoomLock(roomId: string): Promise<boolean> {
    const key = this.getRoomLockKey(roomId);

    const result = await this.redis.set(key, '1', {
      NX: true,
      PX: this.ROOM_LOCK_TTL_MS,
    });

    return result === 'OK';
  }

  private async releaseRoomLock(roomId: string): Promise<void> {
    const key = this.getRoomLockKey(roomId);
    await this.redis.del(key);
  }
}
