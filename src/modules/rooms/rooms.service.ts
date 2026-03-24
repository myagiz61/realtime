import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  GameMode,
  HoldStatus,
  LedgerRefType,
  LedgerType,
  RoomStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { FinishRoomDto, JoinRoomDto, LeaveRoomDto } from './rooms.dto';
import { GameEngineService } from '../games/game-engine.service';
import { calculateOkeyScore } from '../games/okey/okey.scoring';
import { FraudDetectionService } from '../games/fraud-detection.service';
import { RiskEngineService } from '../games/risk-engine.service';
import { GameType } from '@prisma/client';
@Injectable()
export class RoomService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private gameEngine: GameEngineService,
    private fraudDetection: FraudDetectionService,
    private riskEngine: RiskEngineService,
  ) {}

  private readonly DISCONNECT_GRACE_MS = 30_000;

  /* ===============================
     GAME CONFIG
  =============================== */

  private requiredPlayers(gameType: GameType): number {
    switch (gameType) {
      case 'BLACKJACK':
        return 1;
      case 'BATAK':
      case 'OKEY':
      case 'OKEY101':
      case 'SPADES':
      case 'TEXAS_POKER':
        return 4;

      case 'TAVLA':
      case 'PISTI':
      default:
        return 2;
    }
  }

  private getTeamOfSeat(seat: number): number {
    return seat % 2;
  }

  private toDecimal(value: string | number): Decimal {
    const v = typeof value === 'number' ? value.toString() : value;
    const d = new Decimal(v);
    if (d.lte(0)) throw new BadRequestException('Invalid stake');
    return d;
  }

  private decToString(d: Decimal): string {
    return d.toFixed();
  }

  private getDefaultMode(gameType: GameType, mode?: string): GameMode {
    if (mode && (mode === 'SOLO' || mode === 'TEAM')) {
      return mode as GameMode;
    }

    if (
      gameType === 'OKEY' ||
      gameType === 'OKEY101' ||
      gameType === 'BATAK' ||
      gameType === 'SPADES'
    ) {
      return GameMode.TEAM;
    }

    return GameMode.SOLO;
  }

  /* ===============================
     JOIN OR CREATE (TX-SAFE)
  =============================== */

  // SADECE kritik değişiklikleri işaretledim

  async joinOrCreate(params: JoinRoomDto) {
    const { userId, gameType } = params;
    const mode = this.getDefaultMode(gameType, params.mode);
    const stake = this.toDecimal(params.stake);
    const need = this.requiredPlayers(gameType);

    return this.prisma.$transaction(async (tx) => {
      const active = await tx.roomPlayer.findFirst({
        where: {
          userId,
          room: {
            status: { in: [RoomStatus.WAITING, RoomStatus.PLAYING] },
          },
        },
        select: { roomId: true },
      });

      if (active) {
        throw new ConflictException('User already in an active room');
      }

      let wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        const user = await tx.user.create({
          data: {
            id: userId,
            email: `${userId}@bot.test`,
            username: `test_${userId}`,
            password: 'test123',
            role: 'USER',
            status: 'ACTIVE',
          },
        });

        wallet = await tx.wallet.create({
          data: { userId: user.id },
        });

        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            type: 'DEPOSIT',
            amount: this.toDecimal(100000),
            refType: 'ADMIN',
            refId: 'BOT_INIT',
          },
        });
      }

      let room = await tx.room.findFirst({
        where: {
          gameType,
          stake,
          status: RoomStatus.WAITING,
          mode,

          ...(gameType === 'OKEY101'
            ? {
                okey101ScoringMode: (params as any).scoringMode ?? 'KATLAMASIZ',
                okey101MaxRounds: (params as any).maxRounds ?? 1,
              }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!room) {
        /* =====================================
         OKEY101 AYARLARI
      ===================================== */

        const okey101ScoringMode =
          gameType === 'OKEY101'
            ? ((params as any).scoringMode ?? 'KATLAMASIZ')
            : null;

        const okey101MaxRounds =
          gameType === 'OKEY101' ? ((params as any).maxRounds ?? 1) : null;

        room = await tx.room.create({
          data: {
            gameType,
            stake,
            status: RoomStatus.WAITING,
            mode,

            // 🔴 YENİ
            okey101ScoringMode,
            okey101MaxRounds,
          },
        });
      }

      const currentCount = await tx.roomPlayer.count({
        where: { roomId: room.id },
      });

      if (currentCount >= need) {
        throw new ConflictException('Room full');
      }

      const alreadyJoined = await tx.roomPlayer.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId,
          },
        },
      });

      if (alreadyJoined) {
        throw new ConflictException('Already joined');
      }

      await this.wallet.holdForRoomTx(tx, wallet.id, room.id, stake);

      await tx.roomPlayer.create({
        data: {
          roomId: room.id,
          userId,
          walletId: wallet.id,
        },
      });

      const playerCount = await tx.roomPlayer.count({
        where: { roomId: room.id },
      });

      if (playerCount === need) {
        await tx.room.update({
          where: { id: room.id },
          data: { status: RoomStatus.PLAYING },
        });
      }

      const freshRoom = await tx.room.findUnique({
        where: { id: room.id },
        select: {
          status: true,
          okey101ScoringMode: true,
          okey101MaxRounds: true,
        },
      });

      return {
        roomId: room.id,
        status: freshRoom!.status,
        playerCount,
        requiredPlayers: need,
        gameType,
        mode,
        stake: this.decToString(stake),

        // 🔴 OKEY101 için frontend'e dönüyoruz
        scoringMode: freshRoom!.okey101ScoringMode,
        maxRounds: freshRoom!.okey101MaxRounds,
      };
    });
  }

  /* ===============================
     LEAVE (WAITING ONLY)
  =============================== */

  async leaveRoom(params: LeaveRoomDto) {
    const { userId, roomId } = params;

    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { id: roomId } });
      if (!room) throw new NotFoundException('Room not found');

      if (room.status !== RoomStatus.WAITING) {
        throw new BadRequestException('Cannot leave after game started');
      }

      const player = await tx.roomPlayer.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      if (!player) throw new NotFoundException('Player not in room');

      const hold = await tx.hold.findFirst({
        where: {
          roomId,
          walletId: player.walletId,
          status: 'ACTIVE',
        },
      });

      await tx.roomPlayer.delete({
        where: { roomId_userId: { roomId, userId } },
      });

      if (hold) {
        await this.wallet.releaseHoldByIdTx(tx, hold.id);
      }

      const left = await tx.roomPlayer.count({
        where: { roomId },
      });

      if (left === 0) {
        await tx.room.update({
          where: { id: roomId },
          data: { status: RoomStatus.CANCELED },
        });
      }

      return { ok: true, roomId, left };
    });
  }

  /* ===============================
     CANCEL (WAITING ONLY)
  =============================== */

  async cancelRoom(roomId: string) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
      });

      if (!room) throw new NotFoundException('Room not found');

      if (room.status === RoomStatus.CANCELED) {
        return { ok: true, released: 0, roomId };
      }

      if (room.status !== RoomStatus.WAITING) {
        throw new BadRequestException('Only WAITING rooms can be canceled');
      }

      const holds = await tx.hold.findMany({
        where: {
          roomId,
          status: 'ACTIVE',
        },
      });

      for (const h of holds) {
        await this.wallet.releaseHoldByIdTx(tx, h.id);
      }

      await tx.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.CANCELED },
      });

      return {
        ok: true,
        released: holds.length,
        roomId,
      };
    });
  }

  /* ===============================
     FINISH (PLAYING ONLY)
  =============================== */

  async finishRoom(params: FinishRoomDto) {
    const { roomId } = params;
    const feePercent = params.feePercent ?? 5;

    if (feePercent < 0) {
      throw new BadRequestException('Invalid feePercent');
    }

    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { players: true },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      if (room.gameType === 'BLACKJACK') {
        if (room.status === RoomStatus.FINISHED) {
          return {
            roomId,
            blackjack: true,
            alreadyFinished: true,
          };
        }

        if (room.status !== RoomStatus.PLAYING) {
          throw new BadRequestException(
            'Only PLAYING blackjack rooms can be finished',
          );
        }

        await tx.room.update({
          where: { id: roomId },
          data: { status: RoomStatus.FINISHED },
        });

        return {
          roomId,
          blackjack: true,
          redirected: true,
        };
      }

      if (room.status === RoomStatus.FINISHED) {
        throw new ConflictException('Room already finished');
      }

      const lock = await tx.room.updateMany({
        where: {
          id: roomId,
          status: RoomStatus.PLAYING,
        },
        data: {
          status: RoomStatus.FINISHED,
        },
      });

      if (lock.count === 0) {
        throw new ConflictException('Room already settled or not playing');
      }

      const holds = await tx.hold.findMany({
        where: { roomId, status: 'ACTIVE' },
      });

      if (!holds.length) {
        throw new ConflictException('No active holds found for room');
      }

      const alreadyPaid = await tx.ledgerEntry.findFirst({
        where: {
          refType: LedgerRefType.GAME,
          refId: roomId,
          type: LedgerType.WIN,
        },
      });

      if (alreadyPaid) {
        throw new ConflictException('Room already settled');
      }

      const roomState = this.gameEngine.getState(roomId);
      if (!roomState) {
        throw new NotFoundException('Game state not found');
      }

      const internalState = this.gameEngine.getInternalState(roomId) as any;
      if (!internalState) {
        throw new NotFoundException('Internal engine state not found');
      }

      const finishedPhases = ['FINISHED', 'MATCH_FINISHED'];

      if (!finishedPhases.includes(internalState.phase)) {
        throw new ConflictException('Game not finished in engine');
      }

      const playersWithSeat = room.players
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((p, i) => ({
          ...p,
          seat: i,
        }));

      const engineWinnerSeat = this.gameEngine.getWinnerSeat(roomId);

      let engineWinnerWalletId: string | null = null;
      let engineWinnerTeam: number | null = null;
      let finishReason: string | null = null;

      if (engineWinnerSeat !== null) {
        const winnerPlayer = playersWithSeat.find(
          (p) => p.seat === engineWinnerSeat,
        );

        if (!winnerPlayer) {
          throw new BadRequestException(
            `Winner seat ${engineWinnerSeat} not found in room players`,
          );
        }

        engineWinnerWalletId = winnerPlayer.walletId;

        if (room.mode === 'TEAM') {
          engineWinnerTeam = this.getTeamOfSeat(engineWinnerSeat);
        }
      }

      let scoreResult: any = null;
      if (room.gameType === 'OKEY') {
        scoreResult = calculateOkeyScore({
          ...internalState,
          winnerSeat: engineWinnerSeat,
          winnerTeam:
            room.mode === 'TEAM' && engineWinnerSeat !== null
              ? this.getTeamOfSeat(engineWinnerSeat)
              : null,
          players: (internalState.players ?? []).map((p: any) => ({
            ...p,
            hand: p.hand ?? [],
          })),
        });

        if (scoreResult) {
          finishReason = scoreResult.finishReason ?? null;

          if (
            room.mode === 'TEAM' &&
            typeof scoreResult.winnerTeam === 'number'
          ) {
            engineWinnerTeam = scoreResult.winnerTeam;
          }
        }
      }

      let result: any;

      if (room.mode === 'SOLO') {
        result = await this.wallet.applyRoomResultTx(tx, {
          roomId,
          winnerWalletId: engineWinnerWalletId,
          feePercent: engineWinnerWalletId === null ? 0 : feePercent,
        });
      } else if (room.mode === 'TEAM') {
        if (engineWinnerTeam === null) {
          throw new BadRequestException('TEAM settlement requires winner team');
        }

        const winners = playersWithSeat.filter(
          (p) => this.getTeamOfSeat(p.seat) === engineWinnerTeam,
        );
        const losers = playersWithSeat.filter(
          (p) => this.getTeamOfSeat(p.seat) !== engineWinnerTeam,
        );

        if (!winners.length || !losers.length) {
          throw new ConflictException('Invalid TEAM settlement groups');
        }

        const pot = holds.reduce(
          (sum, h) => sum.plus(new Decimal(h.amount)),
          new Decimal(0),
        );
        const fee = pot.mul(feePercent).div(100);
        const distributable = pot.minus(fee);
        const share = distributable
          .div(winners.length)
          .toDecimalPlaces(2, Decimal.ROUND_DOWN);

        const houseUser = await tx.user.findUnique({
          where: { email: 'house@system.local' },
          include: { wallet: true },
        });

        if (!houseUser?.wallet) {
          throw new Error(
            'HOUSE wallet not found. Create user house@system.local with wallet.',
          );
        }

        for (const w of winners) {
          await this.wallet.creditTx(tx, {
            walletId: w.walletId,
            amount: share,
            refType: LedgerRefType.GAME,
            refId: roomId,
            type: LedgerType.WIN,
          });
        }

        await this.wallet.creditTx(tx, {
          walletId: houseUser.wallet.id,
          amount: fee,
          refType: LedgerRefType.GAME,
          refId: roomId,
          type: LedgerType.FEE,
        });

        for (const l of losers) {
          await tx.ledgerEntry.create({
            data: {
              walletId: l.walletId,
              type: LedgerType.LOSS,
              amount: new Decimal(0),
              refType: LedgerRefType.GAME,
              refId: roomId,
            },
          });
        }

        await tx.hold.updateMany({
          where: { roomId, status: 'ACTIVE' },
          data: { status: 'CONSUMED' },
        });

        result = {
          teamWin: true,
          winnerTeam: engineWinnerTeam,
          winnerSeat: engineWinnerSeat,
          winners: winners.map((w) => w.walletId),
          losers: losers.map((l) => l.walletId),
          pot: pot.toFixed(),
          fee: fee.toFixed(),
          share: share.toFixed(),
          finishReason,
        };
      } else {
        throw new BadRequestException(`Unsupported mode: ${room.mode}`);
      }

      void this.fraudDetection
        .evaluateRoom({
          roomId,
          gameType: room.gameType,
        })
        .then(async () => {
          await this.riskEngine.evaluateRoomUsers(roomId);
        })
        .catch((err) => {
          console.error('Fraud/Risk evaluation failed:', err?.message ?? err);
        });

      return {
        roomId,
        winnerSeat: engineWinnerSeat,
        winnerWalletId: engineWinnerWalletId,
        winnerTeam: engineWinnerTeam,
        finishReason,
        scoreResult,
        ...result,
      };
    });
  }

  /* ===============================
     DISCONNECT / RECONNECT
  =============================== */

  async markDisconnected(params: { roomId: string; userId: string }) {
    const { roomId, userId } = params;

    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
      });

      if (!room) throw new NotFoundException('Room not found');

      if (room.status === RoomStatus.WAITING) {
        return { ok: true, roomId, ignored: true };
      }

      if (room.status !== RoomStatus.PLAYING) {
        return { ok: true, roomId, ignored: true };
      }

      await tx.roomPlayer.update({
        where: { roomId_userId: { roomId, userId } },
        data: { disconnectedAt: new Date() },
      });

      return { ok: true, roomId, userId, disconnected: true };
    });
  }

  async markReconnected(params: { roomId: string; userId: string }) {
    const { roomId, userId } = params;

    return this.prisma.$transaction(async (tx) => {
      await tx.roomPlayer.update({
        where: { roomId_userId: { roomId, userId } },
        data: { disconnectedAt: null, lastSeenAt: new Date() },
      });

      return { ok: true, roomId, userId, reconnected: true };
    });
  }

  /* ===============================
     FORFEIT EXPIRED DISCONNECTS
  =============================== */

  async forfeitExpiredDisconnections() {
    const now = Date.now();
    const deadline = new Date(now - this.DISCONNECT_GRACE_MS);

    const results: any[] = [];
    let totalChecked = 0;

    while (true) {
      const expired = await this.prisma.roomPlayer.findMany({
        where: {
          disconnectedAt: { lte: deadline },
          room: { status: RoomStatus.PLAYING },
        },
        select: {
          roomId: true,
          userId: true,
          walletId: true,
        },
        take: 50,
      });

      if (!expired.length) break;

      totalChecked += expired.length;

      for (const p of expired) {
        try {
          const room = await this.prisma.room.findUnique({
            where: { id: p.roomId },
            include: { players: true },
          });

          if (!room) continue;
          if (room.status !== RoomStatus.PLAYING) continue;

          const winner = room.players.find((x) => x.userId !== p.userId);
          if (!winner) continue;

          let settled: any;

          if (room.gameType === 'BLACKJACK') {
            await this.markRoomFinished(room.id);

            settled = {
              roomId: room.id,
              blackjack: true,
              forfeit: true,
            };
          } else {
            settled = await this.finishRoom({
              roomId: room.id,
              feePercent: 5,
            });
          }

          results.push({
            roomId: room.id,
            forfeitedUserId: p.userId,
            winnerWalletId: winner.walletId,
            settled,
          });
        } catch (e: any) {
          results.push({
            roomId: p.roomId,
            error: e?.message ?? 'error',
          });
        }
      }
    }

    return {
      ok: true,
      checked: totalChecked,
      results,
    };
  }

  /* ===============================
     ENGINE ADAPTER
  =============================== */

  async getRoomForEngine(roomId: string): Promise<{
    roomId: string;
    gameType: GameType;
    mode: 'SOLO' | 'TEAM';
    stake: string;
    players: {
      userId: string;
      walletId: string;
      seat: number;
      connected: boolean;
    }[];
  }> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        players: true,
      },
    });

    if (!room) {
      throw new Error('Room not found for engine');
    }

    return {
      roomId: room.id,
      gameType: room.gameType as GameType,
      mode: room.mode,
      stake: room.stake.toString(),
      players: room.players
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((p, index) => ({
          userId: p.userId,
          walletId: p.walletId,
          seat: index,
          connected: !p.disconnectedAt,
        })),
    };
  }

  /* ===============================
     STATS / LISTS
  =============================== */

  async getStats() {
    const rooms = await this.prisma.room.findMany({
      where: { status: 'PLAYING' },
      include: { players: true },
    });

    const activeTables = rooms.length;
    const onlinePlayers = rooms.reduce((acc, r) => acc + r.players.length, 0);

    return {
      activeTables,
      onlinePlayers,
    };
  }

  async getActiveRooms() {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: {
          in: ['WAITING', 'PLAYING'],
        },
      },
      include: {
        players: {
          select: {
            userId: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });

    return rooms.map((r) => ({
      id: r.id,
      gameType: r.gameType,
      stake: r.stake,
      players: r.players,
    }));
  }

  async getWaitingRooms() {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.WAITING,
      },
      include: {
        players: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return rooms.map((r) => ({
      roomId: r.id,
      gameType: r.gameType,
      mode: r.mode,
      stake: r.stake.toString(),
      createdAt: r.createdAt,
      players: r.players.map((p) => ({
        userId: p.userId,
        walletId: p.walletId,
      })),
      playerCount: r.players.length,
      requiredPlayers: this.requiredPlayers(r.gameType as GameType),
    }));
  }

  /* ===============================
     BOT
  =============================== */

  async addBotToRoom(params: { roomId: string; botUserId: string }) {
    const { roomId, botUserId } = params;

    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { players: true },
      });

      if (!room) throw new NotFoundException('Room not found');
      if (room.status !== RoomStatus.WAITING) {
        throw new BadRequestException('Room is not waiting');
      }

      const need = this.requiredPlayers(room.gameType as GameType);
      if (room.players.length >= need) {
        throw new ConflictException('Room already full');
      }

      let botUser = await tx.user.findUnique({
        where: { id: botUserId },
        include: { wallet: true },
      });

      if (!botUser) {
        botUser = await tx.user.create({
          data: {
            id: botUserId,
            email: `${botUserId}@bot.local`,
            username: botUserId,
            password: 'bot-password',
            role: 'USER',
            status: 'ACTIVE',
            wallet: { create: {} },
          },
          include: { wallet: true },
        });
      }

      const alreadyJoined = await tx.roomPlayer.findUnique({
        where: {
          roomId_userId: {
            roomId,
            userId: botUserId,
          },
        },
      });

      if (alreadyJoined) {
        throw new ConflictException('Bot already joined');
      }

      await this.wallet.holdForRoomTx(
        tx,
        botUser.wallet!.id,
        roomId,
        room.stake,
      );

      await tx.roomPlayer.create({
        data: {
          roomId,
          userId: botUser.id,
          walletId: botUser.wallet!.id,
        },
      });

      const playerCount = await tx.roomPlayer.count({
        where: { roomId },
      });

      if (playerCount === need) {
        await tx.room.update({
          where: { id: roomId },
          data: { status: RoomStatus.PLAYING },
        });
      }

      return {
        roomId,
        botUserId,
        playerCount,
        requiredPlayers: need,
        status: playerCount === need ? RoomStatus.PLAYING : RoomStatus.WAITING,
      };
    });
  }

  async markRoomFinished(roomId: string) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      if (room.status === RoomStatus.FINISHED) {
        return room;
      }

      if (room.status !== RoomStatus.PLAYING) {
        throw new BadRequestException('Only PLAYING rooms can be finished');
      }

      return tx.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.FINISHED },
      });
    });
  }

  async finishTexasRoom(params: {
    roomId: string;
    winners: {
      seat: number;
      userId: string;
      walletId: string;
      amount: number;
    }[];
    feePercent?: number;
  }) {
    const feePercent = params.feePercent ?? 5;

    return this.prisma.$transaction(async (tx) => {
      // 🔒 SETTLEMENT LOCK
      const lock = await tx.room.updateMany({
        where: {
          id: params.roomId,
          status: RoomStatus.PLAYING,
        },
        data: {
          status: RoomStatus.FINISHED,
        },
      });

      if (lock.count === 0) {
        throw new ConflictException('Room already settled');
      }

      const holds = await tx.hold.findMany({
        where: {
          roomId: params.roomId,
          status: 'ACTIVE',
        },
      });

      if (!holds.length) {
        throw new Error('No active holds');
      }

      const pot = holds.reduce((sum, h) => sum + Number(h.amount), 0);

      const fee = Math.floor((pot * feePercent) / 100);

      const totalWinnersAmount = params.winners.reduce(
        (s, w) => s + Number(w.amount),
        0,
      );

      if (totalWinnersAmount > pot) {
        throw new Error('Texas payout exceeds pot');
      }

      const results: any[] = [];

      for (const winner of params.winners) {
        const payout = Math.floor(
          (winner.amount / totalWinnersAmount) * (pot - fee),
        );

        const ledger = await tx.ledgerEntry.create({
          data: {
            walletId: winner.walletId,
            type: LedgerType.WIN,
            amount: payout,
            refType: LedgerRefType.GAME,
            refId: params.roomId,
          },
        });

        await tx.wallet.update({
          where: { id: winner.walletId },
          data: {
            balance: {
              increment: payout,
            },
          },
        });

        results.push({
          seat: winner.seat,
          userId: winner.userId,
          walletId: winner.walletId,
          payout,
          ledgerId: ledger.id,
        });
      }

      await tx.hold.updateMany({
        where: { roomId: params.roomId },
        data: { status: HoldStatus.CONSUMED },
      });

      return {
        pot,
        fee,
        winners: results,
      };
    });
  }

  async findActiveRoomByUser(userId: string) {
    const player = await this.prisma.roomPlayer.findFirst({
      where: {
        userId,
        room: {
          status: {
            in: [RoomStatus.WAITING, RoomStatus.PLAYING],
          },
        },
      },
      include: {
        room: true,
      },
    });

    return player;
  }

  async validatePlayerInRoom(roomId: string, userId: string) {
    const player = await this.prisma.roomPlayer.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
      include: {
        room: true,
      },
    });

    if (!player) {
      throw new NotFoundException('Player not found in room');
    }

    if (
      player.room.status !== RoomStatus.WAITING &&
      player.room.status !== RoomStatus.PLAYING
    ) {
      throw new BadRequestException('Room is not active');
    }

    return player;
  }

  async touchPlayer(roomId: string, userId: string) {
    await this.prisma.roomPlayer.updateMany({
      where: { roomId, userId },
      data: { lastSeenAt: new Date() },
    });

    return { ok: true };
  }

  async cancelPlayingRoomWithRefund(roomId: string) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { players: true },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      if (room.status === RoomStatus.CANCELED) {
        return { ok: true, roomId, alreadyCanceled: true };
      }

      if (room.status === RoomStatus.FINISHED) {
        return { ok: true, roomId, alreadyFinished: true };
      }

      if (room.status !== RoomStatus.PLAYING) {
        throw new BadRequestException(
          'Only PLAYING rooms can be crash-canceled',
        );
      }

      const holds = await tx.hold.findMany({
        where: {
          roomId,
          status: HoldStatus.ACTIVE,
        },
      });

      for (const hold of holds) {
        await this.wallet.releaseHoldByIdTx(tx, hold.id);
      }

      await tx.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.CANCELED },
      });

      return {
        ok: true,
        roomId,
        refundedHoldCount: holds.length,
        recoveredFromCrash: true,
      };
    });
  }

  async cancelPlayingRoomsOnStartup() {
    const rooms = await this.prisma.room.findMany({
      where: {
        status: RoomStatus.PLAYING,
      },
      select: {
        id: true,
      },
    });

    const results: any[] = [];

    for (const room of rooms) {
      try {
        const result = await this.cancelPlayingRoomWithRefund(room.id);
        results.push(result);
      } catch (err: any) {
        results.push({
          roomId: room.id,
          error: err?.message ?? 'cancel failed',
        });
      }
    }

    return {
      ok: true,
      recoveredRooms: results.length,
      results,
    };
  }
}
