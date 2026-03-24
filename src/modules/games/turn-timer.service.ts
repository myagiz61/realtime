import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { GameEngineService } from '../games/game-engine.service';
import { RoomService } from '../rooms/rooms.service';
import { GameType } from '@prisma/client';
import { RedisLockService } from '../../common/redis/redis-lock.service';

type TimerConfig = {
  tavlaMs: number;
  okeyMs: number;
  okey101Ms: number;
  batakMs: number;
  spadesMs: number;
  scanIntervalMs: number;
};

@Injectable()
export class TurnTimerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnTimerService.name);

  private readonly config: TimerConfig = {
    tavlaMs: 20_000,
    okeyMs: 15_000,
    okey101Ms: 15_000,
    batakMs: 20_000,
    spadesMs: 20_000,
    scanIntervalMs: 2_000,
  };

  private intervalRef: NodeJS.Timeout | null = null;

  // aynı odada aynı anda iki timer aksiyonu çalışmasın
  private processingRooms = new Set<string>();

  constructor(
    private readonly gameEngine: GameEngineService,
    private readonly roomService: RoomService,
    private readonly redisLock: RedisLockService,
  ) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.intervalRef) return;

    this.intervalRef = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Turn timer tick failed: ${err?.message ?? err}`);
      });
    }, this.config.scanIntervalMs);

    this.logger.log('Turn timer started');
  }

  stop() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
      this.logger.log('Turn timer stopped');
    }
  }

  private async tick() {
    const games = this.gameEngine.getActiveGamesSnapshot();
    const now = Date.now();

    for (const game of games) {
      if (game.state.gameType === 'BLACKJACK') continue;
      if (game.finished) continue;
      if (game.finishedHandled) continue;
      if (this.processingRooms.has(game.roomId)) continue;

      const timeoutMs = this.getTimeoutByGameType(
        game.state.gameType as GameType,
      );
      const elapsed = now - game.lastActionAt;

      if (elapsed < timeoutMs) continue;

      this.processingRooms.add(game.roomId);

      const lockKey = `turn-timeout:${game.roomId}`;
      const lockToken = await this.redisLock.acquire(lockKey, 4000);

      if (!lockToken) {
        this.processingRooms.delete(game.roomId);
        continue;
      }

      try {
        await this.handleTimedOutRoom(game.roomId);
      } catch (err: any) {
        this.logger.error(
          `Timeout handling failed room=${game.roomId}: ${err?.message ?? err}`,
        );
      } finally {
        await this.redisLock.release(lockKey, lockToken);
        this.processingRooms.delete(game.roomId);
      }
    }
  }

  private getTimeoutByGameType(gameType: GameType): number {
    switch (gameType) {
      case 'TAVLA':
        return this.config.tavlaMs;
      case 'OKEY':
        return this.config.okeyMs;
      case 'OKEY101':
        return this.config.okey101Ms;
      case 'BATAK':
        return this.config.batakMs;
      case 'SPADES':
        return this.config.spadesMs;
      default:
        return 15_000;
    }
  }

  private async handleTimedOutRoom(roomId: string) {
    const state = this.gameEngine.getState(roomId);
    if (!state) return;

    const internal = this.gameEngine.getInternalState(roomId) as any;
    if (!internal) return;

    const gameType = state.gameType as GameType;

    switch (gameType) {
      case 'TAVLA':
        await this.handleTavlaTimeout(roomId, state, internal);
        return;

      case 'OKEY':
        await this.handleOkeyTimeout(roomId, state, internal);
        return;

      case 'OKEY101':
        await this.handleOkey101Timeout(roomId, state, internal);
        return;

      case 'BATAK':
        await this.handleBatakTimeout(roomId, state, internal);
        return;

      case 'SPADES':
        await this.handleSpadesTimeout(roomId, state, internal);
        return;

      default:
        this.logger.warn(
          `No timeout strategy for gameType=${gameType}, room=${roomId}`,
        );
    }
  }

  /* =====================================================
     TAVLA
  ===================================================== */

  private async handleTavlaTimeout(roomId: string, state: any, internal: any) {
    const turnIndex = state.turnIndex ?? internal.turn ?? 0;
    const player = state.players?.[turnIndex];
    if (!player) {
      this.logger.warn(
        `Tavla timeout: current player not found room=${roomId}`,
      );
      return;
    }

    // Tavla OPENING ise otomatik başlangıç zarı
    if (internal.phase === 'OPENING') {
      this.logger.warn(
        `Tavla timeout OPENING => auto ROLL_START room=${roomId} player=${player.userId}`,
      );

      this.gameEngine.dispatch(roomId, player.userId, { type: 'ROLL_START' });
      return;
    }

    // Tavla PLAYING ise legalMoves varsa ilkini oynat, yoksa zar at gerekiyorsa zar at, o da yoksa kaybettir
    if (internal.phase === 'PLAYING') {
      const legalMoves =
        internal.legalMoves ?? internal.payload?.legalMoves ?? [];
      const dice = internal.dice ?? internal.payload?.dice ?? [];

      if ((!dice || dice.length === 0) && internal.turn === turnIndex) {
        try {
          this.logger.warn(
            `Tavla timeout PLAYING => auto ROLL room=${roomId} player=${player.userId}`,
          );
          this.gameEngine.dispatch(roomId, player.userId, { type: 'ROLL' });
          return;
        } catch {
          // devam
        }
      }

      if (Array.isArray(legalMoves) && legalMoves.length > 0) {
        this.logger.warn(
          `Tavla timeout PLAYING => auto MOVE room=${roomId} player=${player.userId}`,
        );

        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'MOVE',
          move: legalMoves[0],
        });
        return;
      }
    }

    // En son fallback: rakibi kazandır
    const winnerSeat = turnIndex === 0 ? 1 : 0;
    this.logger.warn(
      `Tavla timeout fallback => force finish room=${roomId} loserSeat=${turnIndex} winnerSeat=${winnerSeat}`,
    );
    this.gameEngine.forceFinish(roomId, winnerSeat);
  }

  /* =====================================================
     OKEY
  ===================================================== */

  private async handleOkeyTimeout(roomId: string, state: any, internal: any) {
    const turnIndex = state.turnIndex ?? internal.turn ?? 0;
    const player = state.players?.[turnIndex];
    if (!player) {
      this.logger.warn(`Okey timeout: current player not found room=${roomId}`);
      return;
    }

    const hand = internal.players?.[turnIndex]?.hand ?? [];
    const drewThisTurn = !!internal.drewThisTurn;

    // Çekmemişse desteden çek
    if (!drewThisTurn) {
      this.logger.warn(
        `Okey timeout => auto DRAW_DECK room=${roomId} player=${player.userId}`,
      );

      try {
        this.gameEngine.dispatch(roomId, player.userId, { type: 'DRAW_DECK' });
      } catch (err) {
        this.logger.warn(
          `Okey auto DRAW_DECK failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    const freshInternal = this.gameEngine.getInternalState(roomId) as any;
    const freshHand = freshInternal.players?.[turnIndex]?.hand ?? [];

    if (!Array.isArray(freshHand) || freshHand.length === 0) {
      this.logger.warn(`Okey timeout: empty hand room=${roomId}`);
      return;
    }

    // Basit strateji: en son taşı at
    const discardTile = freshHand[freshHand.length - 1];

    this.logger.warn(
      `Okey timeout => auto DISCARD room=${roomId} player=${player.userId} tileId=${discardTile.id}`,
    );

    try {
      this.gameEngine.dispatch(roomId, player.userId, {
        type: 'DISCARD',
        tileId: discardTile.id,
      });
      return;
    } catch (err) {
      this.logger.warn(
        `Okey auto DISCARD failed room=${roomId}: ${(err as Error).message}`,
      );
    }

    // olmadıysa ilk taşı dene
    const fallbackTile = freshHand[0];
    if (fallbackTile) {
      try {
        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'DISCARD',
          tileId: fallbackTile.id,
        });
        return;
      } catch (err) {
        this.logger.warn(
          `Okey fallback DISCARD failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    // En son fallback: sıradaki takım/oyuncu kazansın
    const winnerSeat = this.pickNonCurrentWinnerSeat(state.players, turnIndex);
    this.logger.warn(
      `Okey timeout fallback => force finish room=${roomId} loserSeat=${turnIndex} winnerSeat=${winnerSeat}`,
    );
    this.gameEngine.forceFinish(roomId, winnerSeat);
  }

  /* =====================================================
     OKEY101
  ===================================================== */

  private async handleOkey101Timeout(
    roomId: string,
    state: any,
    internal: any,
  ) {
    const turnIndex = state.turnIndex ?? internal.turn ?? 0;
    const player = state.players?.[turnIndex];
    if (!player) {
      this.logger.warn(
        `Okey101 timeout: current player not found room=${roomId}`,
      );
      return;
    }

    const hand = internal.players?.[turnIndex]?.hand ?? [];
    const drewThisTurn = !!internal.drewThisTurn;

    // çekmediyse desteden çek
    if (!drewThisTurn) {
      this.logger.warn(
        `Okey101 timeout => auto DRAW_DECK room=${roomId} player=${player.userId}`,
      );

      try {
        this.gameEngine.dispatch(roomId, player.userId, { type: 'DRAW_DECK' });
      } catch (err) {
        this.logger.warn(
          `Okey101 auto DRAW_DECK failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    const freshInternal = this.gameEngine.getInternalState(roomId) as any;
    const freshHand = freshInternal.players?.[turnIndex]?.hand ?? [];

    if (!Array.isArray(freshHand) || freshHand.length === 0) {
      this.logger.warn(`Okey101 timeout: empty hand room=${roomId}`);
      return;
    }

    // Basit strateji: son indeksi at
    const discardIndex = freshHand.length - 1;

    this.logger.warn(
      `Okey101 timeout => auto DISCARD room=${roomId} player=${player.userId} discardIndex=${discardIndex}`,
    );

    try {
      this.gameEngine.dispatch(roomId, player.userId, {
        type: 'DISCARD',
        tileIndex: discardIndex,
      });
      return;
    } catch (err) {
      this.logger.warn(
        `Okey101 auto DISCARD failed room=${roomId}: ${(err as Error).message}`,
      );
    }

    // fallback ilk indeks
    try {
      this.gameEngine.dispatch(roomId, player.userId, {
        type: 'DISCARD',
        tileIndex: 0,
      });
      return;
    } catch (err) {
      this.logger.warn(
        `Okey101 fallback DISCARD failed room=${roomId}: ${(err as Error).message}`,
      );
    }

    const winnerSeat = this.pickNonCurrentWinnerSeat(state.players, turnIndex);
    this.logger.warn(
      `Okey101 timeout fallback => force finish room=${roomId} loserSeat=${turnIndex} winnerSeat=${winnerSeat}`,
    );
    this.gameEngine.forceFinish(roomId, winnerSeat);
  }

  /* =====================================================
     BATAK
  ===================================================== */

  private async handleBatakTimeout(roomId: string, state: any, internal: any) {
    const turnIndex = state.turnIndex ?? internal.turn ?? 0;
    const player = state.players?.[turnIndex];
    if (!player) {
      this.logger.warn(
        `Batak timeout: current player not found room=${roomId}`,
      );
      return;
    }

    const legalMoves =
      internal.legalMoves ?? internal.payload?.legalMoves ?? [];
    const hand = internal.players?.[turnIndex]?.hand ?? [];

    if (Array.isArray(legalMoves) && legalMoves.length > 0) {
      this.logger.warn(
        `Batak timeout => auto PLAY_CARD room=${roomId} player=${player.userId}`,
      );

      try {
        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'PLAY_CARD',
          card: legalMoves[0],
        });
        return;
      } catch (err) {
        this.logger.warn(
          `Batak auto PLAY_CARD failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    if (Array.isArray(hand) && hand.length > 0) {
      try {
        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'PLAY_CARD',
          card: hand[0],
        });
        return;
      } catch (err) {
        this.logger.warn(
          `Batak fallback PLAY_CARD failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    const winnerSeat = this.pickNonCurrentWinnerSeat(state.players, turnIndex);
    this.logger.warn(
      `Batak timeout fallback => force finish room=${roomId} loserSeat=${turnIndex} winnerSeat=${winnerSeat}`,
    );
    this.gameEngine.forceFinish(roomId, winnerSeat);
  }
  /* =====================================================
   SPADES
===================================================== */

  private async handleSpadesTimeout(roomId: string, state: any, internal: any) {
    const turnIndex = state.turnIndex ?? internal.turn ?? 0;
    const player = state.players?.[turnIndex];

    if (!player) {
      this.logger.warn(`Spades timeout: player not found room=${roomId}`);
      return;
    }

    const phase = internal.phase ?? internal.payload?.phase;

    /* -------------------------
     BIDDING PHASE
  -------------------------- */

    if (phase === 'BIDDING') {
      this.logger.warn(
        `Spades timeout => auto BID room=${roomId} player=${player.userId}`,
      );

      try {
        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'BID',
          bid: 1,
          bidType: 'NORMAL',
        });
        return;
      } catch (err) {
        this.logger.warn(
          `Spades auto BID failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    /* -------------------------
     PLAYING PHASE
  -------------------------- */

    if (phase === 'PLAYING') {
      const hand = internal.players?.[turnIndex]?.hand ?? [];

      if (!Array.isArray(hand) || hand.length === 0) {
        this.logger.warn(`Spades timeout: empty hand room=${roomId}`);
        return;
      }

      const card = hand[0];

      this.logger.warn(
        `Spades timeout => auto PLAY_CARD room=${roomId} player=${player.userId}`,
      );

      try {
        this.gameEngine.dispatch(roomId, player.userId, {
          type: 'PLAY_CARD',
          cardId: card.id,
        });
        return;
      } catch (err) {
        this.logger.warn(
          `Spades auto PLAY_CARD failed room=${roomId}: ${(err as Error).message}`,
        );
      }
    }

    /* -------------------------
     fallback
  -------------------------- */

    const winnerSeat = this.pickNonCurrentWinnerSeat(state.players, turnIndex);

    this.logger.warn(`Spades timeout fallback => force finish room=${roomId}`);

    this.gameEngine.forceFinish(roomId, winnerSeat);
  }

  /* =====================================================
     HELPERS
  ===================================================== */

  private pickNonCurrentWinnerSeat(
    players: any[],
    currentTurnIndex: number,
  ): number | null {
    if (!Array.isArray(players) || players.length === 0) return null;

    for (let i = 0; i < players.length; i++) {
      if (i !== currentTurnIndex) return i;
    }

    return null;
  }
}
