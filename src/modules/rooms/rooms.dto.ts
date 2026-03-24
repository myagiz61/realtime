import { IsIn, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { GameType, GameMode } from '@prisma/client';

export { GameType };

export const GAME_TYPES: GameType[] = [
  'TAVLA',
  'OKEY',
  'OKEY101',
  'BATAK',
  'PISTI',
  'BLACKJACK',
  'SPADES',
];

/* =====================================================
   JOIN ROOM
===================================================== */

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsIn(GAME_TYPES, { message: 'Invalid gameType' })
  gameType!: GameType;

  @Type(() => Number)
  @Min(1)
  stake!: number;

  @IsOptional()
  @IsIn(['SOLO', 'TEAM'])
  mode?: GameMode;

  /* ===============================
     OKEY101 OPTIONS
  =============================== */

  @IsOptional()
  @IsIn(['KATLAMALI', 'KATLAMASIZ'])
  scoringMode?: 'KATLAMALI' | 'KATLAMASIZ';

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 3, 4])
  maxRounds?: number;
}

/* =====================================================
   LEAVE ROOM
===================================================== */

export class LeaveRoomDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  roomId!: string;
}

/* =====================================================
   CANCEL ROOM
===================================================== */

export class CancelRoomDto {
  @IsString()
  @IsNotEmpty()
  roomId!: string;
}

/* =====================================================
   FINISH ROOM
===================================================== */

export class FinishRoomDto {
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  feePercent?: number;
}
