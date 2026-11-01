// Battle scene. Everything is drawn into a tiny canvas, CSS scales it by a whole number, and every style uses one pixel unit (ASCII draws on a 192 canvas, its unit is that canvas's pixel).
// The knight is its own sprite, a helmeted figure with nothing of Rommel in it: one rule per screen keeps him in the header.
// Each style re-renders the same cells.

import { calm } from './brand.js';

// Art palette: the one kept exception to tokens. Scene pixels are game art inside the canvas, they stay the same in both themes, so they cannot follow CSS tokens.
const PX = { banner:'#C0352F', steel:'#C9CED6', shine:'#F4F5F7', ink:'#16181D', belt:'#3A3F48', paper:'#ECEEF1', hilt:'#5B6270', white:'#FFFFFF', black:'#000000', cream:'#FFFDF7', parchment:'#FFFBE8', asciiInk:'#17231D', wine:'#8B2F34', slate:'#26313A', sparkPale:'#FFF1A8', sparkRed:'#FF795F', sparkGold:'#F8D25B', blockGold:'#FFD46A', blockRed:'#EF6B55', blobGold:'#FFE08A', blobRed:'#FF8A72', hurtBlock:'#C9434A', hurtBit:'#F05252', hurtBlob:'#DB5961', hurtLine:'#FF5B5B', hurtText:'#7A2830', blobText:'#56323A', heal:'#E9FFF0', healAscii:'#1F7A4D' };
const AREAS = { // named by the rules, so game-rules.js holds no colour
  greenvale:{ sky:['#9FE7E5','#C7F1D8','#F6E6A4'], far:'#78B99A', hill:'#4B9B6D', ground:'#61B84A', grass:'#378E46', path:'#C89663', tree:'#275D42', trunk:'#81583A', armor:'#5F82C5', enemy:['#204B44','#3A8C6B','#8FD694','#D7F3B7'] },
  amberwood:{ sky:['#F7D7A8','#F0B87B','#D9835A'], far:'#B87355', hill:'#76533D', ground:'#9B7B45', grass:'#5A6D3B', path:'#E2B66C', tree:'#536238', trunk:'#6E4332', armor:'#7597B5', enemy:['#4A241A','#8A4A2E','#D39B4A','#F2D28B'] },
  moonlit:{ sky:['#495A8A','#7D83B5','#C4B7D9'], far:'#5B5877', hill:'#39394F', ground:'#59636F', grass:'#394852', path:'#91858F', tree:'#303846', trunk:'#56424D', armor:'#6F8AC4', enemy:['#2A2135','#6B3858','#B14B63','#E08979'] },
  clockwork:{ sky:['#B5D1CE','#D7D6B6','#E5C98C'], far:'#75877F', hill:'#53605E', ground:'#7B795D', grass:'#555B46', path:'#C1A574', tree:'#4E5D52', trunk:'#6A4D3B', armor:'#4D7880', enemy:['#333238','#6E6B6C','#A88A5D','#D9C890'] },
  frostbyte:{ sky:['#9FD9E6','#C6E8EE','#EFF2E5'], far:'#7DA6B3', hill:'#557486', ground:'#B7D4D0', grass:'#6EA3A0', path:'#D7C9B6', tree:'#3E6868', trunk:'#72594A', armor:'#5F8DB6', enemy:['#2C3F65','#536FB0','#7C9CDD','#C0D4FA'] },
  skykeep:{ sky:['#8EC5F4','#C6D9F2','#F6D9B6'], far:'#7E85B7', hill:'#5A5C89', ground:'#8DBA78', grass:'#567D57', path:'#D9B47E', tree:'#425C57', trunk:'#76513D', armor:'#7E74C8', enemy:['#37254F','#6C3F82','#B05C99','#F0A3C3'] },
};

const W = 96, H = 54, GROUND = 46, TICK = 1000 / 30, HERO_X = 12, BOSS_X = 62;
const DURATION = { attack:32, hurt:28, heal:27, boss_clear:54, revive:44 }; // ticks, TimeBlock's combat timings

