// Exchange-scoped read-only inventory. No order submission, mutation or credential exposure.
const positiveInt=(x,max)=>Number.isInteger(x)&&x>0&&x<=max;
export async function paginateAdvanced(request,endpoint,{field,query={},maxPages=20,limit=100}={}){
  if(!['accounts','fills'].includes(field)||!positiveInt(maxPages,50)||!positiveInt(limit,250))throw Error('Invalid inventory settings');
  const rows=[],ids=new Set(),cursors=new Set();let pages=0,cursor=null,complete=false,issue=null;
  for(let i=0;i<maxPages;i++){
    const data=await request('GET',endpoint,{query:{...query,limit,...(cursor?{cursor}:{})}});
    if(!Array.isArray(data?.[field]))throw Error('Missing Coinbase '+field+' array');
    for(const row of data[field]){
      const id=String(field==='accounts'?(row.uuid||''):(row.entry_id||row.trade_id||''));
      if(!id){issue='Missing immutable '+field+' identifier';continue;}
      if(ids.has(id))continue;ids.add(id);rows.push(row);
    }
    pages++;
    const next=typeof data.cursor==='string'&&data.cursor.trim()?data.cursor:null;
    // Coinbase fills return a next-page cursor but may omit has_next entirely.
    // Accounts explicitly expose has_next; keep that endpoint fail-closed.
    if(field==='fills'){
      if(data.has_next===false){complete=true;break;}
      if(!next){
        if(data.has_next===true){issue='Next fill page indicated without cursor';break;}
        complete=true;break;
      }
    }else{
      if(data.has_next===false){complete=true;break;}
      if(data.has_next!==true||!next){issue='Missing next account page cursor';break;}
    }
    if(cursors.has(next)){issue='Repeated next-page cursor';break;}
    cursors.add(next);cursor=next;
  }
  if(!complete&&!issue)issue='Reached page cap';
  if(issue)complete=false;
  return {rows,pages,complete,issue,scope:'Authenticated Coinbase API-key portfolio only'};
}
export function auditPortfolio({accountsInventory,ordersInventory,fillsInventory,price}={}){
  const acc=accountsInventory?.rows,orders=ordersInventory?.orders,fills=fillsInventory?.rows;
  const closed=!!accountsInventory?.complete&&!!ordersInventory?.complete&&!!fillsInventory?.complete;
  const btc=Array.isArray(acc)?acc.filter(a=>a.currency==='BTC'):[];
  const usd=Array.isArray(acc)?acc.filter(a=>a.currency==='USD'):[];
  const parse=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?n:null;};
  const btcTotal=btc.length?btc.reduce((t,a)=>t+Number(a.available_balance?.value||0)+Number(a.hold?.value||0),0):null;
  const usdTotal=usd.length?usd.reduce((t,a)=>t+Number(a.available_balance?.value||0),0):null;
  const holdingsVerified=btc.length>0&&btc.every(a=>parse(a.available_balance?.value)!==null&&parse(a.hold?.value)!==null);
  const anyOpen=Array.isArray(orders)?orders.some(o=>!['FILLED','CANCELLED','CANCELED','EXPIRED','FAILED','REJECTED','SETTLED'].includes(String(o.status||'').toUpperCase())):true;
  // Exchange fills don't establish accurate cost basis when pre-existing assets/transfers are possible.
  return {completeApiScope:closed,accountsPages:accountsInventory?.pages??0,ordersPages:ordersInventory?.pages??0,fillsPages:fillsInventory?.pages??0,btcTotal:holdingsVerified?btcTotal:null,usdAvailable:usdTotal,btcExposureUsd:holdingsVerified&&Number.isFinite(price)&&price>0?btcTotal*price:null,unresolvedOrders:anyOpen,checks:[
    {name:'Exchange-scoped account pagination',passed:!!accountsInventory?.complete,detail:accountsInventory?.issue||'All returned account pages inspected'},
    {name:'Exchange-scoped fill pagination',passed:!!fillsInventory?.complete,detail:fillsInventory?.issue||'All returned fill pages inspected'},
    {name:'Exchange-scoped BTC exposure measured',passed:closed&&holdingsVerified&&!anyOpen&&Number.isFinite(price)&&price>0,detail:'Only for the API-key portfolio; BTC holdings and open orders must be known'},
    {name:'Portfolio-wide cost basis / daily P&L verified',passed:false,detail:'Cannot reconstruct authoritative realized P&L from fills alone; transfers and other portfolios may exist'},
    {name:'Other Coinbase portfolios reconciled',passed:false,detail:'Coinbase API key is scoped to one portfolio; other portfolios need separate authorized access'}
  ]};
}
