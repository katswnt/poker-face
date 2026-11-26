use mccfr::*;
use monge::Support;
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::OnceLock,
    time::Instant,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    version: u32,
    id: String,
    fixture_hash: String,
    nodes: Vec<Record>,
    information_sets: Vec<Definition>,
    deals: Vec<Deal>,
    profile: Option<Vec<Vec<f64>>>,
}
#[derive(Deserialize)]
struct Record {
    kind: String,
    player: i32,
    info: i32,
    children: Vec<usize>,
    utility: Vec<f64>,
}
#[derive(Deserialize)]
struct Definition {
    key: String,
    player: i32,
    actions: Vec<String>,
}
#[derive(Deserialize)]
struct Deal {
    node: usize,
    tickets: usize,
    probability: f64,
}
static INPUT: OnceLock<Input> = OnceLock::new();
fn input() -> &'static Input {
    INPUT.get().expect("validated input installed")
}

fn validate(a: &Input) -> Result<usize, String> {
    if a.version != 1
        || a.nodes.is_empty()
        || a.nodes.len() > 100_000
        || a.information_sets.len() > 10_000
    {
        return Err("version or size limit".into());
    }
    if let Some(rows) = &a.profile {
        if rows.len() != a.information_sets.len()
            || rows.iter().enumerate().any(|(i, row)| {
                row.len() != a.information_sets[i].actions.len()
                    || row
                        .iter()
                        .any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0 || (*v as f32) as f64 != *v)
                    || (row.iter().sum::<f64>() - 1.0).abs() > 1e-6
            })
        {
            return Err("invalid supplied probability profile".into());
        }
    }
    let mut keys = HashSet::new();
    for d in &a.information_sets {
        if d.key.is_empty()
            || !keys.insert(&d.key)
            || !(0..3).contains(&d.player)
            || d.actions.is_empty()
            || d.actions.len() > 10
            || d.actions.iter().any(String::is_empty)
            || d.actions.iter().collect::<HashSet<_>>().len() != d.actions.len()
        {
            return Err("invalid information-set definition".into());
        }
    }
    let mut seen_infos = HashSet::new();
    for (i, n) in a.nodes.iter().enumerate() {
        if n.children.iter().any(|child| *child >= a.nodes.len()) {
            return Err("unknown child".into());
        }
        match n.kind.as_str() {
            "terminal"
                if n.children.is_empty()
                    && n.utility.len() == 3
                    && n.info == -1
                    && n.player == -1 =>
            {
                if n.utility
                    .iter()
                    .any(|v| !v.is_finite() || (*v as f32) as f64 != *v)
                    || n.utility.iter().sum::<f64>().abs() > 1e-9
                {
                    return Err("invalid zero-sum payoff".into());
                }
            }
            "player" if n.info >= 0 && n.utility.is_empty() => {
                let d = a
                    .information_sets
                    .get(n.info as usize)
                    .ok_or("unknown information set")?;
                if d.player != n.player || d.actions.len() != n.children.len() {
                    return Err("player/action mismatch".into());
                }
                seen_infos.insert(n.info as usize);
            }
            "chance"
                if i == 0
                    && !n.children.is_empty()
                    && n.children.len() <= 100_000
                    && n.utility.is_empty()
                    && n.info == -1
                    && n.player == -1 => {}
            _ => return Err("invalid node kind or fields".into()),
        }
    }
    if seen_infos.len() != a.information_sets.len() {
        return Err("unused information set".into());
    }
    if a.nodes[0].kind == "chance" {
        let mut expected = Vec::new();
        let mut roots = HashSet::new();
        let total = a.nodes[0].children.len();
        for d in &a.deals {
            if d.tickets == 0
                || d.tickets > total
                || !roots.insert(d.node)
                || d.tickets as f64 / total as f64 != d.probability
            {
                return Err("chance measure mismatch".into());
            }
            expected.extend(std::iter::repeat_n(d.node, d.tickets));
        }
        if expected != a.nodes[0].children {
            return Err("chance ticket mismatch".into());
        }
    } else if !a.deals.is_empty() {
        return Err("unexpected chance deals".into());
    }
    fn visit(i: usize, a: &Input, marks: &mut [u8], counts: &mut [usize]) -> Result<usize, String> {
        if marks[i] == 1 {
            return Err("cycle".into());
        }
        if marks[i] == 2 {
            return Ok(counts[i]);
        }
        marks[i] = 1;
        let mut count = 1usize;
        for child in &a.nodes[i].children {
            count = count
                .checked_add(visit(*child, a, marks, counts)?)
                .ok_or("count overflow")?;
            if count > 1_000_000 {
                return Err("expanded tree too large".into());
            }
        }
        marks[i] = 2;
        counts[i] = count;
        Ok(count)
    }
    let mut marks = vec![0; a.nodes.len()];
    let count = visit(0, a, &mut marks, &mut vec![0; a.nodes.len()])?;
    if marks.contains(&0) {
        return Err("unreachable node".into());
    }
    Ok(count)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Turn(usize);
