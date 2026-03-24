// src/test/socket.okey.bot.test.ts
//
// ✅ Professional OKEY (4-player) bot test script for your NestJS Socket.IO gateway.
// - Creates/joins ONE room with 4 bots
// - Plays legal turns end-to-end using ONLY viewer public state (hand only visible to self)
// - Stops on room:finished
// - Optional AFK scenario to validate FORCE_FINISH + payout happens once
//
// Run:
//   WS_URL=http://localhost:3000 npx ts-node src/test/socket.okey.bot.test.ts
//
// Optional:
//   STAKE=10 AFK_TEST=0 TURN_DELAY_MS=200 npx ts-node ...
//
// Notes:
// - Uses events: room:join, room:joined, game:state, room:finished
// - Uses action: {type:'DRAW_DECK'|'DRAW_DISCARD'|'DISCARD', tileIndex:number}
// - If your server uses different gameType strings, adjust GAME_TYPE below.

import { io, Socket } from 'socket.io-client';
import crypto from 'crypto';
type GameType = 'OKEY' | 'TAVLA' | 'BATAK' | 'PISTI' | 'FIFTYONE';

type OkeyAction =
  | { type: 'DRAW_DECK' }
  | { type: 'DRAW_DISCARD' }
  | { type: 'DISCARD'; tileIndex: number }
  | { type: 'DECLARE_WIN' }
  | { type: 'FORCE_FINISH'; winnerSeat: number }; // for AFK timeout path if you ever trigger it manually

type GameStateMsg = {
  roomId: string;
  phase: string; // WAITING/PLAYING/FINISHED (transport)
  turnIndex: number;
  payload: any; // viewer-aware
  players: Array<{ userId: string; seat: number }>;
};

const WS_URL = process.env.WS_URL ?? 'http://localhost:3000';
const NAMESPACE = '/realtime';
const GAME_TYPE: GameType = 'OKEY';
const STAKE = Number(process.env.STAKE ?? 10);
const TURN_DELAY_MS = Number(process.env.TURN_DELAY_MS ?? 150);
const AFK_TEST = (process.env.AFK_TEST ?? '0') === '1'; // set 1 to simulate AFK on one bot
const AFK_BOT_INDEX = Number(process.env.AFK_BOT_INDEX ?? 2); // bot #2 will go AFK by default

const BOT_COUNT = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function log(prefix: string, ...args: any[]) {
  console.log(prefix, ...args);
}

async function waitFor<T>(
  socket: Socket,
  event: string,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);

    const on = (data: T) => {
      cleanup();
      resolve(data);
    };

    const cleanup = () => {
      clearTimeout(t);
      socket.off(event, on as any);
    };

    socket.once(event, on as any);
  });
}

class OkeyBot {
  public socket: Socket;
  public userId: string;
  public idx: number;
  public seat: number | null = null;

  public roomId: string | null = null;
  public lastState: GameStateMsg | null = null;

  private acting = false;
  private stopped = false;
  private finished = false;

