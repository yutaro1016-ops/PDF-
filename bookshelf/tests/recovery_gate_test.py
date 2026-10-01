import datetime,importlib.util,pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
model=load('generation','migration/generation-model.py');gate=load('gate','scripts/recovery-gate.py')
class RecoveryTest(unittest.TestCase):
    def test_pending_update_preserves_previous_and_absent_owner_stays_blocked(self):
        db=sqlite3.connect(':memory:');model.initialize(db);db.execute("INSERT INTO owners VALUES('a',0)");db.commit()
        token=model.begin(db,'a','pdf');model.commit(db,'a','pdf',token)
        model.begin(db,'a','pdf')
        self.assertEqual(db.execute('SELECT visible_key FROM candidates').fetchone()[0],token)
        model.restore_exclusions(db,['not-yet-restored'])
        with self.assertRaises(ValueError):model.begin(db,'not-yet-restored','pdf')
        self.assertEqual(db.execute("SELECT blocked FROM owners WHERE id='not-yet-restored'").fetchone()[0],1)
        db.close()
    def test_old_completion_and_deletion_cannot_republish(self):
        db=sqlite3.connect(':memory:');model.initialize(db);db.execute("INSERT INTO owners VALUES('a',0)");db.commit()
        old=model.begin(db,'a','pdf');new=model.begin(db,'a','pdf')
        self.assertFalse(model.commit(db,'a','pdf',old));self.assertTrue(model.commit(db,'a','pdf',new))
        model.block(db,'a');self.assertFalse(model.commit(db,'a','pdf',new))
        self.assertIsNone(db.execute('SELECT visible_key FROM candidates').fetchone()[0])
        with self.assertRaises(ValueError):model.begin(db,'a','pdf')
        db.close()
    def test_restore_applies_latest_exclusions_idempotently(self):
        db=sqlite3.connect(':memory:');model.initialize(db);db.execute("INSERT INTO owners VALUES('a',0)");db.commit()
        token=model.begin(db,'a','pdf');model.commit(db,'a','pdf',token)
        for _ in range(2):model.restore_exclusions(db,['a'])
        self.assertFalse(model.commit(db,'a','pdf',token));db.close()
    def test_gate_unknown_results_never_expire_to_success(self):
        now=datetime.datetime(2026,10,1,tzinfo=datetime.timezone.utc)
        value={'format':'pdf-page-finder-recovery-evidence','version':1,'backupCompletedAt':now.isoformat(),'hashAudit':True,'deletionLedgerCurrent':True,'ownershipMappingComplete':True,'unknownStorageOperations':1,'orphanMultipart':0,'restoreExcludedOwners':1}
        self.assertIn('storage_result_unknown',gate.evaluate(value,now)['blockers'])
        value['unknownStorageOperations']=0;self.assertTrue(gate.evaluate(value,now)['checksPassed']);self.assertFalse(gate.evaluate(value,now)['productionReady'])
        value['backupCompletedAt']='2026-09-28T00:00:00Z';self.assertFalse(gate.evaluate(value,now)['checksPassed'])
        value['extra']='ignored?'
        with self.assertRaises(ValueError):gate.evaluate(value,now)
if __name__=='__main__':unittest.main()
