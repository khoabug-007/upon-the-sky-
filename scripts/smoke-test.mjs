// End-to-end smoke test for the multiplayer server:
// two fake players create / list / find / join a server and exchange state.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

const emit = (s, ev, arg) => new Promise((res) => arg === undefined ? s.emit(ev, res) : s.emit(ev, arg, res));

const profileA = { name: 'TestHost', custom: { head: 80, body: 20, legs: 60 } };
const profileB = { name: 'TestFriend', custom: { head: 10, body: 90, legs: 30 } };

const a = await connect();
const b = await connect();
check('two clients connected', true);

const created = await emit(a, 'create_server', { serverName: 'Smoke Test Party', profile: profileA });
check('create_server returns ok + code', created.ok && /^[A-Z2-9]{6}$/.test(created.code), `code=${created.code}`);

const list = await emit(b, 'list_servers');
check('list_servers shows the new server', list.some((s) => s.code === created.code && s.players === 1));

const found = await emit(b, 'find_server', created.code.toLowerCase());
check('find_server finds by code (case-insensitive)', !!found && found.code === created.code);

const missing = await emit(b, 'find_server', 'ZZZZZZ');
check('find_server returns null for bad code', missing === null);

const joinedPromise = new Promise((res) => a.once('player_joined', res));
const join = await emit(b, 'join_server', { code: created.code, profile: profileB });
check('join_server ok, sees host in player list', join.ok && join.players.length === 1 && join.players[0].profile.name === 'TestHost');

const joinedEvt = await joinedPromise;
check('host receives player_joined event', joinedEvt.profile.name === 'TestFriend');

const statePromise = new Promise((res) => b.once('player_state', res));
a.emit('state', { x: 1, y: 2, z: 3, ry: 0.5, anim: 'run', carriedBy: null });
const state = await statePromise;
check('state relays between players', state.x === 1 && state.anim === 'run' && state.id === a.id);

const actionPromise = new Promise((res) => b.once('action', res));
a.emit('action', { type: 'punch', target: b.id, dir: { x: 1, y: 0, z: 0 } });
const action = await actionPromise;
check('punch action relays with sender id', action.type === 'punch' && action.from === a.id && action.target === b.id);

const leftPromise = new Promise((res) => b.once('player_left', res));
a.disconnect();
const left = await leftPromise;
check('player_left fires on disconnect', left.id !== undefined);

await new Promise((r) => setTimeout(r, 200));
const badJoin = await emit(b, 'join_server', { code: 'NOPE22', profile: profileB });
check('joining a dead code fails gracefully', badJoin.ok === false);

b.disconnect();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failed} TESTS FAILED`);
process.exit(failed === 0 ? 0 : 1);