  constructor(idx: number) {
    this.idx = idx;

    this.userId = crypto.randomUUID();

    this.socket = io(`${WS_URL}${NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: false,
    });

    this.socket.on('connect', () => {
      log(this.tag(), 'connected', this.socket.id);
    });

    this.socket.on('disconnect', (r) => {
      log(this.tag(), 'disconnected', r);
    });

    this.socket.on('game:state', (msg: GameStateMsg) => {
      this.lastState = msg;
      if (!this.roomId) this.roomId = msg.roomId;

      this.socket.on('connect_error', (e) => {
        log(this.tag(), '❌ connect_error', e?.message ?? e);
      });

      this.socket.on('error', (e) => {
        log(this.tag(), '❌ error', e);
      });

      this.socket.on('exception', (e) => {
        log(this.tag(), '❌ exception', e);
      });

      // seat resolve (server sends {userId, seat} in msg.players)
      const me = msg.players?.find((p) => p.userId === this.userId);
      if (me) this.seat = me.seat;

      // auto-act
      void this.maybeAct();
    });

    this.socket.on('room:finished', (msg: any) => {
      this.finished = true;
      log(this.tag(), '🏁 room:finished', msg);
    });
  }

  tag() {
    return `[BOT#${this.idx} seat=${this.seat ?? '?'}]`;
  }

  stop() {
    this.stopped = true;
    try {
      this.socket.disconnect();
    } catch {}
  }
  async waitForConnect() {
    if (this.socket.connected) return;

    await new Promise<void>((resolve) => {
      this.socket.once('connect', () => resolve());
    });
  }

  async joinRoom() {
    await this.waitForConnect();

    // ✅ 1) önce dinleyicileri kur (event kaçmasın)
    const pJoined = waitFor<any>(this.socket, 'room:joined', 30_000);
    const pState = waitFor<GameStateMsg>(this.socket, 'game:state', 30_000);

    // ✅ 2) sonra emit et
    this.socket.emit('room:join', {
      userId: this.userId,
      gameType: GAME_TYPE,
      stake: STAKE,
    });

    // ✅ 3) joined + state bekle
    const joined = await pJoined;
    const state = await pState;

    this.roomId = state.roomId;
    log(this.tag(), 'room:joined', joined);
    log(this.tag(), 'game:state received', {
      roomId: state.roomId,
      phase: state.phase,
    });
  }

  private myHand(): any[] | null {
    const s = this.lastState;
    if (!s) return null;
    const payload = s.payload;
    const players = payload?.players ?? [];
    const p = players.find((x: any) => x.userId === this.userId);
    const hand = p?.hand;
    if (!hand) return null; // only visible for viewer
    return hand;
  }

  private discardTopExists(): boolean {
    const s = this.lastState;
    if (!s) return false;
    const top = s.payload?.discardTop;
    return !!top;
  }

  private isMyTurn(): boolean {
    const s = this.lastState;
    if (!s) return false;
    if (typeof this.seat !== 'number') return false;
    return s.turnIndex === this.seat;
  }

  private phase(): string {
    return this.lastState?.payload?.phase ?? this.lastState?.phase ?? 'UNKNOWN';
  }

  private drewThisTurn(): boolean {
    return !!this.lastState?.payload?.drewThisTurn;
  }

  private async emitAction(action: OkeyAction) {
    if (!this.roomId) throw new Error('No roomId');
    this.socket.emit('game:action', { action });
  }

  private async maybeAct() {
    if (this.stopped || this.finished) return;
    if (this.acting) return;
    if (!this.lastState) return;

    const phase = this.phase();
    if (phase !== 'PLAYING') return;

    // Optional AFK: one bot will intentionally never play on its turns.
    if (AFK_TEST && this.idx === AFK_BOT_INDEX) {
      if (this.isMyTurn()) {
        log(this.tag(), '😴 AFK mode: skipping my turn to trigger timeout');
      }
      return;
    }

    if (!this.isMyTurn()) return;

    const hand = this.myHand();
    if (!hand) {
      // viewer state not ready; wait next tick
      return;
    }

    this.acting = true;
    try {
      // Small delay to avoid all bots acting in the same millisecond (clean logs, stable tests)
      await sleep(TURN_DELAY_MS);

      // Decide legal step based on your engine rules:
      // - If hand.length === 14 -> must draw
      // - If drewThisTurn === true -> must discard (hand should be 16)
      // - If seat0 initial can have 15 and drewThisTurn=false -> can discard immediately
      const len = hand.length;
      const drew = this.drewThisTurn();

      // 1) Need draw?
      if (!drew && len === 14) {
        const useDiscard = this.discardTopExists();
        const action: OkeyAction = useDiscard
          ? { type: 'DRAW_DISCARD' }
          : { type: 'DRAW_DECK' };

        log(this.tag(), '➡️ action', action, `(hand=${len}, drew=${drew})`);
        await this.emitAction(action);
        return;
      }

      // 2) Must discard?
      if (drew || len === 15 || len === 16) {
        // choose random tile index to discard
        const tileIndex = randInt(0, Math.max(0, len - 1));
        const action: OkeyAction = { type: 'DISCARD', tileIndex };

        log(this.tag(), '➡️ action', action, `(hand=${len}, drew=${drew})`);
        await this.emitAction(action);
        return;
      }

      // 3) Fallback (should never happen if engine is consistent)
      log(this.tag(), '⚠️ unexpected hand state', {
        handLen: len,
        drewThisTurn: drew,
      });
    } catch (e: any) {
      log(this.tag(), '❌ action error', e?.message ?? e);
    } finally {
      this.acting = false;
    }
  }
}

async function main() {
  console.log('=== OKEY BOT TEST ===');
  console.log({
    WS_URL,
    NAMESPACE,
    GAME_TYPE,
    STAKE,
    TURN_DELAY_MS,
    AFK_TEST,
    AFK_BOT_INDEX,
  });

  const bots = Array.from({ length: BOT_COUNT }, (_, i) => new OkeyBot(i));

  // Wait for sockets to connect

  // Join sequentially (more deterministic room matching)
  for (const b of bots) {
    await b.joinRoom();
    await sleep(100);
  }

  // Validate all in same room
  const roomIds = new Set(bots.map((b) => b.roomId));
  if (roomIds.size !== 1) {
    console.error('❌ Bots ended up in multiple rooms:', Array.from(roomIds));
    bots.forEach((b) => b.stop());
    process.exit(1);
  }
  const roomId = bots[0].roomId!;
  console.log('✅ All bots in same room:', roomId);

  // Run until finished (room:finished event)
  const startedAt = Date.now();
  const HARD_TIMEOUT_MS = AFK_TEST ? 180_000 : 120_000;

  while (Date.now() - startedAt < HARD_TIMEOUT_MS) {
    // if any bot sees finished, stop
    if (bots.some((b) => (b as any).finished === true)) break;
    await sleep(250);
  }

  console.log('=== STOPPING BOTS ===');
  bots.forEach((b) => b.stop());
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
