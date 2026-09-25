//! Spot contract v1 (see src/lib/solver/bridge/contract.ts, the source of truth).
//! The TypeScript side performs the full validation; this module re-checks everything the
//! engine relies on, because the bridge never trusts its input file.

use postflop_solver::{card_from_str, Card};
use serde::Deserialize;

pub const SPOT_FORMAT: &str = "poker-face-bridge-spot";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Spot {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub board: Board,
    pub ranges: [RangeSpec; 2],
    pub starting_pot: i64,
    pub effective_stack: i64,
    pub rake: f64,
    pub tree: TreeSpec,
    pub solve: SolveOptions,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Board {
    pub flop: [String; 3],
    pub turn: Option<String>,
    pub river: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeSpec {
    pub source: String,
    pub combos: Vec<RangeEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeEntry {
    pub combo: String,
    pub weight: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode")]
pub enum TreeSpec {
    #[serde(rename = "menu")]
    Menu(Box<MenuTree>),
    #[serde(rename = "explicit")]
    Explicit { root: ExplicitNode },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuTree {
    pub flop: Option<StreetMenu>,
    pub turn: Option<StreetMenu>,
    pub river: Option<StreetMenu>,
    pub turn_donk: Option<Vec<BetSizeSpec>>,
    pub river_donk: Option<Vec<BetSizeSpec>>,
    pub add_all_in_threshold: f64,
    pub force_all_in_threshold: f64,
    pub merging_threshold: f64,
    pub max_raises_per_street: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreetMenu {
    pub oop: SizeMenu,
    pub ip: SizeMenu,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizeMenu {
    pub bet: Vec<BetSizeSpec>,
    pub raise: Vec<BetSizeSpec>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(tag = "kind")]
pub enum BetSizeSpec {
    #[serde(rename = "pot")]
    Pot { pct: f64 },
    #[serde(rename = "prevBet")]
    PrevBet { multiple: f64 },
    #[serde(rename = "chips")]
    Chips {
        amount: i32,
        #[serde(rename = "raiseCap")]
        raise_cap: i32,
    },
    #[serde(rename = "geometric")]
    Geometric {
        streets: i32,
        #[serde(rename = "maxPct")]
        max_pct: Option<f64>,
    },
    #[serde(rename = "allin")]
    AllIn,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ActionSpec {
    #[serde(rename = "fold")]
    Fold,
    #[serde(rename = "check")]
    Check,
    #[serde(rename = "call")]
    Call,
    #[serde(rename = "bet")]
    Bet { to: i32 },
    #[serde(rename = "raise")]
    Raise { to: i32 },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub action: ActionSpec,
    pub next: ExplicitNode,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ExplicitNode {
    #[serde(rename = "player")]
    Player { player: u8, actions: Vec<Edge> },
    #[serde(rename = "chance")]
    Chance { next: Box<ExplicitNode> },
    #[serde(rename = "terminal")]
    Terminal { outcome: String },
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum Compression {
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "on")]
    On,
    #[serde(rename = "auto")]
    Auto,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ExportScope {
    #[serde(rename = "full")]
    Full,
    #[serde(rename = "first-street")]
    FirstStreet,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SolveOptions {
    pub target_exploitability_pct_pot: f64,
    pub max_iterations: u32,
    pub memory_cap_bytes: u64,
    pub timeout_ms: u64,
    pub compression: Compression,
    pub export_scope: ExportScope,
}

/// One checked hand: (spot combo string, (lower card, higher card), float32 weight).
pub type CheckedHand = (String, (Card, Card), f32);

/// Cards and weights after checking, in the spot's own order.
pub struct CheckedCards {
    pub flop: [Card; 3],
    pub turn: Option<Card>,
    pub river: Option<Card>,
    pub hands: [Vec<CheckedHand>; 2],
}

pub fn parse_card(text: &str) -> Result<Card, String> {
    card_from_str(text).map_err(|e| format!("invalid card {text}: {e}"))
}

fn parse_combo(combo: &str) -> Result<(Card, Card), String> {
    if combo.len() != 4 || !combo.is_ascii() {
        return Err(format!("invalid combo {combo}"));
    }
    let first = parse_card(&combo[0..2])?;
    let second = parse_card(&combo[2..4])?;
    if first <= second {
        return Err(format!("combo {combo} is not canonical (higher card first, distinct)"));
    }
    Ok((first, second))
}

const MAX_CHIPS: i64 = 100_000_000;

impl Spot {
    pub fn parse(bytes: &[u8]) -> Result<Spot, String> {
        let spot: Spot =
            serde_json::from_slice(bytes).map_err(|e| format!("spot JSON does not match contract v1: {e}"))?;
        spot.check_scalars()?;
        Ok(spot)
    }

    fn check_scalars(&self) -> Result<(), String> {
        if self.format != SPOT_FORMAT || self.version != 1 {
            return Err(format!("expected {SPOT_FORMAT} version 1"));
        }
        if !(1..=MAX_CHIPS).contains(&self.starting_pot) || !(1..=MAX_CHIPS).contains(&self.effective_stack) {
            return Err("startingPot and effectiveStack must be whole chips in [1, 100000000]".into());
        }
        if self.rake != 0.0 {
            return Err("rake must be 0 in contract v1".into());
        }
        let s = &self.solve;
        if !(s.target_exploitability_pct_pot.is_finite() && s.target_exploitability_pct_pot > 0.0) {
            return Err("solve.targetExploitabilityPctPot must be positive".into());
        }
        if s.max_iterations == 0 || s.timeout_ms == 0 || s.memory_cap_bytes == 0 {
            return Err("solve.maxIterations, timeoutMs and memoryCapBytes must be positive".into());
        }
        Ok(())
    }

    pub fn check_cards(&self) -> Result<CheckedCards, String> {
        let flop = [
            parse_card(&self.board.flop[0])?,
            parse_card(&self.board.flop[1])?,
            parse_card(&self.board.flop[2])?,
        ];
        let turn = self.board.turn.as_deref().map(parse_card).transpose()?;
        let river = self.board.river.as_deref().map(parse_card).transpose()?;
        if river.is_some() && turn.is_none() {
            return Err("board.river requires board.turn".into());
        }
        let mut board_mask: u64 = 0;
        for card in flop.iter().chain(turn.iter()).chain(river.iter()) {
            if board_mask & (1 << card) != 0 {
                return Err("board repeats a card".into());
            }
            board_mask |= 1 << card;
        }
        let mut hands: [Vec<CheckedHand>; 2] = [Vec::new(), Vec::new()];
        for (player, range) in self.ranges.iter().enumerate() {
            if range.combos.is_empty() {
                return Err(format!("ranges[{player}] is empty"));
            }
            let mut seen_pairs = std::collections::HashSet::new();
            for entry in &range.combos {
                let (c1, c2) = parse_combo(&entry.combo)?;
                if board_mask & ((1 << c1) | (1 << c2)) != 0 {
                    return Err(format!("ranges[{player}] combo {} overlaps the board", entry.combo));
                }
                if !seen_pairs.insert((c1, c2)) {
                    return Err(format!("ranges[{player}] repeats combo {}", entry.combo));
                }
                let weight = entry.weight as f32;
                if !(entry.weight > 0.0 && entry.weight <= 1.0) || weight as f64 != entry.weight {
                    return Err(format!(
                        "ranges[{player}] weight {} of {} must be a float32-exact number in (0, 1]",
                        entry.weight, entry.combo
                    ));
                }
                hands[player].push((entry.combo.clone(), (c2, c1), weight));
            }
        }
        Ok(CheckedCards {
            flop,
            turn,
            river,
            hands,
        })
    }
}
