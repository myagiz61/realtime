import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, LedgerService],
  exports: [WalletService, LedgerService],
})
export class WalletModule {}
