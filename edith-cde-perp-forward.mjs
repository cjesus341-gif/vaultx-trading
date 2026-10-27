// EDITH CDE perpetual-only, forward paper scanner. No Coinbase write endpoints.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {edithSignal,EDITH_STRATEGIES} from './edith-paper-lab.mjs';
const WATCH=['BTC','ETH','SOL','XRP','NEAR','HYPE','ADA','DOGE','SUI','BNB','LINK','AVAX','AAVE','LTC','HBAR','XLM','DOT','BCH','ZEC','ENA','ONDO'];
const money=n=>Math.round(n*1e6)/1e6;
export function createEdithPerpScanner({filePath,fetchProducts,fetchCandles,now=Date.now}){
 let state=null,busy=null;
 const account=()=>({cash:300,positions:[],trades:[],pending:{},peak:300,maxDrawdownUsd:0});
 const accounts=()=>Object.fromEntries(EDITH_STRATEGIES.map(name=>[name,account()]));
 async function init(){if(state)return;
  try{const v=JSON.parse(await readFile(filePath,'utf8'));if(v.schema!==1||!Array.isArray(v.trades)||!Array.isArray(v.positions))throw Error('Invalid journal');state=v;if(!state.experiments)state.experiments=accounts();}
  catch(e){if(e.code!=='ENOENT')throw e;state={schema:1,startedAt:new Date(now()).toISOString(),cash:300,positions:[],trades:[],watermarks:{},signals:[],health:{},scans:0,experiments:accounts()};await save();}
 }
 async function save(){const tmp=filePath+'.tmp';await writeFile(tmp,JSON.stringify(state));await rename(tmp,filePath);}
 const snapshot=()=>{const strategies=EDITH_STRATEGIES.map(name=>{const e=state.experiments[name],t=e.trades,w=t.filter(x=>x.netPnlUsd>0).length,tp=t.filter(x=>x.outcome==='TARGET').length;return {name,strategy:name,trades:t.length,netPnlUsd:money(e.cash-300),accountBalanceUsd:money(e.cash),startingBalanceUsd:300,winRate:t.length?w/t.length:null,lossRate:t.length?(t.length-w)/t.length:null,tpHitRate:t.length?tp/t.length:null,tpHits:tp,tpFeeLosses:t.filter(x=>x.outcome==='TARGET'&&x.netPnlUsd<=0).length,maxDrawdownUsd:e.maxDrawdownUsd||0,leverage:3,marginPerTradeUsd:null,openPosition:e.positions[0]||null,openPositions:e.positions};});return {paperOnly:true,canTradeRealMoney:false,enabled:true,marketType:'COINBASE_US_PERPETUAL',paperTimeframeMinutes:15,startingBalanceUsd:300,markets:Object.keys(state.health),strategies,leaderboard:strategies,openPositions:strategies.flatMap(x=>x.openPositions.map(p=>({...p,strategy:x.name}))),recentTrades:EDITH_STRATEGIES.flatMap(name=>state.experiments[name].trades.map(t=>({...t,variant:name,market:t.productId,quantity:1}))).sort((a,b)=>String(b.exitTime).localeCompare(String(a.exitTime))).slice(0,100),marketHealth:Object.fromEntries(Object.entries(state.health).map(([k,v])=>[k,{status:v}])),lastRun:state.lastRun,scanCount:state.scans,limitations:'Separate $300 paper account per strategy. Indicative margin only; funding and liquidation not modeled. No real orders.'};};
 async function status(){await init();return snapshot();}
 async function tick(){if(busy)return busy;busy=(async()=>{await init();
  const catalog=await fetchProducts(),products=(catalog.products||[]).filter(p=>WATCH.some(root=>p.product_id===root+'-PERP'||p.product_id===root+'-USD-PERP')&&!p.trading_disabled&&Number(p.future_product_details?.contract_size)>0&&!/USDC-PERPETUAL/i.test(p.product_id));
  for(const p of products){const id=p.product_id;try{
   const bars=(await fetchCandles(id)).filter(b=>Number.isFinite(b.close)&&b.close>0).sort((a,b)=>a.time.localeCompare(b.time));if(bars.length<70){state.health[id]='INSUFFICIENT_CANDLES';continue;}
   const last=bars.at(-1),previous=state.watermarks[id];
   if(!previous){state.watermarks[id]=last.time;state.health[id]='INITIALIZED';continue;}
   const unseen=bars.filter(b=>b.time>previous);
   if(unseen.length!==1||Date.parse(unseen[0].time)-Date.parse(previous)!==900000){state.watermarks[id]=last.time;state.health[id]=unseen.length?'RESYNCED_GAP':'WAITING';continue;}
   const bar=unseen[0];state.watermarks[id]=bar.time;
   for(const strategy of EDITH_STRATEGIES){const e=state.experiments[strategy];
    for(const position of [...e.positions].filter(x=>x.productId===id&&!x.dataGap)){
     if(bar.time<=position.entryTime)continue;
     const stop=position.side==='LONG'?bar.low<=position.stop:bar.high>=position.stop;
     const target=position.side==='LONG'?bar.high>=position.target:bar.low<=position.target;
     if(!stop&&!target)continue;
     const exit=(stop?position.stop:position.target)*(position.side==='LONG'?0.9995:1.0005);
     const gross=(position.side==='LONG'?exit-position.entry:position.entry-exit)*position.contractSize;
     const fees=(position.entry+exit)*position.contractSize*0.0006;
     const net=money(gross-fees);e.cash=money(e.cash+net);
     e.peak=Math.max(e.peak,e.cash);e.maxDrawdownUsd=Math.max(e.maxDrawdownUsd,e.peak-e.cash);
     e.trades.push({...position,exit,exitTime:bar.time,feesUsd:fees,grossPnlUsd:gross,netPnlUsd:net,outcome:stop?'STOP':'TARGET'});
     e.positions=e.positions.filter(x=>x!==position);
    }
    const prior=e.pending[id];delete e.pending[id];
    if(prior&&prior.time===previous&&!e.positions.some(x=>x.productId===id)){
     const size=Number(p.future_product_details.contract_size),entry=bar.open;
     const margin=size*entry/3,stopDistance=entry*0.0074,targetDistance=entry*0.0206;
     const estimatedRisk=size*stopDistance+size*entry*0.0022;
     const reserved=e.positions.reduce((sum,x)=>sum+x.marginUsd,0);
     if(margin<=e.cash-reserved&&estimatedRisk<=Math.max(0,e.cash)*0.02){
      e.positions.push({productId:id,market:id,side:prior.side,contracts:1,contractSize:size,entry,stop:prior.side==='LONG'?entry-stopDistance:entry+stopDistance,target:prior.side==='LONG'?entry+targetDistance:entry-targetDistance,marginUsd:money(margin),entryTime:bar.time,signalTime:prior.time,strategy});
     }
    }
    const side=edithSignal(bars,bars.length-1,strategy);
    if(side==='LONG'||side==='SHORT')e.pending[id]={productId:id,side,time:bar.time,strategy};
   }
   state.health[id]='OK';
  }catch(e){state.health[id]='ERROR: '+String(e.message).slice(0,100);}}
  state.scans++;state.lastRun=new Date(now()).toISOString();state.signals=state.signals.slice(-100);state.trades=state.trades.slice(-500);await save();return snapshot();
 })();try{return await busy;}finally{busy=null;}}
 return {status,tick};
}
