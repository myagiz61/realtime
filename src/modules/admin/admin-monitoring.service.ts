import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameEngineService } from '../games/game-engine.service';
import { RoomStatus } from '@prisma/client';

@Injectable()
export class AdminMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  async getDashboardSummary() {
    const [waitingRooms, playingRooms, finishedRooms, canceledRooms] =
      await Promise.all([
        this.prisma.room.count({ where: { status: RoomStatus.WAITING } }),
        this.prisma.room.count({ where: { status: RoomStatus.PLAYING } }),
        this.prisma.room.count({ where: { status: RoomStatus.FINISHED } }),
        this.prisma.room.count({ where: { status: RoomStatus.CANCELED } }),
      ]);

    const activeGames = this.gameEngine.getActiveGamesSnapshot();

    const [openFraudCases, frozenUsers, bannedUsers] = await Promise.all([
      this.prisma.fraudCase.count({ where: { status: 'OPEN' } }),
      this.prisma.user.count({ where: { status: 'FROZEN' as any } }),
      this.prisma.user.count({ where: { status: 'BANNED' as any } }),
    ]);

    return {
      rooms: {
        waiting: waitingRooms,
        playing: playingRooms,
        finished: finishedRooms,
        canceled: canceledRooms,
      },
      activeGames: activeGames.length,
      fraud: {
        openCases: openFraudCases,
        frozenUsers,
        bannedUsers,
      },
    };
  }

  async getRooms(params?: {
    status?: 'WAITING' | 'PLAYING' | 'FINISHED' | 'CANCELED';
    take?: number;
  }) {
    const take = params?.take ?? 50;

    return this.prisma.room.findMany({
      where: {
        ...(params?.status ? { status: params.status as RoomStatus } : {}),
      },
      include: {
        players: {
          select: {
            userId: true,
            walletId: true,
            disconnectedAt: true,
            lastSeenAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async getLiveGames() {
    return this.gameEngine.getActiveGamesSnapshot();
  }

  async getLiveGame(roomId: string) {
    const state = this.gameEngine.getState(roomId);
    if (!state) return null;

    const internalState = this.gameEngine.getInternalState(roomId);

    return {
      state,
      internalState,
    };
  }

  async getRoomReplay(roomId: string) {
    return this.prisma.gameReplayLog.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getFraudCases(params?: {
    status?: string;
    severity?: string;
    take?: number;
  }) {
    return this.prisma.fraudCase.findMany({
      where: {
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.severity ? { severity: params.severity } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params?.take ?? 100,
    });
  }

  async getFraudCase(caseId: string) {
    return this.prisma.fraudCase.findUnique({
      where: { id: caseId },
    });
  }

  async closeFraudCase(caseId: string) {
    return this.prisma.fraudCase.update({
      where: { id: caseId },
      data: { status: 'CLOSED' },
    });
  }

  async getTopRiskProfiles(take = 50) {
    return this.prisma.playerRiskProfile.findMany({
      orderBy: { totalRiskScore: 'desc' },
      take,
    });
  }

  async getRiskProfile(userId: string) {
    return this.prisma.playerRiskProfile.findUnique({
      where: { userId },
    });
  }

  async getRiskActions(userId: string) {
    return this.prisma.riskActionLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getFraudSignals(userId: string) {
    return this.prisma.fraudSignal.findMany({
      where: {
        OR: [{ userId }, { relatedUserId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getUserWalletLedger(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) return null;

    const ledger = await this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      wallet,
      ledger,
    };
  }

  async getUserRooms(userId: string) {
    return this.prisma.roomPlayer.findMany({
      where: { userId },
      include: {
        room: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getHighRiskUsers(params?: { minRisk?: number; take?: number }) {
    const minRisk = params?.minRisk ?? 50;
    const take = params?.take ?? 100;

    return this.prisma.playerRiskProfile.findMany({
      where: {
        totalRiskScore: {
          gte: minRisk,
        },
      },
      orderBy: {
        totalRiskScore: 'desc',
      },
      take,
    });
  }
}
