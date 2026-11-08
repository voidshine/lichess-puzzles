// node test/test.js — checks the chess notation and the BMP encoder.
const assert = require('assert');
const c = require('../src/plugin.js');

const eq = (fen, moves, ply, want) => assert.strictEqual(c.solutionText(fen, moves, ply), want);
eq('r3r1k1/ppp2p2/3p1Pp1/7p/2Pbq2Q/8/PP1B2PP/R4R1K w - - 0 1', ['f1f4', 'e4c2', 'f4d4'], 38, '20.Rf4 Qc2 21.Rxd4');
eq('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8'], 0, '1.Ra8#');
eq('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', ['e8c8', 'e1g1'], 11, '6...O-O-O 7.O-O');
eq('k7/4P3/8/8/8/8/8/4K3 w - - 0 1', ['e7e8q'], 0, '1.e8=Q+');
eq('k7/8/8/8/8/8/8/1N1K1N2 w - - 0 1', ['b1d2'], 0, '1.Nbd2');
eq('k7/8/8/3pP3/8/8/8/4K3 w - d6 0 1', ['e5d6'], 0, '1.exd6');
assert.strictEqual(c.legalMoves(c.parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).length, 20);
assert.throws(() => c.solutionText('k7/8/8/8/8/8/8/4K3 w - - 0 1', ['e1e3'], 0));

const W = 480, H = 800, rgba = new Uint8ClampedArray(W * H * 4).fill(255);
rgba.fill(0, 0, 4); // top-left pixel black
const bmp = c.encodeMonoBmp(rgba, W, H);
assert.strictEqual(bmp.length, 62 + 60 * H);
assert.strictEqual(String.fromCharCode(bmp[0], bmp[1]), 'BM');
const topRow = 62 + (H - 1) * 60; // rows are stored bottom-up
assert.strictEqual(bmp[topRow], 0x7f);
assert.strictEqual(bmp[62], 0xff);
console.log('ok');
