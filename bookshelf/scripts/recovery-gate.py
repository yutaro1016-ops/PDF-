"""Offline read-only recovery preflight. Never deletes data, unlocks jobs or sends notices.
Usage: recovery-gate.py INPUT.json
Input is a trusted operator's evidence projection; not proof of a full production snapshot.
"""
import datetime,json,sys

def evaluate(value,now=None):
    if not isinstance(value,dict) or type(value.get('version')) is not int:
        raise ValueError('Evidence must be a versioned object')
    if value.get('format')!='pdf-page-finder-recovery-evidence' or value.get('version')!=1:
        raise ValueError('Unsupported recovery evidence')
    required={'format','version','backupCompletedAt','hashAudit','deletionLedgerCurrent','ownershipMappingComplete','unknownStorageOperations','orphanMultipart','restoreExcludedOwners'}
    if set(value)!=required: raise ValueError('Missing or unknown evidence fields')
    if type(value['unknownStorageOperations']) is not int or value['unknownStorageOperations']<0 or type(value['orphanMultipart']) is not int or value['orphanMultipart']<0:
        raise ValueError('Invalid operation counts')
    for key in ('hashAudit','deletionLedgerCurrent','ownershipMappingComplete'):
        if type(value[key]) is not bool:raise ValueError('Evidence must be boolean')
    if type(value['restoreExcludedOwners']) is not int or value['restoreExcludedOwners']<0:raise ValueError('Invalid exclusion count')
    now=now or datetime.datetime.now(datetime.timezone.utc)
    if not isinstance(value['backupCompletedAt'],str):raise ValueError('Timestamp must be text')
    stamp=datetime.datetime.fromisoformat(value['backupCompletedAt'].replace('Z','+00:00'))
    if stamp.tzinfo is None:raise ValueError('Timestamp must include timezone')
    age=(now-stamp).total_seconds()
    reasons=[]
    if age<0 or age>86400:reasons.append('backup_stale_or_future')
    for key in ('hashAudit','deletionLedgerCurrent','ownershipMappingComplete'):
        if not value[key]:reasons.append(key+'_missing')
    if value['unknownStorageOperations']:reasons.append('storage_result_unknown')
    if value['orphanMultipart']:reasons.append('orphan_multipart_requires_review')
    return {'scope':'offline-evidence-preflight','checksPassed':not reasons,'productionReady':False,'sendNotifications':False,'blockers':reasons}

if __name__=='__main__':
    try:
        result=evaluate(json.load(open(sys.argv[1])))
        print(json.dumps(result));sys.exit(0 if result['checksPassed'] else 2)
    except (ValueError,KeyError,TypeError,OSError,IndexError) as error:
        print('Recovery evidence rejected: '+str(error),file=sys.stderr);sys.exit(1)
