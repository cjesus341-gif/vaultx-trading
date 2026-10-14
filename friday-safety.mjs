// Friday execution journal and dry-run recovery drill. NEVER submits real orders.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const STATES=new Set(['PREPARED','SUBMIT_UNKNOWN','ACKNOWLEDGED','PARTIALLY_FILLED','FILLED','PROTECTED','CANCELLED','REJECTED','HALTED']);
const NEXT={PREPARED:['SUBMIT_UNKNOWN','CANCELLED','HALTED'],SUBMIT_UNKNOWN:['ACKNOWLEDGED','REJECTED','HALTED'],ACKNOWLEDGED:['PARTIALLY_FILLED','FILLED','CANCELLED','HALTED'],PARTIALLY_FILLED:['FILLED','CANCELLED','HALTED'],FILLED:['PROTECTED','HALTED'],PROTECTED:['HALTED'],CANCELLED:[],REJECTED:[],HALTED:[]};
export function intentKey({symbol='BTC-USD',timeframe,closedAt,direction,strategyVersion='strict-v1'}){
  if(symbol!=='BTC-USD'||!['5m','15m','1h'].includes(timeframe)||!['LONG','SHORT'].includes(direction)||!Number.isFinite(Date.parse(closedAt)))throw Error('Invalid strategy identity');
  return createHash('sha256').update(JSON.stringify([symbol,timeframe,new Date(closedAt).toISOString(),direction,strategyVersion])).digest('hex');
}
export function validateProtection({side='BUY',entry,stop,target,quantity,riskBudget,availableUsd,maxExposureUsd,feesUsd=0,slippageUsd=0}){
  const n=[entry,stop,target,quantity,riskBudget,availableUsd,maxExposureUsd,feesUsd,slippageUsd].map(Number);
  if(n.some(x=>!Number.isFinite(x))||n.slice(0,7).some(x=>x<=0)||n[7]<0||n[8]<0)return {ok:false,reason:'Invalid or missing risk values'};
  if(side!=='BUY')return {ok:false,reason:'Only long spot order simulation supported'};
  const [e,s,t,q,b,c,max,f,sl]=n;
  if(!(s<e&&t>e))return {ok:false,reason:'Protective exit prices on wrong side of entry'};
  const exposure=e*q,risk=(e-s)*q+f+sl,reward=(t-e)*q-f-sl;
  if(exposure>Math.min(c,max)+1e-8)return {ok:false,reason:'Insufficient cash or aggregate exposure cap'};
  if(risk>b+1e-8)return {ok:false,reason:'Risk budget exceeded including costs'};
  if(reward<2*risk)return {ok:false,reason:'Reward/risk below 2:1 after costs'};
  return {ok:true,exposureUsd:exposure,estimatedRiskUsd:risk,estimatedRewardUsd:reward,rr:reward/risk};
}
export function assessExecutionSafety({journal,coverageComplete=false,pnlVerified=false,exitLifecycleVerified=false,portfolioScopeVerified=false}={}){
  const unresolved=(journal?.intents||[]).filter(x=>!['CANCELLED','REJECTED'].includes(x.state));
  const checks=[
    {name:'Durable execution journal',passed:!!journal?.durable,detail:journal?.durable?'Persistent journal configured':'No durable disk configured'},
    {name:'No unresolved intents',passed:!!journal?.durable&&unresolved.length===0,detail:`${unresolved.length} outstanding/uncertain intents; uncertain requests require reconciliation`},
    {name:'Complete portfolio/order coverage',passed:coverageComplete&&portfolioScopeVerified,detail:'Exchange-key scope does not certify other portfolios'},
    {name:'Authoritative daily P&L',passed:pnlVerified,detail:'Must include fees, transfers, cost basis and all in-scope fills'},
    {name:'Verified protective exit lifecycle',passed:exitLifecycleVerified,detail:'Live order, partial-fill and exit handling not validated'},
    {name:'Restart reconciliation proven',passed:false,detail:'Dry-run replay is not exchange recovery verification'},
    {name:'Unattended order submissions enabled',passed:false,detail:'Hard-disabled; no automated Coinbase execution route'}
  ];
  return {ready:false,automaticExecutionEnabled:false,checks,unresolvedCount:unresolved.length};
}
export function createSafetyJournal({filePath,now=Date.now}={}){
  let state={version:1,intents:[],armed:false,halted:true,events:[]},loaded=false;
  const persist=async()=>{
    if(!filePath)throw Error('Durable DATA_DIR required');
    await mkdir(path.dirname(filePath),{recursive:true});
    const tmp=filePath+'.tmp';await writeFile(tmp,JSON.stringify(state),'utf8');await rename(tmp,filePath);
  };
  const init=async()=>{
    if(loaded)return;
    if(filePath)try{const doc=JSON.parse(await readFile(filePath,'utf8'));
      if(doc?.version!==1||!Array.isArray(doc.intents)||!Array.isArray(doc.events))throw Error('Invalid persisted journal');
      state=doc;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    // Never restore a live arm state after process restart. All unresolved intents remain blocked.
    state.armed=false;state.halted=true;loaded=true;
    if(filePath)await persist();
  };
  const snapshot=()=>({durable:!!filePath,armed:false,halted:true,mode:'DRY_RUN',intents:state.intents.map(x=>({...x})),recentEvents:state.events.slice(-20)});
  const record=async(type,data)=>{state.events.push({type,at:new Date(now()).toISOString(),...data});state.events=state.events.slice(-500);await persist();};
  async function prepare(input){await init();const id=intentKey(input);if(state.intents.some(x=>x.id===id))throw Error('Duplicate candle strategy intent blocked');
    if(state.intents.some(x=>!['CANCELLED','REJECTED'].includes(x.state)))throw Error('Outstanding order intent requires reconciliation');
    const x={id,state:'PREPARED',symbol:'BTC-USD',timeframe:input.timeframe,closedAt:input.closedAt,direction:input.direction,clientOrderId:'friday-'+id.slice(0,32),createdAt:new Date(now()).toISOString(),dryRun:true};
    state.intents.push(x);await record('PREPARED',{id});return {...x};
  }
  async function transition(id,to,{source='SIMULATION',exchangeOrderId=null}={}){
    await init();if(!STATES.has(to)||source!=='SIMULATION')throw Error('Invalid dry-run transition');
    const x=state.intents.find(x=>x.id===id);if(!x)throw Error('Unknown intent');
    if(!NEXT[x.state].includes(to))throw Error('Invalid or unsafe state transition');
    x.state=to;if(exchangeOrderId)x.exchangeOrderId=String(exchangeOrderId);await record(to,{id});return {...x};
  }
  return {init,snapshot,prepare,transition};
}
