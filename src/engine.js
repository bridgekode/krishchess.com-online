  function ENGINE_SRC(){
    var KNT = [], KGT = [], RAYS = [];   // precomputed knight jumps, king steps, and the 8 sliding rays for every square
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (var s = 0; s < 64; s++){
      var f = s & 7, r = s >> 3; KNT[s] = []; KGT[s] = []; RAYS[s] = [];
      [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(function(d){ var nf = f + d[0], nr = r + d[1]; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KNT[s].push(nr * 8 + nf); });
      DIRS.forEach(function(d, di){ var nf = f + d[0], nr = r + d[1]; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KGT[s].push(nr * 8 + nf);
        var ray = []; nf = f + d[0]; nr = r + d[1]; while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8){ ray.push(nr * 8 + nf); nf += d[0]; nr += d[1]; } RAYS[s][di] = ray; });
    }
    var CR = []; for (var c = 0; c < 64; c++) CR[c] = 15; CR[0] = 13; CR[7] = 14; CR[4] = 12; CR[56] = 7; CR[63] = 11; CR[60] = 3;   // which castling rights a square takes away
    var PV = [0, 100, 320, 330, 500, 900, 0];
    function T(a){ return a; }
    var PST = [null,
      T([0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0]),
      T([-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50]),
      T([-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20]),
      T([0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0]),
      T([-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20]),
      T([-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20])];
    // a move is one number: from | to << 6 | promotion << 12 | flag << 15  (flag 1 double pawn step, 2 en passant, 3 castling)
    function mv(fr, to, pr, fl){ return fr | (to << 6) | (pr << 12) | (fl << 15); }
    function fromOf(m){ return m & 63; } function toOf(m){ return (m >> 6) & 63; } function promoOf(m){ return (m >> 12) & 7; } function flagOf(m){ return (m >> 15) & 3; }
    function newState(){
      var b = new Int8Array(64), back = [4, 2, 3, 5, 6, 3, 2, 4];
      for (var i = 0; i < 8; i++){ b[i] = back[i]; b[8 + i] = 1; b[48 + i] = -1; b[56 + i] = -back[i]; }
      return { b: b, turn: 1, castle: 15, ep: -1, half: 0, k: [4, 60], stack: [] };
    }
    function attacked(S, sq, by){
      var b = S.b, f = sq & 7, pr = (sq >> 3) - by, i, q;
      if (pr >= 0 && pr < 8){ if (f > 0 && b[pr * 8 + f - 1] === by) return true; if (f < 7 && b[pr * 8 + f + 1] === by) return true; }
      var kn = KNT[sq]; for (i = 0; i < kn.length; i++) if (b[kn[i]] === 2 * by) return true;
      var kg = KGT[sq]; for (i = 0; i < kg.length; i++) if (b[kg[i]] === 6 * by) return true;
      for (var d = 0; d < 8; d++){ var ray = RAYS[sq][d];
        for (i = 0; i < ray.length; i++){ q = b[ray[i]]; if (!q) continue;
          if (q * by > 0){ var t = q * by; if (t === 5 || (d < 4 ? t === 4 : t === 3)) return true; } break; } }
      return false;
    }
    function inCheck(S, side){ return attacked(S, S.k[side > 0 ? 0 : 1], -side); }
    function gen(S, capsOnly, out){
      var b = S.b, side = S.turn, i, j, q, to;
      for (var sq = 0; sq < 64; sq++){
        var p = b[sq]; if (p * side <= 0) continue; var t = p * side, f = sq & 7, r = sq >> 3;
        if (t === 1){
          var one = sq + 8 * side, last = side > 0 ? 7 : 0, promo = (one >> 3) === last ? 5 : 0;
          if (!b[one] && (!capsOnly || promo)){ out.push(mv(sq, one, promo, 0));
            if (!capsOnly && (side > 0 ? r === 1 : r === 6) && !b[one + 8 * side]) out.push(mv(sq, one + 8 * side, 0, 1)); }
          if (f > 0){ to = one - 1; if (b[to] * side < 0) out.push(mv(sq, to, promo, 0)); else if (to === S.ep) out.push(mv(sq, to, 0, 2)); }
          if (f < 7){ to = one + 1; if (b[to] * side < 0) out.push(mv(sq, to, promo, 0)); else if (to === S.ep) out.push(mv(sq, to, 0, 2)); }
        } else if (t === 2 || t === 6){
          var tab = t === 2 ? KNT[sq] : KGT[sq];
          for (i = 0; i < tab.length; i++){ q = b[tab[i]]; if (q * side > 0 || (capsOnly && !q)) continue; out.push(mv(sq, tab[i], 0, 0)); }
          if (t === 6 && !capsOnly){
            if (side > 0 && sq === 4){
              if ((S.castle & 1) && !b[5] && !b[6] && b[7] === 4 && !attacked(S, 4, -1) && !attacked(S, 5, -1) && !attacked(S, 6, -1)) out.push(mv(4, 6, 0, 3));
              if ((S.castle & 2) && !b[1] && !b[2] && !b[3] && b[0] === 4 && !attacked(S, 4, -1) && !attacked(S, 3, -1) && !attacked(S, 2, -1)) out.push(mv(4, 2, 0, 3)); }
            if (side < 0 && sq === 60){
              if ((S.castle & 4) && !b[61] && !b[62] && b[63] === -4 && !attacked(S, 60, 1) && !attacked(S, 61, 1) && !attacked(S, 62, 1)) out.push(mv(60, 62, 0, 3));
              if ((S.castle & 8) && !b[57] && !b[58] && !b[59] && b[56] === -4 && !attacked(S, 60, 1) && !attacked(S, 59, 1) && !attacked(S, 58, 1)) out.push(mv(60, 58, 0, 3)); }
          }
        } else {
          var d0 = t === 4 ? 0 : t === 3 ? 4 : 0, d1 = t === 4 ? 4 : 8;
          for (var d = d0; d < d1; d++){ var ray = RAYS[sq][d];
            for (j = 0; j < ray.length; j++){ q = b[ray[j]]; if (q * side > 0) break; if (!q){ if (!capsOnly) out.push(mv(sq, ray[j], 0, 0)); continue; } out.push(mv(sq, ray[j], 0, 0)); break; } }
        }
      }
      return out;
    }
    function make(S, m){
      var b = S.b, fr = fromOf(m), to = toOf(m), pr = promoOf(m), fl = flagOf(m), side = S.turn, p = b[fr], cap = b[to], capSq = to;
      S.stack.push([m, cap, S.castle, S.ep, S.half, S.k[0], S.k[1]]);
      if (fl === 2){ capSq = to - 8 * side; cap = b[capSq]; b[capSq] = 0; S.stack[S.stack.length - 1][1] = cap; }
      b[to] = pr ? pr * side : p; b[fr] = 0;
      if (fl === 3){ if (to === 6){ b[5] = b[7]; b[7] = 0; } else if (to === 2){ b[3] = b[0]; b[0] = 0; } else if (to === 62){ b[61] = b[63]; b[63] = 0; } else if (to === 58){ b[59] = b[56]; b[56] = 0; } }
      if (p * side === 6) S.k[side > 0 ? 0 : 1] = to;
      S.castle &= CR[fr] & CR[to];
      S.ep = fl === 1 ? fr + 8 * side : -1;
      S.half = (p * side === 1 || cap) ? 0 : S.half + 1;
      S.turn = -side;
    }
    function unmake(S){
      var u = S.stack.pop(), m = u[0], b = S.b, fr = fromOf(m), to = toOf(m), pr = promoOf(m), fl = flagOf(m), side = -S.turn;
      b[fr] = pr ? side : b[to]; b[to] = 0;
      if (fl === 2) b[to - 8 * side] = u[1]; else b[to] = u[1];
      if (fl === 3){ if (to === 6){ b[7] = b[5]; b[5] = 0; } else if (to === 2){ b[0] = b[3]; b[3] = 0; } else if (to === 62){ b[63] = b[61]; b[61] = 0; } else if (to === 58){ b[56] = b[59]; b[59] = 0; } }
      S.castle = u[2]; S.ep = u[3]; S.half = u[4]; S.k[0] = u[5]; S.k[1] = u[6]; S.turn = side;
    }
    function legal(S){ var out = [], ps = gen(S, false, []), side = S.turn;
      for (var i = 0; i < ps.length; i++){ make(S, ps[i]); if (!inCheck(S, side)) out.push(ps[i]); unmake(S); } return out; }
    function evaluate(S){ var b = S.b, sc = 0;
      for (var sq = 0; sq < 64; sq++){ var p = b[sq]; if (!p) continue; var t = p > 0 ? p : -p, r = sq >> 3, f = sq & 7;
        if (p > 0) sc += PV[t] + PST[t][(7 - r) * 8 + f]; else sc -= PV[t] + PST[t][r * 8 + f]; }
      return sc; }
    var MATE = 100000, nodes = 0, deadline = 0, stopped = false;
    function score(S, m){ var cap = S.b[toOf(m)]; var s = 0; if (cap) s = 10 * PV[cap < 0 ? -cap : cap] - PV[Math.abs(S.b[fromOf(m)])]; if (promoOf(m)) s += 800; if (flagOf(m) === 2) s += 900; return s; }
    function order(S, ms, first){ var sc = ms.map(function(m){ return m === first ? 1e9 : score(S, m); }); var idx = ms.map(function(_, i){ return i; }); idx.sort(function(a, c){ return sc[c] - sc[a]; }); return idx.map(function(i){ return ms[i]; }); }
    function qs(S, alpha, beta, ply){
      if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
      var stand = evaluate(S) * S.turn; if (stand >= beta) return beta; if (stand > alpha) alpha = stand; if (ply > 14) return stand;
      var ms = order(S, gen(S, true, []), 0), side = S.turn;
      for (var i = 0; i < ms.length; i++){ make(S, ms[i]); if (inCheck(S, side)){ unmake(S); continue; }
        var v = -qs(S, -beta, -alpha, ply + 1); unmake(S); if (stopped) return 0; if (v >= beta) return beta; if (v > alpha) alpha = v; }
      return alpha; }
    function search(S, depth, alpha, beta, ply, useQ){
      if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
      if (depth <= 0) return useQ ? qs(S, alpha, beta, ply) : evaluate(S) * S.turn;
      var ms = order(S, gen(S, false, []), 0), side = S.turn, any = false;
      for (var i = 0; i < ms.length; i++){ make(S, ms[i]); if (inCheck(S, side)){ unmake(S); continue; } any = true;
        var v = -search(S, depth - 1, -beta, -alpha, ply + 1, useQ); unmake(S); if (stopped) return 0;
        if (v >= beta) return beta; if (v > alpha) alpha = v; }
      if (!any) return inCheck(S, side) ? -MATE + ply : 0;
      return alpha; }
    // cfg: rand = chance of a purely random move, d = depth, q = finish captures, noise = randomness in scoring, ms = time budget
    function think(S, cfg){
      var moves = legal(S); if (!moves.length) return 0;
      if (cfg.rand && Math.random() < cfg.rand) return moves[Math.floor(Math.random() * moves.length)];
      deadline = Date.now() + cfg.ms; stopped = false; nodes = 0;
      var best = moves[0], bestScores = null;
      for (var depth = 1; depth <= cfg.d; depth++){
        var ordered = order(S, moves, best), scores = [], alpha = -MATE * 2, cur = ordered[0];
        for (var i = 0; i < ordered.length; i++){ make(S, ordered[i]);
          var v = -search(S, depth - 1, -MATE * 2, -alpha + (cfg.noise ? 400 : 0), 1, cfg.q); unmake(S);
          if (stopped) break; scores.push([ordered[i], v]); if (v > alpha){ alpha = v; cur = ordered[i]; } }
        if (stopped && depth > 1) break;
        best = cur; bestScores = scores; if (stopped) break;
      }
      if (cfg.noise && bestScores && bestScores.length){
        var pick = null, top = -1e9; bestScores.forEach(function(s){ var v = s[1] + Math.random() * cfg.noise; if (v > top){ top = v; pick = s[0]; } }); if (pick !== null) best = pick; }
      return best;
    }
    function key(S){ return Array.prototype.join.call(S.b, '') + S.turn + S.castle + S.ep; }
    function material(S){ var n = [], b = S.b; for (var i = 0; i < 64; i++) if (b[i] && Math.abs(b[i]) !== 6) n.push(Math.abs(b[i])); return n; }
    return { newState: newState, legal: legal, make: make, unmake: unmake, inCheck: inCheck, think: think, key: key, material: material, fromOf: fromOf, toOf: toOf, promoOf: promoOf, flagOf: flagOf };
  }

// used by the room server to check every move with the same rules as the game
export const ENG = ENGINE_SRC();
