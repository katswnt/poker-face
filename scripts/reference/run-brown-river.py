#!/usr/bin/env python3
"""Run the pinned noambrown/poker_solver river model as an offline referee.

This adapter imports the reference repository from a caller-supplied checkout. It does
not copy or link reference code into Poker Face. The naive showdown path is deliberate:
the pinned vector shortcut raises KeyError when the two players have unequal strength
sets, while the repository's own naive implementation handles those ranges correctly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


PINNED_COMMIT = "6a10442877ffc8fd28af93e16e279b9bbdd97b2a"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--solver-dir", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--strategy-out", required=True, type=Path)
    parser.add_argument("--result-out", required=True, type=Path)
    parser.add_argument("--iterations", required=True, type=int)
    args = parser.parse_args()

    if args.iterations <= 0:
        raise SystemExit("--iterations must be positive")
    source_dir = args.solver_dir / "python" / "src"
    if not source_dir.is_dir():
        raise SystemExit(f"Reference source directory does not exist: {source_dir}")
    actual_commit = subprocess.run(
        ["git", "-C", str(args.solver_dir), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if actual_commit != PINNED_COMMIT:
        raise SystemExit(f"Reference checkout is {actual_commit}; expected {PINNED_COMMIT}")
    sys.path.insert(0, str(source_dir))

    from algorithms.naive_eval import (  # pylint: disable=import-outside-toplevel
        best_response_value_naive,
        exploitability_naive,
    )
    from algorithms.vector_cfr import (  # pylint: disable=import-outside-toplevel
        VectorCFRConfig,
        VectorCFRTrainer,
    )
    from cli.run_river_exploitability import write_strategy_json  # pylint: disable=import-outside-toplevel
    from games.river_holdem import RiverHoldemConfig, RiverHoldemGame  # pylint: disable=import-outside-toplevel

    data = json.loads(args.config.read_text(encoding="utf-8"))
    players = data["players"]
    config = RiverHoldemConfig(
        board=tuple(data["board"]),
        pot=int(data["pot"]),
        stacks=(int(data["stack"]), int(data["stack"])),
        bet_sizes=tuple(data["bet_sizes"]),
        oop_first_bets=tuple(data["oop_first_bets"]),
        ip_first_bets=tuple(data["ip_first_bets"]),
        oop_first_raises=tuple(data["oop_first_raises"]),
        ip_first_raises=tuple(data["ip_first_raises"]),
        oop_next_raises=tuple(data["oop_next_raises"]),
        ip_next_raises=tuple(data["ip_next_raises"]),
        include_all_in=bool(data["include_all_in"]),
        max_raises=int(data["max_raises"]),
        ranges=(tuple(players[0]["hands"]), tuple(players[1]["hands"])),
        range_weights=(tuple(players[0]["weights"]), tuple(players[1]["weights"])),
    )
    game = RiverHoldemGame(config)
    trainer = VectorCFRTrainer(
        game,
        VectorCFRConfig(
            use_plus=False,
            linear_weighting=False,
            alternating=True,
            use_naive_eval=True,
        ),
    )
    trainer.run(args.iterations)
    profile = trainer.average_strategy_profile()
    exploitability = exploitability_naive(game, profile)
    best_response_values = [
        best_response_value_naive(game, 0, profile[1]),
        best_response_value_naive(game, 1, profile[0]),
    ]
    write_strategy_json(args.strategy_out, game, profile)
    strategy_bytes = args.strategy_out.read_bytes()
    result = {
        "source": "noambrown/poker_solver",
        "commit": PINNED_COMMIT,
        "license": "MIT",
        "game": "river_nlth",
        "algorithm": "alternating-vector-cfr-naive-showdown",
        "iterations": args.iterations,
        "constantSumBestResponseValue": best_response_values,
        "exploitability": exploitability,
        "exploitabilityConvention": "(BR0 + BR1 - starting pot) / 2",
        "exploitabilityUnits": "chips-per-hand",
        "strategySha256": hashlib.sha256(strategy_bytes).hexdigest(),
        "notes": [
            "The reference counts an opening bet in max_raises, so 2 means one later raise.",
            "Its utilities include the 100-chip starting pot as a constant sum; subtracting 50 chips per player gives Poker Face net-from-hand-start utilities.",
            "Its vector showdown shortcut fails on this unequal-strength fixture, so this run uses the repository's independent naive showdown path.",
        ],
    }
    result_text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    args.result_out.write_text(result_text, encoding="utf-8")
    print(result_text, end="")


if __name__ == "__main__":
    main()
