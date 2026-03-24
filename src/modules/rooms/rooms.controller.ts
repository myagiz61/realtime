import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RoomService } from './rooms.service';
import {
  CancelRoomDto,
  FinishRoomDto,
  JoinRoomDto,
  LeaveRoomDto,
} from './rooms.dto';

@Controller('rooms')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class RoomController {
  constructor(private readonly rooms: RoomService) {}

  @Post('join')
  join(@Body() body: JoinRoomDto) {
    return this.rooms.joinOrCreate(body);
  }

  @Post('leave')
  leave(@Body() body: LeaveRoomDto) {
    return this.rooms.leaveRoom(body);
  }

  /**
   * ⚠️ PRODUCTION: buraya Guard koy (admin/system token)
   */
  @Post('cancel')
  cancel(@Body() body: CancelRoomDto) {
    return this.rooms.cancelRoom(body.roomId);
  }

  @Post('forfeit-check')
  forfeitCheck() {
    return this.rooms.forfeitExpiredDisconnections();
  }
  /**
   * ⚠️ PRODUCTION: buraya Guard koy (engine/internal worker)
   */
  @Post('finish')
  finish(@Body() body: FinishRoomDto) {
    return this.rooms.finishRoom(body);
  }

  @Get('/stats')
  async getStats() {
    return this.rooms.getStats();
  }

  @Get('active')
  async active() {
    return this.rooms.getActiveRooms();
  }
}
