// Krish Chess online: game rooms
// The website (krishchess.com) creates a game here, both players connect to its room, and the room
// checks every move with the same chess rules the game uses. One room per game; rooms expire after a day.
import { DurableObject } from 'cloudflare:workers';
import { ENG } from './engine.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L, so codes are easy to read out
const EMOJIS = ['👍', '😎', '😜', '😮', '😤', '🎉', '🌧️'];   // 🌧️ = a 10-second shower on every screen (players only)
const CHEERS = ['👏', '🔥', '😮', '🎉'];                       // spectators cheer from the crowd
const MAX_WATCHERS = 10;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

function makeCode(){ let c = ''; const r = crypto.getRandomValues(new Uint8Array(4)); for (const b of r) c += CODE_CHARS[b % CODE_CHARS.length]; return c; }
function cleanCode(c){ return String(c || '').toUpperCase().replace(/^KC-?/, '').replace(/[^A-Z0-9]/g, '').slice(0, 4); }
function cleanName(n){ return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 15) || 'Player'; }
function cleanAv(a){ a = String(a || ''); return /^(samridh|opp[0-7]|c:[a-z]{3,12})$/.test(a) ? a : 'c:champion'; }
function json(d, status = 200){ return new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } }); }

export default {
  async fetch(req, env){
    const url = new URL(req.url), p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (p === '/' || p === '/health') return json({ ok: true, service: 'krish-chess-online' });
    // a new game: find a free code and set the room up
    if (p === '/api/new' && req.method === 'POST'){
      for (let k = 0; k < 6; k++){
        const code = makeCode(), stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch('https://room/init?code=' + code, { method: 'POST' });
        if (r.ok) return json({ code });
      }
      return json({ error: 'Could not make a game, please try again.' }, 500);
    }
    // is this code a live game? (so the join screen can say "not found" before connecting)
    const chk = p.match(/^\/api\/check\/([A-Za-z0-9-]+)$/);
    if (chk){ const code = cleanCode(chk[1]); if (code.length !== 4) return json({ ok: false }); return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/check'); }
    // a player's live connection
    const m = p.match(/^\/ws\/([A-Za-z0-9-]+)$/);
    if (m){
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const code = cleanCode(m[1]); if (code.length !== 4) return new Response('Bad code', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return new Response('Not found', { status: 404, headers: CORS });
  }
};

export class Room extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));   // keep-alive without waking the room
  }
  async load(){ if (this.s === undefined){ this.s = (await this.ctx.storage.get('s')) || null; this.S = null; } return this.s; }
  async save(){ await this.ctx.storage.put('s', this.s); }
  // the board, rebuilt from the list of moves (and the repeated-position count for draws)
  board(){
    if (this.S) return this.S;
    const S = ENG.newState(), rep = {}; rep[ENG.key(S)] = 1;
    for (const mv of this.s.hist){ ENG.make(S, mv); const k = ENG.key(S); rep[k] = (rep[k] || 0) + 1; }
    this.S = S; this.rep = rep; return S;
  }
  // has the game just ended? (same rules as the game itself)
  ending(){
    const S = this.board(), ms = ENG.legal(S);
    if (!ms.length) return ENG.inCheck(S, S.turn) ? { win: S.turn > 0 ? 'b' : 'w', why: 'mate' } : { win: '', why: 'stalemate' };
    if (S.half >= 100) return { win: '', why: 'fifty' };
    if (this.rep[ENG.key(S)] >= 3) return { win: '', why: 'repeat' };
    const mat = ENG.material(S); if (!mat.length || (mat.length === 1 && (mat[0] === 2 || mat[0] === 3))) return { win: '', why: 'material' };
    return null;
  }

  async fetch(req){
    const url = new URL(req.url);
    if (url.pathname === '/init'){
      if (await this.load()) return new Response('taken', { status: 409 });
      this.s = { code: url.searchParams.get('code'), created: Date.now(), players: { w: null, b: null }, watchers: [], hist: [], result: null, round: 1, rematch: [], draw: '' };
      this.S = null; await this.save(); await this.ctx.storage.setAlarm(Date.now() + (parseFloat(this.env.ROOM_HOURS) || 24) * 3600 * 1000);
      return new Response('ok');
    }
    if (url.pathname === '/check'){
      const s = await this.load();
      return json(s ? { ok: true, full: !!(s.players.w && s.players.b), host: s.players.w ? s.players.w.name : '', guest: s.players.b ? s.players.b.name : '', started: !!(s.players.w && s.players.b) } : { ok: false });
    }
    const s = await this.load();
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    const pid = (url.searchParams.get('pid') || '').slice(0, 40), name = cleanName(url.searchParams.get('name')), av = cleanAv(url.searchParams.get('av'));
    const fail = (msg, code) => { server.accept(); server.send(JSON.stringify({ t: 'error', msg, code })); server.close(1000, 'bye'); return new Response(null, { status: 101, webSocket: client }); };
    if (!s) return fail('Game not found. Check the code, or ask your friend for a new invite.', 'gone');
    if (!pid) return fail('Something went wrong. Please try again.', 'bad');
    if (!s.watchers) s.watchers = [];
    const watch = url.searchParams.get('role') === 'watch';
    let seat = ['w', 'b'].find(c => s.players[c] && s.players[c].pid === pid), tag = pid;
    if (seat){ if (s.players[seat].name !== name || s.players[seat].av !== av){ s.players[seat].name = name; s.players[seat].av = av; await this.save(); } }
    else if (!watch){
      seat = !s.players.w ? 'w' : !s.players.b ? 'b' : '';
      if (!seat) return fail('This game already has two players.', 'full');
      s.players[seat] = { pid, name, av }; s.watchers = s.watchers.filter(x => x.pid !== pid); await this.save();
    } else {
      // a spectator: up to 10 per game
      const w = s.watchers.find(x => x.pid === pid);
      if (!w){
        if (s.watchers.length >= MAX_WATCHERS) return fail('This game already has 10 people watching.', 'crowd');
        s.watchers.push({ pid, name: this.uniqueName(name, pid), av }); await this.save();
      }
      tag = 'v:' + pid;
    }
    this.ctx.acceptWebSocket(server, [tag]);
    const res = new Response(null, { status: 101, webSocket: client });
    this.broadcast();
    return res;
  }

  online(pid){ return this.ctx.getWebSockets(pid).some(w => w.readyState === 1); }
  // two watchers with the same name get a number ("Ammu 2"), so the list never shows the same name twice
  uniqueName(name, pid){
    const taken = new Set([...(this.s.watchers || []).filter(x => x.pid !== pid).map(x => x.name), ...['w', 'b'].map(c => this.s.players[c] && this.s.players[c].name).filter(Boolean)]);
    if (!taken.has(name)) return name;
    for (let k = 2; k < 50; k++){ const n = (name.slice(0, 12) + ' ' + k); if (!taken.has(n)) return n; }
    return name;
  }
  watching(){ return (this.s.watchers || []).filter(x => this.online('v:' + x.pid)).map(x => x.name); }
  seatOf(pid){ const s = this.s; return s.players.w && s.players.w.pid === pid ? 'w' : s.players.b && s.players.b.pid === pid ? 'b' : ''; }
  view(pid){
    const s = this.s, pub = (c) => s.players[c] ? { name: s.players[c].name, av: s.players[c].av, online: this.online(s.players[c].pid) } : null;
    return { t: 'state', code: s.code, you: this.seatOf(pid), spec: /^v:/.test(pid), watchers: this.watching(), players: { w: pub('w'), b: pub('b') }, hist: s.hist, result: s.result,
      round: s.round, rematch: s.rematch.map(x => this.seatOf(x)).filter(Boolean), draw: s.draw };
  }
  broadcast(){ for (const ws of this.ctx.getWebSockets()){ try { ws.send(JSON.stringify(this.view(this.ctx.getTags(ws)[0]))); } catch (e) {} } }

  async webSocketMessage(ws, raw){
    const s = await this.load(); if (!s) return;
    const pid = this.ctx.getTags(ws)[0];
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    // spectators can only cheer
    if (/^v:/.test(pid)){
      if (m.t !== 'cheer' || !CHEERS.includes(m.e)) return;
      const now = Date.now(); this.last = this.last || {}; if (this.last[pid] && now - this.last[pid] < 2000) return; this.last[pid] = now;
      const v = (s.watchers || []).find(x => 'v:' + x.pid === pid), msg = JSON.stringify({ t: 'cheer', name: v ? v.name : 'Someone', e: m.e });
      for (const w of this.ctx.getWebSockets()) try { w.send(msg); } catch (e) {}
      return;
    }
    const me = this.seatOf(pid); if (!me) return;
    const nope = (msg) => { try { ws.send(JSON.stringify({ t: 'nope', msg })); ws.send(JSON.stringify(this.view(pid))); } catch (e) {} };
    const other = me === 'w' ? 'b' : 'w';

    if (m.t === 'move'){
      // the room is the referee: both players here, game on, right turn, a legal move, and in the right place in the game
      if (!s.players.w || !s.players.b) return nope('Wait for your friend to join!');
      if (s.result) return nope('This game is over.');
      if ((m.n | 0) !== s.hist.length) return nope('Catching up…');
      const S = this.board(), turn = S.turn > 0 ? 'w' : 'b';
      if (turn !== me) return nope("It's not your turn yet.");
      const mv = m.m | 0; if (!ENG.legal(S).includes(mv)) return nope("That move isn't allowed.");
      ENG.make(S, mv); s.hist.push(mv); const k = ENG.key(S); this.rep[k] = (this.rep[k] || 0) + 1;
      s.draw = ''; s.result = this.ending();
      await this.save(); this.broadcast(); return;
    }
    if (m.t === 'resign'){ if (s.result || !s.players[other]) return; s.result = { win: other, why: 'resign' }; s.draw = ''; await this.save(); this.broadcast(); return; }
    if (m.t === 'draw'){ if (s.result || !s.players[other] || s.draw) return; s.draw = me; await this.save(); this.broadcast(); return; }
    if (m.t === 'drawreply'){
      if (s.result || s.draw !== other) return;
      if (m.yes){ s.result = { win: '', why: 'agreed' }; } s.draw = ''; await this.save(); this.broadcast(); return;
    }
    if (m.t === 'rematch'){
      if (!s.result) return;
      if (!s.rematch.includes(pid)) s.rematch.push(pid);
      if (s.rematch.length >= 2){
        // a new game, and the players swap colours
        const w = s.players.w; s.players.w = s.players.b; s.players.b = w;
        s.hist = []; s.result = null; s.rematch = []; s.draw = ''; s.round++; this.S = null;
      }
      await this.save(); this.broadcast(); return;
    }
    if (m.t === 'emoji'){
      if (!EMOJIS.includes(m.e)) return;
      const now = Date.now(); this.last = this.last || {}; if (this.last[pid] && now - this.last[pid] < 1200) return; this.last[pid] = now;
      if (m.e === '🌧️'){ this.rainAt = this.rainAt || {}; if (this.rainAt[pid] && now - this.rainAt[pid] < 30000) return; this.rainAt[pid] = now; }
      const msg = JSON.stringify({ t: 'emoji', from: me, e: m.e }); for (const w of this.ctx.getWebSockets()) try { w.send(msg); } catch (e) {}
      return;
    }
  }
  async webSocketClose(ws){ try { ws.close(); } catch (e) {} await this.load(); if (this.s) this.broadcast(); }
  async webSocketError(ws){ await this.webSocketClose(ws); }
  // a day after it was made, the room tidies itself away
  async alarm(){
    for (const ws of this.ctx.getWebSockets()){ try { ws.send(JSON.stringify({ t: 'error', msg: 'This game has ended. Start a new one!', code: 'gone' })); ws.close(1000, 'expired'); } catch (e) {} }
    await this.ctx.storage.deleteAll(); this.s = null; this.S = null;
  }
}
