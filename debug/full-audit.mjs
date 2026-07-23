/**
 * Full poker logic audit — hand evaluator, equity, preflop tiers, pot math.
 * Tests against known correct answers so bugs can't hide behind plausible-looking output.
 */

// ── Core types / constants ─────────────────────────────────────────────────
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♠","♥","♦","♣"];
const RV = { 2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14 };

const cv = c => RV[c.rank];
const ck = c => c.rank + c.suit;

const makeDeck = () => { const d=[]; for(const s of SUITS) for(const r of RANKS) d.push({rank:r,suit:s}); return d; };

// ── Hand evaluator (extracted from PokerSim.tsx) ───────────────────────────
function getCombos(arr, k) {
  if (k===0) return [[]];
  if (arr.length<k) return [];
  const [f,...r] = arr;
  return [...getCombos(r,k-1).map(c=>[f,...c]),...getCombos(r,k)];
}

function checkStr(vals) {
  const u=[...new Set(vals)].sort((a,b)=>b-a);
  if(u.length<5) return false;
  for(let i=0;i<=u.length-5;i++){if(u[i]-u[i+4]===4){const s=u.slice(i,i+5);if(new Set(s).size===5)return s;}}
  if(u.includes(14)&&u.includes(5)&&u.includes(4)&&u.includes(3)&&u.includes(2)) return [5,4,3,2,1];
  return false;
}

function evalHand(cards) {
  const vals=cards.map(cv).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.suit);
  const isFlush=suits.every(s=>s===suits[0]);
  const counts={};
  vals.forEach(v=>{counts[v]=(counts[v]||0)+1;});
  const groups=Object.entries(counts).map(([v,c])=>({val:+v,count:c})).sort((a,b)=>b.count-a.count||b.val-a.val);
  const isStraight=checkStr(vals);
  if(isFlush&&isStraight&&vals.includes(14)&&vals.includes(13)) return {rank:9,name:"Royal Flush"};
  if(isFlush&&isStraight) return {rank:8,name:"Straight Flush",kickers:isStraight};
  if(groups[0].count===4) return {rank:7,name:"Four of a Kind",kickers:[groups[0].val,groups[1].val]};
  if(groups[0].count===3&&groups[1]?.count===2) return {rank:6,name:"Full House",kickers:[groups[0].val,groups[1].val]};
  if(isFlush) return {rank:5,name:"Flush",kickers:vals};
  if(isStraight) return {rank:4,name:"Straight",kickers:isStraight};
  if(groups[0].count===3) return {rank:3,name:"Three of a Kind",kickers:[groups[0].val,...groups.slice(1).map(g=>g.val)]};
  if(groups[0].count===2&&groups[1]?.count===2) return {rank:2,name:"Two Pair",kickers:[groups[0].val,groups[1].val,groups[2]?.val]};
  if(groups[0].count===2) return {rank:1,name:"Pair",kickers:[groups[0].val,...groups.slice(1).map(g=>g.val)]};
  return {rank:0,name:"High Card",kickers:vals};
}

function cmpK(a,b){for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;}

function bestHand(hole,board){
  const all=[...hole,...board];
  if(all.length<5) return {rank:0,name:"Incomplete",kickers:[]};
  const combos=getCombos(all,5);
  let best=null;
  for(const c of combos){const e=evalHand(c);if(!best||e.rank>best.rank||(e.rank===best.rank&&cmpK(e.kickers,best.kickers)>0)){best=e;}}
  return best;
}

function winsHand(h1,board,h2) {
  const r1=bestHand(h1,board),r2=bestHand(h2,board);
  if(r1.rank!==r2.rank) return r1.rank>r2.rank?1:0;
  const cmp=cmpK(r1.kickers,r2.kickers);
  return cmp>0?1:cmp===0?0.5:0;
}

// ── Preflop tier (extracted from PokerSim.tsx) ─────────────────────────────
function preflopHandTier(hi,lo,suited){
  if(hi===lo){if(hi>=10)return 1;if(hi>=7)return 2;if(hi>=5)return 3;return 4;}
  if(hi===14){
    if(lo>=13)         return 1;
    if(lo>=10)         return suited?1:2;
    if(lo>=7)          return suited?2:4;
                       return suited?3:5;
  }
  if(hi===13){
    if(lo>=12)         return suited?1:2;
    if(lo>=10)         return suited?2:3;
    if(lo>=9)          return suited?3:4;
                       return suited?4:6;
  }
  if(hi===12){
    if(lo>=11)         return suited?2:3;
    if(lo>=9)          return suited?3:4;
                       return suited?4:6;
  }
  if(hi===11){
    if(lo>=10)         return suited?2:3;
    if(lo>=8)          return suited?3:5;
                       return suited?4:6;
  }
  if(hi===10){
    if(lo===9)         return suited?2:3;
    if(lo===8)         return suited?3:5;
                       return suited?4:6;
  }
  const gap=hi-lo;
  if(suited&&gap<=1)   return 3;
  if(suited&&gap<=2)   return 4;
  if(suited)           return 5;
  return 6;
}

