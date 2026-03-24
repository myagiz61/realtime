import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding started...');

  /**
   * 1️⃣ HOUSE USER
   * Sistem hesabı – login olmayacak
   */
  const houseUser = await prisma.user.upsert({
    where: { email: 'house@system.local' },
    update: {},
    create: {
      email: 'house@system.local',
      username: 'house', // ✅ ZORUNLU alan eklendi
      password: 'SYSTEM_ACCOUNT', // login edilmeyecek
      role: UserRole.ADMIN,
    },
  });

  console.log('✅ House user ready:', houseUser.id);

  /**
   * 2️⃣ HOUSE WALLET
   */
  const houseWallet = await prisma.wallet.upsert({
    where: { userId: houseUser.id },
    update: {},
    create: {
      userId: houseUser.id,
    },
  });

  console.log('✅ House wallet ready:', houseWallet.id);

  console.log('🌱 Seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
