#!/usr/bin/env node
/** Read-only paired model/effort benchmark. No vault writes and no live-model changes.
 * Run with node --env-file=.env scripts/model-effort-bakeoff.mjs --run-dir /private/path --confirm.
 * Without --confirm, prepares inputs and prints a free estimate only. Raw data stays outside git.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadRepoPipeline } from './lib/pipeline.mjs';
import { loadChronoCaptures, buildPreRunVault } from './lib/corpus.mjs';
import { measuredCost, reservationCost, reserveBudget, settleBudget, summarize } from './lib/effort-eval.mjs';
import { buildClassifyPayload } from '../plus-service/src/anthropic.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = (key, fallback) => { const i=args.indexOf(`--${key}`); return i>=0 ? args[i+1] : fallback; };
const payloadMode=value('payload','plugin');
if(!['plugin','plus'].includes(payloadMode))throw new Error('Payload must be plugin or plus');
const prefix=payloadMode==='plus'?'plus-':'';
const incumbentCompare=args.includes('--incumbent-compare');
if(incumbentCompare&&payloadMode!=='plus')throw new Error('Incumbent comparison requires the Plus payload');
const concurrency=Number(value('concurrency','2'));
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('Concurrency must be 1–4');
const dir = path.resolve(value('run-dir', '/tmp/atoms-model-eval-20261020'));
if (dir === root || dir.startsWith(root + path.sep)) throw new Error('Raw evaluation data must stay outside the repository');
fs.mkdirSync(dir, {recursive:true,mode:0o700});
const save = (name, data) => { const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(dest+'.tmp',dest); };
const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const pipeline = await loadRepoPipeline();
const capturePool = loadChronoCaptures();
const total = Number(value('limit','300'));
const k = Number(value('k','400'));
const maxTokens = Number(value('max-tokens',payloadMode==='plus'?'2048':'8192'));
const cap = Number(value('budget','15'));
if(!Number.isFinite(cap)||cap<=0||!Number.isInteger(maxTokens)||maxTokens<1)throw new Error('Budget and output limit must be positive');
const models = incumbentCompare?['claude-sonnet-5','claude-sonnet-5-5']:['claude-sonnet-5-5','claude-haiku-5-5'];
const armId=(model,effort)=>`${model}-${prefix}${effort}`;
const allArms = models.flatMap(model=>(incumbentCompare?['low']:payloadMode==='plus'?(model==='claude-haiku-5-5'?['medium','high','xhigh']:['low','medium','high']):['medium','high']).map(effort=>({model,effort,id:armId(model,effort)})));
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const note = (id,title,body,extra={}) => ({path:`Atoms/${id}.md`,title,body,tags:[],links:[],isAtom:true,...extra});
const canonical = c => `${c.id} · ${c.capture.slice(0,76).replace(/\s+\S*$/,'')}`;

async function syntheticCases() {
  const pool=capturePool.slice(0,total);
  const hubs=[...new Set(capturePool.flatMap(c=>c.linksToExisting??[]))].sort();
  const fillers=buildPreRunVault({size:1200,hubTitles:hubs,bodyPool:capturePool.slice(total).map(c=>c.capture),mode:'coherent'});
  const corpus=new pipeline.CandidateCorpus();
  fillers.forEach((n,i)=>corpus.add(note(`background-${i}`,n.title,n.body,{isAtom:!hubs.includes(n.title)})));
  const staticContext=pipeline.buildVaultContext({titles:fillers.map(n=>n.title),vaultTags:[],activeVocabulary:pipeline.DEFAULT_ACTIVE_VOCABULARY,personHubs:[]});
  const prior=new Map(), resolved={}, cases=[];
  for(const c of pool) {
    const run=new pipeline.ContextRun(staticContext,corpus,k,{graph:pipeline.buildLinkGraph(resolved),hubPaths:new Set(fillers.map((n,i)=>hubs.includes(n.title)?`Atoms/background-${i}.md`:null).filter(Boolean))});
    const context=await run.getCandidates(c.capture);
    const goldAtomTitles=(c.linksToEarlier??[]).map(id=>prior.get(id)).filter(Boolean);
    const goldHubTitles=c.linksToExisting??[];
    cases.push({id:c.id,capture:c.capture,verdict:c.verdict,context,hubTitles:hubs,goldAtomTitles,goldHubTitles,goldTitles:[...goldAtomTitles,...goldHubTitles]});
    if(c.verdict==='atom') {
      const title=canonical(c);prior.set(c.id,title);corpus.add(note(c.id,title,c.capture));
      resolved[`Atoms/${c.id}.md`]=Object.fromEntries((c.linksToEarlier??[]).filter(id=>prior.has(id)).map(id=>[`Atoms/${id}.md`,1]));
    }
  }
  return cases;
}

async function privateCases(vault) {
  if(!vault) return [];
  const atoms=path.join(path.resolve(vault),'Atoms');
  const files=fs.readdirSync(atoms).filter(n=>n.endsWith('.md')).sort();
  const notes=files.map((f,i)=>{
    const raw=fs.readFileSync(path.join(atoms,f),'utf8');
    return note(`private-${i}`,path.basename(f,'.md'),pipeline.extractCaptureBody(raw));
  }).filter(n=>n.body.trim());
  const sample=notes.filter(n=>n.body.length>=30&&n.body.length<=800);
  const chosen=Array.from({length:Math.min(20,sample.length)},(_,i)=>sample[Math.floor(i*sample.length/Math.min(20,sample.length))]);
  const settingsPath=path.join(vault,'.obsidian/plugins/atoms/data.json');
  let vocabulary=pipeline.DEFAULT_ACTIVE_VOCABULARY;
  try {const s=JSON.parse(fs.readFileSync(settingsPath,'utf8'));if(Array.isArray(s.activeVocabulary))vocabulary=s.activeVocabulary;}catch{}
  const cases=[];
  for (const [i,target] of chosen.entries()) {
    const corpus=new pipeline.CandidateCorpus();
    // Reclassify against other notes; never leak the existing title or an identical capture.
    const others=notes.filter(n=>norm(n.body)!==norm(target.body));others.forEach(n=>corpus.add(n));
    const staticContext=pipeline.buildVaultContext({titles:others.map(n=>n.title),vaultTags:[],activeVocabulary:vocabulary,personHubs:[]});
    const context=await new pipeline.ContextRun(staticContext,corpus,k).getCandidates(target.body);
    cases.push({id:`private-${String(i+1).padStart(2,'0')}`,capture:target.body,context,sourceHash:crypto.createHash('sha256').update(target.body).digest('hex')});
  }
  return cases;
}

const preparedFile=path.join(dir,'cases.json');
const prepared=fs.existsSync(preparedFile)?read('cases.json'):{synthetic:await syntheticCases(),private:await privateCases(value('vault',''))};
if(!fs.existsSync(preparedFile))save('cases.json',prepared);
const pilot=prepared.synthetic.filter((_c,i)=>Math.floor((i+1)*50/prepared.synthetic.length)>Math.floor(i*50/prepared.synthetic.length));
const pilotIds=new Set(pilot.map(c=>c.id));
const ledger=fs.existsSync(path.join(dir,'ledger.json'))?read('ledger.json'):{cap,spent:0,pending:{}};
if(ledger.cap!==cap)throw new Error('Budget is fixed for an existing run');
if(Object.keys(ledger.pending).length)throw new Error('Another request is pending; wait or inspect its accounting before resuming');
const checkpoint=()=>save('ledger.json',ledger);
checkpoint();
console.log(JSON.stringify({prepared:prepared.synthetic.length,privateSample:prepared.private.length,pilot:pilot.length,k,maxTokens,cap,payloadMode,concurrency,arms:allArms,pairedContext:true,inputDigest:crypto.createHash('sha256').update(JSON.stringify(prepared)).digest('hex')}));
if(!args.includes('--confirm')) {
 const meanBytes=prepared.synthetic.reduce((s,c)=>s+Buffer.byteLength(c.capture)+c.context.titles.join('\n').length,0)/prepared.synthetic.length;
 console.log(JSON.stringify({estimateOnly:true,meanCaptureAndTitleBytes:Math.round(meanBytes),pilotRequests:pilot.length*allArms.length,maximumSyntheticRequests:prepared.synthetic.length*2+pilot.length*(allArms.length-2),privateRequests:prepared.private.length*2,hardCapUsd:cap}));
 process.exit(0);
}
if(!process.env.ANTHROPIC_API_KEY?.trim())throw new Error('ANTHROPIC_API_KEY is required');

async function runCase(arm,c) {
 const key=`${arm.id}/${c.id}`,file=`records/${key}.json`;
 if(fs.existsSync(path.join(dir,file))){
  const cached=read(file);
  if((cached.maxTokens??8192)!==maxTokens||(cached.payloadMode??'plugin')!==payloadMode)throw new Error('Cached request configuration differs; use a separate run');
  return cached;
 }
 let usage=null, raw=null, stopReason=null, providerModel=null, rawBodyField=false, usd=0, called=false, requestCount=0, result=null, failure=null;
 const started=Date.now();
 try {
  const outcome=await pipeline.classifyCapture(c.capture,c.context,{
   apiKey:process.env.ANTHROPIC_API_KEY,model:arm.model,activeVocabulary:c.context.vocabulary,maxAttempts:1,
   request:async params=>{
    requestCount++;
    const built=payloadMode==='plus'?buildClassifyPayload({capture:c.capture,context:c.context}):null;
    if(built&&!built.ok)throw new Error('Plus payload rejected prepared input');
    const body=built?built.payload:JSON.parse(params.body);body.model=arm.model;body.max_tokens=maxTokens;body.output_config.effort=arm.effort;
    try { reserveBudget(ledger,key,reservationCost(body,arm.model)); }
    catch(error) { failure='budget_exhausted'; throw error; }
    checkpoint();called=true;
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:params.headers,body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const json=await response.json();usage=json.usage??null;stopReason=json.stop_reason??null;providerModel=json.model??null;
    raw=(json.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    try{const parsed=JSON.parse(raw);rawBodyField=Object.hasOwn(parsed,'body')||Object.hasOwn(parsed,'capture');}catch{}
    usd=settleBudget(ledger,key,usage,arm.model,[400,401,403,404,429].includes(response.status));checkpoint();
    return {status:response.status,json,text:'',headers:{},arrayBuffer:new ArrayBuffer(0)};
   },
  });
  if(outcome.ok)result=outcome.result;
  else failure=failure??outcome.reason;
 }catch(error) {
  failure=/budget exhausted/.test(error.message)?'budget_exhausted':'request_failed';
 }finally{
  if(ledger.pending[key]!==undefined){usd=settleBudget(ledger,key,usage,arm.model);checkpoint();}
 }
 const record={id:c.id,model:arm.model,providerModel,effort:arm.effort,payloadMode,maxTokens,ms:Date.now()-started,result,error:failure,usage,stopReason,rawBodyField,usd,called,requestCount,raw};
 save(file,record);
 return record;
}

async function runPhase(label,arms,cases) {
 const jobs=cases.flatMap(c=>arms.map(arm=>({arm,c})));let next=0,done=0,stop=false;
 const results=[];
 async function worker(){while(next<jobs.length&&!stop){const job=jobs[next++];const r=await runCase(job.arm,job.c);results.push(r);done++;if(r.error==='budget_exhausted')stop=true;if(done%20===0||done===jobs.length)console.log(JSON.stringify({phase:label,done,total:jobs.length,spentUsd:+ledger.spent.toFixed(4)}));}}
 await Promise.all(Array.from({length:concurrency},()=>worker()));
 const report=arms.map(arm=>({arm,score:summarize(results.filter(r=>r.model===arm.model&&r.effort===arm.effort),cases)}));
 save(`${prefix}${label}-summary.json`,report);console.log(JSON.stringify({phase:prefix+label,summary:report,spentUsd:ledger.spent}));
 if(stop)throw new Error('Budget exhausted; completed records are saved');
 return report;
}

const extraEffort=value('haiku-extra-effort','');
if(incumbentCompare) {
 if(extraEffort)throw new Error('Incumbent comparison uses low effort only');
 if(args.includes('--smoke-only')){await runPhase('incumbent-smoke',allArms,pilot.slice(0,1));process.exit(0);}
 const report=await runPhase('incumbent',allArms,prepared.synthetic);
 save(`${prefix}incumbent-arms.json`,allArms);
 if(prepared.private.length)await runPhase('incumbent-private',allArms,prepared.private);
 save(`${prefix}incumbent-complete.json`,{finishedAt:new Date().toISOString(),payloadMode,maxTokens,concurrency,ledger,arms:allArms,report});
 console.log(JSON.stringify({incumbentComplete:true,spentUsd:ledger.spent,runDir:dir}));
 process.exit(0);
}
if(extraEffort) {
 if(!['xhigh','max'].includes(extraEffort))throw new Error('Extra Haiku effort must be xhigh or max');
 if(Object.keys(ledger.pending).length)throw new Error('Wait for the existing run to finish before extending it');
 const suffix=payloadMode==='plus'?`${extraEffort}-${maxTokens}`:extraEffort;
 const arm={model:'claude-haiku-5-5',effort:extraEffort,id:armId('claude-haiku-5-5',suffix)};
 const high=read(`${prefix}pilot-summary.json`).find(r=>r.arm.id===armId('claude-haiku-5-5','high'));
 if(!high)throw new Error('Run the matching high-effort pilot before extending it');
 const [extra]=await runPhase(`pilot-${suffix}`,[arm],pilot);
 const qualifies=extra.score.errors===0&&extra.score.truncated===0&&(extra.score.atomF1??0)>=(high.score.atomF1??0)+0.02;
 if(qualifies) {
  await runPhase(`full-${suffix}`,[arm],prepared.synthetic);
  const holdout=prepared.synthetic.filter(c=>!pilotIds.has(c.id));
  save(`${prefix}holdout-${suffix}-summary.json`,[{arm,score:summarize(holdout.map(c=>read(`records/${arm.id}/${c.id}.json`)),holdout)}]);
  if(prepared.private.length)await runPhase(`private-${suffix}`,[arm],prepared.private);
 }
 save(`${prefix}extra-${suffix}-complete.json`,{finishedAt:new Date().toISOString(),qualifies,payloadMode,maxTokens,arm,ledger});
 console.log(JSON.stringify({extraComplete:true,effort:extraEffort,qualifies,spentUsd:ledger.spent}));
 process.exit(0);
}

if(args.includes('--smoke-only')) { await runPhase('smoke',allArms,pilot.slice(0,1)); process.exit(0); }
const pilotReport=await runPhase('pilot',allArms,pilot);
const reliable=pilotReport.filter(r=>r.score.errors/r.score.captures<=0.05&&r.score.truncated/r.score.captures<=0.05);
if(models.some(model=>!reliable.some(r=>r.arm.model===model)))throw new Error('No reliable effort for a model; diagnose before expanding');
const finalists=models.map(model=>{
 const high=pilotReport.find(r=>r.arm.model===model&&r.arm.effort==='high');
 const candidates=reliable.filter(r=>r.arm.model===model&&(r.arm.effort!=='xhigh'||(r.score.errors===0&&r.score.truncated===0&&(r.score.atomF1??0)>=(high.score.atomF1??0)+0.02))).sort((a,b)=>(a.score.errors-b.score.errors)||((b.score.atomF1??0)-(a.score.atomF1??0))||a.score.medianMs-b.score.medianMs);
 const best=candidates[0];
 // Avoid paying for higher effort when its small pilot gain is negligible.
 const cheaper=candidates.filter(r=>r.score.errors===best.score.errors&&(best.score.atomF1??0)-(r.score.atomF1??0)<0.02).sort((a,b)=>['low','medium','high','xhigh'].indexOf(a.arm.effort)-['low','medium','high','xhigh'].indexOf(b.arm.effort));
 return cheaper[0].arm;
});
save(`${prefix}finalists.json`,finalists);console.log(JSON.stringify({finalists}));
if(args.includes('--pilot-only'))process.exit(0);
await runPhase('full',finalists,prepared.synthetic);
const holdout=prepared.synthetic.filter(c=>!pilotIds.has(c.id));
const holdoutReport=finalists.map(arm=>({arm,score:summarize(holdout.map(c=>read(`records/${arm.id}/${c.id}.json`)),holdout)}));save(`${prefix}holdout-summary.json`,holdoutReport);
if(prepared.private.length)await runPhase('private',finalists,prepared.private);
save(`${prefix}complete.json`,{finishedAt:new Date().toISOString(),payloadMode,maxTokens,concurrency,ledger,finalists,holdoutReport});
console.log(JSON.stringify({complete:true,spentUsd:ledger.spent,runDir:dir}));
