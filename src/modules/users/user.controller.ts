import { Controller, Post, Body } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('users')
export class UserController {
  constructor(private prisma: PrismaService) {}

  @Post()
  create(
    @Body()
    body: {
      id?: string;
      email: string;
      username: string;
      password: string;
    },
  ) {
    return this.prisma.user.create({
      data: {
        id: body.id,
        email: body.email,
        username: body.username, // EKLENDİ
        password: body.password,
      },
    });
  }
}
