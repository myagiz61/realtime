import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}
  async register(data: any) {
    const { username, email, password } = data;

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existing) {
      throw new BadRequestException('Email veya username zaten kullanılıyor');
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          password: hashed,
        },
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
        },
      });

      return { user, wallet };
    });

    const token = this.jwt.sign({
      userId: result.user.id,
    });

    return {
      accessToken: token,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        walletId: result.wallet.id,
      },
    };
  }
  async login(data: any) {
    const { email, password } = data;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('Email veya şifre yanlış');
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      throw new BadRequestException('Email veya şifre yanlış');
    }

    const token = this.jwt.sign({
      userId: user.id,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    };
  }
}
