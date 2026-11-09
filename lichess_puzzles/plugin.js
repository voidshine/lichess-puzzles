// lichess puzzles — CrossPoint SD plugin
//
// Fetches the lichess.org daily puzzle, draws it as a classic newspaper chess
// diagram (hatched dark squares, woodcut-style pieces) and writes it to
// /sleep.bmp as a 1-bit 480x800 bitmap, which the reader's Custom sleep screen
// shows. The firmware cannot run code on-device, so the work happens here in
// the browser whenever the Plugins page (or /plugins-run) is open, or when the
// "update" job is queued through /api/plugin-jobs.
(function () {
  'use strict';

  const SCREEN_W = 480;
  const SCREEN_H = 800;
  const SLEEP_PATH = '/sleep.bmp';
  const PUZZLE_URL = 'https://lichess.org/api/puzzle/daily';
  const BATCH_URL = 'https://lichess.org/api/puzzle/batch/mix?nb=';
  const PACK_DIR = '/sleep';
  const PACK_MAX = 50; // lichess returns at most 50 puzzles per batch request
  const PACK_FILE_RE = /^lichess-puzzle-\d+\.bmp$/;
  const packName = (n) => 'lichess-puzzle-' + String(n).padStart(2, '0') + '.bmp';
  const SLEEP_SCREEN_CUSTOM = 2; // CrossPointSettings::SLEEP_SCREEN_MODE::CUSTOM

  const DEFAULT_CONFIG = { showThemes: true, showSolution: true, showCoords: true, mode: 'daily', packSize: 31 };

  // ---------------------------------------------------------------------------
  // Chess: just enough to read a FEN and write the solution in SAN.
  // Board index 0 = a8 … 63 = h1. Pieces are FEN letters (upper = white).
  // ---------------------------------------------------------------------------

  const FILES = 'abcdefgh';
  const sqIndex = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

  function parseFen(fen) {
    const [placement, turn = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/);
    const board = new Array(64).fill(null);
    let i = 0;
    for (const c of placement) {
      if (c === '/') continue;
      if (c >= '1' && c <= '8') i += Number(c);
      else board[i++] = c;
    }
    if (i !== 64) throw new Error('bad FEN: ' + fen);
    return { board, turn, castling, ep: ep === '-' ? -1 : sqIndex(ep) };
  }

  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // (file, rank-from-top) offset helper; null when off the board.
  function offset(i, df, dr) {
    const f = (i & 7) + df;
    const r = (i >> 3) + dr;
    return f < 0 || f > 7 || r < 0 || r > 7 ? null : r * 8 + f;
  }

  function isAttacked(board, target, by) {
    const up = by === 'w' ? 1 : -1; // a white pawn attacks toward rank 8 (smaller r)
    for (const df of [-1, 1]) {
      const s = offset(target, df, up);
      if (s !== null && board[s] === (by === 'w' ? 'P' : 'p')) return true;
    }
    const own = (t) => (by === 'w' ? t.toUpperCase() : t);
    for (const [df, dr] of KNIGHT) {
      const s = offset(target, df, dr);
      if (s !== null && board[s] === own('n')) return true;
    }
    for (const [df, dr] of KING) {
      const s = offset(target, df, dr);
      if (s !== null && board[s] === own('k')) return true;
    }
    const slide = (dirs, kinds) => dirs.some(([df, dr]) => {
      let s = offset(target, df, dr);
      while (s !== null) {
        const p = board[s];
        if (p) return colorOf(p) === by && kinds.includes(p.toLowerCase());
        s = offset(s, df, dr);
      }
      return false;
    });
    return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
  }

  function kingSquare(board, color) {
    return board.indexOf(color === 'w' ? 'K' : 'k');
  }

  // Pseudo-legal moves as {from, to, promo}.
  function pseudoMoves(pos) {
    const { board, turn } = pos;
    const moves = [];
    const enemy = turn === 'w' ? 'b' : 'w';
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || colorOf(p) !== turn) continue;
      const kind = p.toLowerCase();
      const add = (to) => {
        if (kind === 'p' && (to >> 3 === 0 || to >> 3 === 7)) {
          for (const promo of 'qrbn') moves.push({ from: i, to, promo });
        } else moves.push({ from: i, to });
      };
      if (kind === 'p') {
        const dir = turn === 'w' ? -1 : 1;
        const one = offset(i, 0, dir);
        if (one !== null && !board[one]) {
          add(one);
          const startRank = turn === 'w' ? 6 : 1;
          const two = offset(i, 0, 2 * dir);
          if (i >> 3 === startRank && !board[two]) add(two);
        }
        for (const df of [-1, 1]) {
          const s = offset(i, df, dir);
          if (s === null) continue;
          if ((board[s] && colorOf(board[s]) === enemy) || s === pos.ep) add(s);
        }
      } else if (kind === 'n' || kind === 'k') {
        for (const [df, dr] of kind === 'n' ? KNIGHT : KING) {
          const s = offset(i, df, dr);
          if (s !== null && (!board[s] || colorOf(board[s]) === enemy)) add(s);
        }
        if (kind === 'k') addCastling(pos, i, moves);
      } else {
        const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (const [df, dr] of dirs) {
          let s = offset(i, df, dr);
          while (s !== null) {
            if (board[s]) {
              if (colorOf(board[s]) === enemy) add(s);
              break;
            }
            add(s);
            s = offset(s, df, dr);
          }
        }
      }
    }
    return moves;
  }

  function addCastling(pos, from, moves) {
    const { board, turn, castling } = pos;
    const enemy = turn === 'w' ? 'b' : 'w';
    const home = turn === 'w' ? sqIndex('e1') : sqIndex('e8');
    if (from !== home || isAttacked(board, from, enemy)) return;
    const rights = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
    if (castling.includes(rights[0]) && !board[from + 1] && !board[from + 2] &&
        !isAttacked(board, from + 1, enemy) && !isAttacked(board, from + 2, enemy)) {
      moves.push({ from, to: from + 2 });
    }
    if (castling.includes(rights[1]) && !board[from - 1] && !board[from - 2] && !board[from - 3] &&
        !isAttacked(board, from - 1, enemy) && !isAttacked(board, from - 2, enemy)) {
      moves.push({ from, to: from - 2 });
    }
  }

  function applyMove(pos, mv) {
    const board = pos.board.slice();
    const p = board[mv.from];
    const kind = p.toLowerCase();
    if (kind === 'p' && mv.to === pos.ep && !board[mv.to]) {
      board[mv.to + (pos.turn === 'w' ? 8 : -8)] = null; // en passant capture
    }
    if (kind === 'k' && Math.abs(mv.to - mv.from) === 2) { // castling: move the rook too
      const kingside = mv.to > mv.from;
      const rookFrom = kingside ? mv.from + 3 : mv.from - 4;
      board[kingside ? mv.from + 1 : mv.from - 1] = board[rookFrom];
      board[rookFrom] = null;
    }
    board[mv.to] = mv.promo ? (pos.turn === 'w' ? mv.promo.toUpperCase() : mv.promo) : p;
    board[mv.from] = null;
    let castling = pos.castling;
    const strip = (chars) => { for (const c of chars) castling = castling.replace(c, ''); };
    if (p === 'K') strip('KQ');
    if (p === 'k') strip('kq');
    for (const [sq, c] of [['h1', 'K'], ['a1', 'Q'], ['h8', 'k'], ['a8', 'q']]) {
      if (mv.from === sqIndex(sq) || mv.to === sqIndex(sq)) strip(c);
    }
    const ep = kind === 'p' && Math.abs(mv.to - mv.from) === 16 ? (mv.from + mv.to) / 2 : -1;
    return { board, turn: pos.turn === 'w' ? 'b' : 'w', castling: castling || '-', ep };
  }

  function legalMoves(pos) {
    return pseudoMoves(pos).filter((mv) => {
      const next = applyMove(pos, mv);
      return !isAttacked(next.board, kingSquare(next.board, pos.turn), next.turn);
    });
  }

  function parseUci(uci) {
    return { from: sqIndex(uci.slice(0, 2)), to: sqIndex(uci.slice(2, 4)), promo: uci[4] || undefined };
  }

  // SAN without the check suffix; `legal` is legalMoves(pos).
  function sanBody(pos, mv, legal) {
    const p = pos.board[mv.from];
    const kind = p.toLowerCase();
    const capture = !!pos.board[mv.to] || (kind === 'p' && mv.to === pos.ep);
    if (kind === 'k' && Math.abs(mv.to - mv.from) === 2) return mv.to > mv.from ? 'O-O' : 'O-O-O';
    if (kind === 'p') {
      return (capture ? FILES[mv.from & 7] + 'x' : '') + sqName(mv.to) + (mv.promo ? '=' + mv.promo.toUpperCase() : '');
    }
    const rivals = legal.filter((m) => m.to === mv.to && m.from !== mv.from && pos.board[m.from] === p);
    let dis = '';
    if (rivals.length) {
      const sameFile = rivals.some((m) => (m.from & 7) === (mv.from & 7));
      const sameRank = rivals.some((m) => m.from >> 3 === mv.from >> 3);
      if (!sameFile) dis = FILES[mv.from & 7];
      else if (!sameRank) dis = String(8 - (mv.from >> 3));
      else dis = sqName(mv.from);
    }
    return kind.toUpperCase() + dis + (capture ? 'x' : '') + sqName(mv.to);
  }

  // Returns [san, nextPos] for a UCI move in pos.
  function toSan(pos, uci) {
    const mv = parseUci(uci);
    const legal = legalMoves(pos);
    if (!legal.some((m) => m.from === mv.from && m.to === mv.to && (m.promo || undefined) === mv.promo)) {
      throw new Error('illegal move ' + uci);
    }
    let san = sanBody(pos, mv, legal);
    const next = applyMove(pos, mv);
    if (isAttacked(next.board, kingSquare(next.board, next.turn), pos.turn)) {
      san += legalMoves(next).length ? '+' : '#';
    }
    return [san, next];
  }

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function toFen(pos) {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = pos.board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    return out + ' ' + pos.turn + ' ' + (pos.castling || '-') + ' ' + (pos.ep < 0 ? '-' : sqName(pos.ep)) + ' 0 1';
  }

  // Plays the first `plies` SAN moves of a game ("e4 e5 Nf3 …") and returns the FEN.
  // The batch API sends puzzles this way, without a FEN.
  function fenAfterPgn(pgn, plies) {
    let pos = parseFen(START_FEN);
    const tokens = pgn.split(/\s+/).filter((t) => t && !/^(\d+\.+|1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    if (tokens.length < plies) throw new Error('game too short for puzzle');
    for (let k = 0; k < plies; k++) {
      const want = tokens[k].replace(/^\d+\.+/, '').replace(/[+#!?]+$/, '').replace(/0/g, 'O');
      const legal = legalMoves(pos);
      const mv = legal.find((m) => sanBody(pos, m, legal) === want);
      if (!mv) throw new Error('cannot play ' + tokens[k] + ' at ply ' + (k + 1));
      pos = applyMove(pos, mv);
    }
    return toFen(pos);
  }

  // "20.Rf4 Qc2 21.Rxd4" — firstPly is the 0-based game ply of the first move.
  function solutionText(fen, solution, firstPly) {
    let pos = parseFen(fen);
    let ply = firstPly;
    const parts = [];
    for (let k = 0; k < solution.length; k++) {
      const [san, next] = toSan(pos, solution[k]);
      const moveNo = Math.floor(ply / 2) + 1;
      if (pos.turn === 'w') parts.push(moveNo + '.' + san);
      else parts.push(k === 0 ? moveNo + '...' + san : san);
      pos = next;
      ply++;
    }
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Piece artwork, 100x100 units, base line at y=90. Each piece is a list of
  // body parts (filled, outlined; drawn back to front) and detail strokes
  // drawn in the contrasting colour (black on white men, white on black men).
  // ---------------------------------------------------------------------------

  const BASE = 'M18 91 L82 91 L80 80 Q50 77 20 80 Z';
  const PIECES = {
    p: {
      body: [
        BASE,
        'M39 46 C39 60 32 70 28 81 L72 81 C68 70 61 60 61 46 Z',
        'M33 41 Q50 37 67 41 Q70 45.5 67 50 Q50 46 33 50 Q30 45.5 33 41 Z',
        'M50 15 A13 13 0 1 1 49.99 15 Z',
      ],
      details: ['M25 86 Q50 84 75 86', 'M36 45.5 Q50 42 64 45.5', 'M43 54 C43 64 38 72 35 78'],
    },
    r: {
      body: [
        BASE,
        'M25 81 L75 81 L72 73 L28 73 Z',
        'M32 73 L68 73 L65 38 L35 38 Z',
        'M26 38 L74 38 L74 14 L64.5 14 L64.5 22 L55 22 L55 14 L45 14 L45 22 L35.5 22 L35.5 14 L26 14 Z',
      ],
      details: [
        'M25 86 Q50 84 75 86', 'M30 77 L70 77', 'M29 31 L71 31',
        'M34.5 49.5 L65.5 49.5', 'M34 61.5 L66 61.5',
        'M50 38 L50 49.5', 'M42 49.5 L42 61.5', 'M58 49.5 L58 61.5', 'M50 61.5 L50 73',
      ],
    },
    b: {
      body: [
        BASE,
        'M29 81 C33 75 40 73 50 73 C60 73 67 75 71 81 Z',
        'M37 73 L63 73 L61 64 L39 64 Z',
        'M39.5 66 C27 57 28 38 50 20 C72 38 73 57 60.5 66 Z',
        'M50 9 A5.5 5.5 0 1 1 49.99 9 Z',
      ],
      details: [
        'M25 86 Q50 84 75 86', 'M40 68.5 L60 68.5',
        'M50 31 L50 54 M42 40 L58 40',
      ],
    },
    q: {
      body: [
        BASE,
        'M25 81 L75 81 L72 71 L28 71 Z',
        'M28 71 L17 32 L36 53 L34 23 L46 50 L50 18 L54 50 L66 23 L64 53 L83 32 L72 71 Z',
        'M17 25.5 A5 5 0 1 1 16.99 25.5 Z',
        'M34 16.5 A5 5 0 1 1 33.99 16.5 Z',
        'M50 11.5 A5 5 0 1 1 49.99 11.5 Z',
        'M66 16.5 A5 5 0 1 1 65.99 16.5 Z',
        'M83 25.5 A5 5 0 1 1 82.99 25.5 Z',
      ],
      details: ['M25 86 Q50 84 75 86', 'M30 76 L70 76', 'M28.5 64 Q50 59 71.5 64'],
    },
    k: {
      body: [
        BASE,
        'M25 81 L75 81 L72 71 L28 71 Z',
        'M28 71 C13 57 18 35 35 40 C38 32 45 31 50 37 C55 31 62 32 65 40 C82 35 87 57 72 71 Z',
        'M47 37 L47 27 L40.5 27 L40.5 21 L47 21 L47 12 L53 12 L53 21 L59.5 21 L59.5 27 L53 27 L53 37 Z',
      ],
      details: [
        'M25 86 Q50 84 75 86', 'M30 76 L70 76', 'M29.5 64 Q50 58 70.5 64',
        'M50 42 L50 60', 'M36 45 C30 50 31 56 35 60', 'M64 45 C70 50 69 56 65 60',
      ],
    },
    n: {
      body: [
        BASE,
        'M28 81 C27 70 38 63 43 56 C37 57 30 61 24 61 C17 61 12 56 15 50 ' +
          'L31 29 C35 23 41 20 47 18 L51 7 L58 16.5 C72 21 81 39 79 60 C78 70 76 77 74 81 Z',
      ],
      details: [
        'M25 86 Q50 84 75 86',
        'M41.5 30 A3 3 0 1 1 41.49 30 Z',
        'M20.5 52 A1.8 1.8 0 1 1 20.49 52 Z',
        'M15.5 56 L24 56',
        'M60 21 L66 27 M66 31 L71 37 M70 42 L74.5 48 M72 53 L75.5 59 M72.5 64 L75 70',
        'M43 56 C46 51 47 46 46 41',
      ],
    },
  };
  const DOT_DETAILS = new Set(); // details ending in "Z" are filled dots, the rest are strokes
  for (const k in PIECES) for (const d of PIECES[k].details) if (d.trim().endsWith('Z')) DOT_DETAILS.add(d);

  const pathCache = new Map();
  function path2d(d) {
    let p = pathCache.get(d);
    if (!p) pathCache.set(d, (p = new Path2D(d)));
    return p;
  }

  // Draw one piece with its 100-unit box mapped onto (x, y, size).
  function drawPiece(ctx, letter, x, y, size) {
    const art = PIECES[letter.toLowerCase()];
    const white = letter === letter.toUpperCase();
    const ink = '#000';
    const paper = '#fff';
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Halo: clears the square hatching around the piece, as in print.
    ctx.strokeStyle = paper;
    ctx.fillStyle = paper;
    ctx.lineWidth = 13;
    for (const d of art.body) { ctx.stroke(path2d(d)); ctx.fill(path2d(d)); }
    ctx.lineWidth = 4.2;
    for (const d of art.body) {
      ctx.fillStyle = white ? paper : ink;
      ctx.strokeStyle = ink;
      ctx.fill(path2d(d));
      ctx.stroke(path2d(d));
    }
    ctx.lineWidth = white ? 3 : 2.6;
    ctx.strokeStyle = white ? ink : paper;
    ctx.fillStyle = white ? ink : paper;
    for (const d of art.details) {
      if (DOT_DETAILS.has(d)) ctx.fill(path2d(d));
      else ctx.stroke(path2d(d));
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Page layout
  // ---------------------------------------------------------------------------

  const SERIF = 'Georgia, "Times New Roman", Times, serif';

  function hatchPattern(ctx) {
    // 4x4 tile of 1px "/" diagonals. Patterns are anchored to the canvas
    // origin, so integer-aligned fills give exact, unsmoothed pixels.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 4;
    const t = tile.getContext('2d');
    t.fillStyle = '#fff';
    t.fillRect(0, 0, 4, 4);
    t.fillStyle = '#000';
    for (let x = 0; x < 4; x++) t.fillRect(x, (4 - x) % 4, 1, 1);
    return ctx.createPattern(tile, 'repeat');
  }

  function humanizeTheme(t) {
    return t.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  }

  function taskLine(turn, themes) {
    const side = turn === 'w' ? 'White' : 'Black';
    const mate = themes.find((t) => /^mateIn\d$/.test(t));
    if (mate) {
      const n = Number(mate.slice(6));
      return n === 1 ? side + ' to play and mate' : side + ' to play and mate in ' + n;
    }
    if (themes.includes('equality')) return side + ' to play and draw';
    if (themes.includes('mate')) return side + ' to play and mate';
    return side + ' to play and win';
  }

  function fitFont(ctx, text, weightStyle, size, maxWidth) {
    let s = size;
    do {
      ctx.font = weightStyle + ' ' + s + 'px ' + SERIF;
    } while (ctx.measureText(text).width > maxWidth && --s > 8);
    return s;
  }

  function rule(ctx, x0, x1, y, w) {
    ctx.fillRect(x0, y, x1 - x0, w);
  }

  // p: { fen, themes[], rating, plays, id, solutionText, players[], perf, date }
  function renderPage(ctx, p, cfg) {
    const W = SCREEN_W;
    const H = SCREEN_H;
    const pos = parseFen(p.fen);
    const flip = pos.turn === 'b'; // board is shown from the solver's side
    const M = 8;

    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';

    // --- masthead ---
    let y = 18;
    rule(ctx, M, W - M, y, 3);
    rule(ctx, M, W - M, y + 5, 1);
    y += 50;
    ctx.font = 'bold 38px ' + SERIF;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText('CHESS PUZZLE', W / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += 12;
    rule(ctx, M, W - M, y, 1);
    y += 21;
    ctx.font = 'italic 16px ' + SERIF;
    ctx.textAlign = 'left';
    ctx.fillText(p.label || 'lichess.org daily puzzle', M, y);
    ctx.textAlign = 'right';
    ctx.fillText(p.date, W - M, y);
    ctx.textAlign = 'center';
    y += 9;
    rule(ctx, M, W - M, y, 1);
    rule(ctx, M, W - M, y + 3, 3);
    y += 20;

    // --- board ---
    const coord = cfg.showCoords ? 13 : 0;
    const frame = 7; // outer thick line + gap + inner thin line
    const sq = Math.floor((W - 2 * M - coord - 2 * frame) / 8);
    const boardPx = sq * 8;
    const bx = Math.round((W - boardPx - coord) / 2) + coord;
    const by = y + frame;

    const hatch = hatchPattern(ctx);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if ((r + f) % 2 === 1) {
          ctx.fillStyle = hatch;
          ctx.fillRect(bx + f * sq, by + r * sq, sq, sq);
        }
      }
    }
    // Pieces first: their white halos clear the hatching; the grid then goes on top.
    for (let i = 0; i < 64; i++) {
      const piece = pos.board[i];
      if (!piece) continue;
      const r = flip ? 7 - (i >> 3) : i >> 3;
      const f = flip ? 7 - (i & 7) : i & 7;
      const size = sq * 1.06; // the artwork has its own margins inside the 100-unit box
      drawPiece(ctx, piece, bx + f * sq + (sq - size) / 2, by + (r + 1) * sq - 0.95 * size, size);
    }
    ctx.fillStyle = '#000';
    for (let k = 0; k <= 8; k++) { // thin grid lines
      ctx.fillRect(bx + k * sq, by, 1, boardPx + 1);
      ctx.fillRect(bx, by + k * sq, boardPx + 1, 1);
    }
    // frame: thick outer, white gap, thin inner (the grid's edge)
    ctx.fillRect(bx - frame, by - frame, boardPx + 2 * frame + 1, 4);
    ctx.fillRect(bx - frame, by + boardPx + frame - 3, boardPx + 2 * frame + 1, 4);
    ctx.fillRect(bx - frame, by - frame, 4, boardPx + 2 * frame + 1);
    ctx.fillRect(bx + boardPx + frame - 3, by - frame, 4, boardPx + 2 * frame + 1);

    if (cfg.showCoords) {
      ctx.font = 'italic 13px ' + SERIF;
      ctx.textAlign = 'center';
      for (let k = 0; k < 8; k++) {
        const file = FILES[flip ? 7 - k : k];
        const rank = String(flip ? k + 1 : 8 - k);
        ctx.fillText(file, bx + k * sq + sq / 2, by + boardPx + frame + 14);
        ctx.fillText(rank, bx - frame - 8, by + k * sq + sq / 2 + 4);
      }
    }
    y = by + boardPx + frame + (cfg.showCoords ? 20 : 6);

    // --- caption, centred between the board and the footer ---
    const lines = [{ text: taskLine(pos.turn, p.themes), style: 'bold', size: 32, gap: 0 }];
    const stats = ['Puzzle ' + p.id];
    if (p.rating) stats.push('rating ' + p.rating);
    if (p.plays) stats.push(p.plays.toLocaleString('en-US') + ' plays');
    lines.push({ text: stats.join('  ·  '), style: '', size: 18, gap: 12 });
    if (p.players && p.players.length === 2) {
      const [w, b] = p.players[0].color === 'white' ? p.players : [p.players[1], p.players[0]];
      const who = (pl) => pl.name + (pl.rating ? ' (' + pl.rating + ')' : '');
      lines.push({ text: who(w) + ' – ' + who(b) + (p.perf ? ', ' + p.perf.toLowerCase() : ''),
        style: 'italic', size: 16, gap: 8 });
    }
    if (cfg.showThemes && p.themes.length) {
      lines.push({ text: 'Hint: ' + p.themes.map(humanizeTheme).join(', '), style: 'italic', size: 16, gap: 8 });
    }
    const footerTop = H - 52;
    const blockH = lines.reduce((h, l) => h + l.gap + l.size, 0);
    y += Math.max(0, Math.round((footerTop - y - blockH) / 2));
    ctx.textAlign = 'center';
    for (const l of lines) {
      y += l.gap + l.size;
      fitFont(ctx, l.text, l.style, l.size, W - 2 * M);
      ctx.fillText(l.text, W / 2, y - Math.round(l.size * 0.2));
    }

    // --- footer: solution printed upside down, newspaper fashion ---
    rule(ctx, M, W - M, footerTop, 1);
    if (cfg.showSolution && p.solutionText) {
      const s = 'Solution: ' + p.solutionText;
      ctx.save();
      // Centred between the thin rule above and the thick rule below; rotating
      // about the middle keeps it there when printed upside down.
      ctx.translate(W / 2, (footerTop + 1 + H - 18) / 2);
      ctx.rotate(Math.PI);
      fitFont(ctx, s, '', 16, W - 2 * M);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, 0, 0);
      ctx.restore();
    }
    rule(ctx, M, W - M, H - 18, 3);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 1-bit BMP
  // ---------------------------------------------------------------------------

  // rgba: Uint8ClampedArray (canvas ImageData), pixels darker than `threshold` become black.
  function encodeMonoBmp(rgba, width, height, threshold = 150) {
    const rowBytes = ((width + 31) >> 5) * 4;
    const dataOffset = 14 + 40 + 8;
    const size = dataOffset + rowBytes * height;
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4d; // "BM"
    dv.setUint32(2, size, true);
    dv.setUint32(10, dataOffset, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, width, true);
    dv.setInt32(22, height, true); // positive: bottom-up rows
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 1, true); // bpp
    dv.setUint32(30, 0, true); // BI_RGB
    dv.setUint32(34, rowBytes * height, true);
    dv.setInt32(38, 2835, true);
    dv.setInt32(42, 2835, true);
    dv.setUint32(46, 2, true);
    dv.setUint32(50, 2, true);
    // palette: 0 = black, 1 = white (B, G, R, reserved)
    buf.set([0, 0, 0, 0, 255, 255, 255, 0], 54);
    for (let y = 0; y < height; y++) {
      const row = dataOffset + (height - 1 - y) * rowBytes;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const lum = (77 * rgba[o] + 150 * rgba[o + 1] + 29 * rgba[o + 2]) >> 8;
        if (lum >= threshold) buf[row + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return buf;
  }

  // Apply the same threshold to the canvas so the preview matches the device.
  function thresholdCanvas(ctx, threshold = 150) {
    const img = ctx.getImageData(0, 0, SCREEN_W, SCREEN_H);
    const d = img.data;
    for (let o = 0; o < d.length; o += 4) {
      const v = ((77 * d[o] + 150 * d[o + 1] + 29 * d[o + 2]) >> 8) >= threshold ? 255 : 0;
      d[o] = d[o + 1] = d[o + 2] = v;
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return img;
  }

  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  // ---------------------------------------------------------------------------
  // Puzzle data
  // ---------------------------------------------------------------------------

  function formatDate(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Turns the lichess API answer into what renderPage needs.
  function toPuzzle(json, now = new Date()) {
    const pz = Object.assign({}, json.puzzle);
    const game = json.game || {};
    if (!pz.fen) pz.fen = fenAfterPgn(game.pgn || '', (pz.initialPly || 0) + 1);
    let sol = '';
    try {
      sol = solutionText(pz.fen, pz.solution || [], (pz.initialPly || 0) + 1);
    } catch (e) {
      console.warn('lichess_puzzles: cannot write solution', e);
    }
    return {
      id: pz.id,
      fen: pz.fen,
      themes: pz.themes || [],
      rating: pz.rating,
      plays: pz.plays,
      solutionText: sol,
      players: game.players,
      perf: game.perf && game.perf.name,
      date: formatDate(now),
    };
  }

  function renderToCanvas(canvas, puzzle, cfg) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext('2d');
    renderPage(ctx, puzzle, cfg);
    const img = thresholdCanvas(ctx);
    return encodeMonoBmp(img.data, SCREEN_W, SCREEN_H);
  }

  const core = {
    parseFen, toFen, fenAfterPgn, legalMoves, toSan, solutionText, encodeMonoBmp, renderPage, renderToCanvas,
    toPuzzle, taskLine, PIECES, drawPiece, SCREEN_W, SCREEN_H,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof window !== 'undefined') window.LichessPuzzles = core;
  if (typeof window === 'undefined' || !window.CrossPoint) return;


  // ---------------------------------------------------------------------------
  // Web UI (Plugins page) and job-queue actions
  //
  // Two modes:
  //  - daily: today's puzzle in /sleep.bmp, refreshed whenever this page is open.
  //  - pack:  N puzzles in /sleep/lichess-puzzle-NN.bmp. With no /sleep.bmp,
  //           the Custom sleep screen picks a different one on every sleep
  //           (it goes through the whole folder before repeating), so one
  //           visit to this page lasts N sleeps.
  // ---------------------------------------------------------------------------

  CrossPoint.registerPlugin(function (container, api) {
    const textB64 = (s) => bytesToBase64(new TextEncoder().encode(s));
    const readJson = async (file) => {
      try {
        const r = await fetch(api.pluginFile(file), { cache: 'no-cache' });
        return r.ok ? await r.json() : null;
      } catch (e) { return null; }
    };
    const writeJson = (file, obj) => api.writeFile(api.dir + '/' + file, textB64(JSON.stringify(obj)));
    const loadConfig = async () => Object.assign({}, DEFAULT_CONFIG, (await readJson('config.json')) || {});
    const clampPack = (n) => Math.min(PACK_MAX, Math.max(1, Math.round(Number(n)) || DEFAULT_CONFIG.packSize));

    // Directory listing; [] when the folder does not exist.
    async function listDir(path) {
      try {
        const r = await fetch('/api/files?path=' + encodeURIComponent(path), { cache: 'no-cache' });
        if (!r.ok) return [];
        const list = await r.json();
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    }
    async function postForm(url, fields) {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams(fields) });
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status + ': ' + (await r.text()).slice(0, 120));
    }
    const fileExists = async (dir, name) => (await listDir(dir)).some((f) => f.name === name && !f.isDirectory);
    const packFiles = async () => (await listDir(PACK_DIR)).filter((f) => !f.isDirectory && PACK_FILE_RE.test(f.name));

    async function relayJson(url) {
      const r = await api.relay('GET', url, { Accept: 'application/json' });
      if (r.status !== 200) throw new Error('lichess answered HTTP ' + r.status);
      return JSON.parse(r.body);
    }

    // --- daily mode ---

    // Fetch, render and write. Skips the write when today's puzzle is already
    // on the card unless `force`. `allowReplace` is needed to overwrite a
    // /sleep.bmp this plugin did not write.
    async function update({ force = false, allowReplace = false, canvas = null } = {}) {
      const [config, state] = await Promise.all([loadConfig(), readJson('state.json')]);
      const puzzle = toPuzzle(await relayJson(PUZZLE_URL));
      const bmp = renderToCanvas(canvas || document.createElement('canvas'), puzzle, config);
      const owned = !!(state && state.owner);
      if (!owned && !allowReplace && (await fileExists('/', SLEEP_PATH.slice(1)))) {
        return { puzzle: puzzle.id, written: false, reason: 'foreign-sleep-bmp' };
      }
      if (!force && state && state.puzzle === puzzle.id) {
        return { puzzle: puzzle.id, written: false, reason: 'up-to-date' };
      }
      await api.writeFile(SLEEP_PATH, bytesToBase64(bmp));
      await writeJson('state.json', Object.assign({}, state, {
        owner: true, puzzle: puzzle.id, written: new Date().toISOString(),
      }));
      return { puzzle: puzzle.id, written: true };
    }

    // --- pack mode ---

    async function fetchBatch(count) {
      const json = await relayJson(BATCH_URL + count);
      const puzzles = (json.puzzles || []).filter((item) => item.puzzle).slice(0, count);
      if (!puzzles.length) throw new Error('lichess sent no puzzles');
      return puzzles;
    }

    // Writes /sleep/lichess-puzzle-01.bmp … NN.bmp and removes higher-numbered
    // ones left over from a bigger pack. Other files in /sleep are not touched.
    async function fillPack({ count, canvas = null, onProgress = () => {} } = {}) {
      const config = await loadConfig();
      const n = clampPack(count === undefined ? config.packSize : count);
      onProgress('Fetching ' + n + ' puzzles from lichess…');
      const items = await fetchBatch(n);
      if (!(await listDir('/')).some((f) => f.isDirectory && f.name === PACK_DIR.slice(1))) {
        await postForm('/mkdir', { name: PACK_DIR.slice(1), path: '/' });
      }
      const target = canvas || document.createElement('canvas');
      for (let i = 0; i < items.length; i++) {
        const puzzle = toPuzzle(items[i]);
        puzzle.label = 'lichess.org puzzle';
        puzzle.date = 'No. ' + (i + 1) + ' of ' + items.length;
        onProgress('Writing ' + packName(i + 1) + ' (' + (i + 1) + ' of ' + items.length + ')…');
        const bmp = renderToCanvas(target, puzzle, config);
        await api.writeFile(PACK_DIR + '/' + packName(i + 1), bytesToBase64(bmp));
      }
      const stale = (await packFiles())
        .filter((f) => Number(f.name.match(/\d+/)[0]) > items.length)
        .map((f) => PACK_DIR + '/' + f.name);
      if (stale.length) await postForm('/delete', { paths: JSON.stringify(stale) });
      const state = (await readJson('state.json')) || {};
      await writeJson('state.json', Object.assign(state, { pack: { count: items.length, written: new Date().toISOString() } }));
      return { written: items.length, removed: stale.length };
    }

    async function cleanPack() {
      const paths = (await packFiles()).map((f) => PACK_DIR + '/' + f.name);
      if (paths.length) await postForm('/delete', { paths: JSON.stringify(paths) });
      return { removed: paths.length };
    }

    // Job queue, e.g. {"plugin":"lichess_puzzles","action":"fill","args":{"count":31}}
    api.registerAction('update', async (args) => update({ force: !!(args && args.force) }));
    api.registerAction('fill', async (args) => fillPack({ count: args && args.count }));
    api.registerAction('clean', async () => cleanPack());

    // --- card UI ---
    container.innerHTML = '';
    const el = (tag, props, ...kids) => {
      const n = Object.assign(document.createElement(tag), props || {});
      for (const k of kids) n.append(k);
      return n;
    };
    const button = (text) => el('button', { type: 'button', textContent: text });
    const status = el('p', { textContent: 'Loading…' });
    const notes = el('div');
    const canvas = el('canvas', { width: SCREEN_W, height: SCREEN_H });
    canvas.style.cssText = 'width:240px;height:400px;border:1px solid #888;display:none;margin:8px 0';
    const modeNote = el('p');
    const options = el('div');
    const modes = el('div');

    const btnUpdate = button('Update sleep screen now');
    const btnReplace = button('Replace existing /sleep.bmp');
    btnReplace.style.display = 'none';
    const dailyRow = el('p', {}, btnUpdate, ' ', btnReplace);

    const countInput = el('input', { type: 'number', min: 1, max: PACK_MAX, step: 1, value: DEFAULT_CONFIG.packSize });
    countInput.style.width = '4em';
    const btnFill = button('Fetch and fill');
    const packRow = el('p', {}, 'Puzzles: ', countInput, ' ', btnFill);

    const btnClean = button('Delete /sleep/lichess-puzzle-*.bmp');
    const allButtons = [btnUpdate, btnReplace, btnFill, btnClean];

    container.append(
      el('h2', { textContent: 'lichess puzzles' }),
      el('p', { textContent: 'Draws lichess.org puzzles as newspaper chess diagrams for the sleep screen.' }),
      modes, dailyRow, packRow, status, notes, canvas, options, modeNote,
      el('p', {}, btnClean),
    );

    let config = Object.assign({}, DEFAULT_CONFIG);
    const OPTION_LABELS = {
      showSolution: 'Print the solution upside down at the bottom',
      showThemes: 'Show puzzle themes as a hint',
      showCoords: 'Show board coordinates',
    };
    const MODE_LABELS = {
      daily: 'Daily puzzle — today’s puzzle in /sleep.bmp, refreshed whenever this page is open',
      pack: 'Puzzle pack — several puzzles in /sleep/, a different one each time the reader sleeps',
    };

    const setStatus = (t) => { status.textContent = t; };
    const saveConfig = async () => {
      try { await writeJson('config.json', config); return true; }
      catch (e) { setStatus('Could not save options: ' + e.message); return false; }
    };
    const busy = async (fn) => {
      allButtons.forEach((b) => { b.disabled = true; });
      try { await fn(); }
      catch (e) { setStatus('Failed: ' + (e && e.message ? e.message : e)); }
      finally { allButtons.forEach((b) => { b.disabled = false; }); }
    };
    const showCanvas = () => { canvas.style.display = 'block'; };

    // Facts about the SD card that decide what the sleep screen will show.
    async function refreshNotes() {
      notes.replaceChildren();
      const note = (t) => notes.append(el('p', { textContent: t }));
      const [rootList, sleepList, state] = await Promise.all([listDir('/'), listDir(PACK_DIR), readJson('state.json')]);
      const ours = sleepList.filter((f) => !f.isDirectory && PACK_FILE_RE.test(f.name)).length;
      const others = sleepList.filter((f) => !f.isDirectory && /\.bmp$/i.test(f.name) && !PACK_FILE_RE.test(f.name)).length;
      const hasSleepBmp = rootList.some((f) => f.name === SLEEP_PATH.slice(1) && !f.isDirectory);
      if (config.mode === 'pack') {
        note(ours ? PACK_DIR + ' holds ' + ours + ' lichess puzzle image' + (ours === 1 ? '' : 's') + '.'
          : 'No lichess puzzle images in ' + PACK_DIR + ' yet.');
        if (hasSleepBmp) {
          note('⚠ ' + SLEEP_PATH + (state && state.owner ? ' (written by daily mode)' : '') +
            ' is on the SD card. It takes priority over ' + PACK_DIR + ', so the reader will keep showing it. ' +
            'Delete or rename it in Files to use the pack.');
        }
        if (others) note(others + ' other image' + (others === 1 ? ' is' : 's are') + ' in ' + PACK_DIR + ' and will be mixed in.');
      } else if (ours) {
        note(ours + ' pack image' + (ours === 1 ? '' : 's') + ' in ' + PACK_DIR +
          ' only show when there is no ' + SLEEP_PATH + '.');
      }
    }

    function runDaily(opts) {
      return busy(async () => {
        setStatus('Fetching today’s puzzle…');
        showCanvas();
        const res = await update(Object.assign({ canvas }, opts));
        btnReplace.style.display = 'none';
        if (res.written) {
          setStatus('Puzzle ' + res.puzzle + ' written to ' + SLEEP_PATH + '. It shows the next time the reader sleeps.');
        } else if (res.reason === 'up-to-date') {
          setStatus('Puzzle ' + res.puzzle + ' is already on the sleep screen.');
        } else if (res.reason === 'foreign-sleep-bmp') {
          setStatus('A ' + SLEEP_PATH + ' this plugin did not create is on the SD card. ' +
            'Replace it to show the puzzle (back it up first if you want to keep it).');
          btnReplace.style.display = '';
        }
        await refreshNotes();
      });
    }

    function runFill() {
      return busy(async () => {
        config.packSize = clampPack(countInput.value);
        countInput.value = config.packSize;
        await saveConfig();
        showCanvas();
        const res = await fillPack({ count: config.packSize, canvas, onProgress: setStatus });
        setStatus('Wrote ' + res.written + ' puzzles to ' + PACK_DIR +
          (res.removed ? ' and removed ' + res.removed + ' left over from a bigger pack' : '') + '.' +
          (res.written < config.packSize ? ' (lichess sent fewer than asked.)' : ''));
        await refreshNotes();
      });
    }

    btnUpdate.onclick = () => runDaily({ force: true });
    btnReplace.onclick = () => runDaily({ force: true, allowReplace: true });
    btnFill.onclick = runFill;
    btnClean.onclick = () => {
      if (!confirm('Delete every ' + PACK_DIR + '/lichess-puzzle-*.bmp file?')) return;
      busy(async () => {
        const res = await cleanPack();
        setStatus(res.removed ? 'Deleted ' + res.removed + ' puzzle image' + (res.removed === 1 ? '' : 's') + '.'
          : 'No lichess puzzle images to delete.');
        await refreshNotes();
      });
    };

    function showMode() {
      dailyRow.style.display = config.mode === 'daily' ? '' : 'none';
      packRow.style.display = config.mode === 'pack' ? '' : 'none';
    }

    async function checkSleepMode() {
      try {
        const list = await (await fetch('/api/settings?keys=sleepScreen')).json();
        const s = Array.isArray(list) && list.find((x) => x.key === 'sleepScreen');
        if (!s) return;
        if (s.value === SLEEP_SCREEN_CUSTOM) { modeNote.textContent = ''; return; }
        const current = (s.options && s.options[s.value]) || String(s.value);
        modeNote.textContent = 'Sleep screen is set to “' + current + '”, so the puzzles will not show. ';
        const fix = button('Switch sleep screen to Custom');
        fix.onclick = async () => {
          fix.disabled = true;
          try {
            const r = await fetch('/api/settings', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sleepScreen: SLEEP_SCREEN_CUSTOM }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            checkSleepMode();
          } catch (e) {
            modeNote.textContent = 'Could not change the setting: ' + e.message;
          }
        };
        modeNote.append(fix);
      } catch (e) { /* settings API unavailable: say nothing */ }
    }

    return (async () => {
      config = await loadConfig();
      config.packSize = clampPack(config.packSize);
      countInput.value = config.packSize;
      for (const mode of Object.keys(MODE_LABELS)) {
        const radio = el('input', { type: 'radio', name: 'lichess-puzzles-mode', checked: config.mode === mode });
        radio.onchange = async () => {
          config.mode = mode;
          showMode();
          await saveConfig();
          if (mode === 'daily') runDaily({});
          else {
            setStatus('Choose how many puzzles to fetch, then press Fetch and fill.');
            await refreshNotes();
          }
        };
        modes.append(el('label', { style: 'display:block' }, radio, ' ' + MODE_LABELS[mode]));
      }
      for (const key of Object.keys(OPTION_LABELS)) {
        const box = el('input', { type: 'checkbox', checked: !!config[key] });
        box.onchange = async () => {
          config[key] = box.checked;
          if (!(await saveConfig())) return;
          if (config.mode === 'daily') runDaily({ force: true });
          else setStatus('Saved. The change applies the next time you fetch and fill.');
        };
        options.append(el('label', { style: 'display:block' }, box, ' ' + OPTION_LABELS[key]));
      }
      showMode();
      checkSleepMode();
      if (config.mode === 'daily') runDaily({});
      else {
        // Refilling replaces the puzzles, so pack mode never runs by itself on page load.
        setStatus('Choose how many puzzles to fetch, then press Fetch and fill.');
        await refreshNotes();
      }
    })();
  });
})();
