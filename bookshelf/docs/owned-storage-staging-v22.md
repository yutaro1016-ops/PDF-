# v22 owned storage preparation

## Implemented, independently tested; not installed in Sites
`migration/owned-store.mjs` is a reusable D1 repository and R2 adapter. Five staging tables persist approved identity mappings, owner status, deletion ledger, candidate operations and visible generations. Server-owned proof/session verification remains a prerequisite: fixture receipts are not real identity verification. Sites headers are not accepted as identity proofs.

Conditional D1 batches keep old visible data during replacement, reject superseded publications, persist tombstones for owners not yet restored, and prevent same-revision conflicting deletion evidence atomically. Unknown storage outcomes block subsequent owner writes without a timeout unlock. Late physical objects may remain in R2 but cannot acquire a visible pointer after blocking. This is not proof of physical deletion or permission to force recovery.

The R2 adapter reuses the existing FixedLengthStream length checker, supports Range reads, journals multipart upload IDs and immutable generation keys. Multipart part metadata, total-length enforcement, quota reservations and import/upload job orchestration must still be supplied by the existing application integration; these are not production-complete endpoints. Admin enumeration/abort, authoritative fencing and independent backup privileges are not established. A read already returned is not revoked per streamed byte. Existing production storage keys and PDF IDs have not been changed.

Native local Miniflare D1/R2 tests cover mapping conflicts, existing access-boundary integration, foreign owner access, pending replacement, superseded/unknown operations, persisted deletion/restart barriers, native put/Range and multipart complete. They use synthetic owners/data and do not validate a deployed Cloudflare account or Sites browser.

## Tool repairs
The SQLite generation model now preserves the previous visible object while replacement is pending and persists deletion for absent owners. Recovery input rejects invalid envelope/version types. AES-GCM streaming now checks actual plaintext length and source identity/size/timestamps before publication, detecting ordinary concurrent truncation/change. This does not establish an atomic DB/object snapshot, hostile-filesystem protection or crash-proof plaintext cleanup.

## Still requires operational authority
Formal source-wide acquisition and consistent DB/PDF/image snapshots remain unconfirmed; user export still omits original owner identity, shares, import jobs, lifecycle state and thumbnail cache. No missing data is fabricated. Real auth proof collection, verified mapping approval, latest independently protected deletion ledger, encrypted backup destination/key separation, retention/restore drills and monitoring delivery require actual operational configuration. No contracts, notifications, production writes, cutover or force unlock were performed. Existing chatgpt.site URL portability remains unconfirmed.

## Acceptance and release
Previously received Dell Chrome, Nothing Phone (2a) Chrome and alternate-account success reports remain accepted as user reports, including direct index/shelf/image refusal. No repeat user work is requested. Tablet hardware remains unavailable. Published v22 is unchanged; staging tools are not deployed. All three production enforcement flags remain unchanged/off. Sales remain on hold pending formal recovery and actual operating controls.
