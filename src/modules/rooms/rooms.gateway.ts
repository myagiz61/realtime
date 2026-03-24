import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import { RoomService } from './rooms.service';
import { GameType, JoinRoomDto } from './rooms.dto';
import { GameEngineService } from '../games/game-engine.service';
import { validateOkeyAction } from '../games/okey/validateOkeyAction';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validateSpadesAction } from '../games/spades/validateSpadesAction';
import { validateTexasAction } from '../games/texas/validateTexasAction';
import { GamePlayer } from '../games/games.types';

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: '*' },
})
export class RoomsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  io!: Server;

  private readonly logger = new Logger(RoomsGateway.name);

  private afkInterval?: NodeJS.Timeout;
  private waitingInterval?: NodeJS.Timeout;
  private readonly botSuggestedRooms = new Set<string>();
  private eventRate = new Map<string, number[]>();

  private actionRate = new Map<string, number[]>();
  constructor(
    private readonly rooms: RoomService,
    private readonly gameEngine: GameEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    try {
      const recovery = await this.rooms.cancelPlayingRoomsOnStartup();

      this.logger.log(`Crash recovery completed: ${JSON.stringify(recovery)}`);
    } catch (err: any) {
      this.logger.error(`Crash recovery failed: ${err?.message ?? err}`);
    }

    this.afkInterval = setInterval(() => {
      this.checkAfkGames().catch((err) => {
        this.logger.error(`checkAfkGames failed: ${err?.message ?? err}`);
      });
    }, 5000);

    this.waitingInterval = setInterval(() => {
      this.checkWaitingRooms().catch((err) => {
        this.logger.error(`checkWaitingRooms failed: ${err?.message ?? err}`);
      });
    }, 5000);
  }

  onModuleDestroy() {
    if (this.afkInterval) clearInterval(this.afkInterval);
    if (this.waitingInterval) clearInterval(this.waitingInterval);
  }

  /* =====================================================
     HELPERS
  ===================================================== */

  private checkEventRateLimit(key: string, max = 5, windowMs = 5000) {
    const now = Date.now();
    const hits = this.eventRate.get(key) ?? [];
    const recent = hits.filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      throw new Error('Too many requests');
    }

    recent.push(now);
    this.eventRate.set(key, recent);
  }

  private checkActionRateLimit(roomId: string, userId: string) {
    const now = Date.now();

    const WINDOW_MS = 1000;
    const MAX_ACTIONS = 5;

    const key = `${roomId}:${userId}`;
    const actions = this.actionRate.get(key) ?? [];

    const recent = actions.filter((t) => now - t < WINDOW_MS);

    if (recent.length >= MAX_ACTIONS) {
      throw new Error('Too many actions');
    }

    recent.push(now);
    this.actionRate.set(key, recent);
  }

  private requiredPlayers(gameType: GameType): number {
    switch (gameType) {
      case 'BLACKJACK':
        return 1;

      case 'OKEY':
      case 'OKEY101':
      case 'BATAK':
      case 'SPADES':
      case 'TEXAS_POKER':
        return 4;

      case 'TAVLA':
      case 'PISTI':
        return 2;

      default:
        return 2;
    }
  }

  private assertSocketContext(socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;

    if (!roomId || !userId) {
      throw new Error('Not joined to a room');
    }

    return { roomId, userId };
  }

  private validateActionByGameType(
    gameType: GameType,
    action: any,
    state: any,
    seat: number,
  ) {
    switch (gameType) {
      case 'OKEY':
        validateOkeyAction(action);
        return;

      case 'SPADES':
        if (!state) {
          throw new Error('Spades engine state missing');
        }

        validateSpadesAction(state, seat, action);
        return;

      case 'TEXAS_POKER':
        validateTexasAction(action);
        return;

      case 'TAVLA':
      case 'OKEY101':
      case 'BATAK':
      case 'PISTI':
      default:
        return;
    }
  }

  private getAfkWinnerSeat(entry: any): number | null {
    const loserSeat = entry.state.turnIndex;
    const playerCount = entry.players.length;

    if (typeof loserSeat !== 'number' || playerCount < 2) {
      return null;
    }

    if (entry.state.mode === 'TEAM' && playerCount === 4) {
      const loserTeam = loserSeat % 2;
      const opponentSeats = entry.players
        .map((p: any) => p.seat)
        .filter((seat: number) => seat % 2 !== loserTeam)
        .sort((a: number, b: number) => a - b);

      return opponentSeats.length ? opponentSeats[0] : null;
    }

    return (loserSeat + 1) % playerCount;
  }

  private async emitWaitingState(roomId: string) {
    const room = await this.rooms.getRoomForEngine(roomId);

    this.io.to(roomId).emit('game:state', {
      roomId,
      phase: 'WAITING',
      turnIndex: 0,
      payload: { phase: 'WAITING' },
      players: room.players,
    });
  }

  private async emitViewerAwareState(roomId: string) {
    const sockets = await this.io.in(roomId).fetchSockets();
    const game = this.gameEngine.getState(roomId);
    if (!game) return;

    for (const s of sockets) {
      const viewerId = s.data.userId;
      if (!viewerId) continue;

      const view = this.gameEngine.getPublicState(roomId, viewerId);
      const myIndex = game.players.findIndex((p) => p.userId === viewerId);

      s.emit('game:state', {
        roomId,
        gameType: game.gameType,
        phase: view.phase,
        turnIndex: view.turnIndex,
        payload: view.payload,
        players: game.players.map((p) => ({
          userId: p.userId,
          seat: p.seat,
        })),
        myUserId: viewerId,
        myIndex,
      });
    }
  }

  private normalizePayload(raw: any) {
    if (!raw) return null;

    let payload = raw;

    for (let i = 0; i < 5 && payload?.payload; i++) {
      payload = payload.payload;
    }
    return payload;
  }

  private async handleGameFinished(roomId: string, finishedState?: any) {
    if (this.gameEngine.isFinishedHandled(roomId)) return;
    await this.gameEngine.markFinishedHandled(roomId);

    try {
      const game = finishedState ?? this.gameEngine.getState(roomId);
      if (!game) return;

      const rawPayload = finishedState?.payload ?? game.payload;
      const payload = this.normalizePayload(rawPayload);

      const winnerSeat = this.gameEngine.getWinnerSeat(roomId);

      let winnerUserId: string | null = null;

      /**
       * BLACKJACK winner logic
       */
      if (game.gameType === 'BLACKJACK') {
        const outcome = payload?.outcome?.result;

        if (outcome === 'WIN' || outcome === 'BLACKJACK') {
          const winner = game.players[0];
          if (winner) winnerUserId = winner.userId;
        }

        if (outcome === 'LOSE' || outcome === 'BUST') {
          winnerUserId = 'HOUSE';
        }
      } else if (game.gameType === 'TEXAS_POKER') {
        /**
         * TEXAS winner logic
         */
        const winners = payload?.winners ?? [];

        if (winners.length) {
          const first = winners[0];
          const player = game.players.find(
            (p: GamePlayer) => p.seat === first.seat,
          );
          if (player) winnerUserId = player.userId;
        }
      } else {
        /**
         * Other games
         */
        if (winnerSeat !== null) {
          const winner = game.players[winnerSeat];
          if (winner) winnerUserId = winner.userId;
        }
      }

      let result: any;

      /**
       * BLACKJACK settlement
       */
      if (game.gameType === 'BLACKJACK') {
        const settlement = await this.gameEngine.settleBlackjack(roomId);

        await this.rooms.markRoomFinished(roomId);

        const outcomeData = payload?.outcome ?? null;

        result = {
          roomId,
          blackjack: true,
          outcome: outcomeData?.result ?? null,
          playerTotal: outcomeData?.hands?.[0]?.total ?? null,
          dealerScore: outcomeData?.dealerScore ?? null,
          winnerSeat: outcomeData?.winner ?? null,
          settlement,
        };
      } else if (game.gameType === 'TEXAS_POKER') {
        /**
         * TEXAS settlement
         */
        const payloadWinners = payload?.winners ?? [];

        if (!payloadWinners.length) {
          throw new Error('Texas winners missing');
        }

        const room = await this.rooms.getRoomForEngine(roomId);

        const winners = payloadWinners.map((w: any) => {
          const player = room.players.find((p) => p.seat === w.seat);

          if (!player) {
            throw new Error(`Winner seat ${w.seat} not found`);
          }

          return {
            seat: w.seat,
            userId: player.userId,
            walletId: player.walletId,
            amount: w.amount,
          };
        });

        const settlement = await this.rooms.finishTexasRoom({
          roomId,
          winners,
          feePercent: 5,
        });

        await this.rooms.markRoomFinished(roomId);

        result = {
          roomId,
          texas: true,
          winners,
          settlement,
        };
      } else {
        /**
         * POT games settlement
         */
        result = await this.rooms.finishRoom({
          roomId,
          feePercent: 5,
        });
      }

      /**
       * notify clients
       */
      this.io.to(roomId).emit('room:finished', {
        roomId,
        winnerUserId,
        result,
      });

      /**
       * cleanup game engine memory
       */
      await this.gameEngine.finishGame(roomId);
    } catch (err) {
      await this.gameEngine.clearFinishedHandled(roomId);
      throw err;
    }
    this.botSuggestedRooms.delete(roomId);
  }

  private async checkAfkGames() {
    const AFK_TIMEOUT_MS = 60_000;
    const now = Date.now();

    const games = this.gameEngine.getActiveGamesSnapshot();

    for (const entry of games) {
      if (entry.finished) continue;

      try {
        if (this.gameEngine.isFinished(entry.roomId)) continue;
      } catch {
        continue;
      }

      if (now - entry.lastActionAt < AFK_TIMEOUT_MS) continue;

      if (
        !['TAVLA', 'OKEY', 'OKEY101', 'BATAK', 'PISTI', 'SPADES'].includes(
          entry.state.gameType,
        )
      ) {
        continue;
      }

      const loserSeat = entry.state.turnIndex;
      let winnerSeat: number | null = null;

      if (entry.state.mode === 'TEAM' && entry.players.length === 4) {
        const loserTeam = loserSeat % 2;
        const opponentSeats = entry.players
          .map((p) => p.seat)
          .filter((seat) => seat % 2 !== loserTeam)
          .sort((a, b) => a - b);

        winnerSeat = opponentSeats.length ? opponentSeats[0] : null;
      } else {
        winnerSeat = (loserSeat + 1) % entry.players.length;
      }

      if (winnerSeat === null) continue;

      try {
        await this.gameEngine.forceFinish(entry.roomId, winnerSeat);
        await this.handleGameFinished(entry.roomId);
      } catch (err: any) {
        const msg = err?.message ?? '';
        if (
          !msg.includes('Game already finished') &&
          !msg.includes('Game not found') &&
          !msg.includes('Player not found')
        ) {
          throw err;
        }
      }
    }
  }
  private async checkWaitingRooms() {
    const WAIT_BOT_SUGGEST_MS = 30_000;
    const now = Date.now();

    const rooms = await this.rooms.getWaitingRooms();

    for (const room of rooms) {
      if (room.playerCount >= room.requiredPlayers) continue;

      const waitedMs = now - new Date(room.createdAt).getTime();
      if (waitedMs < WAIT_BOT_SUGGEST_MS) continue;

      if (this.botSuggestedRooms.has(room.roomId)) continue;

      this.botSuggestedRooms.add(room.roomId);

      this.io.to(room.roomId).emit('room:bot_available', {
        roomId: room.roomId,
        gameType: room.gameType,
        waitedMs,
        message: 'Rakip bulunamadı. Bot ile oynamak ister misin?',
      });
    }
  }

  /* =====================================================
     CONNECTION
  ===================================================== */

  async handleConnection(socket: Socket) {
    this.logger.log(`Socket connected: ${socket.id}`);

    const userId = socket.data.userId as string | undefined;
    if (!userId) return;

    try {
      const activePlayer = await this.rooms.findActiveRoomByUser(userId);
      if (!activePlayer) return;

      const roomId = activePlayer.roomId;

      socket.data.roomId = roomId;
      await socket.join(roomId);

      await this.rooms.markReconnected({ roomId, userId });

      const room = await this.rooms.getRoomForEngine(roomId);
      const game = this.gameEngine.getState(roomId);

      if (!game) {
        socket.emit('game:state', {
          roomId,
          phase: 'WAITING',
          turnIndex: 0,
          payload: { phase: 'WAITING' },
          players: room.players,
        });
      } else {
        const view = this.gameEngine.getPublicState(roomId, userId);

        socket.emit('game:state', {
          roomId,
          phase: view.phase,
          turnIndex: view.turnIndex,
          payload: view.payload,
          players: game.players,
        });
      }

      this.io.to(roomId).emit('room:player_reconnected', {
        roomId,
        userId,
      });
    } catch (err: any) {
      this.logger.error(
        `handleConnection reconnect failed socket=${socket.id}: ${err?.message ?? err}`,
      );
    }
  }

  /* =====================================================
    DİSCONNECT
   ===================================================== */

  async handleDisconnect(socket: Socket) {
    this.logger.log(`Socket disconnected: ${socket.id}`);

    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;

    if (!roomId || !userId) return;

    this.actionRate.delete(`${roomId}:${userId}`);
    this.eventRate.delete(`join:${userId}`);
    this.eventRate.delete(`reconnect:${userId}`);
    this.eventRate.delete(`bot:${roomId}:${userId}`);
    try {
      await this.rooms.markDisconnected({
        roomId,
        userId,
      });

      this.io.to(roomId).emit('room:player_disconnected', {
        roomId,
        userId,
      });
    } catch (err: any) {
      this.logger.error(
        `handleDisconnect failed room=${roomId} user=${userId}: ${
          err?.message ?? err
        }`,
      );
    }
  }

  /* =====================================================
     JOIN ROOM
  ===================================================== */

  @SubscribeMessage('room:join')
  async roomJoin(
    @MessageBody()
    body: {
      userId: string;
      gameType: GameType;
      stake: number;
      mode?: 'SOLO' | 'TEAM';
    },
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      this.checkEventRateLimit(`join:${body.userId}`, 3, 5000);

      const res = await this.rooms.joinOrCreate(body as JoinRoomDto);

      socket.data.userId = body.userId;
      socket.data.roomId = res.roomId;

      await socket.join(res.roomId);

      socket.emit('room:joined', {
        roomId: res.roomId,
        status: res.status,
        userId: body.userId,
        mode: res.mode,
      });

      this.io.to(res.roomId).emit('room:state', {
        roomId: res.roomId,
        status: res.status,
      });
      const game = this.gameEngine.getState(res.roomId);

      if (res.status === 'WAITING') {
        await this.emitWaitingState(res.roomId);
        return;
      }

      if (!game) {
        const room = await this.rooms.getRoomForEngine(res.roomId);

        await this.gameEngine.startGame(
          room.roomId,
          room.gameType,
          room.players,
          room.mode,
          undefined,
          Number(room.stake),
        );
      }

      this.botSuggestedRooms.delete(res.roomId);

      this.io.to(res.roomId).emit('room:match_found', {
        roomId: res.roomId,
      });

      await this.emitViewerAwareState(res.roomId);

      const state = this.gameEngine.getState(res.roomId);

      if (state?.phase === 'FINISHED') {
        await this.handleGameFinished(res.roomId, state);
      }
    } catch (e: any) {
      this.logger.error(`room:join failed: ${e?.message ?? e}`);

      socket.emit('room:error', {
        message: e?.message ?? 'Unknown error',
      });
    }
  }

  /* =====================================================
     LEAVE ROOM
  ===================================================== */

  @SubscribeMessage('room:leave')
  async roomLeave(
    @MessageBody() body: { userId: string; roomId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      const res = await this.rooms.leaveRoom(body);

      await socket.leave(body.roomId);

      if (socket.data.roomId === body.roomId) {
        socket.data.roomId = undefined;
      }

      this.io.to(body.roomId).emit('room:state', {
        roomId: body.roomId,
        status: 'WAITING',
        left: res.left,
      });

      socket.emit('room:left', res);
      return res;
    } catch (e: any) {
      this.logger.error(`room:leave failed: ${e?.message ?? e}`);

      return {
        ok: false,
        message: e?.message ?? 'Leave failed',
      };
    }
  }

  /* =====================================================
     RECONNECT
  ===================================================== */

  @SubscribeMessage('room:reconnect')
  async roomReconnect(
    @MessageBody() body: { userId: string; roomId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      this.checkEventRateLimit(`reconnect:${body.userId}`, 5, 5000);
      await this.rooms.validatePlayerInRoom(body.roomId, body.userId);

      socket.data.userId = body.userId;
      socket.data.roomId = body.roomId;

      await socket.join(body.roomId);

      await this.rooms.markReconnected({
        roomId: body.roomId,
        userId: body.userId,
      });

      const room = await this.rooms.getRoomForEngine(body.roomId);
      const game = this.gameEngine.getState(body.roomId);

      if (!game) {
        socket.emit('game:state', {
          roomId: body.roomId,
          phase: 'WAITING',
          turnIndex: 0,
          payload: { phase: 'WAITING' },
          players: room.players,
        });
      } else {
        const view = this.gameEngine.getPublicState(body.roomId, body.userId);

        socket.emit('game:state', {
          roomId: body.roomId,
          phase: view.phase,
          turnIndex: view.turnIndex,
          payload: view.payload,
          players: game.players,
        });
      }

      this.io.to(body.roomId).emit('room:player_reconnected', {
        roomId: body.roomId,
        userId: body.userId,
      });

      return { ok: true, roomId: body.roomId };
    } catch (e: any) {
      this.logger.error(`room:reconnect failed: ${e?.message ?? e}`);

      return {
        ok: false,
        message: e?.message ?? 'Reconnect failed',
      };
    }
  }

  /* =====================================================
     GAME ACTION
  ===================================================== */

  @SubscribeMessage('game:action')
  async gameAction(
    @MessageBody() body: { action: any },
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      const { roomId, userId } = this.assertSocketContext(socket);

      this.checkActionRateLimit(roomId, userId);

      const game = this.gameEngine.getState(roomId);

      if (!game) {
        return { ok: false, message: 'Game not found' };
      }

      const seat = game.players.findIndex((p) => p.userId === userId);

      if (seat === -1) {
        throw new Error('Player not found');
      }

      const engineState = this.gameEngine.getInternalState(roomId) as any;

      if (game.gameType === 'SPADES') {
        console.log('SPADES DEBUG', {
          roomId,
          seat,
          action: body.action,
          hasState: !!engineState,
          players: engineState?.players?.length,
          phase: engineState?.phase,
          turn: engineState?.turn,
        });
      }

      this.validateActionByGameType(
        game.gameType,
        body.action,
        engineState,
        seat,
      );

      const state = (await this.gameEngine.dispatch(
        roomId,
        userId,
        body.action,
      )) as any;
      await this.emitViewerAwareState(roomId);

      /**
       * SPADES dahil tüm oyunlar için bitiş kontrolü
       */
      if (state.phase === 'FINISHED' || state.phase === 'MATCH_FINISHED') {
        await this.handleGameFinished(roomId, state);
      }

      return { ok: true };
    } catch (e: any) {
      this.logger.error(`game:action failed: ${e?.message ?? e}`);

      return {
        ok: false,
        message: e?.message ?? 'Unknown error',
      };
    }
  }

  /* =====================================================
     START WITH BOT
  ===================================================== */

  @SubscribeMessage('room:start_with_bot')
  async startWithBot(@ConnectedSocket() socket: Socket) {
    try {
      const { roomId, userId } = this.assertSocketContext(socket);

      this.checkEventRateLimit(`bot:${roomId}:${userId}`, 2, 10000);

      const roomBefore = await this.rooms.getRoomForEngine(roomId);
      const requiredPlayers = this.requiredPlayers(roomBefore.gameType);
      const missing = requiredPlayers - roomBefore.players.length;

      if (missing <= 0) {
        return { ok: false, message: 'Room already full' };
      }

      const bots: string[] = [];

      for (let i = 0; i < missing; i++) {
        const botUserId = `BOT_${roomId.slice(0, 6)}_${i + 1}`;

        await this.rooms.addBotToRoom({
          roomId,
          botUserId,
        });

        bots.push(botUserId);
      }

      this.botSuggestedRooms.delete(roomId);

      this.io.to(roomId).emit('room:state', {
        roomId,
        status: 'PLAYING',
      });

      const updatedRoom = await this.rooms.getRoomForEngine(roomId);

      if (!this.gameEngine.getState(roomId)) {
        await this.gameEngine.startGame(
          updatedRoom.roomId,
          updatedRoom.gameType,
          updatedRoom.players,
          updatedRoom.mode,
        );
      }

      this.io.to(roomId).emit('room:match_found', {
        roomId,
        bot: true,
      });

      await this.emitViewerAwareState(roomId);

      return {
        ok: true,
        roomId,
        bots,
        status: 'PLAYING',
      };
    } catch (e: any) {
      this.logger.error(`room:start_with_bot failed: ${e?.message ?? e}`);

      return {
        ok: false,
        message: e?.message ?? 'Unknown error',
      };
    }
  }

  /* =====================================================
     PING
  ===================================================== */

  @SubscribeMessage('room:ping')
  async ping(@ConnectedSocket() socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    this.checkEventRateLimit(`ping:${userId}`, 10, 5000);
    if (roomId && userId) {
      await this.rooms.touchPlayer(roomId, userId);
    }

    socket.emit('room:pong', { ts: Date.now() });
  }

  @SubscribeMessage('room:find')
  async roomFind(
    @MessageBody()
    body: {
      userId: string;
      gameType: GameType;
      stake: number;
      mode?: 'SOLO' | 'TEAM';
    },
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      const res = await this.rooms.joinOrCreate(body);

      socket.data.userId = body.userId;
      socket.data.roomId = res.roomId;

      await socket.join(res.roomId); // ✅ artık hata yok

      if (res.status === 'WAITING') {
        socket.emit('room:joined', {
          roomId: res.roomId,
          status: res.status,
        });

        await this.emitWaitingState(res.roomId);
        return;
      }

      const game = this.gameEngine.getState(res.roomId);

      if (!game) {
        const room = await this.rooms.getRoomForEngine(res.roomId);

        await this.gameEngine.startGame(
          room.roomId,
          room.gameType,
          room.players,
          room.mode,
          undefined,
          Number(room.stake),
        );
      }

      this.io.to(res.roomId).emit('room:match_found', {
        roomId: res.roomId,
      });

      await this.emitViewerAwareState(res.roomId);
    } catch (e: any) {
      socket.emit('room:error', {
        message: e?.message ?? 'Unknown error',
      });
    }
  }
  @SubscribeMessage('room:sync')
  async handleRoomSync(
    @MessageBody()
    body: { roomId: string; userId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const { roomId } = body;
    const userId = body.userId || socket.data.userId;

    if (!userId) {
      socket.emit('room:error', { message: 'No userId' });
      return;
    }

    socket.data.userId = userId; // 🔥 KRİTİK
    socket.data.roomId = roomId;

    await socket.join(roomId);

    const game = this.gameEngine.getState(roomId);

    if (!game) {
      const room = await this.rooms.getRoomForEngine(roomId);

      socket.emit('game:state', {
        roomId,
        gameType: room.gameType,
        phase: 'WAITING',
        turnIndex: 0,
        payload: { phase: 'WAITING' },
        players: room.players,
      });

      return;
    }

    const view = this.gameEngine.getPublicState(roomId, userId);

    socket.emit('game:state', {
      roomId,
      gameType: game.gameType,
      phase: view.phase,
      turnIndex: view.turnIndex,
      payload: view.payload ?? {},
      players: game.players,
      myUserId: userId,
      myIndex: game.players.findIndex((p) => p.userId === userId),
    });
  }
}
