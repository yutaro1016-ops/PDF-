"""SQLite-only experiment, never wired to production. Object uploads are immutable
operation-specific candidates. Visibility requires an atomic current-token commit.
It does NOT abort remote operations or certify remote deletion completion.
"""
import uuid

def initialize(db):
    db.executescript('''CREATE TABLE owners(id TEXT PRIMARY KEY,blocked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE candidates(owner TEXT,pdf TEXT,token TEXT,visible_key TEXT,PRIMARY KEY(owner,pdf));''')

def begin(db,owner,pdf):
    token=str(uuid.uuid4())
    with db:
        if db.execute('SELECT blocked FROM owners WHERE id=?',(owner,)).fetchone()!=(0,):raise ValueError('Owner blocked or unknown')
        db.execute('INSERT INTO candidates VALUES(?,?,?,NULL) ON CONFLICT(owner,pdf) DO UPDATE SET token=excluded.token',(owner,pdf,token))
    return token

def commit(db,owner,pdf,token):
    # One conditional SQL write, not a check followed by an unconditional update.
    with db:
        changed=db.execute('UPDATE candidates SET visible_key=? WHERE owner=? AND pdf=? AND token=? AND EXISTS(SELECT 1 FROM owners WHERE id=? AND blocked=0)',(token,owner,pdf,token,owner)).rowcount
    return changed==1

def block(db,owner):
    with db:
        db.execute('INSERT INTO owners VALUES(?,1) ON CONFLICT(id) DO UPDATE SET blocked=1',(owner,))
        db.execute('UPDATE candidates SET visible_key=NULL WHERE owner=?',(owner,))

def restore_exclusions(db,latest_deleted_owners):
    # Operator-provided latest independent ledger, authority/freshness verified elsewhere.
    for owner in latest_deleted_owners:block(db,owner)
