//! poker-face ⇄ postflop-solver bridge: spot contract v1 in, result contract v1 out.
//! The contract types are defined in src/lib/solver/bridge/contract.ts.

pub mod spot;

use postflop_solver::{
    compute_exploitability, finalize, solve_step, Action, ActionTree, BetSize, BetSizeOptions, BoardState, Card,
    CardConfig, DonkSizeOptions, PostFlopGame, Range, TreeConfig, NOT_DEALT,
};
use serde::Serialize;
use spot::{
    ActionSpec, BetSizeSpec, CheckedCards, Compression, ExplicitNode, ExportScope, MenuTree, SizeMenu, Spot,
    StreetMenu, TreeSpec,
};
use std::collections::HashMap;
use std::time::Instant;

pub const POSTFLOP_SOLVER_REPOSITORY: &str = "https://github.com/b-inary/postflop-solver";
/// Must equal the `rev` in Cargo.toml and POSTFLOP_SOLVER_COMMIT in contract.ts.
pub const POSTFLOP_SOLVER_COMMIT: &str = "9d1509fe5077d019825f833eed04b16d342dfda1";
pub const RESULT_FORMAT: &str = "poker-face-bridge-result";
/// Exploitability is re-measured every this many iterations (as upstream `solve` does).
pub const EXPLOITABILITY_EVERY: u32 = 10;

// ---------------------------------------------------------------------------------------
// Tree construction.

fn bet_size(spec: &BetSizeSpec, allow_prev_bet: bool, label: &str) -> Result<BetSize, String> {
    let positive = |x: f64| x.is_finite() && x > 0.0;
    Ok(match *spec {
        BetSizeSpec::Pot { pct } if positive(pct) => BetSize::PotRelative(pct / 100.0),
        BetSizeSpec::PrevBet { multiple } if allow_prev_bet && multiple.is_finite() && multiple > 1.0 => {
            BetSize::PrevBetRelative(multiple)
        }
        BetSizeSpec::Chips { amount, raise_cap } if amount > 0 && raise_cap >= 0 => {
            BetSize::Additive(amount, raise_cap)
        }
        BetSizeSpec::Geometric { streets, max_pct } if streets >= 0 && max_pct.is_none_or(positive) => {
            BetSize::Geometric(streets, max_pct.map_or(f64::INFINITY, |p| p / 100.0))
        }
        BetSizeSpec::AllIn => BetSize::AllIn,
        _ => return Err(format!("{label}: invalid or misplaced bet size {spec:?}")),
    })
}

fn size_list(specs: &[BetSizeSpec], allow_prev_bet: bool, label: &str) -> Result<Vec<BetSize>, String> {
    specs.iter().map(|s| bet_size(s, allow_prev_bet, label)).collect()
}

fn size_menu(menu: &SizeMenu, label: &str) -> Result<BetSizeOptions, String> {
    Ok(BetSizeOptions {
        bet: size_list(&menu.bet, false, label)?,
        raise: size_list(&menu.raise, true, label)?,
    })
}

fn street_menu(menu: &Option<StreetMenu>, played: bool, name: &str) -> Result<[BetSizeOptions; 2], String> {
    match (menu, played) {
        (Some(m), true) => Ok([size_menu(&m.oop, name)?, size_menu(&m.ip, name)?]),
        (None, false) => Ok(Default::default()),
        (None, true) => Err(format!("tree.{name} is required for this board")),
        (Some(_), false) => Err(format!("tree.{name} must be null: that street is already dealt")),
    }
}

fn initial_state(cards: &CheckedCards) -> BoardState {
    match (cards.turn, cards.river) {
        (None, _) => BoardState::Flop,
        (Some(_), None) => BoardState::Turn,
        (Some(_), Some(_)) => BoardState::River,
    }
}

fn base_config(spot: &Spot, cards: &CheckedCards) -> TreeConfig {
    TreeConfig {
        initial_state: initial_state(cards),
        starting_pot: spot.starting_pot as i32,
        effective_stack: spot.effective_stack as i32,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: Default::default(),
        turn_bet_sizes: Default::default(),
        river_bet_sizes: Default::default(),
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 0.0,
        force_allin_threshold: 0.0,
        merging_threshold: 0.0,
    }
}