impl From<usize> for Turn {
    fn from(i: usize) -> Self {
        assert!(i < 3);
        Self(i)
    }
}
impl CfrTurn for Turn {
    fn chance() -> Self {
        Self(3)
    }
    fn terminal() -> Self {
        Self(4)
    }
    fn players() -> usize {
        3
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Edge(usize);
impl Support for Edge {}
impl CfrEdge for Edge {}
#[derive(Clone, Copy)]
struct Game(usize);
impl CfrGame for Game {
    type E = Edge;
    type T = Turn;
    fn root() -> Self {
        Self(0)
    }
    fn turn(&self) -> Turn {
        let n = &input().nodes[self.0];
        match n.kind.as_str() {
            "chance" => Turn::chance(),
            "terminal" => Turn::terminal(),
            _ => Turn(n.player as usize),
        }
    }
    fn apply(&self, edge: Edge) -> Self {
        Self(input().nodes[self.0].children[edge.0])
    }
    fn payoff(&self, turn: Turn) -> f32 {
        input().nodes[self.0].utility[turn.0] as f32
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Public(usize);
impl CfrPublic for Public {
    type E = Edge;
    type T = Turn;
    fn choices(&self) -> impl Iterator<Item = Edge> + use<> {
        (0..self.0).map(Edge)
    }
    fn subgame(&self) -> Vec<Edge> {
        Vec::new()
    } // Full history is in the lossless info ID.
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Secret(usize);
impl Support for Secret {}
impl CfrSecret for Secret {}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Info(usize);
impl CfrInfo for Info {
    type E = Edge;
    type T = Turn;
    type X = Public;
    type Y = Secret;
    fn public(&self) -> Public {
        let a = input();
        Public(if self.0 < a.information_sets.len() {
            a.information_sets[self.0].actions.len()
        } else if self.0 == a.information_sets.len() {
            a.nodes[0].children.len()
        } else {
            0
        })
    }
    fn secret(&self) -> Secret {
        Secret(self.0)
    }
}
struct Encoder;
impl CfrEncoder for Encoder {
    type T = Turn;
    type E = Edge;
    type G = Game;
    type I = Info;
    const CHECK_RECALL: bool = true;
    fn seed(&self, game: &Game) -> Info {
        self.resume(std::iter::empty(), game)
    }
    fn resume<P: IntoIterator<Item = Edge>>(&self, _: P, game: &Game) -> Info {
        let n = &input().nodes[game.0];
        Info(match n.kind.as_str() {
            "player" => n.info as usize,
            "chance" => input().information_sets.len(),
            _ => input().information_sets.len() + 1,
        })
    }
}
struct Uniform;
impl CfrRule for Uniform {
    type T = Turn;
    type E = Edge;
    type G = Game;
    type I = Info;
}
impl RefProf for Uniform {
    fn averaged_distribution(&self, info: &Info) -> Policy<Edge> {
        info.choices()
            .map(|edge| {
                let p = input()
                    .profile
                    .as_ref()
                    .map(|rows| rows[info.0][edge.0] as f32)
                    .unwrap_or(1.0 / info.choices().count() as f32);
                (edge, p)
            })
            .collect()
    }
    fn t(&self) -> usize {
        0
    }
    fn sum_regret(&self) -> f32 {
        0.0
    }
    fn cum_weight(&self, _: &Info, _: &Edge) -> f32 {
        1.0
    }
    fn cum_regret(&self, _: &Info, _: &Edge) -> f32 {
        0.0
    }
    fn cum_payoff(&self, _: &Info, _: &Edge) -> f32 {
        0.0
    }
    fn cum_visits(&self, _: &Info, _: &Edge) -> u32 {
        0
    }
}
impl CfrSampling for Uniform {
    fn walker(&self) -> Turn {
        Turn(0)
    }
    fn increment(&mut self) {}
}
fn full_tree() -> Tree<Turn, Edge, Game, Info> {
    TreeBuilder::<_, _, _, _, _, _, VanillaSampling>::new(
        &Encoder,
        &Uniform,
        Game::root(),
        20261122,
    )
    .build()
}
#[derive(Default)]
struct Profile {
    encounters: HashMap<Info, HashMap<Edge, Encounter>>,
    epochs: usize,
}
impl CfrData for Profile {
    type T = Turn;
    type E = Edge;
    type G = Game;
    type I = Info;
    fn encounters_ref(&self) -> &HashMap<Info, HashMap<Edge, Encounter>> {
        &self.encounters
    }
    fn encounters_mut(&mut self) -> &mut HashMap<Info, HashMap<Edge, Encounter>> {
        &mut self.encounters
    }
    fn epochs_ref(&self) -> usize {
        self.epochs
    }
    fn epochs_mut(&mut self) -> &mut usize {
        &mut self.epochs
    }
    fn store_metrics(&self) -> Option<&Metrics> {
        None
    }
}
struct Trainer<S> {
    profile: Profile,
    scheme: std::marker::PhantomData<S>,
}
impl<S: SamplingScheme + Send + Sync> Solver for Trainer<S> {
    type T = Turn;
    type E = Edge;
    type G = Game;
    type I = Info;
    type X = Public;
    type Y = Secret;
    type P = Profile;
    type N = Encoder;
    type W = LinearWeight;
    type R = LinearRegret;
    type S = S;
    fn batch_size() -> usize {
        1
    }
    fn encoder(&self) -> &Encoder {
        &Encoder
    }
    fn profile(&self) -> &Profile {
        &self.profile
    }
    fn storage(&mut self) -> &mut Profile {
        &mut self.profile
    }
    fn advance(&mut self) {
        self.profile.increment();
    }
    fn tree(&self, _: usize) -> Tree<Turn, Edge, Game, Info> {
        TreeBuilder::<_, _, _, _, _, _, S>::new(&Encoder, &self.profile, Game::root(), 20261122)
            .build()
    }
}
fn train<S: SamplingScheme + Send + Sync>() -> Profile {
    let mut solver = Trainer::<S> {
        profile: Profile::default(),
        scheme: std::marker::PhantomData,
    };
    for _ in 0..100_000 {
        solver.step();
    }
    solver.profile
}
fn report<P: RefProf<T = Turn, E = Edge, G = Game, I = Info>>(
    profile: &P,
    tree: &Tree<Turn, Edge, Game, Info>,
    start: Instant,
    mode: &str,
) -> Result<(), String> {
    let grade = profile.exact_full_tree(tree, true)?;
    let raw_grade = profile.exact_full_tree(tree, false)?;
    let raw: Vec<Vec<f64>> = (0..input().information_sets.len())
        .map(|i| {
            Info(i)
                .choices()
                .map(|e| f64::from(profile.averaged_policy(&Info(i), &e)))
                .collect()
        })
        .collect();
    let normalized: Vec<Vec<f64>> = raw
        .iter()
        .map(|row| {
            let sum: f64 = row.iter().sum();
            row.iter().map(|p| p / sum).collect()
        })
        .collect();
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return Err("RSS unavailable".into());
    }
    let rss = unsafe { usage.assume_init() }.ru_maxrss as u64;
    println!(
        "{}",
        serde_json::json!({
            "version": 2, "id": input().id, "fixtureHash": input().fixture_hash,
            "upstreamCommit": "72360adc7fbc6afa4119be3aefcc0e990d3789a7", "crateVersion": "1.2.0-poker-face.1",
            "mode": mode, "epochs": profile.t(), "treeSeed": 20261122, "workers": 1,
            "fullNodeCount": tree.n(), "rawProfile": raw, "profile": normalized,
            "values": grade.values, "bestResponses": grade.best_responses, "score": grade.score,
            "rawValues": raw_grade.values, "rawBestResponses": raw_grade.best_responses, "rawScore": raw_grade.score,
            "elapsedMs": start.elapsed().as_secs_f64() * 1000.0,
            "peakRssBytes": if cfg!(target_os = "macos") { rss } else { rss * 1024 }
        })
    );
    Ok(())
}
fn run() -> Result<(), String> {
    let start = Instant::now();
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("input byte limit".into());
    }
    let a: Input = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let expected = validate(&a)?;
    INPUT.set(a).map_err(|_| "input already installed")?;
    let tree = full_tree();
    if tree.n() != expected {
        return Err("incomplete full tree".into());
    }
    Uniform.exact_full_tree(&tree, true)?; // Also rejects imperfect recall before any training.
    let mode = std::env::args().nth(1).unwrap_or_else(|| "uniform".into());
    if std::env::args().count() > 2 {
        return Err("unexpected arguments".into());
    }
    match mode.as_str() {
        "uniform" if input().profile.is_none() => report(&Uniform, &tree, start, &mode),
        "profile" if input().profile.is_some() => report(&Uniform, &tree, start, &mode),
        "external" | "pluribus"
            if input().id == "three-player-river-v1" && input().profile.is_none() =>
        {
            let profile = if mode == "external" {
                train::<ExternalSampling>()
            } else {
                train::<PluribusSampling>()
            };
            report(&profile, &tree, start, &mode)
        }
        _ => Err("unsupported mode or fixture".into()),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn witness() -> Input {
        serde_json::from_str(r#"{"version":1,"id":"witness","fixtureHash":"x","deals":[],"informationSets":[{"key":"first","player":0,"actions":["a","b"]},{"key":"later","player":0,"actions":["c","d"]}],"nodes":[{"kind":"player","player":0,"info":0,"children":[2,1],"utility":[]},{"kind":"player","player":0,"info":1,"children":[3,4],"utility":[]},{"kind":"terminal","player":-1,"info":-1,"children":[],"utility":[1,-0.5,-0.5]},{"kind":"terminal","player":-1,"info":-1,"children":[],"utility":[-10,5,5]},{"kind":"terminal","player":-1,"info":-1,"children":[],"utility":[10,-5,-5]}]}"#).unwrap()
    }
    #[test]
    fn sequential_best_response_optimizes_later_decisions() {
        assert!(INPUT.set(witness()).is_ok());
        let tree = full_tree();
        let br = Uniform.exact_full_tree(&tree, true).unwrap().best_responses[0];
        assert_eq!(br, 10.0);
    }
    #[test]
    fn accepts_complete_finite_tree() {
        assert!(validate(&witness()).is_ok());
    }
    #[test]
    fn rejects_cycles_actions_players_and_nonzero_sum() {
        let mut a = witness();
        a.nodes[1].children[0] = 0;
        assert!(validate(&a).is_err());
        let mut a = witness();
        a.nodes[1].children.pop();
        assert!(validate(&a).is_err());
        let mut a = witness();
        a.nodes[1].player = 2;
        assert!(validate(&a).is_err());
        let mut a = witness();
        a.nodes[2].utility[0] = 2.0;
        assert!(validate(&a).is_err());
        let mut a = witness();
        a.nodes[1].children[0] = 99;
        assert!(validate(&a).is_err());
    }
    #[test]
    fn rejects_changed_ticket_measure() {
        let mut a = witness();
        a.deals.push(Deal {
            node: 1,
            tickets: 1,
            probability: 1.0,
        });
        assert!(validate(&a).is_err());
    }
}