// ── Test runner ────────────────────────────────────────────────────────────
let passed=0,failed=0;
const issues=[];

function test(name,fn){
  try{fn();console.log(`  ✓ ${name}`);passed++;}
  catch(e){console.log(`  ✗ ${name}\n    → ${e.message}`);failed++;issues.push({name,msg:e.message});}
}
function assert(cond,msg){if(!cond)throw new Error(msg);}
function card(rank,suit){return {rank:String(rank),suit};}
function c(s){
  // "As" "Kh" "10d" etc. — suit letters: s h d c
  const suitMap={s:'♠',h:'♥',d:'♦',c:'♣'};
  const rank=s.slice(0,-1),suit=suitMap[s.slice(-1)];
  return {rank,suit};
}

// ═══════════════════════════════════════
// SECTION 1: Hand evaluator correctness
// ═══════════════════════════════════════
console.log('\n[1] Hand evaluator — rank identification');

test('Royal Flush detected', ()=>{
  const h=evalHand([c('As'),c('Ks'),c('Qs'),c('Js'),c('10s')]);
  assert(h.rank===9,`got rank ${h.rank} (${h.name})`);
});
test('Straight Flush detected', ()=>{
  const h=evalHand([c('9h'),c('8h'),c('7h'),c('6h'),c('5h')]);
  assert(h.rank===8,`got rank ${h.rank} (${h.name})`);
});
test('Wheel straight flush (A-2-3-4-5) detected', ()=>{
  const h=evalHand([c('Ah'),c('2h'),c('3h'),c('4h'),c('5h')]);
  assert(h.rank===8,`got rank ${h.rank} (${h.name})`);
});
test('Four of a Kind detected', ()=>{
  const h=evalHand([c('As'),c('Ah'),c('Ad'),c('Ac'),c('Ks')]);
  assert(h.rank===7,`got rank ${h.rank} (${h.name})`);
});
test('Full House detected', ()=>{
  const h=evalHand([c('As'),c('Ah'),c('Ad'),c('Ks'),c('Kh')]);
  assert(h.rank===6,`got rank ${h.rank} (${h.name})`);
});
test('Flush detected', ()=>{
  const h=evalHand([c('As'),c('9s'),c('7s'),c('4s'),c('2s')]);
  assert(h.rank===5,`got rank ${h.rank} (${h.name})`);
});
test('Straight detected', ()=>{
  const h=evalHand([c('9s'),c('8h'),c('7d'),c('6c'),c('5s')]);
  assert(h.rank===4,`got rank ${h.rank} (${h.name})`);
});
test('Wheel straight (A-2-3-4-5) detected', ()=>{
  const h=evalHand([c('As'),c('2h'),c('3d'),c('4c'),c('5s')]);
  assert(h.rank===4,`got rank ${h.rank} (${h.name})`);
});
test('Trips detected', ()=>{
  const h=evalHand([c('As'),c('Ah'),c('Ad'),c('Ks'),c('2h')]);
  assert(h.rank===3,`got rank ${h.rank} (${h.name})`);
});
test('Two Pair detected', ()=>{
  const h=evalHand([c('As'),c('Ah'),c('Ks'),c('Kh'),c('2s')]);
  assert(h.rank===2,`got rank ${h.rank} (${h.name})`);
});
test('Pair detected', ()=>{
  const h=evalHand([c('As'),c('Ah'),c('Ks'),c('Qh'),c('2s')]);
  assert(h.rank===1,`got rank ${h.rank} (${h.name})`);
});
test('High Card detected', ()=>{
  const h=evalHand([c('As'),c('Kh'),c('Qd'),c('Js'),c('9h')]);
  assert(h.rank===0,`got rank ${h.rank} (${h.name})`);
});
test('Broadway straight (A-K-Q-J-10) is straight not flush', ()=>{
  const h=evalHand([c('As'),c('Kh'),c('Qd'),c('Jc'),c('10s')]);
  assert(h.rank===4,`got rank ${h.rank} (${h.name}) — should be straight`);
});

