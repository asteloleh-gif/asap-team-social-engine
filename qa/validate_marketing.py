from pathlib import Path
from datetime import datetime, timezone
import json,hashlib,collections,os
from PIL import Image
R=Path(__file__).resolve().parents[1]
checks=[]
def ck(name,test,detail=''):
 checks.append({'check':name,'passed':bool(test),'detail':detail})
pool=json.load(open(R/'content/content_pool.json'));wave=json.load(open(R/'content/first_wave.json'));matrix=json.load(open(R/'content/seven_day_matrix.json'));metrics=json.load(open(R/'content/metrics_contract.json'));ledger=json.load(open(R/'content/first_wave_assets.json'))
concepts=pool['concepts'];items=wave['items'];variants=[(i,v) for i in items for v in i['variants']];byid={v['variant_id']:(i,v) for i,v in variants}
asset_dir=Path(os.environ['ASAP_MARKETING_ASSET_DIR']).resolve() if os.environ.get('ASAP_MARKETING_ASSET_DIR') else None
def asset_path(item):
 path=item['asset']['local_path']
 if path=='LOCAL_ASSET_REFERENCE' and asset_dir:
  return asset_dir/f"{item['asset']['asset_id']}.jpg"
 return Path(path)
ck('60 concepts and 30 per brand',len(concepts)==60 and collections.Counter(x['brand_id'] for x in concepts)=={'ASAP_GTA6':30,'ASAP_KATY':30})
ck('60 unique content IDs',len({x['content_id'] for x in concepts})==60)
ck('Required concept fields',all(all(k in c for k in ['hook','persona','platforms','formats','cta','primary_metric','pass_fail_rule_id','source_ids','claim_class','hypothesis','topic_family_id']) for c in concepts))
ck('10 core items, five per brand',len(items)==10 and collections.Counter(x['brand_id'] for x in items)=={'ASAP_GTA6':5,'ASAP_KATY':5})
ck('30 unique variants and text hashes',len(variants)==30 and len(byid)==30 and len({v['text_sha256'] for i,v in variants})==30)
ck('Text hashes and lengths correct',all(v['text_sha256']==hashlib.sha256(v['text'].encode()).hexdigest() and v['character_count']==len(v['text']) for i,v in variants))
ck('Threads text <=500 chars',all(len(v['text'])<=500 for i,v in variants if v['platform']=='threads'),str(max(len(v['text']) for i,v in variants if v['platform']=='threads')))
ck('No invented account bindings or metrics',all(i['account_key'] is None and i['account_ids_verified'] is False and all(v['actual_metrics'] is None and v['publication_id'] is None and v['permalink'] is None for v in i['variants']) for i in items))
ck('10 distinct image hashes',len({i['asset']['sha256'] for i in items})==10)
ck('Asset files exist and hashes match',all(asset_path(i).is_file() and hashlib.sha256(asset_path(i).read_bytes()).hexdigest()==i['asset']['sha256'] for i in items))
ck('JPEG dimensions match',all(list(Image.open(asset_path(i)).size)==i['asset']['dimensions'] for i in items))
ck('No AI cover selected as source evidence',all(i['asset']['is_ai_editorial_cover'] is False and i['asset']['kind']=='OFFICIAL_SOURCE_REFERENCE_JPEG' for i in items))
ck('Pool and first-wave source/asset bindings match',all(next(c for c in concepts if c['content_id']==i['content_id'])['asset_refs'][0]['sha256']==i['asset']['sha256'] and next(c for c in concepts if c['content_id']==i['content_id'])['source_urls']==i['source_urls'] for i in items))
ck('No same-brand first-wave topic family collision',len({i['brand_topic_family_key'] for i in items})==10)
ck('42 matrix cells, 30 publishing, 12 observing',len(matrix['slots'])==42 and sum(s['action']=='PUBLISH_AFTER_PREFLIGHT' for s in matrix['slots'])==30 and sum(s['action']=='OBSERVE_NO_NEW_POST' for s in matrix['slots'])==12)
ck('Matrix variants join exact brand/platform/content',all(s['variant_id'] in byid and byid[s['variant_id']][0]['brand_id']==s['brand_id'] and byid[s['variant_id']][1]['platform']==s['platform'] and byid[s['variant_id']][0]['content_id']==s['concept_id'] for s in matrix['slots'] if s['action']=='PUBLISH_AFTER_PREFLIGHT'))
ck('Scheduler not silently enabled',matrix['scheduler_enabled'] is False and matrix['start_date'] is None and all(s['scheduled_at_utc'] is None and s['account_key'] is None for s in matrix['slots']))
ck('Timing quality separate from availability','out_of_window' not in metrics['availability_values'] and 'late' in metrics['window_status_values'])
ck('Raw metrics unobserved not zeros',all(m['value'] is None and m['availability']=='not_collected' for m in metrics['raw_metrics']))
ck('Asset ledger matches first wave',[x['sha256'] for x in ledger['assets']]==[i['asset']['sha256'] for i in items])
ck('Katy disclosure in all variants',all('fictional' in v['text'].lower() for i,v in variants if i['brand_id']=='ASAP_KATY'))
ck('No held cover files in first wave',all('/01_FINALS/' not in i['asset']['local_path'] and '/04_VERTICAL_FINALS/' not in i['asset']['local_path'] and i['asset']['pack_slot'] not in [2,11,29,43] for i in items))
report={'schema_version':'1.1','checked_at_utc':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'result':'PASS' if all(c['passed'] for c in checks) else 'FAIL','checks_passed':sum(x['passed'] for x in checks),'checks_total':len(checks),'checks':checks,'asset_hash_matches':sum(asset_path(i).is_file() and hashlib.sha256(asset_path(i).read_bytes()).hexdigest()==i['asset']['sha256'] for i in items),'asset_hash_total':len(items),'independent_review':'Fresh deterministic replay of the marketing data, exact text hashes and supplied JPEG ledger. Historical editorial review remains in MARKETING_QA.json.','boundaries':['Static data/hash/dimension QA only. No live publication test, permissions validation, metric ingestion test, new visual editorial review or commercial licence determination.','Asset locations are supplied privately at runtime and are not written to this report.','Exact asset hash matches do not establish image-use rights, staging approval or publishing authorization.','No paid AI, media generation, deployment or publication was performed.']}
(R/'qa/MARKETING_QA_FRESH.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(report['result'],report['checks_passed'],'/',len(checks))
for c in checks:
 if not c['passed']:print('FAILED:',c)
assert report['result']=='PASS'
