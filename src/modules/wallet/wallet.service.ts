import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { LedgerRefType, LedgerType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import crypto from 'crypto';

type HoldStatus = 'ACTIVE' | 'RELEASED' | 'CONSUMED';

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /* ===============================
       WALLET
  =============================== */

  getOrCreateWallet(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  /* ===============================
       DEPOSIT / WITHDRAW
  =============================== */

  async deposit(userId: string, amount: Decimal) {
    if (!amount || amount.lte(0))
      throw new BadRequestException('Invalid deposit amount');

    const wallet = await this.getOrCreateWallet(userId);
    const refId = `DEP:${crypto.randomUUID()}`;

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.addEntryTx(
        tx,
        wallet.id,
        LedgerType.DEPOSIT,
        amount,
        LedgerRefType.DEPOSIT,
        refId,
      );
    });

    return { ok: true, refId };
  }

  async withdraw(userId: string, amount: Decimal) {
    if (!amount || amount.lte(0))
      throw new BadRequestException('Invalid withdraw amount');

    const wallet = await this.getOrCreateWallet(userId);
    const refId = `WDR:${crypto.randomUUID()}`;

    await this.prisma.$transaction(async (tx) => {
      const balance = await this.ledger.getBalanceTx(tx, wallet.id);
      if (balance.lt(amount))
        throw new BadRequestException('Insufficient balance');

      await this.ledger.addEntryTx(
        tx,
        wallet.id,
        LedgerType.WITHDRAW,
        amount.neg(),
        LedgerRefType.WITHDRAW,
        refId,
      );
    });

    return { ok: true, refId };
  }

  /* ===============================
       HOLD (TX SAFE + IDEMPOTENT)
  =============================== */

  async holdForRoomTx(
    tx: Prisma.TransactionClient,
    walletId: string,
    roomId: string,
    amount: Decimal,
  ) {
    if (!amount || amount.lte(0))
      throw new BadRequestException('Invalid stake amount');

    // 🔒 idempotency: aynı room + wallet için tek ACTIVE hold
    const existing = await tx.hold.findFirst({
      where: { walletId, roomId, status: 'ACTIVE' },
    });
    if (existing) return existing;

    const balance = await this.ledger.getBalanceTx(tx, walletId);
    if (balance.lt(amount))
      throw new BadRequestException('Insufficient balance');

    await this.ledger.addEntryTx(
      tx,
      walletId,
      LedgerType.STAKE_HOLD,
      amount.neg(),
      LedgerRefType.ROOM,
      roomId,
    );

    return tx.hold.create({
      data: {
        walletId,
        roomId,
        amount,
        status: 'ACTIVE',
      },
    });
  }

  /* ===============================
       RELEASE / CANCEL
  =============================== */

  async releaseHoldByIdTx(tx: Prisma.TransactionClient, holdId: string) {
    const hold = await tx.hold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Hold not found');

    if (hold.status !== 'ACTIVE') return true;

    await this.ledger.addEntryTx(
      tx,
      hold.walletId,
      LedgerType.STAKE_RELEASE,
      hold.amount,
      LedgerRefType.ROOM,
      hold.roomId,
    );

    await tx.hold.update({
      where: { id: holdId },
      data: { status: 'RELEASED' },
    });

    return true;
  }

  async cancelRoom(roomId: string) {
    return this.prisma.$transaction(async (tx) => {
      const holds = await tx.hold.findMany({
        where: { roomId, status: 'ACTIVE' },
      });

      for (const h of holds) {
        await this.releaseHoldByIdTx(tx, h.id);
      }

      return { ok: true, released: holds.length };
    });
  }

  /* ===============================
       APPLY GAME RESULT (FINAL)
  =============================== */

  async applyRoomResultTx(
    tx: Prisma.TransactionClient,
    params: {
      roomId: string;
      winnerWalletId: string | null;
      feePercent?: number;
    },
  ) {
    const feePercent = params.feePercent ?? 5;

    if (feePercent < 0 || feePercent > 20) {
      throw new BadRequestException('Invalid fee percent');
    }

    // 🔒 Idempotency: room bazlı tek settlement
    const alreadySettled = await tx.ledgerEntry.count({
      where: { refType: LedgerRefType.GAME, refId: params.roomId },
    });
    if (alreadySettled > 0) {
      throw new ConflictException('Room already settled');
    }

    // 🎯 Active holds
    const holds = await tx.hold.findMany({
      where: { roomId: params.roomId, status: 'ACTIVE' },
    });
    if (holds.length === 0) {
      throw new BadRequestException('No active holds');
    }

    // ===============================
    // DRAW CASE
    // ===============================
    if (params.winnerWalletId === null) {
      for (const h of holds) {
        // stake iade
        await this.ledger.addEntryTx(
          tx,
          h.walletId,
          LedgerType.STAKE_RELEASE,
          h.amount,
          LedgerRefType.GAME,
          params.roomId,
        );

        // audit entry
        await this.ledger.addEntryTx(
          tx,
          h.walletId,
          LedgerType.LOSS, // elinizde DRAW diye enum yoksa geçici audit olarak kalabilir
          new Decimal(0),
          LedgerRefType.GAME,
          params.roomId,
        );
      }

      await tx.hold.updateMany({
        where: { roomId: params.roomId, status: 'ACTIVE' },
        data: { status: 'RELEASED' as HoldStatus },
      });

      const pot = holds.reduce((a, h) => a.plus(h.amount), new Decimal(0));

      return {
        ok: true,
        result: 'DRAW',
        pot,
        refunded: pot,
        players: holds.length,
      };
    }

    // ===============================
    // WIN CASE
    // ===============================

    const winnerHold = holds.find((h) => h.walletId === params.winnerWalletId);
    if (!winnerHold) {
      throw new BadRequestException(
        'Winner wallet is not part of active holds',
      );
    }

    // 🏦 HOUSE wallet resolve
    const houseUser = await tx.user.findUnique({
      where: { email: 'house@system.local' },
      include: { wallet: true },
    });
    if (!houseUser?.wallet) {
      throw new Error(
        'HOUSE wallet not found. Create user house@system.local with wallet.',
      );
    }
    const houseWalletId = houseUser.wallet.id;

    // ✅ wallet consistency
    const walletIdsToCheck = Array.from(
      new Set([houseWalletId, ...holds.map((h) => h.walletId)]),
    );

    const existingWallets = await tx.wallet.findMany({
      where: { id: { in: walletIdsToCheck } },
      select: { id: true },
    });

    if (existingWallets.length !== walletIdsToCheck.length) {
      const existingSet = new Set(existingWallets.map((w) => w.id));
      const missing = walletIdsToCheck.filter((id) => !existingSet.has(id));
      throw new Error(
        `Wallet consistency error before settlement. Missing wallet(s): ${missing.join(', ')}`,
      );
    }

    // 💰 Pot
    const pot = holds.reduce((a, h) => a.plus(h.amount), new Decimal(0));
    const fee = pot.mul(feePercent).div(100);
    const payout = pot.minus(fee);

    // 🏆 Winner gets payout
    await this.ledger.addEntryTx(
      tx,
      params.winnerWalletId,
      LedgerType.WIN,
      payout,
      LedgerRefType.GAME,
      params.roomId,
    );

    // 🏦 House gets fee
    await this.ledger.addEntryTx(
      tx,
      houseWalletId,
      LedgerType.FEE,
      fee,
      LedgerRefType.GAME,
      params.roomId,
    );

    // ❌ Losers: audit only
    for (const h of holds) {
      if (h.walletId === params.winnerWalletId) continue;

      await this.ledger.addEntryTx(
        tx,
        h.walletId,
        LedgerType.LOSS,
        new Decimal(0),
        LedgerRefType.GAME,
        params.roomId,
      );
    }

    await tx.hold.updateMany({
      where: { roomId: params.roomId, status: 'ACTIVE' },
      data: { status: 'CONSUMED' as HoldStatus },
    });

    return {
      ok: true,
      result: 'WIN',
      pot,
      fee,
      payout,
      players: holds.length,
      winnerWalletId: params.winnerWalletId,
    };
  }
  /* ===============================
       BALANCE
  =============================== */
  async creditTx(
    tx: Prisma.TransactionClient,
    params: {
      walletId: string;
      amount: Decimal;
      refType: LedgerRefType;
      refId: string;
      type?: LedgerType;
    },
  ) {
    if (!params.amount || params.amount.lte(0)) {
      throw new BadRequestException('Invalid credit amount');
    }

    return this.ledger.addEntryTx(
      tx,
      params.walletId,
      params.type ?? LedgerType.WIN,
      params.amount,
      params.refType,
      params.refId,
    );
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const balance = await this.ledger.getBalance(wallet.id);
    return { walletId: wallet.id, balance };
  }
}