const BOSSES = {
  slime:['....DD....','..DDDDDD..','.DDBBBBDD.','DDBDBBBDDD','DDBBBBBBDD','.DDDBBDDD.','..D....D..'],
  mimic:['.AAAAAAAA.','ADDDDDDDDA','ADBBBBBBDA','ADBD..DBDA','ADBBBBBBDA','AEEEEEEEEA','.EE....EE.'],
  drake:['......D....','..D..DDD...','.DDDDDBDD..','DDBBBBBDD..','.DBBBDDDD..','..DDD.DD...','...D..D....'],
  hydra:['.D..D..D..','DD.DD.DD..','DBDDBDDB..','DDBBBBBB..','..BBBBB...','..B.B.B...','..D.D.D...'],
  clock:['..AAAA....','.ADDDDDA..','ADDBBDDA..','ADBBBBDA..','ADDBBDDA..','.ADDDDDA..','..A..A....'],
  mage:['...DDD...','..DBBBD..','.DDBBBDD.','..DDBDD..','..BBBBB..','.BB.B.BB.','..D...D..'],
};
// Facing right. p plume, s steel, h highlight, v visor, a area armour, d belt, o boots. Row 0 sits 3 cells above his old head line, so his feet stay on the ground.
const KNIGHT = [
  '....ppp.....',
  '...pp.......',
  '...ssssss...',
  '..sshhssss..',
  '..ssssssss..',
  '..ssvvvvvs..',
  '..sssssvss..',
  '...ssssss...',
  '..aaaaaaaa..',
  '.aaaaaaaaaa.',
  '.aaahhaaaaa.',
  '.aaaaaaaaaa.',
  '..dddddddd..',
  '..ss....ss..',
  '..ss....ss..',
  '.oooo..oooo.',
];
// ASCII knight at scene size: 4 x 6 cells, about as big as the other styles' knight.
const ASCII_KNIGHT = { rest:['  ^^   ', ' [##]  ', ' [@@] |', 'o%%%% |', 'o%%%%+ ', ' #  #  '], swing:['  ^^   ', ' [##]  ', ' [@@]  ', 'o%%%%+---', 'o%%%%  ', ' #  #  '] };
const ASCII_COLOR = { '^':PX.wine };
const SHIELD = [[-2,6,'b'],[-1,6,'b'],[-3,7,'b'],[-2,7,'a'],[-1,7,'b'],[-3,8,'b'],[-2,8,'a'],[-1,8,'b'],[-2,9,'b'],[-1,9,'b']];
const SWORD_REST = [[12,2,'m'],[12,3,'m'],[12,4,'m'],[12,5,'m'],[11,6,'g'],[12,6,'g'],[13,6,'g'],[12,7,'g']];
const SWORD_SWING = [[11,6,'g'],[12,5,'g'],[12,6,'g'],[12,7,'g'],[13,6,'m'],[14,6,'m'],[15,6,'m'],[16,6,'m'],[17,6,'m']];

const GLYPH = { '0':'777','1':'262','2':'636','3':'717','4':'571','5':'474','6':'477','7':'711','8':'757','9':'771',' ':'000','-':'070','+':'272','*':'525','.':'001','o':'075','#':'575','%':'424','@':'777','/':'124','\\':'421','_':'007','^':'250','(':'242',')':'212','<':'141','>':'414','=':'707','|':'222','!':'202','[':'646',']':'313','"':'500' };
// 3 x 3 rows expanded to 3 x 5 by holding the middle row: small, legible, and one unit like everything else.
// Damage numbers are Silkscreen's digits, pixel for pixel. The symbols above are ASCII art, not type.
const DIGIT = { '0':['.##.','#..#','#..#','#..#','.##.'], '1':['##.','.#.','.#.','.#.','###'], '2':['###.','...#','.##.','#...','####'], '3':['###.','...#','.##.','...#','###.'], '4':['#.#.','#.#.','####','..#.','..#.'],
  '5':['####','#...','###.','...#','###.'], '6':['.##.','#...','###.','#..#','.##.'], '7':['####','...#','..#.','.#..','.#..'], '8':['.##.','#..#','.##.','#..#','.##.'], '9':['.##.','#..#','.###','...#','.##.'] };
