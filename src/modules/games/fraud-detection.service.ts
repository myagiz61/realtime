import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType } from '@prisma/client';

type EvaluateRoomParams = {
  roomId: string;
  gameType: GameType | string;
};

type ReplayRow = {
  roomId: string;
  gameType: string;
  userId: string | null;
  seat: number | null;
  eventType: string;
  actionType: string | null;
  phase: string | null;
  turnIndex: number | null;
  payload: any;
  createdAt: Date;
};

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluateRoom(params: EvaluateRoomParams) {
    const logs = (await this.prisma.gameReplayLog.findMany({
      where: { roomId: params.roomId },
      orderBy: { createdAt: 'asc' },
    })) as ReplayRow[];

    if (!logs.length) {
      return { ok: true, roomId: params.roomId, findings: [] };
    }

    const findings: any[] = [];

    const timingFindings = await this.detectBotLikeTiming(logs);
    findings.push(...timingFindings);

    const autoActionFindings = await this.detectExcessiveAutoActions(logs);
    findings.push(...autoActionFindings);

    const pairPatternFindings = await this.detectSuspiciousPairPatterns(
      params.roomId,
      params.gameType,
    );
    findings.push(...pairPatternFindings);

    const dumpingFindings = await this.detectChipDumpingLikeBehavior(
      params.roomId,
      params.gameType,
    );
    findings.push(...dumpingFindings);

    for (const finding of findings) {
      await this.persistFinding(finding);
    }

    return {
      ok: true,
      roomId: params.roomId,
      findingsCount: findings.length,
      findings,
    };
  }

  /* =====================================================
     RULE 1: BOT-LIKE TIMING
     Aynı oyuncunun hamle süreleri aşırı stabilse şüpheli
  ===================================================== */

  private async detectBotLikeTiming(logs: ReplayRow[]) {
    const findings: any[] = [];

    const actionLogs = logs.filter(
      (x) => x.eventType === 'ACTION_DISPATCHED' && !!x.userId,
    );

    const grouped = new Map<string, ReplayRow[]>();
    for (const row of actionLogs) {
      const arr = grouped.get(row.userId!) ?? [];
      arr.push(row);
      grouped.set(row.userId!, arr);
    }

    for (const [userId, rows] of grouped.entries()) {
      if (rows.length < 8) continue;

      const deltas: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        deltas.push(
          rows[i].createdAt.getTime() - rows[i - 1].createdAt.getTime(),
        );
      }

      const avg = this.avg(deltas);
      const std = this.stddev(deltas, avg);

      // Çok stabil ve insan dışı düşük varyans
      if (avg > 800 && avg < 6000 && std < 250) {
        findings.push({
          roomId: rows[0].roomId,
          gameType: rows[0].gameType,
          primaryUserId: userId,
          secondaryUserId: null,
          riskScore: 35,
          severity: 'MEDIUM',
          ruleCode: 'BOT_TIMING_STABLE',
          reason: `User has unnaturally stable move timings. avg=${avg.toFixed(
            0,
          )}ms std=${std.toFixed(0)}ms`,
          payload: { avg, std, sampleSize: deltas.length },
          profile: { botScore: 35, timingScore: 35 },
          signals: [
            {
              userId,
              relatedUserId: null,
              signalType: 'BOT_TIMING_STABLE',
              signalValue: std,
              severity: 'MEDIUM',
              payload: { avg, std, sampleSize: deltas.length },
            },
          ],
        });
      }
    }

    return findings;
  }

  /* =====================================================
     RULE 2: AUTO ACTION ABUSE
  ===================================================== */

  private async detectExcessiveAutoActions(logs: ReplayRow[]) {
    const findings: any[] = [];

    const grouped = new Map<
      string,
      { total: number; auto: number; roomId: string; gameType: string }
    >();

    for (const row of logs) {
      if (!row.userId) continue;

      const g = grouped.get(row.userId) ?? {
        total: 0,
        auto: 0,
        roomId: row.roomId,
        gameType: row.gameType,
      };

      if (row.eventType === 'ACTION_DISPATCHED') g.total += 1;
      if (row.eventType === 'AUTO_ACTION') g.auto += 1;

      grouped.set(row.userId, g);
    }

    for (const [userId, stat] of grouped.entries()) {
      if (stat.total < 6) continue;

      const ratio = stat.auto / stat.total;
      if (ratio >= 0.5) {
        findings.push({
          roomId: stat.roomId,
          gameType: stat.gameType,
          primaryUserId: userId,
          secondaryUserId: null,
          riskScore: 20,
          severity: 'LOW',
          ruleCode: 'EXCESSIVE_AUTO_ACTION',
          reason: `User relied too much on timeout auto actions. ratio=${ratio.toFixed(
            2,
          )}`,
          payload: stat,
          profile: { timingScore: 20 },
          signals: [
            {
              userId,
              relatedUserId: null,
              signalType: 'EXCESSIVE_AUTO_ACTION',
              signalValue: ratio,
              severity: 'LOW',
              payload: stat,
            },
          ],
        });
      }
    }

    return findings;
  }

  /* =====================================================
     RULE 3: SAME PAIR TOO OFTEN
     Aynı 2 oyuncu çok sık birlikte oynuyorsa collusion sinyali
  ===================================================== */

  private async detectSuspiciousPairPatterns(
    roomId: string,
    gameType: GameType | string,
  ) {
    const findings: any[] = [];

    const roomPlayers = await this.prisma.roomPlayer.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });

    const userIds = roomPlayers.map((p) => p.userId);
    if (userIds.length < 2) return findings;

    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const a = userIds[i];
        const b = userIds[j];

        const commonRooms = await this.findCommonRoomsCount(a, b);
        if (commonRooms >= 12) {
          findings.push({
            roomId,
            gameType,
            primaryUserId: a,
            secondaryUserId: b,
            riskScore: 25,
            severity: 'MEDIUM',
            ruleCode: 'PAIR_FREQUENCY_HIGH',
            reason: `Users played together unusually often. commonRooms=${commonRooms}`,
            payload: { commonRooms },
            profile: { collusionScore: 25 },
            signals: [
              {
                userId: a,
                relatedUserId: b,
                signalType: 'PAIR_FREQUENCY_HIGH',
                signalValue: commonRooms,
                severity: 'MEDIUM',
                payload: { commonRooms },
              },
              {
                userId: b,
                relatedUserId: a,
                signalType: 'PAIR_FREQUENCY_HIGH',
                signalValue: commonRooms,
                severity: 'MEDIUM',
                payload: { commonRooms },
              },
            ],
          });
        }
      }
    }

    return findings;
  }

  /* =====================================================
     RULE 4: CHIP DUMPING-LIKE BEHAVIOR
     Sürekli aynı kişiye kaybetme / karşı takım lehine dağılım
  ===================================================== */

  private async detectChipDumpingLikeBehavior(
    roomId: string,
    gameType: GameType | string,
  ) {
    const findings: any[] = [];

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { players: true },
    });
    if (!room) return findings;

    const winEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        refType: 'GAME',
        refId: roomId,
        type: 'WIN',
      },
      select: {
        walletId: true,
        amount: true,
      },
    });

    if (!winEntries.length) return findings;

    const totalWin = winEntries.reduce((sum, x) => sum + Number(x.amount), 0);

    // Oyun bitti, tek bir taraf sürekli kazanıyorsa ve geçmiş pattern de varsa şüpheli
    const roomUserIds = room.players.map((p) => p.userId);

    for (const uid of roomUserIds) {
      const recentLossCount = await this.countRecentLosses(uid, 20);
      const recentWinCount = await this.countRecentWins(uid, 20);

      if (recentLossCount >= 12 && recentWinCount <= 1) {
        findings.push({
          roomId,
          gameType,
          primaryUserId: uid,
          secondaryUserId: null,
          riskScore: 40,
          severity: 'HIGH',
          ruleCode: 'DUMPING_PATTERN',
          reason: `User has suspicious repeated loss pattern. losses=${recentLossCount} wins=${recentWinCount}`,
          payload: { recentLossCount, recentWinCount, totalWin },
          profile: { dumpingScore: 40 },
          signals: [
            {
              userId: uid,
              relatedUserId: null,
              signalType: 'DUMPING_PATTERN',
              signalValue: recentLossCount,
              severity: 'HIGH',
              payload: { recentLossCount, recentWinCount, totalWin },
            },
          ],
        });
      }
    }

    return findings;
  }

  /* =====================================================
     PERSISTENCE
  ===================================================== */

  private async persistFinding(finding: any) {
    await this.prisma.$transaction(async (tx) => {
      await tx.fraudCase.create({
        data: {
          roomId: finding.roomId ?? null,
          gameType: finding.gameType ?? null,
          primaryUserId: finding.primaryUserId ?? null,
          secondaryUserId: finding.secondaryUserId ?? null,
          riskScore: finding.riskScore,
          severity: finding.severity,
          ruleCode: finding.ruleCode,
          reason: finding.reason,
          payload: finding.payload ?? undefined,
          status: 'OPEN',
        },
      });

      const affectedUsers = [
        finding.primaryUserId,
        finding.secondaryUserId,
      ].filter(Boolean);

      for (const userId of affectedUsers) {
        await tx.playerRiskProfile.upsert({
          where: { userId },
          create: {
            userId,
            totalRiskScore: finding.riskScore,
            fraudCaseCount: 1,
            suspiciousRoomCount: 1,
            collusionScore: finding.profile?.collusionScore ?? 0,
            botScore: finding.profile?.botScore ?? 0,
            dumpingScore: finding.profile?.dumpingScore ?? 0,
            timingScore: finding.profile?.timingScore ?? 0,
            lastFraudAt: new Date(),
          },
          update: {
            totalRiskScore: { increment: finding.riskScore },
            fraudCaseCount: { increment: 1 },
            suspiciousRoomCount: { increment: 1 },
            collusionScore: {
              increment: finding.profile?.collusionScore ?? 0,
            },
            botScore: {
              increment: finding.profile?.botScore ?? 0,
            },
            dumpingScore: {
              increment: finding.profile?.dumpingScore ?? 0,
            },
            timingScore: {
              increment: finding.profile?.timingScore ?? 0,
            },
            lastFraudAt: new Date(),
          },
        });
      }

      for (const signal of finding.signals ?? []) {
        await tx.fraudSignal.create({
          data: {
            roomId: finding.roomId ?? null,
            gameType: finding.gameType ?? null,
            userId: signal.userId ?? null,
            relatedUserId: signal.relatedUserId ?? null,
            signalType: signal.signalType,
            signalValue: signal.signalValue,
            severity: signal.severity,
            payload: signal.payload ?? undefined,
          },
        });
      }
    });
  }

  /* =====================================================
     HELPERS
  ===================================================== */

  private async findCommonRoomsCount(
    userA: string,
    userB: string,
  ): Promise<number> {
    const roomsA = await this.prisma.roomPlayer.findMany({
      where: { userId: userA },
      select: { roomId: true },
    });

    const roomIdsA = roomsA.map((x) => x.roomId);
    if (!roomIdsA.length) return 0;

    return this.prisma.roomPlayer.count({
      where: {
        userId: userB,
        roomId: { in: roomIdsA },
      },
    });
  }

  private async countRecentLosses(
    userId: string,
    take: number,
  ): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) return 0;

    return this.prisma.ledgerEntry.count({
      where: {
        walletId: wallet.id,
        type: 'LOSS',
      },
      take,
    });
  }

  private async countRecentWins(userId: string, take: number): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) return 0;

    return this.prisma.ledgerEntry.count({
      where: {
        walletId: wallet.id,
        type: 'WIN',
      },
      take,
    });
  }

  private avg(arr: number[]) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private stddev(arr: number[], avg: number) {
    if (!arr.length) return 0;
    const variance =
      arr.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }
}
