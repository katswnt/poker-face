//! Pre-storage export sizing. Count the edited abstract action tree, multiplying public
//! chance by ALL unseen board cards. We deliberately do not discount blockers, impossible
//! cards or suit isomorphism: the actual full export cannot exceed these counts.
use crate::{spot::ExportScope, ActionTree};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEstimate {
    pub version: u32,
    pub basis: &'static str,
    pub scope: &'static str,
    pub nodes: u64,
    pub cells: u64,
    pub edges: u64,
    pub json_bytes_upper_bound: u64,
    /// Engineering reservation, NOT a mathematical bound on an arbitrary JS engine's heap.
    pub working_bytes_estimate: u64,
}

fn add(target: &mut u64, amount: u64) -> Result<(), String> {
    *target = target.checked_add(amount).ok_or("export estimate overflow")?;
    Ok(())
}
fn times(a: u64, b: u64) -> Result<u64, String> {
    a.checked_mul(b).ok_or_else(|| "export estimate overflow".into())
}

struct Counter {
    nodes: u64,
    cells: u64,
    edges: u64,
    hands: [u64; 2],
    scope: ExportScope,
}
impl Counter {
    fn visit(&mut self, tree: &mut ActionTree, board: u64, actor: usize, copies: u64) -> Result<(), String> {
        add(&mut self.nodes, copies)?;
        if tree.is_terminal_node() {
            return Ok(());
        }
        let (board, actor, copies) = if tree.is_chance_node() {
            if self.scope == ExportScope::FirstStreet {
                return Ok(());
            }
            let children = times(copies, 52 - board)?;
            add(&mut self.edges, children)?;
            // ActionTree exposes the NEXT street's player actions at its chance node.
            add(&mut self.nodes, children)?;
            (board + 1, 0, children)
        } else {
            (board, actor, copies)
        };
        let actions = tree.available_actions().to_vec();
        add(
            &mut self.cells,
            times(times(actions.len() as u64, self.hands[actor])?, copies)?,
        )?;
        add(&mut self.edges, times(actions.len() as u64, copies)?)?;
        for action in actions {
            tree.play(action)?;
            self.visit(tree, board, 1 - actor, copies)?;
            tree.undo()?;
        }
        Ok(())
    }
}

pub fn estimate_export(
    tree: &mut ActionTree,
    board_cards: u64,
    hands: [u64; 2],
    scope: ExportScope,
    input_bytes: u64,
    max_iterations: u32,
) -> Result<ExportEstimate, String> {
    tree.back_to_root();
    let mut counter = Counter {
        nodes: 0,
        cells: 0,
        edges: 0,
        hands,
        scope,
    };
    counter.visit(tree, board_cards, 0, 1)?;
    tree.back_to_root();
    let mut json = 4096;
    // 32 bytes covers a serialized f32 + separators. 1024/node covers metadata/boards/
    // impossible-card lists; 128/edge covers action/chance descriptors and row brackets.
    // Include root arrays/hand names, escaped input-derived text and convergence checkpoints.
    for (count, bytes) in [
        (counter.nodes, 1024),
        (counter.cells, 32),
        (counter.edges, 128),
        (hands[0] + hands[1], 256),
        (input_bytes, 8),
        (u64::from(max_iterations) / 10 + 2, 128),
    ] {
        add(&mut json, times(count, bytes)?)?;
    }
    let mut working = times(json, 8)?;
    // Rust DTOs + vector slack, JS strings/parsed objects in worker and receiver. Calibrated
    // conservatively, with fixed/preflight memory added separately by the browser policy.
    for (count, bytes) in [(counter.nodes, 4096), (counter.cells, 64), (hands[0] + hands[1], 1024)] {
        add(&mut working, times(count, bytes)?)?;
    }
    Ok(ExportEstimate {
        version: 1,
        basis: "public-tree-upper-bound",
        scope: if scope == ExportScope::Full {
            "full"
        } else {
            "first-street"
        },
        nodes: counter.nodes,
        cells: counter.cells,
        edges: counter.edges,
        json_bytes_upper_bound: json,
        working_bytes_estimate: working,
    })
}
