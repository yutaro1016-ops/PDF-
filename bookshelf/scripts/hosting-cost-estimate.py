"""Planning estimate, not a quote. USD prices checked 2026-10-01; JPY=150 assumption.
Both options use paid Workers + standard R2. B adds Supabase Pro for Auth/Postgres.
No network, credentials, paid resources, or billing setup.
"""
import json, math

def estimate(users, gb_per_user, backup_copies=2, jpy_per_usd=150):
    # Include DB dump copies in R2. Index size is an unmeasured 5% assumption.
    pdf_gb = users * gb_per_user
    db_gb = pdf_gb * 0.05
    r2_gb = pdf_gb * (1 + backup_copies) + db_gb * backup_copies
    r2 = math.ceil(max(0, r2_gb - 10)) * 0.015
    # Assumed requests/CPU/rows/operations remain inside included monthly quotas.
    a = 5 + r2 + max(0, db_gb - 5) * 0.75
    # Daily full logical DB dump to R2 plus one DB-sized volume of API reads.
    # PDF transfers go directly through Workers/R2, not Supabase.
    db_egress_gb = db_gb * 31
    b = 5 + 25 + r2 + max(0, db_gb - 8) * 0.125 + max(0, db_egress_gb - 250) * 0.09
    return {'users': users, 'pdfGBPerUser': gb_per_user, 'pdfGB': pdf_gb,
            'dbGBAssumed': db_gb, 'r2GBWithTwoBackups': r2_gb,
            'supabaseDBEgressGBPerMonth': db_egress_gb,
            'cloudflareUSD': round(a, 2), 'supabaseR2USD': round(b, 2),
            'cloudflareJPY': round(a * jpy_per_usd), 'supabaseR2JPY': round(b * jpy_per_usd),
            'singleD1NeedsCapacityReview': db_gb >= 10,
            'monthlyGrossJPY': users * 500, 'annualPlanMonthlyGrossJPY': round(users * 5000 / 12)}

if __name__ == '__main__':
    print(json.dumps([estimate(n, gb) for gb in (1, 5) for n in (10, 50, 100)], indent=2))
