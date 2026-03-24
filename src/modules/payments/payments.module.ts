import { Module } from '@nestjs/common';
import { DepositService } from './deposit.service';
import { DepositController } from './deposit.controller';
import { WithdrawService } from './withdraw.service';
import { WithdrawController } from './withdraw.controller';
import { AmlService } from './aml.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  providers: [PrismaService, DepositService, WithdrawService, AmlService],
  controllers: [DepositController, WithdrawController],
  exports: [DepositService, WithdrawService, AmlService],
})
export class PaymentsModule {}