fn menu_config(spot: &Spot, cards: &CheckedCards, menu: &MenuTree) -> Result<TreeConfig, String> {
    let state = initial_state(cards);
    let thresholds = [
        menu.add_all_in_threshold,
        menu.force_all_in_threshold,
        menu.merging_threshold,
    ];
    if thresholds.iter().any(|t| !t.is_finite() || *t < 0.0) {
        return Err("tree thresholds must be finite and non-negative".into());
    }
    let donk = |sizes: &Option<Vec<BetSizeSpec>>, label: &str| -> Result<Option<DonkSizeOptions>, String> {
        sizes
            .as_ref()
            .map(|s| {
                Ok(DonkSizeOptions {
                    donk: size_list(s, false, label)?,
                })
            })
            .transpose()
    };
    Ok(TreeConfig {
        flop_bet_sizes: street_menu(&menu.flop, state == BoardState::Flop, "flop")?,
        turn_bet_sizes: street_menu(&menu.turn, state <= BoardState::Turn, "turn")?,
        river_bet_sizes: street_menu(&menu.river, true, "river")?,
        turn_donk_sizes: donk(&menu.turn_donk, "turnDonk")?,
        river_donk_sizes: donk(&menu.river_donk, "riverDonk")?,
        add_allin_threshold: menu.add_all_in_threshold,
        force_allin_threshold: menu.force_all_in_threshold,
        merging_threshold: menu.merging_threshold,
        ..base_config(spot, cards)
    })
}

fn is_sized(action: &Action) -> bool {
    matches!(action, Action::Bet(_) | Action::Raise(_) | Action::AllIn(_))
}

