// Read-only execution readiness assessment. No submit/cancel/transfer API use.
export const FRIDAY_LIVE_AUTO_EXECUTION_ENABLED=false;
const finiteNonnegative=x=>Number.isFinite(Number(x))&&Number(x)>=0;
const OPEN_STATUSES=new Set(['OPEN','PENDING','QUEUED','CANCEL_QUEUED','EDIT_QUEUED','UNKNOWN','ACTIVE','PARTIALLY_FILLED']);
export function classifyBtcOrders(orders){
  if(!Array.isArray(orders))throw Error('Order list unavailable');
  const btc=orders.filter(o=>o.productId==='BTC-USD');
  const uncertain=btc.filter(o=>!o.status||OPEN_STATUSES.has(String(o.status).toUpperCase())||!['FILLED','CANCELLED','CANCELED','EXPIRED','FAILED','REJECTED','SETTLED'].includes(String(o.status).toUpperCase()));
  return {recentCount:btc.length,unsettledCount:uncertain.length,unsettled:uncertain.slice(0,5).map(o=>({orderId:o.orderId,status:o.status,side:o.side})),coverage:'latest 25 orders only; not guaranteed exhaustive'};
}
export function assessFridayReadiness({accounts,orders,fills,liveTradingEnabled=false,maxOrderUsd=0,persistent=false,checksError=null}={}){
  const checks=[];const add=(name,passed,detail)=>checks.push({name,passed:!!passed,detail:String(detail)});
  const usd=Array.isArray(accounts)?accounts.find(x=>x.currency==='USD'):null;
  const btc=Array.isArray(accounts)?accounts.find(x=>x.currency==='BTC'):null;
  const availableUsd=usd&&finiteNonnegative(usd.availableBalance)?Number(usd.availableBalance):null;
  const availableBtc=btc&&finiteNonnegative(btc.availableBalance)?Number(btc.availableBalance):null;
  let orderSummary=null;
  try{orderSummary=classifyBtcOrders(orders);}catch{}
  add('Coinbase read access',!checksError&&Array.isArray(accounts)&&Array.isArray(orders)&&Array.isArray(fills),checksError||'Accounts, recent orders and recent fills fetched');
  add('Available USD known',availableUsd!==null,'USD available: '+(availableUsd===null?'unknown':availableUsd.toFixed(2)));
  add('Available BTC known',availableBtc!==null,'BTC available: '+(availableBtc===null?'unknown':availableBtc.toFixed(8)));
  add('No unresolved BTC orders in sample',!!orderSummary&&orderSummary.unsettledCount===0,orderSummary?`${orderSummary.unsettledCount} unresolved / recent 25 only`:'Orders unavailable');
  add('Persistent bot data path',!!persistent,'Requires durable DATA_DIR on Render');
  add('Manual execution switch',!!liveTradingEnabled,'Does not grant automatic execution');
  add('Positive manual order cap',Number.isFinite(Number(maxOrderUsd))&&Number(maxOrderUsd)>0,'Manual cap: $'+(Number(maxOrderUsd)||0).toFixed(2));
  add('Complete open-order and position reconciliation',false,'Needs paginated orders, all portfolios, fills, and position ownership');
  add('Verified protected exit lifecycle',false,'Attached stop/target acceptance, fills, partial fills and cancellation recovery not verified');
  add('Daily realized-loss and aggregate exposure lock',false,'No authoritative daily P&L and total at-risk exposure ledger');
  add('Restart/redeploy kill-safe recovery',false,'Pending order reconciliation and durable idempotency not verified');
  add('Live bot execution gate',FRIDAY_LIVE_AUTO_EXECUTION_ENABLED,'Hard-disabled in this build');
  return {mode:'READ_ONLY',automaticExecutionEnabled:false,readyForUnattendedTrading:false,checkedAt:new Date().toISOString(),checks,balances:{usd:availableUsd,btc:availableBtc},orders:orderSummary,recentFillsCount:Array.isArray(fills)?fills.length:null,warning:'Recent orders and fills may be incomplete due to pagination. These results never authorize an unattended order.'};
}