function text(g, str, x, y, color){ g.fillStyle = color; let px = x; [...String(str)].forEach(ch => {
  if (DIGIT[ch]){ DIGIT[ch].forEach((r, ry) => [...r].forEach((c, b) => { if (c === '#') g.fillRect(px + b, y + ry, 1, 1); })); px += DIGIT[ch][0].length + 1; return; }
  const rows = GLYPH[ch] || GLYPH[' ']; px += 4;
  [rows[0], rows[1], rows[1], rows[2], rows[2]].forEach((r, ry) => { const v = +r; for (let b = 0; b < 3; b++) if (v & (4 >> b)) g.fillRect(px - 4 + b, y + ry, 1, 1); }); }); }

function rect(g, x, y, w, h, c){ g.fillStyle = c; g.fillRect(x, y, w, h); }
function line(g, x0, y0, x1, y1, c){ g.fillStyle = c; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (;;){ g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy){ e += dy; x0 += sx; } if (e2 <= dx){ e += dx; y0 += sy; } } }
function disk(g, cx, cy, r, c){ g.fillStyle = c; for (let y = -r; y <= r; y++){ const hw = Math.floor(Math.sqrt(r * r - y * y)); g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1); } }
function ring(g, cx, cy, r, c){ g.fillStyle = c; for (let a = 0; a < 64; a++){ const t = a / 64 * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1); } }

// Scale2x: doubles a sprite and rounds its corners with no new colours, so bosses and the Blob knight stay on the same pixel unit.
function scale2x(list){
  const at = new Map(list.map(p => [p.x + ',' + p.y, p.c])), get = (x, y) => at.get(x + ',' + y), out = [];
  for (const { x, y, c } of list){ const A = get(x, y - 1), B = get(x + 1, y), C = get(x - 1, y), D = get(x, y + 1);
    const e = [C === A && C !== D && A !== B ? A : c, A === B && A !== C && B !== D ? B : c, D === C && D !== B && C !== A ? C : c, B === D && B !== A && D !== C ? D : c];
    [[0,0],[1,0],[0,1],[1,1]].forEach(([ox, oy], i) => { if (e[i]) out.push({ x:x * 2 + ox, y:y * 2 + oy, c:e[i] }); }); }
  return out;
}
const spriteCells = (rows, pal, flip) => { const w = Math.max(...rows.map(r => r.length)), out = []; rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) out.push({ x:flip ? w - 1 - x : x, y, c:pal[ch] }); })); return out; };
const heroCells = (area, attacking) => { const pal = { p:PX.banner, s:PX.steel, h:PX.shine, v:PX.ink, a:area.armor, d:PX.belt, o:PX.ink, b:PX.paper, m:PX.shine, g:PX.hilt };
  const place = l => l.map(([x, y, k]) => ({ x, y, k, c:pal[k] }));
  return [...KNIGHT.flatMap((r, y) => [...r].flatMap((k, x) => k === '.' ? [] : [{ x, y:y - 3, k, c:pal[k] }])), ...place(SHIELD), ...place(attacking ? SWORD_SWING : SWORD_REST)]; };
const edgeOf = list => { const at = new Set(list.map(p => p.x + ',' + p.y)); return list.filter(({ x, y }) => !(at.has(x + 1 + ',' + y) && at.has(x - 1 + ',' + y) && at.has(x + ',' + (y + 1)) && at.has(x + ',' + (y - 1)))); };
const ringOf = list => { const at = new Set(list.map(p => p.x + ',' + p.y)), out = new Map(); list.forEach(({ x, y }) => [[1,0],[-1,0],[0,1],[0,-1]].forEach(([a, b]) => { const k = (x + a) + ',' + (y + b); if (!at.has(k)) out.set(k, { x:x + a, y:y + b }); })); return [...out.values()]; };
const blit = (g, list, ox, oy) => list.forEach(p => { g.fillStyle = p.c; g.fillRect(ox + p.x, oy + p.y, 1, 1); });
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');

