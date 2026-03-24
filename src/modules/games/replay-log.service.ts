import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType } from '@prisma/client';

type CreateReplayLogParams = {
  roomId: string;
  gameType: GameType | string;
  userId?: string | null;
  seat?: number | null;
  eventType:
    | 'GAME_STARTED'
    | 'ACTION_DISPATCHED'
    | 'AUTO_ACTION'
    | 'GAME_FINISHED'
    | 'GAME_FORCE_FINISHED'
    | 'ROUND_FINISHED'
    | 'MATCH_FINISHED';
  actionType?: string | null;
  phase?: string | null;
  turnIndex?: number | null;
  payload?: unknown;
};

@Injectable()
export class ReplayLogService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(params: CreateReplayLogParams) {
    return this.prisma.gameReplayLog.create({
      data: {
        roomId: params.roomId,
        gameType: String(params.gameType),
        userId: params.userId ?? null,
        seat: params.seat ?? null,
        eventType: params.eventType,
        actionType: params.actionType ?? null,
        phase: params.phase ?? null,
        turnIndex: params.turnIndex ?? null,
        payload: (params.payload ?? null) as any,
      },
    });
  }

  async createLogs(logs: CreateReplayLogParams[]) {
    if (!logs.length) return;

    await this.prisma.gameReplayLog.createMany({
      data: logs.map((log) => ({
        roomId: log.roomId,
        gameType: String(log.gameType),
        userId: log.userId ?? null,
        seat: log.seat ?? null,
        eventType: log.eventType,
        actionType: log.actionType ?? null,
        phase: log.phase ?? null,
        turnIndex: log.turnIndex ?? null,
        payload: (log.payload ?? null) as any,
      })),
    });
  }

  async getRoomReplay(roomId: string) {
    return this.prisma.gameReplayLog.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteRoomReplay(roomId: string) {
    return this.prisma.gameReplayLog.deleteMany({
      where: { roomId },
    });
  }
}
