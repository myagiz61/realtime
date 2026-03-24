import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

type RiskDecision = 'NONE' | 'FLAG' | 'UNDER_REVIEW' | 'FREEZE' | 'BAN';

type EvaluateUserRiskResult = {
  userId: string;
  totalRiskScore: number;
  fraudCaseCount: number;
  collusionScore: number;
  botScore: number;
  dumpingScore: number;
  timingScore: number;
  decision: RiskDecision;
  actionApplied: boolean;
  reason: string;
};

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  // Threshold’lar
  private readonly thresholds = {
    FLAG: 50,
    UNDER_REVIEW: 100,
    FREEZE: 150,
    BAN: 220,
  };

  constructor(private readonly prisma: PrismaService) {}

  async evaluateUser(userId: string): Promise<EvaluateUserRiskResult> {
    const profile = await this.prisma.playerRiskProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return {
        userId,
        totalRiskScore: 0,
        fraudCaseCount: 0,
        collusionScore: 0,
        botScore: 0,
        dumpingScore: 0,
        timingScore: 0,
        decision: 'NONE',
        actionApplied: false,
        reason: 'No risk profile found',
      };
    }

    const decision = this.computeDecision(profile.totalRiskScore);

    const result: EvaluateUserRiskResult = {
      userId,
      totalRiskScore: profile.totalRiskScore,
      fraudCaseCount: profile.fraudCaseCount,
      collusionScore: profile.collusionScore,
      botScore: profile.botScore,
      dumpingScore: profile.dumpingScore,
      timingScore: profile.timingScore,
      decision,
      actionApplied: false,
      reason: this.buildReason(profile.totalRiskScore, decision),
    };

    if (decision !== 'NONE') {
      result.actionApplied = await this.applyDecision(userId, decision, result);
    }

    return result;
  }

  async evaluateManyUsers(userIds: string[]) {
    const results: EvaluateUserRiskResult[] = [];

    for (const userId of [...new Set(userIds)]) {
      const result = await this.evaluateUser(userId);
      results.push(result);
    }

    return results;
  }

  async evaluateRoomUsers(roomId: string) {
    const players = await this.prisma.roomPlayer.findMany({
      where: { roomId },
      select: { userId: true },
    });

    return this.evaluateManyUsers(players.map((p) => p.userId));
  }

  private computeDecision(score: number): RiskDecision {
    if (score >= this.thresholds.BAN) return 'BAN';
    if (score >= this.thresholds.FREEZE) return 'FREEZE';
    if (score >= this.thresholds.UNDER_REVIEW) return 'UNDER_REVIEW';
    if (score >= this.thresholds.FLAG) return 'FLAG';
    return 'NONE';
  }

  private buildReason(score: number, decision: RiskDecision): string {
    switch (decision) {
      case 'BAN':
        return `Risk score ${score} exceeded BAN threshold`;
      case 'FREEZE':
        return `Risk score ${score} exceeded FREEZE threshold`;
      case 'UNDER_REVIEW':
        return `Risk score ${score} exceeded UNDER_REVIEW threshold`;
      case 'FLAG':
        return `Risk score ${score} exceeded FLAG threshold`;
      default:
        return `Risk score ${score} below action thresholds`;
    }
  }

  private async applyDecision(
    userId: string,
    decision: RiskDecision,
    result: EvaluateUserRiskResult,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!user) {
      this.logger.warn(`RiskEngine: user not found userId=${userId}`);
      return false;
    }

    // Mevcut statüye göre gereksiz update engeli
    let nextStatus: string | null = null;

    switch (decision) {
      case 'FLAG':
        // Status değiştirmek istemiyorsanız sadece log atabilirsiniz
        nextStatus = user.status === 'ACTIVE' ? 'FLAGGED' : null;
        break;

      case 'UNDER_REVIEW':
        nextStatus =
          user.status === 'ACTIVE' || user.status === 'FLAGGED'
            ? 'UNDER_REVIEW'
            : null;
        break;

      case 'FREEZE':
        nextStatus = user.status !== 'BANNED' ? 'FROZEN' : null;
        break;

      case 'BAN':
        nextStatus = 'BANNED';
        break;

      default:
        return false;
    }

    await this.prisma.$transaction(async (tx) => {
      if (nextStatus && user.status !== nextStatus) {
        await tx.user.update({
          where: { id: userId },
          data: { status: nextStatus as any },
        });
      }

      await tx.riskActionLog.create({
        data: {
          userId,
          actionType: decision,
          riskScore: result.totalRiskScore,
          reason: result.reason,
          payload: {
            fraudCaseCount: result.fraudCaseCount,
            collusionScore: result.collusionScore,
            botScore: result.botScore,
            dumpingScore: result.dumpingScore,
            timingScore: result.timingScore,
            previousStatus: user.status,
            nextStatus,
          },
        },
      });
    });

    this.logger.warn(
      `Risk action applied userId=${userId} decision=${decision} risk=${result.totalRiskScore}`,
    );

    return true;
  }
}
