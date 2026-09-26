//! Empirical checks of the unit mapping documented in tasks/postflop-solver-bridge-spec.md.

use postflop_solver::{Action, ActionTree, BetSizeOptions, BoardState, DonkSizeOptions, TreeConfig};
use serde_json::{json, Value};
use solver_bridge::{solve_spot, BridgeResult, Progress, ResultNode};

fn basic_config() -> TreeConfig {
    let sizes = BetSizeOptions::try_from(("60%, e, a", "2.5x")).unwrap();
    TreeConfig {
        initial_state: BoardState::Turn,
        starting_pot: 200,
        effective_stack: 900,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: Default::default(),
        turn_bet_sizes: [sizes.clone(), sizes.clone()],
        river_bet_sizes: [sizes.clone(), sizes],
        turn_donk_sizes: None,
        river_donk_sizes: Some(DonkSizeOptions::try_from("50%").unwrap()),
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    }
}

#[test]
fn bet_and_raise_amounts_are_street_totals() {
    let mut tree = ActionTree::new(basic_config()).unwrap();
    assert_eq!(
        tree.available_actions(),
        &[Action::Check, Action::Bet(120), Action::Bet(216), Action::AllIn(900)]
    );
    tree.play(Action::Bet(120)).unwrap();
    assert_eq!(tree.total_bet_amount(), [120, 0]);
    // 2.5x of 120 = 300: Raise(300) means IP's street total becomes 300, not 120 + 300.
    assert_eq!(
        tree.available_actions(),
        &[Action::Fold, Action::Call, Action::Raise(300)]
    );
    tree.play(Action::Raise(300)).unwrap();
    assert_eq!(tree.total_bet_amount(), [120, 300]);
    // 2.5x of 300 = 750 would leave 150 behind, under the force-all-in threshold
    // (0.15 x the pot after the call), so the engine offers AllIn(900) instead.
    assert_eq!(
        tree.available_actions(),
        &[Action::Fold, Action::Call, Action::AllIn(900)]
    );
    tree.play(Action::AllIn(900)).unwrap();
    assert_eq!(tree.total_bet_amount(), [900, 300]);
    // On the next street amounts restart from zero: after Bet(120)-Call the all-in is the
    // street total AllIn(780) that exhausts the remaining 900 - 120 chips.
    tree.back_to_root();
    tree.play(Action::Bet(120)).unwrap();
    tree.play(Action::Call).unwrap();
    assert_eq!(tree.total_bet_amount(), [120, 120]);
    assert!(tree.is_chance_node());
    assert_eq!(tree.available_actions().last(), Some(&Action::AllIn(780)));
    // Minimum raise = previous street total + the amount needed to call it.
    tree.back_to_root();
    tree.play(Action::Bet(120)).unwrap();
    assert!(tree.add_action(Action::Raise(239)).is_err());
    tree.add_action(Action::Raise(240)).unwrap();
    // A bet/raise to the all-in total is stored as AllIn.
    tree.back_to_root();
    assert!(tree.add_action(Action::Bet(899)).is_ok());
}

fn combos(list: &[&str]) -> Value {
    Value::Array(list.iter().map(|c| json!({ "combo": c, "weight": 1 })).collect())
}

fn solve(spot: Value) -> Result<BridgeResult, String> {
    let bytes = serde_json::to_vec(&spot).unwrap();
    let mut sink = |_: Value| {};
    solve_spot(&bytes, &mut Progress(&mut sink))
}

fn solve_options(scope: &str) -> Value {
    json!({ "targetExploitabilityPctPot": 0.01, "maxIterations": 2000, "memoryCapBytes": 1u64 << 30,
        "timeoutMs": 60000, "compression": "off", "exportScope": scope })
}

