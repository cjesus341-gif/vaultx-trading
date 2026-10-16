// Friday guarded single-entry autonomous pilot. Explicit arming, fail-closed recovery.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
export function createFridayAutopilot({filePath,now=Date.now,signal,preflight,submit}={}){
  let armed=false,busy=false,loaded=false,blocked=false;
  let saved={version:1,lastCandle:null,lastOrderDay:null,pending:null,events:[]};
  const stamp=()=>new Date(now()).toISOString();
  const event=(type,detail='')=>{saved.events.unshift({at:stamp(),type,detail:String(detail).slice(0,180)});saved.events=saved.events.slice(0,20);};
  async function persist(){if(!filePath)throw Error('Durable DATA_DIR is required');await mkdir(path.dirname(filePath),{recursive:true});const temp=filePath+'.tmp';await writeFile(temp,JSON.stringify(saved));await rename(temp,filePath);}
  async function init(){if(loaded)return;loaded=true;if(filePath){try{const d=JSON.parse(await readFile(filePath,'utf8'));if(d.version!==1||!Array.isArray(d.events))throw Error('Invalid autopilot journal');saved=d;}catch(e){if(e.code!=='ENOENT'){blocked=true;event('HALTED','Unreadable journal');}}}armed=false;if(saved.pending){blocked=true;event('HALTED','Unresolved prior submission requires Coinbase reconciliation');}if(filePath&&!blocked)await persist();}
  const snapshot=()=>({armed,blocked,busy,persistent:!!filePath,lastCandle:saved.lastCandle,lastOrderDay:saved.lastOrderDay,pending:saved.pending,events:saved.events,mode:'LIMITED_LIVE_PILOT',maxOrdersPerUtcDay:1,unattendedAfterRestart:false});
  async function control(command){await init();if(command==='disarm'){armed=false;event('DISARMED');await persist();return snapshot();}if(command!=='arm')throw Error('Invalid command');if(!filePath||blocked||saved.pending)throw Error('Durable journal/reconciliation required');armed=true;event('ARMED','One protected BTC buy maximum per UTC day; auto-disarm after an attempt');await persist();return snapshot();}
  async function tick(){await init();if(!armed||blocked||busy)return snapshot();busy=true;
    try{
      const item=await signal();if(!item||!item.closedAt||!item.qualified||item.side!=='LONG')return snapshot();
      if(item.closedAt===saved.lastCandle)return snapshot();
      saved.lastCandle=item.closedAt;await persist();
      const day=stamp().slice(0,10);if(saved.lastOrderDay===day){event('WAIT','Daily one-order limit');await persist();return snapshot();}
      const plan=await preflight(item);
      if(!plan||plan.ok!==true){event('NO_TRADE',plan?.reason||'Preflight failed');await persist();return snapshot();}
      if(!plan.clientOrderId||!plan.request)throw Error('Missing frozen Coinbase order request');
      // Durably journal BEFORE contacting Coinbase. If result is unknown, never retry automatically.
      saved.pending={clientOrderId:plan.clientOrderId,candle:item.closedAt,day,createdAt:stamp(),status:'SUBMISSION_UNKNOWN'};
      saved.lastOrderDay=day;armed=false;await persist();
      try{
        const outcome=await submit(plan.request);
        saved.pending={...saved.pending,status:'COINBASE_RESPONSE_RECEIVED',orderId:String(outcome?.orderId||'')};
        event('ORDER_RESPONSE','Submitted; inspect order and attached exit on Coinbase');await persist();
      }catch(e){blocked=true;event('HALTED','Submission outcome uncertain: '+e.message);await persist();}
    }catch(e){armed=false;blocked=true;event('HALTED','Preflight/runtime failure: '+e.message);try{await persist();}catch{}}
    finally{busy=false;}return snapshot();}
  return {init,snapshot,control,tick};
}
