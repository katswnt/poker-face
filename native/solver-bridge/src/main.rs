//! `solver-bridge solve <spot.json> --out <result.json> [--threads N]`
//! `solver-bridge estimate <spot.json>` (build the tree, report memory, allocate nothing)
//!
//! Reads a spot (contract v1), solves it with postflop-solver, and writes a result
//! (contract v1). Progress and errors are JSON lines on stderr. On any failure the exit
//! code is nonzero and no output file exists.

use solver_bridge::{solve_spot, Progress};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const MAX_SPOT_BYTES: u64 = 64 * 1024 * 1024;
const USAGE: &str = "usage: solver-bridge solve <spot.json> --out <result.json> [--threads N]\n       solver-bridge estimate <spot.json>";

fn emit(value: serde_json::Value) {
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{value}");
}

fn parse_args(args: &[String]) -> Result<(PathBuf, PathBuf, Option<usize>), String> {
    let mut rest = args.iter();
    if rest.next().map(String::as_str) != Some("solve") {
        return Err(USAGE.into());
    }
    let spot = rest.next().filter(|a| !a.starts_with("--")).ok_or(USAGE)?;
    let (mut out, mut threads) = (None, None);
    while let Some(flag) = rest.next() {
        let value = rest.next().ok_or(USAGE)?;
        match flag.as_str() {
            "--out" if out.is_none() => out = Some(PathBuf::from(value)),
            "--threads" if threads.is_none() => {
                threads = Some(
                    value
                        .parse::<usize>()
                        .ok()
                        .filter(|n| (1..=1024).contains(n))
                        .ok_or("--threads must be 1..1024")?,
                )
            }
            _ => return Err(USAGE.into()),
        }
    }
    Ok((PathBuf::from(spot), out.ok_or(USAGE)?, threads))
}

fn write_atomically(out: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = out.file_name().ok_or("--out needs a file name")?.to_string_lossy();
    let temporary = out.with_file_name(format!(".{name}.{}.partial", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, out)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| format!("cannot write {}: {e}", out.display()))
}

fn read_spot(path: &Path) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?
        .len();
    if size > MAX_SPOT_BYTES {
        return Err(format!("spot file exceeds {MAX_SPOT_BYTES} bytes"));
    }
    fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}

fn run(args: &[String]) -> Result<(), String> {
    if args.len() == 2 && args[0] == "estimate" {
        let estimate = solver_bridge::estimate_spot(&read_spot(Path::new(&args[1]))?)?;
        println!("{estimate}");
        return Ok(());
    }
    let (spot_path, out, threads) = parse_args(args)?;
    if out.exists() {
        return Err(format!(
            "output {} already exists; refusing to overwrite",
            out.display()
        ));
    }
    if let Some(n) = threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .build_global()
            .map_err(|e| e.to_string())?;
    }
    let size = fs::metadata(&spot_path)
        .map_err(|e| format!("cannot read {}: {e}", spot_path.display()))?
        .len();
    if size > MAX_SPOT_BYTES {
        return Err(format!("spot file exceeds {MAX_SPOT_BYTES} bytes"));
    }
    let bytes = fs::read(&spot_path).map_err(|e| format!("cannot read {}: {e}", spot_path.display()))?;
    let mut sink = emit;
    let result = solve_spot(&bytes, &mut Progress(&mut sink))?;
    let json = serde_json::to_vec(&result).map_err(|e| format!("cannot serialize result: {e}"))?;
    write_atomically(&out, &json)?;
    emit(serde_json::json!({
        "type": "done", "out": out.display().to_string(), "iterations": result.iterations,
        "exploitabilityChips": result.exploitability.chips, "exploitabilityPctPot": result.exploitability.pct_pot,
        "reached": result.exploitability.reached, "totalMs": result.timings.total_ms, "peakRssBytes": result.memory.peak_rss_bytes,
    }));
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            emit(serde_json::json!({ "type": "error", "message": message }));
            ExitCode::FAILURE
        }
    }
}
