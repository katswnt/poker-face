// Snapshot test: extract simulation logic to check stage.decision.action for hero stages
// This is a structural check — does the seeded RNG fix hold when heroChoices grows?
// We can't easily run the full React component, but we can verify the INDEX MATH.

// Simulate pfHeroActionCount tracking for common scenarios:
// Scenario A: Bob=BB, nobody raises (1 preflop hero action)
// Scenario B: Bob=UTG, someone raises preflop (2 preflop hero actions — the bug case)

function simulatePreflopHeroCount(heroPos, raises) {
  // preflopOrder = [UTG=0, BTN=1, SB=2, BB=3]
  // heroPos: 0=UTG, 1=BTN, 2=SB, 3=BB
  const order = [0, 1, 2, 3]; // UTG, BTN, SB, BB
  const needs = [true, true, true, true];
  let pfHeroActionCount = 0;
  let safety = 0;
  let idx = 0;

  while (needs.some(Boolean) && safety < 40) {
    safety++;
    const pi = order[idx % order.length]; idx++;
    if (!needs[pi]) continue;
    needs[pi] = false;
    const isHero = pi === heroPos;
    if (isHero) pfHeroActionCount++;

    // Simulate a raise at a specific point
    if (raises.includes(safety)) {
      order.forEach(j => { if (j !== pi) needs[j] = true; });
    }
  }
  return pfHeroActionCount;
}

const scenarios = [
  { label: 'Bob=BB, no raise',         heroPos: 3, raises: [] },
  { label: 'Bob=UTG, BTN raises',      heroPos: 0, raises: [2] },  // BTN raises on iteration 2
  { label: 'Bob=SB, UTG raises',       heroPos: 2, raises: [1] },  // UTG raises on iter 1
  { label: 'Bob=BTN, UTG raises',      heroPos: 1, raises: [1] },
];

console.log('pfHeroActionCount by scenario (= heroActionStartIdx on flop):');
scenarios.forEach(s => {
  const count = simulatePreflopHeroCount(s.heroPos, s.raises);
  console.log(`  ${s.label}: pfHeroActionCount=${count}`);
});

console.log('\nFor heroChoices=[callDec, checkDec] (2 elements):');
console.log('  heroChoices[0] = callDec (preflop), heroChoices[1] = checkDec (intended for flop)');
console.log('  If pfHeroActionCount=2, flop uses heroChoices[2]=undefined → AI decision (BUG)');
console.log('  If pfHeroActionCount=1, flop uses heroChoices[1]=checkDec → correct (FIX)');
