import { Controller, Post, Get, Patch, Param, Body } from '@nestjs/common';
import { DepositService } from './deposit.service';

@Controller('deposits')
export class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Post()
  async create(@Body() body: any) {
    return this.deposits.createDeposit(body.userId, body.amount, body.method);
  }

  @Get('pending')
  async pending() {
    return this.deposits.getPendingDeposits();
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.deposits.approveDeposit(id, 'ADMIN');
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string) {
    return this.deposits.rejectDeposit(id, 'ADMIN');
  }
}
