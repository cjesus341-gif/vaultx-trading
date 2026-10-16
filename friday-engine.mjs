import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export const FRIDAY_DEFAULTS=Object.freeze({timeframe:'5m',riskPct:0.5,rr:2,volume:1.2,atrMultiplier:1.5,requireContext:true,requireStructure:true,requireZone:true,pattern:'directional'});
const PERIOD={ '5m':300000,'15m':900000,'1h':3600000 };
export function validateFridaySettings(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid strategy settings');
  const s={...FRIDAY_DEFAULTS,...input};
  if(!PERIOD[s.timeframe])throw Error('Only 5m, 15m and 1h completed candles are supported');
  for(const [key,min,max] of [['riskPct',0.1,1],['rr',2,4],['volume',1,3],['atrMultiplier',1,3]]){
    if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(`Invalid ${key}`);
  }
  if(!['directional','engulfing','wick'].includes(s.pattern))throw Error('Invalid pattern selection');
  for(const k of ['requireContext','requireStructure','requireZone'])if(typeof s[k]!=='boolean')throw Error(`Invalid ${k}`);
  return Object.fromEntries(Object.keys(FRIDAY_DEFAULTS).map(k=>[k,s[k]]));
}
function finite(v){return typeof v==='number'&&Number.isFinite(v)}
export function qualifyFriday(report,settings,nowMs=Date.now()){
  const s=validateFridaySettings(settings),f=report?.frames?.[s.timeframe],context=report?.frames?.[s.timeframe==='5m'?'15m':'1h'];
  const checks=[];const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail:String(detail||'')});
  const closed=Date.parse(f?.closedAt||'');const age=nowMs-closed;
  check('Fresh completed candle',finite(closed)&&age>=0&&age<=PERIOD[s.timeframe]+120000,'Age '+(finite(age)?Math.round(age/1000)+'s':'unknown'));
  const candles=f?.recentCandles;
  check('Price history',Array.isArray(candles)&&candles.length>=24,'Require 24 completed candles');
  const price=Number(f?.close),atr=Number(f?.atr14),volume=Number(f?.volumeRatio),rsi=Number(f?.rsi14);
  const pattern=(f?.patterns||[]).find(p=>['bullish','bearish'].includes(p.direction)&&(s.pattern==='directional'||(s.pattern==='engulfing'&&/engulfing/i.test(p.name))||(s.pattern==='wick'&&/hammer|shooting/i.test(p.name))));
  const side=pattern?.direction==='bullish'?'LONG':pattern?.direction==='bearish'?'SHORT':null;
  check('Directional pattern',!!pattern,pattern?.name||'No matching directional pattern');
  check('EMA trend',!!side&&f?.trend===(side==='LONG'?'bullish':'bearish')&&finite(f?.ema20)&&finite(f?.ema50),'20/50 EMA aligned with entry');
  check('Higher timeframe',!s.requireContext||(!!side&&context?.trend===(side==='LONG'?'bullish':'bearish')),'Confirmation required when enabled');
  check('RSI',!!side&&finite(rsi)&&(side==='LONG'?rsi>=55&&rsi<=75:rsi>=25&&rsi<=45),'RSI '+(finite(rsi)?rsi:'unavailable'));
  check('Volume',finite(volume)&&volume>=s.volume,'Observed '+(finite(volume)?volume+'×':'unknown')+' / minimum '+s.volume+'×');
  let structure=false;
  if(Array.isArray(candles)&&candles.length>=24&&side){
    const a=candles.slice(-24,-12),b=candles.slice(-12);
    const low=x=>Math.min(...x.map(z=>Number(z.low))),high=x=>Math.max(...x.map(z=>Number(z.high)));
    structure=side==='LONG'?low(b)>low(a)&&high(b)>high(a):low(b)<low(a)&&high(b)<high(a);
  }
  check('Market structure',!s.requireStructure||structure,'Higher/lower highs and lows');
  const zone=side==='LONG'?Number(f?.recentLow):Number(f?.recentHigh);
  const near=finite(price)&&finite(atr)&&atr>0&&finite(zone)&&Math.abs(price-zone)<=2.5*atr;
  check('Relevant price zone',!s.requireZone||near,'Price near observed support/resistance');
  const stop=side==='LONG'?price-s.atrMultiplier*atr:price+s.atrMultiplier*atr;
  const target=side==='LONG'?price+s.atrMultiplier*atr*s.rr:price-s.atrMultiplier*atr*s.rr;
  check('Valid stop/target',!!side&&finite(price)&&price>0&&finite(atr)&&atr>0&&finite(stop)&&stop>0&&finite(target)&&target>0,'Risk/reward '+s.rr+':1; ATR '+atr);
  // Position size requires authenticated balance and exchange order checks; this is only a reference signal.
  const passed=checks.every(x=>x.pass);
  return {qualified:passed,side,pattern:pattern?.name||null,checks,closedAt:f?.closedAt||null,price:finite(price)?price:null,stop:passed?Number(stop.toFixed(2)):null,target:passed?Number(target.toFixed(2)):null,timeframe:s.timeframe,warning:'Paper signal only; does not verify liquidity, wallet, fills, fees, live stops or a profitable edge.'};
}
export function createFridayEngine({reporter,now=Date.now,filePath=null}={}){
  let state={armed:false,settings:{...FRIDAY_DEFAULTS},lastCandle:null,lastEvaluation:null,events:[],updatedAt:null};
  let ready=null,queue=Promise.resolve(),running=false;
  async function init(){if(!ready)ready=(async()=>{if(!filePath)return;try{const saved=JSON.parse(await readFile(filePath,'utf8'));state={...state,settings:validateFridaySettings(saved.settings),lastCandle:typeof saved.lastCandle==='string'?saved.lastCandle:null,events:Array.isArray(saved.events)?saved.events.slice(-50):[],updatedAt:saved.updatedAt||null};
    // Never silently resume automatic processing after a server restart.
    state.armed=false;
  }catch(e){if(e.code!=='ENOENT')throw Error('Friday strategy state unreadable; monitoring is locked');}})();return ready;}
  function snapshot(){return {...state,mode:'PAPER_ONLY',liveExecutionAvailable:false,persistent:!!filePath};}
  function save(){if(!filePath)return Promise.resolve();queue=queue.then(async()=>{await mkdir(path.dirname(filePath),{recursive:true});const temp=filePath+'.tmp';await writeFile(temp,JSON.stringify(state));await rename(temp,filePath);});return queue;}
  async function control(command,settings){await init();if(!['arm','disarm','configure'].includes(command))throw Error('Invalid control');
    if(command==='arm'&&!filePath)throw Error('Persistent DATA_DIR is required to arm server monitoring');
    if(command==='configure'){if(state.armed)throw Error('Disarm before changing settings');state.settings=validateFridaySettings(settings);state.lastCandle=null;}
    if(command==='arm')state.armed=true;
    if(command==='disarm')state.armed=false;
    state.updatedAt=new Date(now()).toISOString();await save();return snapshot();}
  async function tick(){await init();if(!state.armed||running)return snapshot();running=true;
    try{const report=await reporter();if(report?.status!=='current')throw Error('Current completed-candle data unavailable');
      const result=qualifyFriday(report,state.settings,now());if(!result.closedAt||result.closedAt===state.lastCandle)return snapshot();
      state.lastCandle=result.closedAt;state.lastEvaluation=result;
      state.events.unshift({time:new Date(now()).toISOString(),candle:result.closedAt,decision:result.qualified?'QUALIFIED_PAPER':'WAIT',side:result.side,failed:result.checks.filter(x=>!x.pass).map(x=>x.name)});state.events=state.events.slice(0,50);state.updatedAt=new Date(now()).toISOString();await save();
    }catch(e){state.events.unshift({time:new Date(now()).toISOString(),decision:'ERROR',reason:String(e.message||'Data unavailable').slice(0,160)});state.events=state.events.slice(0,50);state.updatedAt=new Date(now()).toISOString();await save();}
    finally{running=false;}return snapshot();}
  return {init,control,tick,snapshot};
}