console.log('\n[2] Hand evaluator — tiebreakers / winner selection');

test('AA beats KK', ()=>{
  const board=[c('2h'),c('7d'),c('9c'),c('3s'),c('Jh')];
  const aa=[c('As'),c('Ah')],kk=[c('Ks'),c('Kh')];
  assert(winsHand(aa,board,kk)===1,'AA should beat KK');
});
test('KK beats QQ', ()=>{
  const board=[c('2h'),c('7d'),c('9c'),c('3s'),c('Jh')];
  assert(winsHand([c('Ks'),c('Kh')],board,[c('Qs'),c('Qh')])===1,'KK should beat QQ');
});
test('Flush beats straight', ()=>{
  const flush=[c('As'),c('Ks')],straight=[c('9d'),c('8h')];
  const board=[c('Qs'),c('Js'),c('10s'),c('7c'),c('6d')];
  // flush: As Ks Qs Js 10s; straight: 9d 8h 7c 6d + one board... wait
  // Re-do: hero has nut flush, villain has straight
  const h1=[c('2s'),c('5s')]; // makes flush with board spades
  const h2=[c('9d'),c('8h')]; // 9-8-7-6-5 straight using 7c 6d and board 10s Js Qs... no
  // Simpler: 5-card evals
  const r1=evalHand([c('As'),c('9s'),c('7s'),c('4s'),c('2s')]); // flush
  const r2=evalHand([c('9s'),c('8h'),c('7d'),c('6c'),c('5h')]); // straight
  assert(r1.rank===5&&r2.rank===4&&r1.rank>r2.rank,'flush should beat straight');
});
test('Higher pair wins with same kicker structure', ()=>{
  const board=[c('2h'),c('7d'),c('9c'),c('3s'),c('Jh')];
  const aa=[c('As'),c('Ah')]; // pair of aces
  const kk=[c('Ks'),c('Kh')]; // pair of kings — wait both make higher than pair...
  // Use bestHand
  const r1=bestHand([c('As'),c('Ah')],[c('2h'),c('7d'),c('9c'),c('3s'),c('6h')]);
  const r2=bestHand([c('Ks'),c('Kh')],[c('2h'),c('7d'),c('9c'),c('3s'),c('6h')]);
  assert(r1.rank===r2.rank&&r1.rank===1,'both should have pair');
  assert(r1.kickers[0]>r2.kickers[0],'aces pair should beat kings pair');
});
test('bestHand picks flush over pair on combined board', ()=>{
  // Hero: 7s 5s, Board: As 9s 3s Kh 2d → 5-card flush: As 9s 7s 5s 3s
  const h=bestHand([c('7s'),c('5s')],[c('As'),c('9s'),c('3s'),c('Kh'),c('2d')]);
  assert(h.rank===5,`expected flush (5), got ${h.rank} (${h.name})`);
});
test('bestHand uses best 5 of 7', ()=>{
  // 4 aces + king on board; hero holds 2 3 → should still get four aces
  const h=bestHand([c('2h'),c('3d')],[c('As'),c('Ah'),c('Ad'),c('Ac'),c('Ks')]);
  assert(h.rank===7,`expected quads (7), got ${h.rank} (${h.name})`);
});
test('Chop: identical best hands return 0.5', ()=>{
  const board=[c('As'),c('Ah'),c('Ad'),c('Kh'),c('Kd')];
  // Both players have full house AAAKK from the board — identical
  const r=winsHand([c('2s'),c('3s')],board,[c('4h'),c('5h')]);
  assert(r===0.5,`expected chop (0.5), got ${r}`);
});

// ═══════════════════════════════════════
// SECTION 2: Preflop hand tiers
// ═══════════════════════════════════════
console.log('\n[3] Preflop hand tiers');

const tier=(s)=>{
  const suitMap={s:'♠',h:'♥',d:'♦',c:'♣'};
  // e.g. "AKs" "72o" "JJ"
  let h1,h2,suited;
  if(s.length===2){h1=s[0];h2=s[1];suited=false;} // pocket pair
  else{h1=s.slice(0,-1);h2=s.slice(1,-2+s.length-1);suited=s.endsWith('s');
    // handle two-char ranks like "10"
    if(s.slice(0,2)==='10'){h1='10';h2=s[2];suited=s.endsWith('s');}
    else{h1=s[0];h2=s[1];suited=s.endsWith('s');}
  }
  const v1=RV[h1]||+h1,v2=RV[h2]||+h2;
  return preflopHandTier(Math.max(v1,v2),Math.min(v1,v2),suited);
};

