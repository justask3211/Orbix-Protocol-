#!/usr/bin/env python3
"""Account-token multipart deployment. Never prints credentials or secret values.
Run after npm run build. Existing unrelated Workers are never read or mutated.
"""
import argparse,json,os,secrets,shlex
from pathlib import Path
import requests
parser=argparse.ArgumentParser()
parser.add_argument('--railway-origin',default='https://orbix-center-production.up.railway.app')
parser.add_argument('--allowed-origins',default='https://orbixcore.fun,https://www.orbixcore.fun,https://multiplayer.justask3211.workers.dev')
parser.add_argument('--evidence',default='deployment.json')
args=parser.parse_args()
ACCOUNT='0d91ccc5789d50ce43aa35c2ad8e38d8';SCRIPT='multiplayer'
values={}
for line in (Path.home()/'.cf_env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.removeprefix('export ').split('=',1);values[k.strip()]=shlex.split(v)[0]
session=requests.Session();session.headers['Authorization']='Bearer '+values['CF_ACCOUNT_TOKEN']
base=f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}'
def api(method,url,**kwargs):
 r=session.request(method,url,timeout=120,**kwargs)
 data=r.json()
 if not r.ok or not data.get('success'):raise RuntimeError(json.dumps({'status':r.status_code,'errors':data.get('errors')}))
 return data['result']
status=session.get(base+'/settings',timeout=30)
exists=status.ok and status.json().get('success')
metadata={'main_module':'worker.js','compatibility_date':'2026-10-20','compatibility_flags':['nodejs_compat'],
 'bindings':[{'type':'durable_object_namespace','name':'ROOMS','class_name':'MultiplayerRoom'},
 {'type':'plain_text','name':'RAILWAY_ORIGIN','text':args.railway_origin},
 {'type':'plain_text','name':'ALLOWED_ORIGINS','text':args.allowed_origins}],
 'keep_bindings':['secret_text'],'observability':{'enabled':True}}
if not exists:metadata['migrations']={'new_tag':'v1','steps':[{'new_sqlite_classes':['MultiplayerRoom']}]}
bundle=Path(__file__).parent/'dist/index.js'
result=api('PUT',base,files={'metadata':(None,json.dumps(metadata),'application/json'),'worker.js':('worker.js',bundle.read_bytes(),'application/javascript+module')})
secret_path=Path.home()/'.orbix_multiplayer.env'
secret_values={}
if secret_path.exists():
 for line in secret_path.read_text().splitlines():
  if '=' in line:
   k,v=line.split('=',1);secret_values[k]=v
mapping={'EDGE_TICKET_SECRET':'CENTER_EDGE_TICKET_SECRET','PROVISION_SECRET':'CENTER_CF_PROVISION_SECRET','RESULT_SECRET':'CENTER_CF_RESULT_SECRET'}
for worker_key,railway_key in mapping.items():secret_values.setdefault(railway_key,secrets.token_hex(32))
fd=os.open(secret_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as out:out.write(''.join(f'{k}={v}\n' for k,v in secret_values.items()))
os.chmod(secret_path,0o600)
for worker_key,railway_key in mapping.items():api('PUT',base+'/secrets',json={'name':worker_key,'text':secret_values[railway_key],'type':'secret_text'})
api('POST',base+'/subdomain',json={'enabled':True,'previews_enabled':False})
settings=api('GET',base+'/settings')
deployments=api('GET',base+'/deployments')
active=deployments.get('deployments',[]) if isinstance(deployments,dict) else deployments
public={'script':SCRIPT,'account':ACCOUNT,'url':'https://multiplayer.justask3211.workers.dev','deploymentId':result.get('deployment_id'),'modifiedOn':result.get('modified_on'),
 'bindings':[{k:v for k,v in b.items() if k in ('name','type','class_name','namespace_id')} for b in settings.get('bindings',[])],
 'secretsSet':list(mapping),'secretValues':'MASKED; local mode-0600 handoff file ~/.orbix_multiplayer.env',
 'activeDeployment':active[0] if active else None,
 'railwayOrigin':args.railway_origin,'allowedOrigins':args.allowed_origins,'compatibilityDate':metadata['compatibility_date'],'customDomain':None}
Path(args.evidence).write_text(json.dumps(public,indent=2)+'\n');print(json.dumps(public,indent=2))
