import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { AmlService } from './aml.service';

@Injectable()
export class WithdrawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly amlService: AmlService,
  ) {}

  async createWithdraw(
    userId: string,
    amount: number,
    method: string,
    accountInfo?: any,
  ) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) throw new Error('Wallet not found');
    if (Number(wallet.balance) < amount) {
      throw new Error('Insufficient balance');
    }

    const aml = await this.amlService.evaluateWithdraw(userId, amount);

    const status =
      aml.decision === 'ALLOW'
        ? 'PENDING'
        : aml.decision === 'REVIEW'
          ? 'UNDER_REVIEW'
          : 'REJECTED';

    return this.prisma.withdrawRequest.create({
      data: {
        userId,
        walletId: wallet.id,
        amount: new Decimal(amount),
        method,
        accountInfo: accountInfo ?? undefined,
        status: status as any,
        amlRiskScore: aml.riskScore,
        amlReason: aml.reasons.join(' | ') || null,
      },
    });
  }

  async getPendingWithdraws() {
    return this.prisma.withdrawRequest.findMany({
      where: {
        status: {
          in: ['PENDING', 'UNDER_REVIEW'],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveWithdraw(withdrawId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const withdraw = await tx.withdrawRequest.findUnique({
        where: { id: withdrawId },
      });

      if (!withdraw) throw new Error('Withdraw not found');
      if (!['PENDING', 'UNDER_REVIEW'].includes(withdraw.status)) {
        throw new Error('Withdraw already processed');
      }

      const wallet = await tx.wallet.findUnique({
        where: { id: withdraw.walletId },
      });

      if (!wallet) throw new Error('Wallet not found');
      if (Number(wallet.balance) < Number(withdraw.amount)) {
        throw new Error('Insufficient balance at approval time');
      }

      await tx.wallet.update({
        where: { id: withdraw.walletId },
        data: {
          balance: {
            decrement: withdraw.amount,
          },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: withdraw.walletId,
          type: 'WITHDRAW',
          amount: withdraw.amount,
          refType: 'WITHDRAW',
          refId: withdraw.id,
        },
      });

      return tx.withdrawRequest.update({
        where: { id: withdrawId },
        data: {
          status: 'APPROVED',
          approvedBy: adminId,
          approvedAt: new Date(),
        },
      });
    });
  }

  async rejectWithdraw(
    withdrawId: string,
    adminId: string,
    rejectReason?: string,
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
    });

    if (!withdraw) throw new Error('Withdraw not found');
    if (!['PENDING', 'UNDER_REVIEW'].includes(withdraw.status)) {
      throw new Error('Withdraw already processed');
    }

    return this.prisma.withdrawRequest.update({
      where: { id: withdrawId },
      data: {
        status: 'REJECTED',
        rejectedBy: adminId,
        rejectedAt: new Date(),
        rejectReason: rejectReason ?? 'Rejected by admin',
      },
    });
  }

  async markAsPaid(withdrawId: string, payoutReference: string) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
    });

    if (!withdraw) throw new Error('Withdraw not found');
    if (withdraw.status !== 'APPROVED') {
      throw new Error('Only APPROVED withdraw can be marked as paid');
    }

    return this.prisma.withdrawRequest.update({
      where: { id: withdrawId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        payoutReference,
      },
    });
  }
}
