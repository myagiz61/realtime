import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AdminMonitoringService } from './admin-monitoring.service';

@Controller('admin')
export class AdminMonitoringController {
  constructor(private readonly adminMonitoring: AdminMonitoringService) {}

  @Get('dashboard')
  async dashboard() {
    return this.adminMonitoring.getDashboardSummary();
  }

  @Get('rooms')
  async rooms(
    @Query('status') status?: 'WAITING' | 'PLAYING' | 'FINISHED' | 'CANCELED',
    @Query('take') take?: string,
  ) {
    return this.adminMonitoring.getRooms({
      status,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('rooms/live')
  async liveGames() {
    return this.adminMonitoring.getLiveGames();
  }

  @Get('rooms/:roomId/live')
  async liveGame(@Param('roomId') roomId: string) {
    return this.adminMonitoring.getLiveGame(roomId);
  }

  @Get('rooms/:roomId/replay')
  async replay(@Param('roomId') roomId: string) {
    return this.adminMonitoring.getRoomReplay(roomId);
  }

  @Get('fraud/cases')
  async fraudCases(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('take') take?: string,
  ) {
    return this.adminMonitoring.getFraudCases({
      status,
      severity,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('fraud/cases/:caseId')
  async fraudCase(@Param('caseId') caseId: string) {
    return this.adminMonitoring.getFraudCase(caseId);
  }

  @Patch('fraud/cases/:caseId/close')
  async closeFraudCase(@Param('caseId') caseId: string) {
    return this.adminMonitoring.closeFraudCase(caseId);
  }

  @Get('risk/top')
  async topRisk(@Query('take') take?: string) {
    return this.adminMonitoring.getTopRiskProfiles(
      take ? Number(take) : undefined,
    );
  }

  @Get('risk/high')
  async highRiskUsers(
    @Query('minRisk') minRisk?: string,
    @Query('take') take?: string,
  ) {
    return this.adminMonitoring.getHighRiskUsers({
      minRisk: minRisk ? Number(minRisk) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('risk/profile/:userId')
  async riskProfile(@Param('userId') userId: string) {
    return this.adminMonitoring.getRiskProfile(userId);
  }

  @Get('risk/actions/:userId')
  async riskActions(@Param('userId') userId: string) {
    return this.adminMonitoring.getRiskActions(userId);
  }

  @Get('fraud/signals/:userId')
  async fraudSignals(@Param('userId') userId: string) {
    return this.adminMonitoring.getFraudSignals(userId);
  }

  @Get('users/:userId/wallet')
  async wallet(@Param('userId') userId: string) {
    return this.adminMonitoring.getUserWalletLedger(userId);
  }

  @Get('users/:userId/rooms')
  async userRooms(@Param('userId') userId: string) {
    return this.adminMonitoring.getUserRooms(userId);
  }
}