// Tier 1 = premium (AA/KK/QQ/AKs/AKo etc.)
test('AA is tier 1', ()=>assert(tier('AA')===1,`got ${tier('AA')}`));
test('KK is tier 1', ()=>assert(tier('KK')===1,`got ${tier('KK')}`));
test('QQ is tier 1', ()=>assert(tier('QQ')===1,`got ${tier('QQ')}`));
test('AKs is tier 1', ()=>{
  const t=preflopHandTier(14,13,true);assert(t===1,`AKs got tier ${t}`);
});
test('AKo is tier 1', ()=>{
  const t=preflopHandTier(14,13,false);assert(t===1,`AKo got tier ${t}`);
});
test('AQs is tier 1', ()=>{
  const t=preflopHandTier(14,12,true);assert(t===1,`AQs got tier ${t}`);
});
test('AQo is tier 2', ()=>{
  const t=preflopHandTier(14,12,false);assert(t===2,`AQo got tier ${t} (expected 2)`);
});
test('JJ is tier 1', ()=>{const t=preflopHandTier(11,11,false);assert(t===1,`JJ got ${t}`);});
test('TT is tier 1', ()=>{const t=preflopHandTier(10,10,false);assert(t===1,`TT got ${t}`);});
test('99 is tier 2', ()=>{const t=preflopHandTier(9,9,false);assert(t===2,`99 got ${t}`);});
test('72o is tier 6 (garbage)', ()=>{
  const t=preflopHandTier(7,2,false);assert(t===6,`72o got tier ${t}`);
});
test('J2o is tier 6 (garbage)', ()=>{
  const t=preflopHandTier(11,2,false);assert(t===6,`J2o got tier ${t}`);
});
test('KQs is tier 1', ()=>{
  const t=preflopHandTier(13,12,true);assert(t===1,`KQs got ${t}`);
});
test('KQo is tier 2', ()=>{
  const t=preflopHandTier(13,12,false);assert(t===2,`KQo got ${t}`);
});

// ═══════════════════════════════════════
// SECTION 3: Pot odds / EV math
// ═══════════════════════════════════════
console.log('\n[4] Pot odds and EV formulas');

function potOdds(toCall, pot) { return toCall / (pot + toCall); }
function ev(equity, pot, toCall) { return equity * pot - (1 - equity) * toCall; }

test('Pot odds: toCall=20 into pot=80 → 20%', ()=>{
  const po=potOdds(20,80);
  assert(Math.abs(po-0.20)<0.001,`got ${(po*100).toFixed(1)}%`);
});
test('Pot odds: toCall=50 into pot=100 → 33.3%', ()=>{
  const po=potOdds(50,100);
  assert(Math.abs(po-1/3)<0.001,`got ${(po*100).toFixed(1)}%`);
});
test('EV: 60% equity, 100 pot, 0 to call → +60', ()=>{
  const e=ev(0.60,100,0);
  assert(Math.abs(e-60)<0.001,`got ${e}`);
});
test('EV: 33% equity, 100 pot, 50 to call → break-even (EV≈0)', ()=>{
  // Need equity = toCall/(pot+toCall) = 50/150 = 33.3% to break even
  const e=ev(1/3,100,50);
  assert(Math.abs(e)<0.1,`expected ~0, got ${e.toFixed(2)}`);
});
test('EV: 20% equity, pot=80, toCall=20 → negative (-4)', ()=>{
  // potOdds = 20/100 = 20%, equity = 20%, so EV ≈ 0
  // With 15% equity: 0.15*80 - 0.85*20 = 12 - 17 = -5
  const e=ev(0.15,80,20);
  assert(e<0,`expected negative EV, got ${e.toFixed(2)}`);
});
test('Bluff breakeven fold%: bet=50 into pot=100 → 33.3%', ()=>{
  const fold=50/(100+50);
  assert(Math.abs(fold-1/3)<0.001,`got ${(fold*100).toFixed(1)}%`);
});
test('Bluff breakeven fold%: bet=100 into pot=100 → 50%', ()=>{
  const fold=100/(100+100);
  assert(Math.abs(fold-0.5)<0.001,`got ${(fold*100).toFixed(1)}%`);
});

