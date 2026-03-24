import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  BadRequestException,
  UseGuards,
  Param,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { Decimal } from '@prisma/client/runtime/library';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wallet')
// @UseGuards(JwtAuthGuard) // 🔒 PROD'da AÇIK OLMALI
export class WalletController {
  constructor(private wallet: WalletService) {}

  /* ===============================
     BALANCE
  =============================== */

  @Get('balance')
  async getBalance(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    return this.wallet.getBalance(userId);
  }

  /* ===============================
     DEPOSIT
     - userId ASLA body'den alınmaz
  =============================== */

  @Post('deposit')
  async deposit(@Req() req: any, @Body() body: { amount: string | number }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    if (body.amount === undefined || body.amount === null) {
      throw new BadRequestException('amount required');
    }

    const amount = new Decimal(body.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Invalid amount');
    }

    return this.wallet.deposit(userId, amount);
  }

  /* ===============================
     WITHDRAW
  =============================== */

  @Post('withdraw')
  async withdraw(@Req() req: any, @Body() body: { amount: string | number }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    if (body.amount === undefined || body.amount === null) {
      throw new BadRequestException('amount required');
    }

    const amount = new Decimal(body.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Invalid amount');
    }

    return this.wallet.withdraw(userId, amount);
  }

  @Get('balance-test/:userId')
  getBalanceTest(@Param('userId') userId: string) {
    return this.wallet.getBalance(userId);
  }
}
