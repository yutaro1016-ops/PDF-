import {env} from 'cloudflare:workers';
export const PROPOSED_BYTES=5000000000;
export function capacityEnforced(){return (env as unknown as Record<string,unknown>).CAPACITY_ENFORCED==='true';}
export function closureEnabled(){return (env as unknown as Record<string,unknown>).ACCOUNT_DELETION_ENABLED==='true';}
// Embedded in INSERT ... SELECT so checking and reservation are atomic in SQLite.
export const ACTIVE_ACCOUNT_SQL="NOT EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=? AND status!='active')";
export const USED_BYTES_SQL="(SELECT COALESCE(SUM(file_size),0) FROM books WHERE user_id=?) + (SELECT COALESCE(SUM(CAST(json_extract(i.metadata,'$.file_size') AS INTEGER)),0) FROM import_items i JOIN import_jobs j ON j.id=i.job_id LEFT JOIN books b ON b.id=i.target_id WHERE j.user_id=? AND j.status='pending' AND i.status!='done' AND b.id IS NULL)";