/* ===== One background per style, as in v3.6: a style change must change the whole scene ===== */
const paperOf = a => mix(a.sky[2], PX.parchment, .72);
// A glyph on a paper cell, so a sprite stays readable over the background's text.
const cell = (g, a, ch, x, y, c) => { rect(g, x - 1, y - 1, 5, 7, paperOf(a)); text(g, ch, x, y, c); };
const BG = {
  '8-bit'(g, a, f){ const hz = 31; rect(g, 0, 0, W, 11, a.sky[0]); rect(g, 0, 11, W, 10, a.sky[1]); rect(g, 0, 21, W, hz - 21, a.sky[2]);
    const drift = Math.floor(f / 30) % (W + 24), cloud = mix(a.sky[2], PX.white, .58);
    [4, 44, 84].forEach(b => { const x = (b + drift) % (W + 24) - 12, y = 7 + (b % 2) * 4; rect(g, x, y + 2, 10, 2, cloud); rect(g, x + 2, y, 6, 2, cloud); });
    for (let x = -5; x < W; x += 20){ rect(g, x, hz - 4, 20, 8, a.far); rect(g, x + 4, hz - 8, 12, 4, a.far); rect(g, x + 7, hz - 11, 6, 3, a.far); }
    rect(g, 0, hz + 2, W, H, a.ground); for (let x = 0; x < W; x += 8) rect(g, x, hz + 2, 8, 1, x % 16 ? mix(a.ground, a.grass, .25) : a.grass);
    for (let r = 0; r < 7; r++) rect(g, 48 - 3 - r * 2, hz + 3 + r * 3, 6 + r * 4, 3, a.path);
    [5, 90].forEach(x => { rect(g, x - 1, 28, 2, 8, a.trunk); rect(g, x - 4, 23, 8, 5, a.tree); rect(g, x - 3, 20, 6, 3, a.tree); }); },
  Vector(g, a){ const night = mix(a.hill, PX.black, .72), line1 = a.sky[1], line2 = a.path; rect(g, 0, 0, W, H, night);
    [[0,31,16,17],[16,17,30,27],[30,27,48,12],[48,12,66,25],[66,25,80,15],[80,15,95,30]].forEach(l => line(g, ...l, line1));
    [[0,34,14,26],[14,26,34,33],[34,33,58,24],[58,24,76,32],[76,32,95,27]].forEach(l => line(g, ...l, a.far));
    line(g, 0, 34, 95, 34, line2); [36, 39, 44, 52].forEach(y => line(g, 0, y, 95, y, mix(line2, night, .45)));
    for (let x = -60; x <= 156; x += 24) line(g, 48 + Math.round((x - 48) * .28), 34, Math.max(0, Math.min(95, x)), x < 0 || x > 95 ? 44 : 53, mix(line2, night, .45)); },
  Block(g, a){ const sky = mix(a.sky[2], PX.white, .45), T = 6; rect(g, 0, 0, W, H, sky);
    for (let i = 0; i * T < W; i++){ const h = (i % 5) * 2 + 6; rect(g, i * T, 34 - h, T - 1, h + 3, a.far); rect(g, i * T, 34 - h, T - 1, 1, mix(a.far, PX.white, .25)); }
    rect(g, 0, 36, W, H, a.ground); for (let y = 36; y < H; y += T) for (let x = 0; x < W; x += T) if ((x + y) / T % 2 >= 1) rect(g, x, y, T, T, mix(a.ground, a.grass, .22));
    [6, 84].forEach(x => { rect(g, x, 25, 3, 12, a.trunk); rect(g, x - 4, 17, 11, 9, a.tree); rect(g, x - 4, 17, 11, 1, mix(a.tree, PX.white, .25)); }); },
  Blob(g, a, f){ const sky = mix(a.sky[2], PX.cream, .55); rect(g, 0, 0, W, H, sky); const drift = Math.floor(f / 45) % (W + 24), c = mix(sky, PX.white, .6);
    [8, 54].forEach(b => { const x = (b + drift) % (W + 24) - 12; disk(g, x, 10, 3, c); disk(g, x + 5, 8, 4, c); disk(g, x + 10, 10, 3, c); });
    disk(g, 16, 54, 34, a.far); disk(g, 80, 56, 32, a.hill); rect(g, 0, 37, W, H, a.ground); disk(g, 48, 62, 18, a.path);
    [6, 89].forEach(x => { rect(g, x - 1, 28, 2, 9, a.trunk); disk(g, x, 23, 6, a.tree); }); },
  ASCII(g, a){ const paper = paperOf(a), ink = mix(a.far, PX.asciiInk, .5), faint = mix(paper, ink, .14); rect(g, 0, 0, W * 2, H * 2, paper);
    for (let y = 2; y < 104; y += 12) text(g, '. . . . . . . . . . . . . . . . . . . . . . . .', 2, y, faint);
    const hz = 58; text(g, '   /\\      /\\_/\\         /\\      /\\_      /\\', 0, hz - 22, mix(ink, a.far, .35)); text(g, '  ^^^    ^^      ^^^^     ^^      ^^^    ^^', 0, hz - 11, mix(ink, a.tree, .35));
    text(g, '__/  \\____/     \\_____/  \\____/  \\______/  \\___', 0, hz, ink); for (let x = 8; x < 190; x += 22) text(g, '*', x, hz + 14 + (x % 2 ? 0 : 8), mix(ink, a.grass, .4)); },
};

