// VaultX v24: fail-closed, read-only risk evidence. Never authorizes live entry
// from key-scoped history; portfolio coverage requires independent verification.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assessFridayRisk(data,{now=Date.now(),maxDailyLossUsd=0.25}={}){
  const reasons=[],r=data?.report||{};
  const day=new Date(now).toISOString().slice(0,10);
  const trades=Array.isArray(r.matchedTrades)?r.matchedTrades:[];
  const today=trades.filter(t=>typeof t.soldAt==='string'&&t.soldAt.slice(0,10)===day);
  const dailyRealizedUsd=today.reduce((n,t)=>n+Number(t.pnlUsd),0);
  if(!Number.isFinite(maxDailyLossUsd)||maxDailyLossUsd<=0)reasons.push('Daily loss cap misconfigured');
  if(!r.complete||!r.matchedFillCoverage)reasons.push('Coinbase fill history incomplete or unmatched');
  if(!data?.ordersComplete)reasons.push('Coinbase order inventory incomplete');
  if(!data?.accountsComplete||!data?.balancesValid||!Number.isFinite(data.balanceBtc))reasons.push('Coinbase balance inventory incomplete');
  if((data?.openBtcOrders||0)>0)reasons.push('Open BTC orders require resolution');
  if((data?.balanceBtc||0)>1e-8||(r.openBtc||0)>1e-8)reasons.push('BTC inventory remains open');
  if(!trades.every(t=>Number.isFinite(Number(t.pnlUsd))&&Number.isFinite(Date.parse(t.soldAt))))reasons.push('Invalid matched trading records');
  if(!Number.isFinite(dailyRealizedUsd))reasons.push('Daily P&L unavailable');
  else if(dailyRealizedUsd<=-maxDailyLossUsd)reasons.push('Daily realized loss cap reached');
  // Critical: a portfolio-scoped API token does not prove that all balances, transfers,
  // transactions, fills, other portfolios and collateral are accounted for.
  if(data?.portfolioCoverageVerified!==true)reasons.push('Full portfolio and transfer coverage not verified');
  return {ready:reasons.length===0,reasons,day,dailyRealizedUsd,
    maxDailyLossUsd,matchedTrades:trades.length,fillCount:r.fillCount||0,
    portfolioCoverageVerified:data?.portfolioCoverageVerified===true};
}
export function createFridayRiskLedger({filePath,now=Date.now}={}){
  let state=null,broken=false;
  async function load(){
    if(state)return;
    if(!filePath)throw Error('Persistent DATA_DIR required for risk journal');
    try{
      const parsed=JSON.parse(await readFile(filePath,'utf8'));
      if(parsed.version!==1||!Array.isArray(parsed.entries)||parsed.entries.some(e=>e.digest!==hash({at:e.at,day:e.day,ready:e.ready,realized:e.realized,reasons:e.reasons,previous:e.previous})))throw Error('Risk journal invalid');
      for(let i=1;i<parsed.entries.length;i++)if(parsed.entries[i].previous!==parsed.entries[i-1].digest)throw Error('Risk journal chain broken');
      state=parsed;
    }catch(e){if(e.code==='ENOENT')state={version:1,entries:[]};else{broken=true;throw Error('Risk journal corrupt/unreadable — human recovery required');}}
  }
  async function record(data,assessment){
    if(broken)throw Error('Risk journal requires recovery');
    await load();
    const at=new Date(now()).toISOString(),previous=state.entries.at(-1)?.digest||null;
    const base={at,day:assessment.day,ready:assessment.ready,realized:assessment.dailyRealizedUsd,reasons:assessment.reasons,previous};
    const entry={...base,digest:hash(base)};
    // Small append-only snapshot; never store private credentials, account IDs or raw trades.
    const next={version:1,entries:[...state.entries,entry]};
    const temp=filePath+'.tmp';await mkdir(path.dirname(filePath),{recursive:true});
    await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,filePath);
    state=next;
    return {persistent:true,entries:next.entries.length,lastCheckedAt:at,lastDigest:entry.digest.slice(0,16)};
  }
  return {record};
}
