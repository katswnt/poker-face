//! Local poker-face.1 repair. Complete-tree, perfect-recall scoring in f64.
//! Training and the historical CfrNash API are unchanged. Chance edges have
//! equal probability, matching TreeBuilder's explicit-ticket representation.
use crate::*;
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct ExactGrade {
    pub values: Vec<f64>,
    pub best_responses: Vec<f64>,
    pub score: f64,
}

impl<P: RefProf> CfrExact for P {}

pub trait CfrExact: RefProf {
    /// `normalize=false` is a diagnostic evaluation of the raw f32 row measure,
    /// not a probability-strategy certificate. Both paths use f64 arithmetic.
    fn exact_full_tree(
        &self,
        tree: &Tree<Self::T, Self::E, Self::G, Self::I>,
        normalize: bool,
    ) -> Result<ExactGrade, String> {
        if tree.n() == 0 { return Err("empty tree".into()); }
        let order = tree.bfs();
        if order.len() != tree.n() { return Err("disconnected tree".into()); }
        let post = tree.postorder();
        let mut groups = BTreeMap::<Self::I, Vec<usize>>::new();
        let mut policies = BTreeMap::<Self::I, Vec<f64>>::new();
        let mut edges = vec![Vec::<(usize, Self::E)>::new(); tree.n()];
        for node in tree.all() {
            let id = node.index().index();
            let turn = node.game().turn();
            if turn.is_terminal() {
                if node.width() != 0 { return Err("nonleaf terminal".into()); }
                continue;
            }
            let choices = node.info().choices().collect::<Vec<_>>();
            if choices.is_empty() || node.width() != choices.len() {
                return Err("incomplete legal actions".into());
            }
            for edge in &choices {
                let child = node.step(edge).ok_or("missing legal action")?;
                edges[id].push((child.index().index(), *edge));
            }
            if turn.is_chance() { continue; }
            let members = groups.entry(*node.info()).or_default();
            if let Some(first) = members.first() {
                if node.at(petgraph::graph::NodeIndex::new(*first)).game().turn() != turn {
                    return Err("mixed information-set owners".into());
                }
            }
            members.push(id);
            if !policies.contains_key(node.info()) {
                let raw = choices.iter().map(|edge| f64::from(self.averaged_policy(node.info(), edge))).collect::<Vec<_>>();
                let sum: f64 = raw.iter().sum();
                if !sum.is_finite() || sum <= 0.0 || raw.iter().any(|p| !p.is_finite() || *p < 0.0 || *p > 1.0) {
                    return Err("invalid probability row".into());
                }
                policies.insert(*node.info(), raw.iter().map(|p| if normalize { p / sum } else { *p }).collect());
            }
        }
        let root = order[0].index();
        let mut values = Vec::new();
        let mut best_responses = Vec::new();
        for p in 0..Self::T::players() {
            let hero = Self::T::from(p);
            let mut signatures = BTreeMap::<Self::I, Vec<(Self::I, Self::E)>>::new();
            let mut depths = BTreeMap::<usize, Vec<Self::I>>::new();
            let mut reach = vec![0.0; tree.n()];
            reach[root] = 1.0;
            for &index in &order {
                let node = tree.at(index);
                let id = index.index();
                let turn = node.game().turn();
                if turn == hero {
                    let mut signature = node.decisions().filter(|(t, _, _)| *t == hero)
                        .map(|(_, i, e)| (i, e)).collect::<Vec<_>>();
                    signature.reverse();
                    match signatures.get(node.info()) {
                        Some(previous) if previous != &signature => return Err("imperfect recall".into()),
                        Some(_) => {},
                        None => {
                            depths.entry(signature.len()).or_default().push(*node.info());
                            signatures.insert(*node.info(), signature);
                        }
                    }
                }
                for (a, (child, _)) in edges[id].iter().enumerate() {
                    let probability = if turn.is_chance() { 1.0 / edges[id].len() as f64 }
                        else if turn == hero { 1.0 } else { policies[node.info()][a] };
                    reach[*child] = reach[id] * probability;
                }
            }
            // Evaluate leaves first. During optimization, all later own decisions
            // have already been fixed, by perfect recall and own-history depth.
            let evaluate = |response: &BTreeMap<Self::I, usize>| -> Vec<f64> {
                let mut value = vec![0.0; tree.n()];
                for &index in &post {
                    let node = tree.at(index);
                    let id = index.index();
                    let turn = node.game().turn();
                    value[id] = if turn.is_terminal() { f64::from(node.game().payoff(hero)) }
                        else if turn == hero && response.contains_key(node.info()) {
                            value[edges[id][response[node.info()]].0]
                        } else {
                            edges[id].iter().enumerate().map(|(a, (child, _))| {
                                let probability = if turn.is_chance() { 1.0 / edges[id].len() as f64 }
                                    else { policies[node.info()][a] };
                                probability * value[*child]
                            }).sum()
                        };
                }
                value
            };
            let mut response = BTreeMap::new();
            let mut value = evaluate(&response);
            values.push(value[root]);
            for infos in depths.values().rev() {
                for info in infos {
                    let members = &groups[info];
                    let mut best = (0, f64::NEG_INFINITY);
                    for a in 0..edges[members[0]].len() {
                        let candidate: f64 = members.iter().map(|id| reach[*id] * value[edges[*id][a].0]).sum();
                        if candidate > best.1 { best = (a, candidate); }
                    }
                    response.insert(*info, best.0);
                }
                value = evaluate(&response);
            }
            best_responses.push(value[root]);
        }
        if values.iter().chain(&best_responses).any(|v| !v.is_finite()) {
            return Err("nonfinite full-tree value".into());
        }
        Ok(ExactGrade { score: best_responses.iter().sum::<f64>() / Self::T::players() as f64, values, best_responses })
    }
}
