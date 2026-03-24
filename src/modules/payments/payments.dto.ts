import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateWithdrawDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  method!: string;

  @IsOptional()
  accountInfo?: any;
}

export class RejectWithdrawDto {
  @IsOptional()
  @IsString()
  rejectReason?: string;
}
