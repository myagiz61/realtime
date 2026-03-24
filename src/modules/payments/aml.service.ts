import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

type AmlCheckResult = {
  riskScore: number;
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  reasons: string[];
};

@Injectable()
export class AmlService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateWithdraw(
    userId: string,
    amount: number,
  ): Promise<AmlCheckResult> {
    let riskScore = 0;
    const reasons: string[] = [];

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return {
        riskScore: 999,
        decision: 'BLOCK',
        reasons: ['Wallet not found'],
      };
    }

    if (Number(wallet.balance) < amount) {
      return {
        riskScore: 999,
        decision: 'BLOCK',
        reasons: ['Insufficient balance'],
      };
    }

    const profile = await this.prisma.playerRiskProfile.findUnique({
      where: { userId },
    });

    if (profile) {
      riskScore += profile.totalRiskScore;

      if (profile.totalRiskScore >= 150) {
        reasons.push('User has high accumulated fraud risk');
      }
    }

    const deposits = await this.prisma.depositRequest.findMany({
      where: {
        userId,
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const totalApprovedDeposits = deposits.reduce(
      (sum, d) => sum + Number(d.amount),
      0,
    );

    if (totalApprovedDeposits === 0 && amount > 0) {
      riskScore += 80;
      reasons.push('Withdraw requested without approved deposit history');
    }

    if (amount > 10000) {
      riskScore += 30;
      reasons.push('Large withdrawal amount');
    }

    const recentWithdrawCount = await this.prisma.withdrawRequest.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (recentWithdrawCount >= 3) {
      riskScore += 25;
      reasons.push('Too many withdrawals in last 24h');
    }

    const recentDepositCount = await this.prisma.depositRequest.count({
      where: {
        userId,
        status: 'APPROVED',
        approvedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (recentDepositCount >= 3 && amount > totalApprovedDeposits * 0.8) {
      riskScore += 20;
      reasons.push('Rapid deposit-then-withdraw pattern');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });

    if (
      user &&
      ['UNDER_REVIEW', 'FROZEN', 'BANNED'].includes(String(user.status))
    ) {
      riskScore += 200;
      reasons.push(`User status is ${user.status}`);
    }

    let decision: 'ALLOW' | 'REVIEW' | 'BLOCK' = 'ALLOW';

    if (riskScore >= 150) decision = 'BLOCK';
    else if (riskScore >= 60) decision = 'REVIEW';

    return {
      riskScore,
      decision,
      reasons,
    };
  }
}
