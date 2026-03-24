/**
 * AUTO-FORFEIT TEST (GRACE EXPIRED)
 *
 * SCENARIO:
 * - U1 joins
 * - U2 joins
 * - Room becomes PLAYING
 * - U2 disconnects
 * - NO reconnect
 * - Wait >30s
 * - Backend forfeit worker finishes room
 */

const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000/realtime';

const ROOM = { id: null };

const s1 = io(SERVER_URL, {
  transports: ['websocket'],
  reconnection: false,
});

const s2 = io(SERVER_URL, {
  transports: ['websocket'],
  reconnection: false,
});

function log(name, msg, data) {
  if (data) console.log(`[${name}] ${msg}`, data);
  else console.log(`[${name}] ${msg}`);
}

/* ===============================
   CONNECTION
=============================== */

s1.on('connect', () => log('U1', `connected ${s1.id}`));
s2.on('connect', () => log('U2', `connected ${s2.id}`));

[s1, s2].forEach((s, i) => {
  const name = i === 0 ? 'U1' : 'U2';

  s.on('room:joined', (d) => {
    log(name, 'room:joined', d);
    ROOM.id = d.roomId;
  });

  s.on('room:state', (d) => log(name, 'room:state', d));
  s.on('room:ready', (d) => log(name, 'room:ready', d));
  s.on('room:finished', (d) => log(name, 'room:finished 🏁', d));
  s.on('exception', (e) => log(name, 'exception ❌', e));
});

/* ===============================
   TEST FLOW
=============================== */

// STEP 1: U1 joins
setTimeout(() => {
  console.log('\n👉 STEP 1: U1 joins');
  s1.emit('room:join', {
    userId: 'U1',
    gameType: 'TAVLA',
    stake: '10',
  });
}, 1000);

// STEP 2: U2 joins
setTimeout(() => {
  console.log('\n👉 STEP 2: U2 joins');
  s2.emit('room:join', {
    userId: 'U2',
    gameType: 'TAVLA',
    stake: '10',
  });
}, 2500);

// STEP 3: U2 disconnects (NO reconnect)
setTimeout(() => {
  console.log('\n💥 STEP 3: U2 disconnects (NO RECONNECT)');
  s2.disconnect();
}, 5000);

// STEP 4: Wait grace expiration
setTimeout(() => {
  console.log('\n⏳ STEP 4: Grace expired (>30s)');
  console.log('Now run FORFEIT worker / endpoint');
}, 36000);

// STEP 5: Final check
setTimeout(() => {
  console.log('\n✅ STEP 5: Final check');
  console.log('Expected: room FINISHED, U1 WIN, holds CONSUMED');
}, 45000);