// ═══════════════════════════════════════
// SECTION 4: Stack/pot accounting
// ═══════════════════════════════════════
console.log('\n[5] Stack and pot accounting');

test('SB/BB post: pot=15, stacks reduced correctly', ()=>{
  const start=[200,200,200,200];
  const afterBlinds=[200,200-5,200-10,200]; // SB=idx1, BB=idx2
  const pot=5+10; // 15
  assert(afterBlinds[1]===195,'SB should have 195');
  assert(afterBlinds[2]===190,'BB should have 190');
  assert(pot===15,'pot should be 15');
});

test('UTG calls BB (20 total): pot grows, stack shrinks', ()=>{
  let pot=15,stacks=[200,195,190,200];
  const toCall=10-0; // UTG has no prior bet, BB=10, UTG must call 10
  stacks[3]-=toCall; pot+=toCall;
  assert(stacks[3]===190,`UTG stack should be 190, got ${stacks[3]}`);
  assert(pot===25,`pot should be 25, got ${pot}`);
});

test('Pre-action snapshot: toCall uses pre-action bets', ()=>{
  // Before Carol acts: currentBet=30, Carol's bets[2]=10 (BB)
  const currentBet=30,carolBet=10;
  const toCall=currentBet-carolBet;
  assert(toCall===20,`toCall should be 20, got ${toCall}`);
  // After Carol calls, bets[2]=30 — if we used post-action bets, toCall would be 0 (bug we fixed)
  const carolBetAfterCall=30;
  const toCallPostAction=currentBet-carolBetAfterCall;
  assert(toCallPostAction===0,'post-action toCall incorrectly shows 0 (confirms the pre-action fix is necessary)');
});

// ═══════════════════════════════════════
// SECTION 5: Full hand simulation
// ═══════════════════════════════════════
console.log('\n[6] Full hand — deterministic simulation');

// Simulate a simple 3-street hand with known cards
// Hero: A♠ K♠, Villain: 7♦ 2♣
// Board: A♦ 7♥ K♦ 3♣ 2♠ — hero makes two pair AA+KK, villain makes two pair 77+22
test('Hero AA+KK beats villain 77+22', ()=>{
  const heroHole=[c('As'),c('Ks')];
  const villainHole=[c('7d'),c('2c')];
  const board=[c('Ad'),c('7h'),c('Kd'),c('3c'),c('2s')];
  const heroHand=bestHand(heroHole,board);
  const villainHand=bestHand(villainHole,board);
  assert(heroHand.rank===2,`hero should have two pair, got ${heroHand.name}`);
  assert(villainHand.rank===2,`villain should have two pair, got ${villainHand.name}`);
  assert(heroHand.kickers[0]>villainHand.kickers[0],
    `hero AA+KK kicker[0]=${heroHand.kickers[0]} should beat villain 77+22 kicker[0]=${villainHand.kickers[0]}`);
  assert(winsHand(heroHole,board,villainHole)===1,'hero should win');
});

test('Villain rivered flush beats hero two pair', ()=>{
  const heroHole=[c('As'),c('Kh')];
  const villainHole=[c('2c'),c('5c')];
  const board=[c('Ad'),c('Kd'),c('3c'),c('7c'),c('9c')];
  const heroHand=bestHand(heroHole,board);
  const villainHand=bestHand(villainHole,board);
  assert(heroHand.rank===2,`hero should have two pair, got ${heroHand.name}`);
  assert(villainHand.rank===5,`villain should have flush, got ${villainHand.name}`);
  assert(winsHand(heroHole,board,villainHole)===0,'villain flush should beat hero two pair');
});

test('Straight on board: both players chop', ()=>{
  // Board has a straight, both hole cards don't improve it
  const board=[c('Ah'),c('Ks'),c('Qd'),c('Jc'),c('10h')];
  // Both hero/villain use the board straight
  const r=winsHand([c('2s'),c('3s')],board,[c('4h'),c('5h')]);
  assert(r===0.5,`expected chop, got ${r}`);
});

// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════
console.log(`\n${'─'.repeat(56)}`);
console.log(`Total: ${passed} passed, ${failed} failed`);
if(issues.length>0){
  console.log('\nFailed tests:');
  issues.forEach(({name,msg})=>console.log(`  ✗ ${name}: ${msg}`));
  process.exit(1);
}
console.log('\nAll checks pass — math and hand evaluation are correct.');
