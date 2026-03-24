import { io, Socket } from 'socket.io-client';
import { TavlaLegalMove } from '../src/modules/games/tavla/tavla.engine';

type GameType = 'TAVLA' | 'OKEY';

type JoinBody = { userId: string; gameType: GameType; stake: number };

type GameStateMsg = {
  roomId: string;
  phase: string; // transport phase
  turnIndex: number;
  payload: any; // engine public payload
  players: Array<{ userId: string; seat: number }>;
};

type BotConfig = {
  baseUrl: string; // e.g. http://localhost:3000
  namespace: string; // /realtime
  stake: number;
  roomsTavla: number;
  roomsOkey: number;
  actionJitterMs: [number, number]; // random delay between actions
  maxRunMs: number; // total run time then exit
  logEveryMs: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mkUserId(prefix: string, i: number) {
  return `${prefix}_${Date.now()}_${i}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * Very small action delay to avoid sending multiple actions at once due to repeated state events.
 */
class ActionGate {
  private busy = false;
  async run(fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } finally {
      this.busy = false;
    }
  }
}

class GameBot {
  public readonly userId: string;
  public readonly gameType: GameType;

  private socket!: Socket;
  private roomId: string | null = null;
  private seat: number | null = null;

  private lastState: GameStateMsg | null = null;
  private gate = new ActionGate();

  // metrics
  public actions = 0;
  public finishedRooms = 0;
  public errors = 0;

  constructor(
    userId: string,
    gameType: GameType,
    private cfg: BotConfig,
  ) {
    this.userId = userId;
    this.gameType = gameType;
  }

  async connectAndJoin() {
    const url = `${this.cfg.baseUrl}${this.cfg.namespace}`;
    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 200,
    });

    this.socket.on('connect', () => {
      // join
      const body: JoinBody = {
        userId: this.userId,
        gameType: this.gameType,
        stake: this.cfg.stake,
      };
      this.socket.emit('room:join', body);
    });

    this.socket.on('connect_error', (e) => {
      this.errors++;
      console.error(`[${this.userId}] connect_error`, e?.message ?? e);
    });

    this.socket.on('room:joined', (msg: any) => {
      this.roomId = msg.roomId;
      // console.log(`[${this.userId}] joined room ${this.roomId}`);
    });

    this.socket.on('game:state', (msg: GameStateMsg) => {
      this.lastState = msg;
      // determine seat
      const me = msg.players?.find((p) => p.userId === this.userId);
      if (me) this.seat = me.seat ?? this.seat;

      // act
      this.gate.run(async () => {
        await this.maybeAct(msg);
      });
    });

    this.socket.on('room:finished', (msg: any) => {
      if (this.roomId && msg.roomId === this.roomId) {
        this.finishedRooms++;
      }
    });

    this.socket.on('disconnect', (reason) => {
      // console.log(`[${this.userId}] disconnected: ${reason}`);
    });
  }

  private async maybeAct(msg: GameStateMsg) {
    // no room yet
    if (!this.roomId) return;
    if (msg.roomId !== this.roomId) return;

    // WAITING transport -> do nothing
    if (msg.phase === 'WAITING') return;

    // if finished -> no actions
    if (msg.payload?.phase === 'FINISHED' || msg.phase === 'FINISHED') return;

    // if seat unknown, skip
    if (this.seat == null) return;

    const isMyTurn = msg.turnIndex === this.seat;
    if (!isMyTurn) return;

    // jitter
    const [a, b] = this.cfg.actionJitterMs;
    await sleep(randInt(a, b));

    try {
      if (this.gameType === 'TAVLA') {
        await this.actTavla(msg);
      } else {
        await this.actOkey(msg);
      }
    } catch (e: any) {
      this.errors++;
      console.error(`[${this.userId}] act error`, e?.message ?? e);
    }
  }

  private emitAction(action: any) {
    if (!this.roomId) return;
    this.socket.emit('game:action', { action });
    this.actions++;
  }

  // -------------------------
  // TAVLA BOT
  // -------------------------
  private async actTavla(msg: GameStateMsg) {
    const p = msg.payload;

    // Tavla engine phase lives in payload.phase
    const innerPhase = p?.phase;

    // OPENING => only ROLL_START
    if (innerPhase === 'OPENING') {
      this.emitAction({ type: 'ROLL_START' });
      return;
    }

    // PLAYING
    if (innerPhase === 'PLAYING') {
      // if not rolled yet => ROLL
      if (!p?.rolled) {
        this.emitAction({ type: 'ROLL' });
        return;
      }

      const legalMoves = (p?.legalMoves ?? []) as TavlaLegalMove[];

      const mv = pickOne(legalMoves);
      if (legalMoves.length > 0) {
        this.emitAction({
          type: 'MOVE',
          from: mv.from,
          to: mv.to,
          die: mv.die,
        });
        return;
      }

      // no legal moves -> END_TURN
      this.emitAction({ type: 'END_TURN' });
      return;
    }

    // fallback: do nothing
  }

  // -------------------------
  // OKEY BOT (basit stabil)
  // -------------------------
  private async actOkey(msg: GameStateMsg) {
    const p = msg.payload;

    // p.players includes viewer seat hand
    const me = Array.isArray(p?.players)
      ? p.players.find((x: any) => x.userId === this.userId)
      : null;
    const myHand: any[] = me?.hand ?? [];
    const drewThisTurn: boolean = !!p?.drewThisTurn;

    // If somehow phase not PLAYING -> do nothing
    if (p?.phase && p.phase !== 'PLAYING') return;

    // Strategy:
    // - If hand is 14 and not drew => draw (prefer discard if exists sometimes)
    // - If hand is 15 (first player starts) and not drew => discard
    // - If hand is 15/16 and drew => discard
    // - Occasionally try DECLARE_WIN when hand=14 (engine will reject if not winning)
    const discardTop = p?.discardTop ?? null;

    // Optional: try declare win sometimes if hand=14
    if (myHand.length === 14 && Math.random() < 0.02) {
      this.emitAction({ type: 'DECLARE_WIN' });
      return;
    }

    if (myHand.length === 14 && !drewThisTurn) {
      // draw
      const useDiscard = !!discardTop && Math.random() < 0.35;
      this.emitAction({ type: useDiscard ? 'DRAW_DISCARD' : 'DRAW_DECK' });
      return;
    }

    // discard path
    if (myHand.length >= 15) {
      const tileIndex = randInt(0, myHand.length - 1);
      this.emitAction({ type: 'DISCARD', tileIndex });
      return;
    }

    // If corrupted state (shouldn't happen), try drawing
    if (!drewThisTurn) {
      this.emitAction({ type: 'DRAW_DECK' });
    }
  }
}

async function run() {
  const cfg: BotConfig = {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    namespace: process.env.NS ?? '/realtime',
    stake: Number(process.env.STAKE ?? 10),

    roomsTavla: Number(process.env.ROOMS_TAVLA ?? 10),
    roomsOkey: Number(process.env.ROOMS_OKEY ?? 5),

    actionJitterMs: [
      Number(process.env.JITTER_MIN ?? 80),
      Number(process.env.JITTER_MAX ?? 220),
    ],

    maxRunMs: Number(process.env.MAX_RUN_MS ?? 120_000), // 2 dk default
    logEveryMs: Number(process.env.LOG_EVERY_MS ?? 5_000),
  };

  const bots: GameBot[] = [];

  // Create bots for Tavla rooms (2 per room)
  for (let r = 0; r < cfg.roomsTavla; r++) {
    for (let i = 0; i < 2; i++) {
      bots.push(new GameBot(mkUserId(`TAVLA_R${r}`, i), 'TAVLA', cfg));
    }
  }

  // Create bots for Okey rooms (4 per room)
  for (let r = 0; r < cfg.roomsOkey; r++) {
    for (let i = 0; i < 4; i++) {
      bots.push(new GameBot(mkUserId(`OKEY_R${r}`, i), 'OKEY', cfg));
    }
  }

  console.log('=== PARALLEL BOT RUNNER ===');
  console.log({
    baseUrl: cfg.baseUrl,
    namespace: cfg.namespace,
    stake: cfg.stake,
    roomsTavla: cfg.roomsTavla,
    roomsOkey: cfg.roomsOkey,
    totalBots: bots.length,
    maxRunMs: cfg.maxRunMs,
  });

  // Connect all
  await Promise.all(bots.map((b) => b.connectAndJoin()));

  // Periodic stats
  const startedAt = Date.now();
  const statsTimer = setInterval(() => {
    const actions = bots.reduce((s, b) => s + b.actions, 0);
    const finished = bots.reduce((s, b) => s + b.finishedRooms, 0);
    const errors = bots.reduce((s, b) => s + b.errors, 0);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[STATS t=${elapsed}s] actions=${actions} finishedSignals=${finished} errors=${errors}`,
    );
  }, cfg.logEveryMs);

  // Stop after maxRunMs
  await sleep(cfg.maxRunMs);
  clearInterval(statsTimer);

  const actions = bots.reduce((s, b) => s + b.actions, 0);
  const finished = bots.reduce((s, b) => s + b.finishedRooms, 0);
  const errors = bots.reduce((s, b) => s + b.errors, 0);

  console.log('=== DONE ===');
  console.log({ actions, finishedSignals: finished, errors });

  process.exit(errors > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
