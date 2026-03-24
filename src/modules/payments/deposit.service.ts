import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class DepositService {
  constructor(private prisma: PrismaService) {}

  async createDeposit(userId: string, amount: number, method: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) throw new Error('Wallet not found');

    return this.prisma.depositRequest.create({
      data: {
        userId,
        walletId: wallet.id,
        amount: new Decimal(amount),
        method,
      },
    });
  }

  async getPendingDeposits() {
    return this.prisma.depositRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveDeposit(depositId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.depositRequest.findUnique({
        where: { id: depositId },
      });

      if (!deposit) throw new Error('Deposit not found');
      if (deposit.status !== 'PENDING') throw new Error('Already processed');

      await tx.wallet.update({
        where: { id: deposit.walletId },
        data: {
          balance: {
            increment: deposit.amount,
          },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: deposit.walletId,
          type: 'DEPOSIT',
          amount: deposit.amount,
          refType: 'DEPOSIT',
          refId: deposit.id,
        },
      });

      return tx.depositRequest.update({
        where: { id: depositId },
        data: {
          status: 'APPROVED',
          approvedBy: adminId,
          approvedAt: new Date(),
        },
      });
    });
  }

  async rejectDeposit(depositId: string, adminId: string) {
    return this.prisma.depositRequest.update({
      where: { id: depositId },
      data: {
        status: 'REJECTED',
        rejectedBy: adminId,
        rejectedAt: new Date(),
      },
    });
  }
}