/* ===== Characters: the same cells, re-rendered per style ===== */
function drawHero(g, style, area, x, y, attacking, dark){
  const all = heroCells(area, attacking);
  if (style === 'ASCII'){ (attacking ? ASCII_KNIGHT.swing : ASCII_KNIGHT.rest).forEach((row, r) => [...row].forEach((ch, i) => { if (ch !== ' ') cell(g, area, ch, x * 2 + i * 4, y * 2 - 12 + r * 6, ASCII_COLOR[ch] || PX.ink); })); return; }
  if (style === 'Vector'){ blit(g, edgeOf(all).map(p => ({ ...p, c:p.k === 'v' || p.k === 'o' || p.k === 'd' ? PX.paper : p.c })), x, y); return; }
  if (style === 'Block'){ const big = all.flatMap(p => [[0,0,mix(p.c,PX.white,.22)],[1,0,p.c],[0,1,p.c],[1,1,mix(p.c,PX.black,.22)]].map(([a, b, c]) => ({ x:p.x * 2 + a, y:p.y * 2 + b, c })));
    blit(g, big, x - 6, y - 10); return; }
  if (style === 'Blob'){ const big = scale2x(all); blit(g, ringOf(big).map(p => ({ ...p, c:PX.ink })), x - 6, y - 10); blit(g, big, x - 6, y - 10); return; }
  if (dark) blit(g, ringOf(all).map(p => ({ ...p, c:PX.paper })), x, y);
  blit(g, all, x, y);
}
function drawBoss(g, style, area, kind, x, y){
  const [A, B, D, E] = area.enemy, raw = spriteCells(BOSSES[kind], { A, B, D, E }, true);
  if (style === 'ASCII'){ const m = { [A]:'@', [B]:'#', [D]:'%', [E]:'o' }; raw.forEach(p => cell(g, area, m[p.c], x * 2 + p.x * 4, GROUND * 2 - 42 + p.y * 6, A)); return; }
  if (style === 'Vector'){ const big = scale2x(raw); blit(g, edgeOf(big).map(p => ({ ...p, c:area.enemy[3] })), x, y); return; }
  if (style === 'Block'){ blit(g, raw.flatMap(p => [[0,0,mix(p.c,PX.white,.22)],[1,0,p.c],[0,1,p.c],[1,1,mix(p.c,PX.black,.22)]].map(([a, b, c]) => ({ x:p.x * 2 + a, y:p.y * 2 + b, c }))), x, y); return; }
  if (style === 'Blob'){ const big = scale2x(raw); blit(g, ringOf(big).map(p => ({ ...p, c:A })), x, y); blit(g, big, x, y); return; }
  blit(g, scale2x(raw), x, y);
}
const FLAG = ['##......', '#t####..', '#ttttt#.', '#t####..']; // icons/svg/flag.svg; the pole runs down to the ground
const flag = (g, style, x, y, c) => { const s = style === 'ASCII' ? 2 : 1; rect(g, x * s, y * s, s, 14 * s, c); rect(g, x * s, (y + 13) * s, 2 * s, s, c);
  FLAG.forEach((r, ry) => [...r].forEach((p, rx) => { if (p !== '.') rect(g, (x + rx) * s, (y + ry) * s, s, s, p === 't' ? PX.banner : c); })); };