/// Bridge extension: remove every raise beyond `cap` on a street (postflop-solver itself
/// keeps offering raises until someone is all-in).
fn cap_raises(tree: &mut ActionTree, cap: u32, sized_on_street: u32) -> Result<(), String> {
    if tree.is_terminal_node() {
        return Ok(());
    }
    let sized_on_street = if tree.is_chance_node() { 0 } else { sized_on_street };
    let actions = tree.available_actions().to_vec();
    let facing = actions.contains(&Action::Fold);
    if facing && sized_on_street > cap {
        for action in actions.iter().filter(|a| is_sized(a)) {
            tree.remove_action(*action)?;
        }
    }
    for action in tree.available_actions().to_vec() {
        tree.play(action)?;
        cap_raises(tree, cap, sized_on_street + u32::from(is_sized(&action)))?;
        tree.undo()?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Betting {
    street: u8,
    actor: usize,
    closed: i32,
    put: [i32; 2],
    checks: u8,
}

fn engine_action(spec: ActionSpec, state: &Betting, stack: i32) -> Action {
    let all_in = stack - state.closed;
    match spec {
        ActionSpec::Fold => Action::Fold,
        ActionSpec::Check => Action::Check,
        ActionSpec::Call => Action::Call,
        ActionSpec::Bet { to } | ActionSpec::Raise { to } if to == all_in => Action::AllIn(to),
        ActionSpec::Bet { to } => Action::Bet(to),
        ActionSpec::Raise { to } => Action::Raise(to),
    }
}

fn advance(state: &Betting, spec: ActionSpec) -> Betting {
    let mut next = *state;
    let close = |matched: i32| Betting {
        street: state.street + 1,
        actor: 0,
        closed: state.closed + matched,
        put: [0, 0],
        checks: 0,
    };
    match spec {
        ActionSpec::Fold => next,
        ActionSpec::Check if state.checks == 1 || state.actor == 1 => close(0),
        ActionSpec::Check => {
            next.actor = 1;
            next.checks = 1;
            next
        }
        ActionSpec::Call => close(state.put[0].max(state.put[1])),
        ActionSpec::Bet { to } | ActionSpec::Raise { to } => {
            next.put[state.actor] = to;
            next.actor = 1 - state.actor;
            next.checks = 0;
            next
        }
    }
}

fn explicit_edit(
    tree: &mut ActionTree,
    node: &ExplicitNode,
    state: Betting,
    stack: i32,
    after_chance: bool,
    path: &str,
) -> Result<(), String> {
    let mismatch = |what: &str| format!("explicit tree cannot be represented at {path}: {what}");
    match node {
        ExplicitNode::Terminal { outcome } => {
            if !tree.is_terminal_node() {
                return Err(mismatch("postflop-solver continues where the spot ends"));
            }
            let folded = tree.history().last() == Some(&Action::Fold);
            match (outcome.as_str(), folded) {
                ("fold", true) | ("showdown", false) => Ok(()),
                _ => Err(mismatch(&format!(
                    "terminal outcome {outcome} disagrees with the engine"
                ))),
            }
        }
        ExplicitNode::Chance { next } => {
            if !tree.is_chance_node() {
                return Err(mismatch("expected a chance node (next street)"));
            }
            explicit_edit(tree, next, state, stack, true, path)
        }
        ExplicitNode::Player { player, actions } => {
            if tree.is_terminal_node() || (!after_chance && tree.is_chance_node()) {
                return Err(mismatch("expected a player decision"));
            }
            if usize::from(*player) != state.actor {
                return Err(mismatch(&format!("player {player} cannot act here")));
            }
            let desired: Vec<Action> = actions.iter().map(|e| engine_action(e.action, &state, stack)).collect();
            for existing in tree.available_actions().to_vec() {
                if !desired.contains(&existing) {
                    tree.remove_action(existing).map_err(|e| mismatch(&e))?;
                }
            }
            for action in &desired {
                if !tree.available_actions().contains(action) {
                    tree.add_action(*action)
                        .map_err(|e| mismatch(&format!("{action:?}: {e}")))?;
                }
            }
            let mut wanted = desired.clone();
            wanted.sort_unstable();
            wanted.dedup();
            if tree.available_actions() != wanted.as_slice() || wanted.len() != desired.len() {
                return Err(mismatch(&format!(
                    "engine has {:?}, spot wants {desired:?}",
                    tree.available_actions()
                )));
            }
            for (edge, action) in actions.iter().zip(desired) {
                tree.play(action)?;
                let child_path = format!("{path}/{action:?}");
                explicit_edit(
                    tree,
                    &edge.next,
                    advance(&state, edge.action),
                    stack,
                    false,
                    &child_path,
                )?;
                tree.undo()?;
            }
            Ok(())
        }
    }
}

pub fn build_action_tree(spot: &Spot, cards: &CheckedCards) -> Result<ActionTree, String> {
    match &spot.tree {
        TreeSpec::Menu(menu) => {
            let mut tree = ActionTree::new(menu_config(spot, cards, menu)?)?;
            if let Some(cap) = menu.max_raises_per_street {
                cap_raises(&mut tree, cap, 0)?;
                tree.back_to_root();
            }
            Ok(tree)
        }
        TreeSpec::Explicit { root } => {
            let mut tree = ActionTree::new(base_config(spot, cards))?;
            let street = initial_state(cards) as u8;
            let state = Betting {
                street,
                actor: 0,
                closed: 0,
                put: [0, 0],
                checks: 0,
            };
            explicit_edit(&mut tree, root, state, spot.effective_stack as i32, false, "root")?;
            tree.back_to_root();
            // Second pass: the edited tree must now match without further edits.
            let removed = tree.removed_lines().len();
            let added = tree.added_lines().len();
            explicit_edit(&mut tree, root, state, spot.effective_stack as i32, false, "root")?;
            if tree.removed_lines().len() != removed || tree.added_lines().len() != added {
                return Err("explicit tree edit did not converge".into());
            }
            tree.back_to_root();
            Ok(tree)
        }
    }
}

pub fn build_game(spot: &Spot, cards: &CheckedCards) -> Result<PostFlopGame, String> {
    let mut ranges = [Range::new(), Range::new()];
    for (player, hands) in cards.hands.iter().enumerate() {
        for &(_, (c1, c2), weight) in hands {
            ranges[player].set_weight_by_cards(c1, c2, weight);
        }
    }
    let card_config = CardConfig {
        range: ranges,
        flop: cards.flop,
        turn: cards.turn.unwrap_or(NOT_DEALT),
        river: cards.river.unwrap_or(NOT_DEALT),
    };
    let tree = build_action_tree(spot, cards)?;
    PostFlopGame::with_config(card_config, tree)
}

// ---------------------------------------------------------------------------------------
// Result contract v1.

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "type")]
pub enum ActionOut {
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

#[derive(Serialize)]
pub struct ResultAction {
    pub action: ActionOut,
    #[serde(rename = "engineAction")]
    pub engine_action: String,
    pub child: usize,
}

#[derive(Serialize)]
pub struct ChanceChild {
    pub card: String,
    pub child: usize,
    pub representative: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind")]
pub enum ResultNode {
    #[serde(rename = "player")]
    Player {
        id: usize,
        street: &'static str,
        board: Vec<String>,
        player: usize,
        committed: [i32; 2],
        actions: Vec<ResultAction>,
        strategy: Vec<Vec<Option<f32>>>,
    },
    #[serde(rename = "chance")]
    Chance {
        id: usize,
        street: &'static str,
        board: Vec<String>,
        committed: [i32; 2],
        children: Vec<ChanceChild>,
        #[serde(rename = "impossibleCards")]
        impossible_cards: Vec<String>,
        truncated: bool,
    },
    #[serde(rename = "terminal")]
    Terminal {
        id: usize,
        outcome: &'static str,
        board: Vec<String>,
        committed: [i32; 2],
        folder: Option<usize>,
    },
}

#[derive(Serialize)]
pub struct Engine {
    pub name: &'static str,
    pub repository: &'static str,
    pub commit: &'static str,
    #[serde(rename = "bridgeVersion")]
    pub bridge_version: &'static str,
    pub algorithm: &'static str,
    pub precision: &'static str,
    pub threads: usize,
}

#[derive(Serialize)]
pub struct Root {
    pub ev: [Vec<f32>; 2],
    #[serde(rename = "engineEv")]
    pub engine_ev: [Vec<f32>; 2],
    pub equity: [Vec<f32>; 2],
    pub weights: [Vec<f32>; 2],
}

#[derive(Serialize)]
pub struct Exploitability {
    pub chips: f32,
    #[serde(rename = "pctPot")]
    pub pct_pot: f64,
    pub convention: &'static str,
    pub target: f64,
    pub reached: bool,
}

#[derive(Serialize)]
pub struct Checkpoint {
    pub iteration: u32,
    pub exploitability: f32,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub build_ms: u64,
    pub allocate_ms: u64,
    pub solve_ms: u64,
    pub export_ms: u64,
    pub total_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub estimated_bytes: u64,
    pub estimated_compressed_bytes: u64,
    pub allocated_estimate_bytes: u64,
    pub peak_rss_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub exported_nodes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeResult {
    pub format: &'static str,
    pub version: u32,
    pub spot_id: String,
    pub spot_hash: String,
    pub engine: Engine,
    pub hands: [Vec<String>; 2],
    pub tree: Vec<ResultNode>,
    pub root: Root,
    pub exploitability: Exploitability,
    pub iterations: u32,
    pub convergence: Vec<Checkpoint>,
    pub timings: Timings,
    pub memory: Memory,
    pub counts: Counts,
}

pub fn card_name(card: Card) -> String {
    postflop_solver::card_to_string(card).expect("valid card id")
}

fn engine_label(action: &Action) -> String {
    format!("{action:?}")
}

struct Exporter {
    /// spot hand index → engine private-hand index, per player.
    order: [Vec<usize>; 2],
    hands: [Vec<(Card, Card)>; 2],
    scope: ExportScope,
    nodes: Vec<Option<ResultNode>>,
}

impl Exporter {
    fn visit(
        &mut self,
        game: &mut PostFlopGame,
        history: &mut Vec<usize>,
        last: Option<(Action, usize)>,
        derived: bool,
    ) -> Result<usize, String> {
        let id = self.nodes.len();
        self.nodes.push(None);
        game.apply_history(history);
        let board_ids = game.current_board();
        let board: Vec<String> = board_ids.iter().map(|&c| card_name(c)).collect();
        let board_mask: u64 = board_ids.iter().map(|&c| 1u64 << c).sum();
        let committed = game.total_bet_amount();
        let node = if game.is_terminal_node() {
            let folder = match last {
                Some((Action::Fold, player)) => Some(player),
                _ => None,
            };
            ResultNode::Terminal {
                id,
                outcome: if folder.is_some() { "fold" } else { "showdown" },
                board,
                committed,
                folder,
            }
        } else if game.is_chance_node() {
            let street = if board_ids.len() == 3 { "turn" } else { "river" };
            let possible = game.possible_cards();
            let impossible_cards = (0..52u8)
                .filter(|c| board_mask & (1 << c) == 0 && possible & (1 << c) == 0)
                .map(card_name)
                .collect();
            let mut children = Vec::new();
            if self.scope == ExportScope::Full {
                let representatives: Vec<Card> = game
                    .available_actions()
                    .iter()
                    .filter_map(|a| if let Action::Chance(c) = a { Some(*c) } else { None })
                    .collect();
                for card in (0..52u8).filter(|c| possible & (1 << c) != 0) {
                    let representative = !derived && representatives.contains(&card);
                    history.push(card as usize);
                    let child = self.visit(game, history, None, !representative)?;
                    history.pop();
                    children.push(ChanceChild {
                        card: card_name(card),
                        child,
                        representative,
                    });
                }
            }
            let truncated = self.scope != ExportScope::Full;
            ResultNode::Chance {
                id,
                street,
                board,
                committed,
                children,
                impossible_cards,
                truncated,
            }
        } else {
            let player = game.current_player();
            let actions = game.available_actions();
            let strategy = game.strategy();
            let engine_hands = self.hands[player].len();
            if strategy.len() != actions.len() * engine_hands {
                return Err(format!("node {id}: strategy has unexpected length"));
            }
            let facing = actions.contains(&Action::Fold);
            let rows = (0..actions.len())
                .map(|a| {
                    self.order[player]
                        .iter()
                        .map(|&e| {
                            let (c1, c2) = self.hands[player][e];
                            if board_mask & ((1 << c1) | (1 << c2)) != 0 {
                                Ok(None)
                            } else {
                                let p = strategy[a * engine_hands + e];
                                if p.is_finite() {
                                    Ok(Some(p))
                                } else {
                                    Err(format!("node {id}: non-finite strategy"))
                                }
                            }
                        })
                        .collect::<Result<Vec<_>, String>>()
                })
                .collect::<Result<Vec<_>, String>>()?;
            let street = match board_ids.len() {
                3 => "flop",
                4 => "turn",
                _ => "river",
            };
            let mut out = Vec::with_capacity(actions.len());
            for (index, action) in actions.iter().enumerate() {
                history.push(index);
                let child = self.visit(game, history, Some((*action, player)), derived)?;
                history.pop();
                let mapped = match *action {
                    Action::Fold => ActionOut::Fold,
                    Action::Check => ActionOut::Check,
                    Action::Call => ActionOut::Call,
                    Action::Bet(to) => ActionOut::Bet { to },
                    Action::Raise(to) => ActionOut::Raise { to },
                    Action::AllIn(to) if facing => ActionOut::Raise { to },
                    Action::AllIn(to) => ActionOut::Bet { to },
                    other => return Err(format!("node {id}: unexpected action {other:?}")),
                };
                out.push(ResultAction {
                    action: mapped,
                    engine_action: engine_label(action),
                    child,
                });
            }
            ResultNode::Player {
                id,
                street,
                board,
                player,
                committed,
                actions: out,
                strategy: rows,
            }
        };
        self.nodes[id] = Some(node);
        Ok(id)
    }
}

/// Peak resident set size of this process in bytes.
pub fn peak_rss_bytes() -> u64 {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return 0;
    }
    let max = usage.ru_maxrss.max(0) as u64;
    if cfg!(target_os = "macos") {
        max
    } else {
        max * 1024
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Progress<'a>(pub &'a mut dyn FnMut(serde_json::Value));

impl Progress<'_> {
    fn emit(&mut self, value: serde_json::Value) {
        (self.0)(value)
    }
}

/// Build the game without allocating solver storage and report its size (a preflight).
pub fn estimate_spot(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let spot = Spot::parse(bytes)?;
    let cards = spot.check_cards()?;
    let game = build_game(&spot, &cards)?;
    let (estimated, compressed) = game.memory_usage();
    Ok(serde_json::json!({
        "type": "estimate", "spotId": spot.id, "spotHash": sha256_hex(bytes),
        "estimatedBytes": estimated, "estimatedCompressedBytes": compressed,
        "hands": [game.private_cards(0).len(), game.private_cards(1).len()],
        "memoryCapBytes": spot.solve.memory_cap_bytes,
    }))
}

/// Solve one spot. Errors leave nothing behind; the caller writes the result only on Ok.
pub fn solve_spot(bytes: &[u8], progress: &mut Progress) -> Result<BridgeResult, String> {
    let started = Instant::now();
    let elapsed_ms = |since: Instant| since.elapsed().as_millis() as u64;
    let spot = Spot::parse(bytes)?;
    let cards = spot.check_cards()?;
    let options = spot.solve;
    progress.emit(serde_json::json!({ "type": "progress", "stage": "building", "elapsedMs": elapsed_ms(started) }));

    let build_started = Instant::now();
    let mut game = build_game(&spot, &cards)?;
    let build_ms = elapsed_ms(build_started);

    // Map the spot's hands to the engine's private-hand order; both must be the same set.
    let mut order: [Vec<usize>; 2] = [Vec::new(), Vec::new()];
    let mut hands: [Vec<(Card, Card)>; 2] = [Vec::new(), Vec::new()];
    for player in 0..2 {
        hands[player] = game.private_cards(player).to_vec();
        let index: HashMap<(Card, Card), usize> = hands[player].iter().enumerate().map(|(i, &h)| (h, i)).collect();
        if index.len() != cards.hands[player].len() {
            return Err(format!(
                "engine kept {} hands for player {player}; spot has {}",
                index.len(),
                cards.hands[player].len()
            ));
        }
        for (combo, pair, _) in &cards.hands[player] {
            order[player].push(*index.get(pair).ok_or_else(|| format!("engine dropped hand {combo}"))?);
        }
    }

    let (estimated, estimated_compressed) = game.memory_usage();
    let compress = match options.compression {
        Compression::Off => false,
        Compression::On => true,
        Compression::Auto => estimated > options.memory_cap_bytes,
    };
    let allocated_estimate = if compress { estimated_compressed } else { estimated };
    progress.emit(
        serde_json::json!({ "type": "progress", "stage": "allocating", "estimatedBytes": estimated,
        "estimatedCompressedBytes": estimated_compressed, "compression": compress, "elapsedMs": elapsed_ms(started) }),
    );
    if allocated_estimate > options.memory_cap_bytes {
        return Err(format!(
            "estimated memory {allocated_estimate} bytes (compression {compress}) exceeds the cap {} bytes; nothing allocated",
            options.memory_cap_bytes
        ));
    }
    let allocate_started = Instant::now();
    game.allocate_memory(compress);
    let allocate_ms = elapsed_ms(allocate_started);

    let target = spot.starting_pot as f64 * options.target_exploitability_pct_pot / 100.0;
    let timeout = std::time::Duration::from_millis(options.timeout_ms);
    let solve_started = Instant::now();
    let mut exploitability = compute_exploitability(&game);
    let mut convergence = vec![Checkpoint {
        iteration: 0,
        exploitability,
        elapsed_ms: 0,
    }];
    let mut iterations = 0;
    while iterations < options.max_iterations && f64::from(exploitability) > target {
        if started.elapsed() > timeout {
            return Err(format!(
                "timed out after {iterations} iterations (limit {} ms); no result written",
                options.timeout_ms
            ));
        }
        solve_step(&game, iterations);
        iterations += 1;
        if iterations % EXPLOITABILITY_EVERY == 0 || iterations == options.max_iterations {
            exploitability = compute_exploitability(&game);
            let elapsed = elapsed_ms(solve_started);
            convergence.push(Checkpoint {
                iteration: iterations,
                exploitability,
                elapsed_ms: elapsed,
            });
            progress.emit(
                serde_json::json!({ "type": "progress", "stage": "solving", "iteration": iterations,
                "maxIterations": options.max_iterations, "exploitability": exploitability, "target": target,
                "elapsedMs": elapsed_ms(started), "peakRssBytes": peak_rss_bytes() }),
            );
        }
    }
    finalize(&mut game);
    let exploitability = compute_exploitability(&game);
    let solve_ms = elapsed_ms(solve_started);
    if !exploitability.is_finite() {
        return Err("engine reported a non-finite exploitability".into());
    }
    if started.elapsed() > timeout {
        return Err("timed out while finalizing; no result written".into());
    }

    progress.emit(serde_json::json!({ "type": "progress", "stage": "exporting", "elapsedMs": elapsed_ms(started) }));
    let export_started = Instant::now();
    game.back_to_root();
    game.cache_normalized_weights();
    let reorder = |values: Vec<f32>, player: usize| -> Vec<f32> { order[player].iter().map(|&e| values[e]).collect() };
    let half_pot = spot.starting_pot as f32 / 2.0;
    let engine_ev = [reorder(game.expected_values(0), 0), reorder(game.expected_values(1), 1)];
    let ev = [0, 1].map(|p| engine_ev[p].iter().map(|v| v - half_pot).collect::<Vec<f32>>());
    let root = Root {
        ev,
        engine_ev,
        equity: [reorder(game.equity(0), 0), reorder(game.equity(1), 1)],
        weights: [
            reorder(game.normalized_weights(0).to_vec(), 0),
            reorder(game.normalized_weights(1).to_vec(), 1),
        ],
    };
    if [&root.ev, &root.equity, &root.weights]
        .iter()
        .any(|rows| rows.iter().flatten().any(|v| !v.is_finite()))
    {
        return Err("engine produced non-finite root values".into());
    }
    let mut exporter = Exporter {
        order,
        hands,
        scope: options.export_scope,
        nodes: Vec::new(),
    };
    exporter.visit(&mut game, &mut Vec::new(), None, false)?;
    let tree: Vec<ResultNode> = exporter
        .nodes
        .into_iter()
        .map(|n| n.expect("every node exported"))
        .collect();
    if started.elapsed() > timeout {
        return Err("timed out while exporting; no result written".into());
    }
    let export_ms = elapsed_ms(export_started);

    Ok(BridgeResult {
        format: RESULT_FORMAT,
        version: 1,
        spot_id: spot.id.clone(),
        spot_hash: sha256_hex(bytes),
        engine: Engine {
            name: "postflop-solver",
            repository: POSTFLOP_SOLVER_REPOSITORY,
            commit: POSTFLOP_SOLVER_COMMIT,
            bridge_version: env!("CARGO_PKG_VERSION"),
            algorithm: "discounted-cfr",
            precision: if compress { "int16-compressed" } else { "float32" },
            threads: rayon::current_num_threads(),
        },
        hands: [0, 1].map(|p| cards.hands[p].iter().map(|(combo, _, _)| combo.clone()).collect()),
        counts: Counts {
            exported_nodes: tree.len(),
        },
        tree,
        root,
        exploitability: Exploitability {
            chips: exploitability,
            pct_pot: f64::from(exploitability) / spot.starting_pot as f64 * 100.0,
            convention: "half-sum-of-best-response-gains",
            target,
            reached: f64::from(exploitability) <= target,
        },
        iterations,
        convergence,
        timings: Timings {
            build_ms,
            allocate_ms,
            solve_ms,
            export_ms,
            total_ms: elapsed_ms(started),
        },
        memory: Memory {
            estimated_bytes: estimated,
            estimated_compressed_bytes: estimated_compressed,
            allocated_estimate_bytes: allocated_estimate,
            peak_rss_bytes: peak_rss_bytes(),
        },
    })
}