fn river_spot(tree: Value, oop: &[&str], ip: &[&str]) -> Value {
    json!({ "format": "poker-face-bridge-spot", "version": 1, "id": "test-river",
        "board": { "flop": ["Kd", "8c", "4h"], "turn": "2s", "river": "9d" },
        "ranges": [ { "source": "test", "combos": combos(oop) }, { "source": "test", "combos": combos(ip) } ],
        "startingPot": 100, "effectiveStack": 50, "rake": 0, "tree": tree, "solve": solve_options("full") })
}

fn check_down() -> Value {
    json!({ "mode": "explicit", "root": { "kind": "player", "player": 0, "actions": [
        { "action": { "type": "check" }, "next": { "kind": "player", "player": 1, "actions": [
            { "action": { "type": "check" }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } } ] } })
}

#[test]
fn root_ev_is_net_chips_and_engine_ev_is_pot_share() {
    // AA beats 22... on this board 22 makes a set with the 2s; use 33 instead.
    let result = solve(river_spot(check_down(), &["AsAh"], &["3s3h"])).unwrap();
    assert_eq!(result.tree.len(), 3);
    // Winner of a 100-chip pot: pot share 100, net +50 relative to the spot start.
    assert!(
        (result.root.engine_ev[0][0] - 100.0).abs() < 1e-3,
        "{:?}",
        result.root.engine_ev
    );
    assert!((result.root.ev[0][0] - 50.0).abs() < 1e-3);
    assert!((result.root.ev[1][0] + 50.0).abs() < 1e-3);
    assert!((result.root.equity[0][0] - 1.0).abs() < 1e-6);
}

#[test]
fn explicit_all_in_bet_is_exported_as_a_bet_to_the_stack() {
    let tree = json!({ "mode": "explicit", "root": { "kind": "player", "player": 0, "actions": [
        { "action": { "type": "check" }, "next": { "kind": "player", "player": 1, "actions": [
            { "action": { "type": "check" }, "next": { "kind": "terminal", "outcome": "showdown" } },
            { "action": { "type": "bet", "to": 20 }, "next": { "kind": "player", "player": 0, "actions": [
                { "action": { "type": "fold" }, "next": { "kind": "terminal", "outcome": "fold" } },
                { "action": { "type": "call" }, "next": { "kind": "terminal", "outcome": "showdown" } },
                { "action": { "type": "raise", "to": 50 }, "next": { "kind": "player", "player": 1, "actions": [
                    { "action": { "type": "fold" }, "next": { "kind": "terminal", "outcome": "fold" } },
                    { "action": { "type": "call" }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } } ] } } ] } },
        { "action": { "type": "bet", "to": 50 }, "next": { "kind": "player", "player": 1, "actions": [
            { "action": { "type": "fold" }, "next": { "kind": "terminal", "outcome": "fold" } },
            { "action": { "type": "call" }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } } ] } });
    let result = solve(river_spot(tree, &["AsAh", "7s6s"], &["KsQs", "3s3h"])).unwrap();
    let ResultNode::Player { actions, strategy, .. } = &result.tree[0] else {
        panic!("root must be a player node")
    };
    let labels: Vec<&str> = actions.iter().map(|a| a.engine_action.as_str()).collect();
    assert_eq!(labels, ["Check", "AllIn(50)"]);
    assert_eq!(
        serde_json::to_value(actions[1].action).unwrap(),
        json!({ "type": "bet", "to": 50 })
    );
    assert_eq!(strategy.len(), 2);
    // The check-bet-raise line: raise to the stack is AllIn(50) and exported as a raise.
    let ResultNode::Player { actions: ip, .. } = &result.tree[actions[0].child] else {
        panic!()
    };
    let ResultNode::Player {
        actions: oop,
        committed,
        ..
    } = &result.tree[ip[1].child]
    else {
        panic!()
    };
    assert_eq!(*committed, [0, 20]);
    assert_eq!(oop[2].engine_action, "AllIn(50)");
    assert_eq!(
        serde_json::to_value(oop[2].action).unwrap(),
        json!({ "type": "raise", "to": 50 })
    );
    // Tiny games plateau near 0.03% of the pot within 2000 DCFR iterations (see the spec).
    assert!(
        result.exploitability.chips < 0.1,
        "{} after {}",
        result.exploitability.chips,
        result.iterations
    );
}

#[test]
fn explicit_tree_mismatch_fails_loudly() {
    // Claims the hand ends after one check; postflop-solver always gives IP a decision.
    let tree = json!({ "mode": "explicit", "root": { "kind": "player", "player": 0, "actions": [
        { "action": { "type": "check" }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } });
    let error = solve(river_spot(tree, &["AsAh"], &["3s3h"])).err().unwrap();
    assert!(error.contains("cannot be represented"), "{error}");
    // A raise below the minimum raise cannot be added.
    let tree = json!({ "mode": "explicit", "root": { "kind": "player", "player": 0, "actions": [
        { "action": { "type": "check" }, "next": { "kind": "player", "player": 1, "actions": [
            { "action": { "type": "check" }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } },
        { "action": { "type": "bet", "to": 20 }, "next": { "kind": "player", "player": 1, "actions": [
            { "action": { "type": "fold" }, "next": { "kind": "terminal", "outcome": "fold" } },
            { "action": { "type": "call" }, "next": { "kind": "terminal", "outcome": "showdown" } },
            { "action": { "type": "raise", "to": 30 }, "next": { "kind": "terminal", "outcome": "showdown" } } ] } } ] } });
    let error = solve(river_spot(tree, &["AsAh"], &["3s3h"])).err().unwrap();
    assert!(error.contains("Invalid bet amount"), "{error}");
}

#[test]
fn rejects_bad_cards_weights_and_memory() {
    let base = river_spot(check_down(), &["AsAh"], &["3s3h"]);
    let mut overlap = base.clone();
    overlap["ranges"][0]["combos"] = combos(&["KdQs"]);
    assert!(solve(overlap).err().unwrap().contains("overlaps the board"));
    let mut weight = base.clone();
    weight["ranges"][0]["combos"][0]["weight"] = json!(0.1);
    assert!(solve(weight).err().unwrap().contains("float32-exact"));
    let mut zero = base.clone();
    zero["ranges"][1]["combos"][0]["weight"] = json!(0);
    assert!(solve(zero).is_err());
    let mut chips = base.clone();
    chips["startingPot"] = json!(100.5);
    assert!(solve(chips).is_err());
    let mut unknown = base.clone();
    unknown["extra"] = json!(true);
    assert!(solve(unknown).err().unwrap().contains("unknown field"));
    let mut memory = base;
    memory["solve"]["memoryCapBytes"] = json!(1);
    assert!(solve(memory).err().unwrap().contains("exceeds the cap"));
}

fn menu(bets: Value, raises: Value, max_raises: Value) -> Value {
    let street = json!({ "oop": { "bet": bets, "raise": raises }, "ip": { "bet": bets, "raise": raises } });
    json!({ "mode": "menu", "flop": null, "turn": street, "river": street, "turnDonk": null, "riverDonk": null,
        "addAllInThreshold": 1.5, "forceAllInThreshold": 0.15, "mergingThreshold": 0.1, "maxRaisesPerStreet": max_raises })
}

fn turn_spot(board: [&str; 4], tree: Value, oop: &[&str], ip: &[&str]) -> Value {
    json!({ "format": "poker-face-bridge-spot", "version": 1, "id": "test-turn",
        "board": { "flop": [board[0], board[1], board[2]], "turn": board[3], "river": null },
        "ranges": [ { "source": "test", "combos": combos(oop) }, { "source": "test", "combos": combos(ip) } ],
        "startingPot": 100, "effectiveStack": 400, "rake": 0, "tree": tree, "solve": solve_options("full") })
}

#[test]
fn raise_cap_removes_reraises() {
    let tree = menu(
        json!([{ "kind": "pot", "pct": 50 }]),
        json!([{ "kind": "prevBet", "multiple": 2.5 }]),
        json!(1),
    );
    let result = solve(turn_spot(
        ["Qs", "Jh", "2h", "5d"],
        tree,
        &["AsAh", "Tc9c"],
        &["KsKh", "8c7c"],
    ))
    .unwrap();
    let ResultNode::Player { actions: root, .. } = &result.tree[0] else {
        panic!()
    };
    let bet = root.iter().find(|a| a.engine_action == "Bet(50)").unwrap();
    let ResultNode::Player { actions: ip, .. } = &result.tree[bet.child] else {
        panic!()
    };
    let raise = ip
        .iter()
        .find(|a| a.engine_action.starts_with("Raise"))
        .expect("one raise allowed");
    let ResultNode::Player { actions: oop, .. } = &result.tree[raise.child] else {
        panic!()
    };
    let labels: Vec<&str> = oop.iter().map(|a| a.engine_action.as_str()).collect();
    assert_eq!(labels, ["Fold", "Call"], "second raise must be removed");
}

#[test]
fn isomorphic_river_cards_are_expanded_with_permuted_hands() {
    // Board has spades and hearts only, and the ranges are suit-symmetric in clubs/diamonds,
    // so postflop-solver stores one of each (Xc, Xd) river pair and derives the other.
    let tree = menu(json!([{ "kind": "pot", "pct": 50 }]), json!([]), json!(null));
    let oop = ["AdAc", "Tc9c", "Td9d"];
    let ip = ["KdKc", "8c7c", "8d7d"];
    let result = solve(turn_spot(["Qs", "Jh", "2h", "3s"], tree, &oop, &ip)).unwrap();
    // Walk check-check to the river chance node.
    let ResultNode::Player { actions: root, .. } = &result.tree[0] else {
        panic!()
    };
    let ResultNode::Player {
        actions: ip_actions, ..
    } = &result.tree[root[0].child]
    else {
        panic!()
    };
    let ResultNode::Chance {
        children,
        impossible_cards,
        ..
    } = &result.tree[ip_actions[0].child]
    else {
        panic!("expected river chance")
    };
    assert_eq!(children.len() + impossible_cards.len(), 48);
    assert!(
        children.iter().any(|c| !c.representative),
        "some rivers must be isomorphic"
    );
    let river = |card: &str| {
        let child = children.iter().find(|c| c.card == card).unwrap();
        let ResultNode::Player { strategy, board, .. } = &result.tree[child.child] else {
            panic!()
        };
        assert_eq!(board.last().unwrap(), card);
        (child.representative, strategy.clone())
    };
    let (rep_c, clubs) = river("4c");
    let (rep_d, diamonds) = river("4d");
    assert_ne!(rep_c, rep_d, "exactly one of 4c/4d is stored directly");
    // Swapping clubs and diamonds maps OOP hand 1 (Tc9c) to hand 2 (Td9d); AdAc maps to itself.
    for action in 0..clubs.len() {
        let close = |a: Option<f32>, b: Option<f32>| (a.unwrap() - b.unwrap()).abs() < 1e-6;
        assert!(close(clubs[action][1], diamonds[action][2]));
        assert!(close(clubs[action][2], diamonds[action][1]));
        assert!(close(clubs[action][0], diamonds[action][0]));
    }
}

#[test]
fn timeout_fails_without_a_result() {
    let tree = menu(
        json!([{ "kind": "pot", "pct": 50 }, { "kind": "allin" }]),
        json!([{ "kind": "prevBet", "multiple": 3 }]),
        json!(null),
    );
    let mut spot = turn_spot(["Qs", "Jh", "2h", "5d"], tree, &["AsAh", "Tc9c"], &["KsKh", "8c7c"]);
    spot["solve"]["timeoutMs"] = json!(1);
    spot["solve"]["targetExploitabilityPctPot"] = json!(1e-9);
    spot["solve"]["maxIterations"] = json!(1_000_000);
    assert!(solve(spot).err().unwrap().contains("timed out"));
}

fn lean_menu() -> Value {
    let pct = |p: f64| json!({ "kind": "pot", "pct": p });
    let street = |oop: Vec<Value>, ip: Vec<Value>| json!({ "oop": { "bet": oop, "raise": [pct(60.0)] }, "ip": { "bet": ip, "raise": [pct(60.0)] } });
    json!({ "mode": "menu", "flop": null, "turn": street(vec![pct(66.0)], vec![pct(66.0)]),
        "river": street(vec![pct(50.0), pct(100.0)], vec![pct(66.0)]), "turnDonk": null, "riverDonk": null,
        "addAllInThreshold": 0, "forceAllInThreshold": 0.2, "mergingThreshold": 0, "maxRaisesPerStreet": 1 })
}

fn engine_labels(tree: &ActionTree) -> Vec<String> {
    tree.available_actions().iter().map(|a| format!("{a:?}")).collect()
}

#[test]
fn lean_fold_tree_raises_to_call_plus_60_pct_and_forces_all_in_at_0_2_pot() {
    use solver_bridge::{build_action_tree, spot::Spot};
    let build = |stack: i64| {
        let mut spot = turn_spot(["Qs", "Jh", "2h", "5d"], lean_menu(), &["AsAh"], &["KsKh"]);
        spot["effectiveStack"] = json!(stack);
        let parsed = Spot::parse(&serde_json::to_vec(&spot).unwrap()).unwrap();
        build_action_tree(&parsed, &parsed.check_cards().unwrap()).unwrap()
    };
    let mut deep = build(400);
    assert_eq!(engine_labels(&deep), ["Check", "Bet(66)"]);
    deep.play(Action::Bet(66)).unwrap();
    // raise-to = bet + 0.6 × (pot + 2·bet) = 66 + 0.6 × 232 = 205.2 → 205.
    assert_eq!(engine_labels(&deep), ["Fold", "Call", "Raise(205)"]);
    deep.play(Action::Raise(205)).unwrap();
    assert_eq!(engine_labels(&deep), ["Fold", "Call"], "one raise per street");
    // With 240 behind, raising to 205 would leave 35 ≤ 0.2 × 510 (the pot after the call): all-in instead.
    let mut short = build(240);
    short.play(Action::Bet(66)).unwrap();
    assert_eq!(engine_labels(&short), ["Fold", "Call", "AllIn(240)"]);
    // River: OOP 50%/100%, IP 66% after a check.
    let mut river = build(400);
    river.play(Action::Check).unwrap();
    river.play(Action::Check).unwrap();
    // ActionTree folds the (implicit) river card into the chance node: its actions are the river's.
    assert!(river.is_chance_node());
    assert_eq!(engine_labels(&river), ["Check", "Bet(50)", "Bet(100)"]);
    river.play(Action::Check).unwrap();
    assert_eq!(engine_labels(&river), ["Check", "Bet(66)"]);
}

fn flop_slice_spot() -> Value {
    let pct = |p: f64| json!({ "kind": "pot", "pct": p });
    let street = json!({ "oop": { "bet": [pct(50.0)], "raise": [] }, "ip": { "bet": [pct(50.0)], "raise": [] } });
    json!({ "format": "poker-face-bridge-spot", "version": 1, "id": "test-flop-slices",
        "board": { "flop": ["Ks", "8s", "4d"], "turn": null, "river": null },
        "ranges": [ { "source": "test", "combos": combos(&["KhKd", "AsQs"]) }, { "source": "test", "combos": combos(&["9h9d", "QdJd"]) } ],
        "startingPot": 100, "effectiveStack": 100, "rake": 0,
        "tree": { "mode": "menu", "flop": street, "turn": street, "river": street, "turnDonk": null, "riverDonk": null,
            "addAllInThreshold": 0, "forceAllInThreshold": 0, "mergingThreshold": 0, "maxRaisesPerStreet": 0 },
        "solve": solve_options("first-street") })
}

fn solve_sliced(plan: Value) -> Result<BridgeResult, String> {
    let bytes = serde_json::to_vec(&flop_slice_spot()).unwrap();
    let plan = serde_json::to_vec(&plan).unwrap();
    let mut sink = |_: Value| {};
    solver_bridge::solve_spot_with_slices(&bytes, Some(&plan), &mut Progress(&mut sink))
}

#[test]
fn slice_plans_select_nodes_by_street_depth_and_report_dead_cards() {
    // Kd is held by KhKd, but other pairs survive it, so it is dealt. The river board Qc3h is
    // never reached because Qc is not a listed turn card: it must be reported, not dropped.
    let plan = json!({ "format": "poker-face-bridge-slices", "version": 1, "flop": { "maxDepth": 0 },
        "turn": { "cards": ["2c", "Kd"], "maxDepth": 1, "maxPriorRaises": null },
        "river": { "boards": [["2c", "3h"], ["Qc", "3h"]], "maxDepth": 0, "maxPriorRaises": 0 },
        "subtrees": [["x", "x", "2c", "x", "x", "3h"]], "equity": true });
    let result = solve_sliced(plan).unwrap();
    let slices = result.slices.expect("slices exported");
    let paths: Vec<String> = slices.nodes.iter().map(|n| n.path.join(" ")).collect();
    assert_eq!(paths[0], "", "flop root first");
    assert!(
        paths
            .iter()
            .all(|p| p.is_empty() || p.contains("2c") || p.contains("Kd")),
        "flop depth 0 only: {paths:?}"
    );
    assert!(
        paths.contains(&"x x 2c".to_string())
            && paths.contains(&"x x 2c x".to_string())
            && paths.contains(&"x x 2c b50".to_string())
    );
    assert!(!paths.contains(&"x x 2c x b50".to_string()), "turn depth ≤ 1");
    assert!(paths.contains(&"x x 2c x x 3h".to_string()) && !paths.contains(&"x x 2c x x 3h x".to_string()));
    for node in &slices.nodes {
        assert_eq!(node.strategy.len(), node.actions.len());
        assert!(node.equity.is_some());
        let board: Vec<&str> = node
            .path
            .iter()
            .filter(|t| t.len() == 2 && t.chars().nth(1).is_some_and(|c| "cdhs".contains(c)))
            .map(String::as_str)
            .collect();
        assert_eq!(&node.board[3..], board.as_slice());
    }
    assert_eq!(slices.unreached, ["Qc3h"]);
    let subtree = &slices.subtrees[0];
    assert_eq!(subtree.path, ["x", "x", "2c", "x", "x", "3h"]);
    assert!(matches!(subtree.nodes[0], ResultNode::Player { .. }));
    // Check-check-… river subtree: root, IP after check, two facing-bet nodes and their terminals.
    assert!(subtree.nodes.len() >= 5);
}

#[test]
fn slice_plan_errors_fail_before_solving() {
    let bad_path = json!({ "format": "poker-face-bridge-slices", "version": 1, "flop": null, "turn": null, "river": null,
        "subtrees": [["x", "b999"]], "equity": false });
    assert!(solve_sliced(bad_path).err().unwrap().contains("no action b999"));
    let terminal = json!({ "format": "poker-face-bridge-slices", "version": 1, "flop": null, "turn": null, "river": null,
        "subtrees": [["x", "x"]], "equity": false });
    assert!(solve_sliced(terminal)
        .err()
        .unwrap()
        .contains("must start at a decision node"));
    let unknown = json!({ "format": "poker-face-bridge-slices", "version": 1, "flop": null, "turn": null, "river": null,
        "subtrees": [], "equity": false, "extra": 1 });
    assert!(solve_sliced(unknown).err().unwrap().contains("unknown field"));
}
