import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerRefType, LedgerType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /* ===============================
     WRITE (IDEMPOTENT + TX SAFE)
  =============================== */

  /**
   * Ledger write – idempotent
   * - Aynı walletId + refType + refId tekrar yazılmaz
   * - Duplicate olursa sessizce ignore edilir
   */
  async addEntryTx(
    tx: Prisma.TransactionClient,
    walletId: string,
    type: LedgerType,
    amount: Decimal,
    refType: LedgerRefType,
    refId: string,
  ) {
    try {
      return await tx.ledgerEntry.create({
        data: {
          walletId,
          type,
          amount,
          refType,
          refId,
        },
      });
    } catch (err: any) {
      // Prisma unique constraint violation
      if (err.code === 'P2002') {
        // zaten yazılmış → idempotent davran
        return null;
      }
      throw err;
    }
  }

  /* ===============================
     READ BALANCE (TX SAFE)
  =============================== */

  async getBalanceTx(
    tx: Prisma.TransactionClient,
    walletId: string,
  ): Promise<Decimal> {
    const res = await tx.ledgerEntry.aggregate({
      where: { walletId },
      _sum: { amount: true },
    });
    return res._sum.amount ?? new Decimal(0);
  }

  /* ===============================
     READ BALANCE (NON-TX)
  =============================== */

  async getBalance(walletId: string): Promise<Decimal> {
    const res = await this.prisma.ledgerEntry.aggregate({
      where: { walletId },
      _sum: { amount: true },
    });
    return res._sum.amount ?? new Decimal(0);
  }

  /* ===============================
     HISTORY
  =============================== */

  getHistory(walletId: string, take = 50) {
    return this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /* ===============================
     DOMAIN HELPERS (OPTIONAL AMA TEMİZ)
  =============================== */

  // 🔴 para düş
  debit(amount: Decimal) {
    return amount.mul(-1);
  }

  // 🟢 para ekle
  credit(amount: Decimal) {
    return amount;
  }
}
