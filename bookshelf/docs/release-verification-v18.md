# version18 最終検証記録（2026-09-30 JST）

- 公開URL: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf
- 公開version18 / deployment appgdep_6abc735be2288191b4768b648dd8d663: succeeded
- Sites source: 33632602156157c7f824d8f37086c910907291e0
- GitHub code: e9e7602e286f664b973b41d28667e9285b42a7c9
- branch: feature/digital-bookshelves / PR#1 Draft
- GitHub Actions: https://github.com/yutaro1016-ops/PDF-/actions/runs/36659689685 / completed success / run118
- Clean GitHub checkout: npm dependencies, vendor generation/hash verification, migrations/recovery/thumbnail/color/folder/PDF/API tests, type checking, build, health probe all passed.
- Post-deploy public DB/R2 health probe: OK.
- Post-deploy version:18 / active / environment entries:0. CAPACITY_ENFORCED and ACCOUNT_DELETION_ENABLED default false.
- Added account_lifecycle table is empty. Production account closure was never started.
- Read-only metadata comparison across all returned rows: books52 / shelves9 unchanged before/after deployment. This is not a hash verification of production PDF bytes or a full text-index backup.
- Source checkout clean after publication. PDF.js assets reproduced from the exact existing5.6.205 package with all200 file hashes verified.

## Verified without private user data
Self-authored valid PDF normal/32MB+: API registration, bounded8MB upload, file retrieval, same PDF.js extraction, indexing and targeted search.
Actual first-page raster rendering for both PDFs.
Local independent restore: unchanged PDF bytes/ID, search index, shelf name/order/color.
SQLite+mock R2: ownership separation, all/single/multiple search, sharing copy/resume/revoke/ranges/cleanup,100-book batches, concurrent quota reservation, pending-share quota release, disabled closure, nonce/confirmation/other-user refusal, closure outage retry and other-user copy protection.
File System Access mock adapters: interrupted folder save, per-book resume, metadata change rejection. This is not actual browser QA.
Malformed cached-image decode failure triggers first-page regeneration. This fixes a demonstrable code path; the reported user's cause remains unconfirmed.

## Not verified / not enabled
Actual PC/tablet/phone browser UI, actual ChatGPT second-account isolation,1GB PDF, production full restore and encrypted independent backups, actual browser folder write and notification delivery.
Quota enforcement and closure stay OFF pending production acceptance. Long-running uploads/expired lease races, re-auth freshness, backup erasure policy and retention need review before enabling closure.
Automated backups cannot be activated without supported full-export access and an approved storage/key/notification setup.
Manual health workflow exists; periodic monitoring is not active on the default branch. No external notification contract.
GitHub-to-Sites unattended publish credentials/API remain unverified; deployment currently uses authenticated same-Site workflow.
No sale, payment setup, trial expiry enforcement, external contract or existing user PDF deletion.

## Resume
See sales-readiness-audit.md and operations-and-migration.md.
First obtain platform confirmation of DB/R2 whole export/recovery points/retention/permissions and current account limits; arrange approved test accounts/devices; perform independent full recovery and UI acceptance.
Do not enable deletion/quota or merge a scheduled monitor merely because code tests pass.
