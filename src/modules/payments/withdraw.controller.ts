import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { WithdrawService } from './withdraw.service';
import { CreateWithdrawDto, RejectWithdrawDto } from './payments.dto';

@Controller('withdraws')
export class WithdrawController {
  constructor(private readonly withdraws: WithdrawService) {}

  @Post()
  async create(@Body() body: CreateWithdrawDto) {
    return this.withdraws.createWithdraw(
      body.userId,
      body.amount,
      body.method,
      body.accountInfo,
    );
  }

  @Get('pending')
  async pending() {
    return this.withdraws.getPendingWithdraws();
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.withdraws.approveWithdraw(id, 'ADMIN');
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() body: RejectWithdrawDto) {
    return this.withdraws.rejectWithdraw(id, 'ADMIN', body.rejectReason);
  }

  @Patch(':id/paid')
  async markPaid(@Param('id') id: string) {
    return this.withdraws.markAsPaid(id, `PAYOUT-${Date.now()}`);
  }
}
