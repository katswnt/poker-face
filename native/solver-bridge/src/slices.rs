//! Slice export (bridge extension, B3/B4): a solved game is far too large to export whole, so
//! a slice plan names which public nodes to write with per-hand detail, and which river
//! subgames to write in full (for the referee). The plan is a separate input file, hashed
//! into the result, so the same spot can be sliced differently without changing its identity.
//!
//! Path tokens name public actions and cards from the root: `x` check, `c` call, `f` fold,
//! `b<to>` bet to `to` (street total, all-in included), `r<to>` raise to `to`, `s<i>` the
//! i-th sized action at that node (plan input only), and a card name (`Qh`) at a chance node.

use crate::{card_name, spot::parse_card, ActionOut, Exporter, ResultNode};
use postflop_solver::{Action, Card, PostFlopGame};
use serde::{Deserialize, Serialize};

pub const SLICE_PLAN_FORMAT: &str = "poker-face-bridge-slices";
pub const MAX_SLICE_NODES: usize = 20_000;
pub const MAX_SUBTREES: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SlicePlan {
    pub format: String,
    pub version: u32,
    /// Flop decision nodes with at most this many flop actions before them (null = all).
    pub flop: Option<FlopPlan>,
    pub turn: Option<TurnPlan>,
    pub river: Option<RiverPlan>,
    /// Full subtrees (every node below, strategies only) for referee spot-checks.
    pub subtrees: Vec<Vec<String>>,
    /// Also export per-hand equity at every sliced node.
    pub equity: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FlopPlan {
    pub max_depth: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TurnPlan {
    pub cards: Vec<String>,
    pub max_depth: u32,
    /// Only lines with at most this many raises on earlier streets (null = any).
    pub max_prior_raises: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RiverPlan {
    /// (turn, river) pairs.
    pub boards: Vec<[String; 2]>,
    pub max_depth: u32,
    /// Only lines with at most this many raises on earlier streets (null = any).
    pub max_prior_raises: Option<u32>,
}

struct CheckedPlan {
    flop: Option<Option<u32>>,
    turn_cards: Vec<Card>,
    turn_depth: u32,
    turn_prior: Option<u32>,
    river_boards: Vec<(Card, Card)>,
    river_depth: u32,
    river_prior: Option<u32>,
    subtrees: Vec<Vec<String>>,
    equity: bool,
}

impl SlicePlan {
    pub fn parse(bytes: &[u8]) -> Result<SlicePlan, String> {
        let plan: SlicePlan =
            serde_json::from_slice(bytes).map_err(|e| format!("slice plan does not match format v1: {e}"))?;
        if plan.format != SLICE_PLAN_FORMAT || plan.version != 1 {
            return Err(format!("expected {SLICE_PLAN_FORMAT} version 1"));
        }
        if plan.subtrees.len() > MAX_SUBTREES {
            return Err(format!("at most {MAX_SUBTREES} subtrees"));
        }
        Ok(plan)
    }

    fn check(&self) -> Result<CheckedPlan, String> {
        let cards = |list: &[String]| list.iter().map(|c| parse_card(c)).collect::<Result<Vec<_>, _>>();
        let turn_cards = self.turn.as_ref().map_or(Ok(Vec::new()), |t| cards(&t.cards))?;
        let river_boards = self.river.as_ref().map_or(Ok(Vec::new()), |r| {
            r.boards
                .iter()
                .map(|[t, v]| Ok((parse_card(t)?, parse_card(v)?)))
                .collect::<Result<Vec<_>, String>>()
        })?;
        Ok(CheckedPlan {
            flop: self.flop.as_ref().map(|f| f.max_depth),
            turn_cards,
            turn_depth: self.turn.as_ref().map_or(0, |t| t.max_depth),
            turn_prior: self.turn.as_ref().and_then(|t| t.max_prior_raises),
            river_boards,
            river_depth: self.river.as_ref().map_or(0, |r| r.max_depth),
            river_prior: self.river.as_ref().and_then(|r| r.max_prior_raises),
            subtrees: self.subtrees.clone(),
            equity: self.equity,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceAction {
    pub action: ActionOut,
    pub engine_action: String,
    pub token: String,
}

/// One public decision node with per-hand detail. Rows follow `result.hands` order; null =
/// the hand is blocked by the board or (EV/equity) has zero blocker-compatible reach.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceNode {
    pub path: Vec<String>,
    pub street: &'static str,
    pub board: Vec<String>,
    pub player: usize,
    pub committed: [i32; 2],
    pub actions: Vec<SliceAction>,
    /// strategy[a][h] of the acting player.
    pub strategy: Vec<Vec<Option<f32>>>,
    /// Acting player's EV of each action from this node on ("from-now": chips won back from
    /// the pot minus chips still to be paid; fold = 0), conditional on the hand.
    pub action_ev: Vec<Vec<Option<f32>>>,
    /// Both players' from-now EV per hand under the saved strategy.
    pub ev: [Vec<Option<f32>>; 2],
    /// Both players' reach: range weight × own action probabilities along the path (0 = blocked).
    pub reach: [Vec<f32>; 2],
    pub equity: Option<[Vec<Option<f32>>; 2]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtree {
    pub path: Vec<String>,
    pub reach: [Vec<f32>; 2],
    pub ev: [Vec<Option<f32>>; 2],
    /// The subtree in the result-tree format; node 0 is the subtree root.
    pub nodes: Vec<ResultNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slices {
    pub plan_hash: String,
    pub nodes: Vec<SliceNode>,
    pub subtrees: Vec<Subtree>,
    /// Listed cards/boards the engine never deals (dead) or that no exported line reaches.
    pub unreached: Vec<String>,
}

fn street_name(board_len: usize) -> &'static str {
    match board_len {
        3 => "flop",
        4 => "turn",
        _ => "river",
    }
}

fn map_action(action: Action, facing: bool) -> Result<(ActionOut, String), String> {
    Ok(match action {
        Action::Fold => (ActionOut::Fold, "f".into()),
        Action::Check => (ActionOut::Check, "x".into()),
        Action::Call => (ActionOut::Call, "c".into()),
        Action::Raise(to) => (ActionOut::Raise { to }, format!("r{to}")),
        Action::AllIn(to) if facing => (ActionOut::Raise { to }, format!("r{to}")),
        Action::Bet(to) | Action::AllIn(to) => (ActionOut::Bet { to }, format!("b{to}")),
        other => return Err(format!("unexpected action {other:?}")),
    })
}

fn node_tokens(game: &PostFlopGame) -> Result<Vec<String>, String> {
    let actions = game.available_actions();
    let facing = actions.contains(&Action::Fold);
    actions.iter().map(|a| map_action(*a, facing).map(|(_, t)| t)).collect()
}

/// Resolve plan path tokens to a history (action indices / card ids), from the root.
fn resolve(game: &mut PostFlopGame, tokens: &[String]) -> Result<(Vec<usize>, Vec<String>), String> {
    game.back_to_root();
    let mut history = Vec::new();
    let mut canonical = Vec::new();
    for token in tokens {
        if game.is_terminal_node() {
            return Err(format!("path {tokens:?} continues past a terminal node"));
        }
        if game.is_chance_node() {
            let card = parse_card(token)?;
            if game.possible_cards() & (1 << card) == 0 {
                return Err(format!("path {tokens:?}: card {token} cannot be dealt here"));
            }
            history.push(card as usize);
            canonical.push(card_name(card));
        } else {
            let names = node_tokens(game)?;
            let sized: Vec<usize> = names
                .iter()
                .enumerate()
                .filter(|(_, n)| n.starts_with('b') || n.starts_with('r'))
                .map(|(i, _)| i)
                .collect();
            let index = if let Some(i) = token.strip_prefix('s').and_then(|s| s.parse::<usize>().ok()) {
                *sized
                    .get(i)
                    .ok_or_else(|| format!("path {tokens:?}: no sized action {token}"))?
            } else {
                names
                    .iter()
                    .position(|n| n == token)
                    .ok_or_else(|| format!("path {tokens:?}: no action {token} (have {names:?})"))?
            };
            history.push(index);
            canonical.push(names[index].clone());
        }
        game.play(*history.last().unwrap());
    }
    Ok((history, canonical))
}

struct Walker<'a> {
    plan: &'a CheckedPlan,
    order: &'a [Vec<usize>; 2],
    hands: &'a [Vec<(Card, Card)>; 2],
    nodes: Vec<SliceNode>,
    reached_turns: Vec<Card>,
    reached_rivers: Vec<(Card, Card)>,
}

impl Walker<'_> {
    fn blocked(&self, player: usize, engine: usize, mask: u64) -> bool {
        let (c1, c2) = self.hands[player][engine];
        mask & ((1u64 << c1) | (1u64 << c2)) != 0
    }

    fn rows(&self, player: usize, values: &[f32], mask: u64, live: &[f32]) -> Vec<Option<f32>> {
        self.order[player]
            .iter()
            .map(|&e| {
                if self.blocked(player, e, mask) || live[e] <= 0.0 || !values[e].is_finite() {
                    None
                } else {
                    Some(values[e])
                }
            })
            .collect()
    }

    fn export(&mut self, game: &mut PostFlopGame, tokens: &[String]) -> Result<(), String> {
        if self.nodes.len() >= MAX_SLICE_NODES {
            return Err(format!("slice plan selects more than {MAX_SLICE_NODES} nodes"));
        }
        game.cache_normalized_weights();
        let board_ids = game.current_board();
        let mask: u64 = board_ids.iter().map(|&c| 1u64 << c).sum();
        let player = game.current_player();
        let actions = game.available_actions();
        let facing = actions.contains(&Action::Fold);
        let hands = self.hands[player].len();
        let strategy = game.strategy();
        let detail = game.expected_values_detail(player);
        let normalized = [game.normalized_weights(0).to_vec(), game.normalized_weights(1).to_vec()];
        let ones = vec![1.0f32; hands];
        let mut strategy_rows = Vec::new();
        let mut ev_rows = Vec::new();
        let mut out_actions = Vec::new();
        for (a, action) in actions.iter().enumerate() {
            let (mapped, token) = map_action(*action, facing)?;
            out_actions.push(SliceAction {
                action: mapped,
                engine_action: format!("{action:?}"),
                token,
            });
            strategy_rows.push(self.rows(player, &strategy[a * hands..(a + 1) * hands], mask, &ones));
            ev_rows.push(self.rows(player, &detail[a * hands..(a + 1) * hands], mask, &normalized[player]));
        }
        let ev = [0, 1].map(|p| self.rows(p, &game.expected_values(p), mask, &normalized[p]));
        let reach = [0, 1].map(|p| {
            let weights = game.weights(p);
            self.order[p]
                .iter()
                .map(|&e| if self.blocked(p, e, mask) { 0.0 } else { weights[e] })
                .collect::<Vec<f32>>()
        });
        let equity = self
            .plan
            .equity
            .then(|| [0, 1].map(|p| self.rows(p, &game.equity(p), mask, &normalized[p])));
        self.nodes.push(SliceNode {
            path: tokens.to_vec(),
            street: street_name(board_ids.len()),
            board: board_ids.iter().map(|&c| card_name(c)).collect(),
            player,
            committed: game.total_bet_amount(),
            actions: out_actions,
            strategy: strategy_rows,
            action_ev: ev_rows,
            ev,
            reach,
            equity,
        });
        Ok(())
    }

    fn wanted(&self, board: &[Card], depth: u32, tokens: &[String]) -> bool {
        // Raises on earlier streets: `r` tokens before the last card token.
        let street_start = tokens
            .iter()
            .rposition(|t| t.len() == 2 && parse_card(t).is_ok())
            .map_or(0, |i| i + 1);
        let prior = tokens[..street_start].iter().filter(|t| t.starts_with('r')).count() as u32;
        let allowed = |cap: Option<u32>| cap.is_none_or(|c| prior <= c);
        match board.len() {
            3 => self.plan.flop.is_some_and(|m| m.is_none_or(|m| depth <= m)),
            4 => {
                self.plan.turn_cards.contains(&board[3])
                    && depth <= self.plan.turn_depth
                    && allowed(self.plan.turn_prior)
            }
            _ => {
                self.plan.river_boards.contains(&(board[3], board[4]))
                    && depth <= self.plan.river_depth
                    && allowed(self.plan.river_prior)
            }
        }
    }

    fn walk(
        &mut self,
        game: &mut PostFlopGame,
        history: &mut Vec<usize>,
        tokens: &mut Vec<String>,
        depth: u32,
    ) -> Result<(), String> {
        game.apply_history(history);
        if game.is_terminal_node() {
            return Ok(());
        }
        let board = game.current_board();
        if game.is_chance_node() {
            let possible = game.possible_cards();
            let cards: Vec<Card> = if board.len() == 3 {
                self.plan.turn_cards.clone()
            } else {
                self.plan
                    .river_boards
                    .iter()
                    .filter(|(t, _)| *t == board[3])
                    .map(|(_, r)| *r)
                    .collect()
            };
            for card in cards {
                if possible & (1u64 << card) == 0 {
                    continue;
                }
                if board.len() == 3 {
                    self.reached_turns.push(card);
                } else {
                    self.reached_rivers.push((board[3], card));
                }
                history.push(card as usize);
                tokens.push(card_name(card));
                self.walk(game, history, tokens, 0)?;
                history.pop();
                tokens.pop();
            }
            return Ok(());
        }
        if self.wanted(&board, depth, tokens) {
            self.export(game, tokens)?;
        }
        let names = node_tokens(game)?;
        for (index, name) in names.into_iter().enumerate() {
            history.push(index);
            tokens.push(name);
            self.walk(game, history, tokens, depth + 1)?;
            history.pop();
            tokens.pop();
        }
        Ok(())
    }
}

/// Fail fast (before solving) if a subtree path does not exist in the built tree.
pub fn check_subtree_paths(game: &mut PostFlopGame, plan: &SlicePlan) -> Result<(), String> {
    plan.check()?;
    for tokens in &plan.subtrees {
        let (history, _) = resolve(game, tokens)?;
        game.apply_history(&history);
        if game.is_terminal_node() || game.is_chance_node() {
            return Err(format!("subtree {tokens:?} must start at a decision node"));
        }
    }
    game.back_to_root();
    Ok(())
}

pub fn export_slices(
    game: &mut PostFlopGame,
    plan: &SlicePlan,
    plan_hash: String,
    order: &[Vec<usize>; 2],
    hands: &[Vec<(Card, Card)>; 2],
) -> Result<Slices, String> {
    let plan = plan.check()?;
    game.back_to_root();
    if game.current_board().len() != 3 && (plan.flop.is_some() || !plan.turn_cards.is_empty()) {
        return Err("flop/turn slices need a flop spot".into());
    }
    let mut walker = Walker {
        plan: &plan,
        order,
        hands,
        nodes: Vec::new(),
        reached_turns: Vec::new(),
        reached_rivers: Vec::new(),
    };
    walker.walk(game, &mut Vec::new(), &mut Vec::new(), 0)?;
    let mut unreached: Vec<String> = plan
        .turn_cards
        .iter()
        .filter(|c| !walker.reached_turns.contains(c))
        .map(|&c| card_name(c))
        .collect();
    unreached.extend(
        plan.river_boards
            .iter()
            .filter(|b| !walker.reached_rivers.contains(b))
            .map(|&(t, r)| format!("{}{}", card_name(t), card_name(r))),
    );
    let nodes = walker.nodes;

    let mut subtrees = Vec::new();
    for tokens in &plan.subtrees {
        let (history, canonical) = resolve(game, tokens)?;
        game.apply_history(&history);
        if game.is_terminal_node() || game.is_chance_node() {
            return Err(format!("subtree {tokens:?} must start at a decision node"));
        }
        game.cache_normalized_weights();
        let mask: u64 = game.current_board().iter().map(|&c| 1u64 << c).sum();
        let blocked = |p: usize, e: usize| {
            let (c1, c2) = hands[p][e];
            mask & ((1u64 << c1) | (1u64 << c2)) != 0
        };
        let normalized = [game.normalized_weights(0).to_vec(), game.normalized_weights(1).to_vec()];
        let reach = [0, 1].map(|p| {
            let w = game.weights(p);
            order[p]
                .iter()
                .map(|&e| if blocked(p, e) { 0.0 } else { w[e] })
                .collect::<Vec<f32>>()
        });
        let ev = [0, 1].map(|p| {
            let values = game.expected_values(p);
            order[p]
                .iter()
                .map(|&e| (!blocked(p, e) && normalized[p][e] > 0.0).then_some(values[e]))
                .collect::<Vec<_>>()
        });
        let mut exporter = Exporter {
            order: order.clone(),
            hands: hands.clone(),
            scope: crate::spot::ExportScope::Full,
            nodes: Vec::new(),
        };
        let mut h = history.clone();
        exporter.visit(game, &mut h, None, false)?;
        subtrees.push(Subtree {
            path: canonical,
            reach,
            ev,
            nodes: exporter
                .nodes
                .into_iter()
                .map(|n| n.expect("every node exported"))
                .collect(),
        });
    }
    game.back_to_root();
    Ok(Slices {
        plan_hash,
        nodes,
        subtrees,
        unreached,
    })
}