/* ===== Effects: every style has its own hit and hurt language ===== */
function attackFx(g, style, cx, cy, step, power){
  const r = 2 + step, label = '-' + power;
  if (style === 'ASCII'){ text(g, '>>>>', cx * 2 - 34, cy * 2, PX.slate); text(g, '*' + label + '*', cx * 2 - 12, cy * 2 - 16, PX.wine); return; }
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  dirs.forEach(([a, b], i) => { const x = cx + a * r, y = cy + b * r;
    if (style === '8-bit') rect(g, x, y, i % 2 ? 1 : 2, i % 2 ? 1 : 2, [PX.sparkPale,PX.sparkRed,PX.sparkGold][i % 3]);
    else if (style === 'Block') rect(g, x, y, 2, 2, i % 2 ? PX.blockGold : PX.blockRed);
    else if (style === 'Blob') disk(g, x, y, i % 3 === 0 ? 2 : 1, i % 2 ? PX.blobGold : PX.blobRed);
    else line(g, cx + a * 2, cy + b * 2, x, y, i % 2 ? PX.sparkPale : PX.sparkRed); });
  if (style === '8-bit') rect(g, cx - 1, cy - 1, 3, 3, PX.white);
  if (style === '8-bit') [[1,0],[-1,0],[0,1],[0,-1]].forEach(([a, b]) => text(g, label, cx - 4 + a, cy - 13 + b, PX.ink)); // white alone vanishes on a pale sky
  text(g, label, cx - 4, cy - 13, style === 'Block' ? PX.slate : style === 'Blob' ? PX.blobText : PX.white);
}
function hurtFx(g, style, cx, cy, power){
  const label = '-' + power;
  if (style === 'ASCII'){ text(g, label, cx * 2 - 6, cy * 2 - 34, PX.wine); return; }
  if (style === 'Block'){ [0, 1].forEach(i => { rect(g, cx - 13 + i, cy - 15, 1, 28, PX.hurtBlock); rect(g, cx + 13 - i, cy - 15, 1, 28, PX.hurtBlock); }); }
  else if (style === '8-bit'){ [[-10,-11,21,1],[-10,10,21,1],[-10,-11,1,21],[10,-11,1,22]].forEach(([a, b, w, h]) => rect(g, cx + a, cy + b, w, h, PX.hurtBit)); }
  else ring(g, cx, cy, 13, style === 'Blob' ? PX.hurtBlob : PX.hurtLine);
  text(g, label, cx - 4, cy - 19, style === 'Vector' ? PX.hurtLine : PX.hurtText);
}

