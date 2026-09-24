# Flop float64 storage v1

Locked before binary artifact/checkpoint writes, 2026-09-23. This is an additive
Node-only format for the [vector flop contract](vector-flop-v1-spec.md).

Uncompressed file:

1. Eight ASCII magic bytes `PFFLP001`.
2. Four bytes: unsigned little-endian header byte length, at most 65,536.
3. UTF-8 canonical JSON header with version 1, kind (`policy` or `checkpoint`),
   SHA-256 of the canonical game-identity string, completed iteration, validated solve
   options, and ordered array descriptors (`name`, float64 element `length`).
4. Contiguous little-endian IEEE-754 float64 arrays, in descriptor order. A policy has
   `policy`; a checkpoint has `regrets`, then `strategySums`. Exact lengths must match
   the compiled game's allocated action slots. Physically impossible rows stay zero.
5. Thirty-two raw SHA-256 bytes covering everything before the trailer.

The manifest content hash is this trailer digest, not the gzip transport's hash. Gzip
may differ across Node versions; decompressed bytes must reproduce identically. Maximum
uncompressed file 256 MiB; maximum encoded file 256 MiB; bounded decompression precedes
header parsing/allocation. Reject wrong magic/version/kind/array order/length, truncation,
trailing bytes, checksum mismatch, noncanonical header, wrong game, invalid iterations,
non-finite values, illegal probabilities/padding or out-of-bound regrets/averages.

Checkpoint restoration checks the complete game and algorithm options and resumes the
next completed iteration. It is not interchangeable with a saved average policy. Hashes
detect corruption and bind identities; they are not authenticity signatures.

Writes validate/encode before touching the destination, create an exclusive uniquely
named temporary sibling, fsync it, then rename it onto the explicit destination. A
failure before rename preserves the old destination. Remove only the writer's own
temporary sibling after a failure. This is per-file atomic replacement, not atomic
multi-file catalog publication; catalog hashes must reject mixed versions.

Workers export files inside a fresh job-specific temporary directory. No large policy
arrays are copied through JSON IPC. A controller publishes only completed independently
graded artifacts. Cancellation can retain the last complete requested checkpoint, not
a partially applied iteration. Quality, counts and canonical policy hashes live in a
separate deterministic JSON manifest; wall time and sampled RSS live in run reports.
