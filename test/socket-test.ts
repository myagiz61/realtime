import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3000/realtime';
const GAME_TYPE = 'TEXAS_POKER';
const STAKE = 100;

/* BOT AYARLARI */

const TOTAL_BOTS = 10000;
const CONNECT_BATCH = 200;
const JOIN_DELAY = 5;

class PokerBot {
  socket!: Socket;

  constructor(public userId: string) {}

  async connect() {
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.socket.on('connect', () => {
        resolve();
      });

      this.socket.on('connect_error', reject);
    });

    this.bindEvents();
  }

  bindEvents() {
    this.socket.on('room:joined', (data) => {
      console.log(`[${this.userId}] joined room ${data.roomId}`);
    });

    this.socket.on('game:state', async (state) => {
      const payload = state.payload || {};
      const players = payload.players || [];

      const me = players.find((p: any) => p.userId === this.userId);

      if (!me) return;

      if (state.turnIndex !== me.seat) return;

      const legal = payload.legalActions || [];

      if (!legal.length) return;

      /* İnsan davranışı gecikmesi */
      await sleep(random(300, 1200));

      const action = legal[Math.floor(Math.random() * legal.length)];

      this.socket.emit('game:action', {
        action: {
          type: action.type,
          amount: action.min || action.amount || 0,
        },
      });
    });
  }

  join() {
    this.socket.emit('room:join', {
      userId: this.userId,
      gameType: GAME_TYPE,
      stake: STAKE,
    });
  }
}

async function main() {
  console.log('creating bots...');

  const bots: PokerBot[] = [];

  for (let i = 0; i < TOTAL_BOTS; i++) {
    bots.push(new PokerBot(`BOT_${i}`));
  }

  console.log(`bots created: ${bots.length}`);

  console.log('connecting bots...');

  for (let i = 0; i < bots.length; i += CONNECT_BATCH) {
    const batch = bots.slice(i, i + CONNECT_BATCH);

    await Promise.all(batch.map((b) => b.connect()));

    console.log(
      `connected ${Math.min(i + CONNECT_BATCH, bots.length)}/${bots.length}`,
    );

    await sleep(200);
  }

  console.log('joining matchmaking...');

  for (const bot of bots) {
    bot.join();

    await sleep(JOIN_DELAY);
  }

  console.log('stress test running');
}

function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

main();
