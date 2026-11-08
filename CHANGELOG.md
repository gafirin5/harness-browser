# Changelog

Semua perubahan penting pada Dorado didokumentasikan di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/) dan [Semantic Versioning](https://semver.org/).
Rilis dibuat dengan `npm run release -- patch|minor|major|X.Y.Z`.

## [0.1.0] - 2026-11-09

- Snapshot Dorado: workspace agent berbasis web (project/worktree/terminal/agent CLI).
- Ekspansi Orca-parity: Worktree Racing, sub-agent `dorado-ctl`, triage CI & issue
  (GitHub/Linear), multimodal (attachment + dikte suara + profil agent),
  Live Preview + Design Mode, Mobile Companion.
- Remote Nodes Federation: node melihat identitas controller-nya.
- Pembaruan in-place (`npm run update`) + sistem penanda versi (build-info,
  riwayat pembaruan, `npm run release`).