export function createScene(canvas){
  const g = canvas.getContext('2d', { alpha:false });
  let state = null, tick = 0, queue = [], event = null, eventAt = 0, raf = 0, last = 0, running = false, drawn = -1;

  function size(){ const scale = state?.style === 'ASCII' ? 2 : 1, w = W * scale, h = H * scale; if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; canvas.dispatchEvent(new Event('refit')); } }

  function draw(){
    if (!state) return; size(); g.setTransform(1, 0, 0, 1, 0, 0);
    const { style, kind, defeated } = state, area = { ...state.area, ...AREAS[state.area.art] }, dark = area.dark, t = event ? tick - eventAt : 0, k = event?.kind, D = DURATION[k] || 1;
    BG[style](g, area, tick);
    const bob = Math.floor(tick / 15) % 2;
    let hx = HERO_X, bx = BOSS_X, attacking = false, hideBoss = defeated, hit = false;
    if (k === 'attack' || k === 'boss_clear'){ const u = Math.min(1, t / D); attacking = true;
      const lunge = u < .5 ? Math.floor(u * 2 * 8) * 4 : Math.floor((1 - u) * 2 * 8) * 4; hx += Math.min(lunge, 28); hit = u > .42 && u < .8; if (hit) bx += tick % 4 < 2 ? 2 : -2; }
    if (k === 'boss_clear') hideBoss = t > D * .75 || (t > D * .5 && tick % 4 < 2); // blinks away: no fades on pixel art
    if (k === 'hurt') hx += tick % 4 < 2 ? 1 : -1;
    if (hideBoss) flag(g, style, BOSS_X + 8, GROUND - 14, area.trunk); else drawBoss(g, style, area, event?.kindOf || kind, bx, GROUND - 13 - bob);
    drawHero(g, style, area, hx, GROUND - 12 - (k ? 0 : bob), attacking, dark);
    if (k === 'attack' || k === 'boss_clear'){ const u = t / D; if (u > .42 && u < .85) attackFx(g, style, BOSS_X + 6, GROUND - 8, Math.floor((u - .42) * 40) % 12, event.power); }
    if (k === 'hurt' && t > D * .25) hurtFx(g, style, HERO_X + 5, GROUND - 6, event.power);
    if (k === 'heal' || k === 'revive') for (let i = 0; i < 5; i++){ const y = GROUND - 14 - Math.floor(t / 3) % 10 - i, x = HERO_X - 3 + i * 4;
      if (style === 'ASCII') text(g, '+', x * 2, y * 2, PX.healAscii); else { rect(g, x, y - 1, 1, 3, PX.heal); rect(g, x - 1, y, 3, 1, PX.heal); } }
  }

  function step(now){
    raf = 0; if (!running) return;
    if (calm()){ running = false; draw(); return; }
    if (now - last >= TICK){ last = now; tick++;
      if (event && tick - eventAt > DURATION[event.kind]){ event = null; state?.onEventEnd?.(); }
      if (!event && queue.length){ event = queue.shift(); eventAt = tick; }
      const visual = event ? tick : Math.floor(tick / 5); // idle art only changes a few times a second, so skip redundant repaints
      if (visual !== drawn){ drawn = visual; draw(); } }
    raf = requestAnimationFrame(step);
  }

  return {
    setState(s){ state = s; draw(); },
    play(e){ queue.push(e); queue = queue.slice(-4); if (!running && !calm()) this.start(); },
    start(){ draw(); if (running || calm()) return; running = true; raf = requestAnimationFrame(step); },
    shown:() => canvas.getClientRects().length > 0,
    stop(){ running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

// The canvas is scaled by a whole number of its real width, so ASCII's 192 canvas keeps one unit too. The floor keeps 96 x 54 clear of a 44 px target.
export function fitCanvas(canvas, wrap, min = 2){
  const fit = () => { const cs = getComputedStyle(wrap), room = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2; // 2: the frame's border
    const k = Math.max(canvas.width === W ? min : 1, Math.floor(room / canvas.width)); canvas.style.width = canvas.width * k + 'px'; canvas.style.height = canvas.height * k + 'px'; };
  const ro = new ResizeObserver(fit); ro.observe(wrap); canvas.addEventListener('refit', fit); fit();
  return () => { ro.disconnect(); canvas.removeEventListener('refit', fit); };
}
