// VaultX v14: deterministic dry-run exchange adapter and fail-closed order-lifecycle drills.
// Never imports exchange credentials and never submits any network requests.
export function createDryRunExecutor({limitUsd=10,dailyLossLimitUsd=2}={}) {
  if(!Number.isFinite(limitUsd)||limitUsd<=0||!Number.isFinite(dailyLossLimitUsd)||dailyLossLimitUsd<=0)throw Error('Invalid limits');
  let halted=false, realizedLossUsd=0;
  const orders=new Map(),events=[];
  const push=(type,order,more={})=>events.push({type,clientOrderId:order?.clientOrderId||null,...more});
  function prepare({clientOrderId,quantity,entry,stop,target,feeReserveUsd=0.02}){
    if(halted||realizedLossUsd>=dailyLossLimitUsd)throw Error('Daily risk lock active');
    if(typeof clientOrderId!=='string'||!/^friday-[a-f0-9]{16,64}$/.test(clientOrderId))throw Error('Invalid client order ID');
    if(orders.has(clientOrderId))throw Error('Duplicate order intent');
    if(![quantity,entry,stop,target,feeReserveUsd].every(x=>typeof x==='number'&&Number.isFinite(x)))throw Error('Invalid order numbers');
    if(!(quantity>0&&entry>0&&stop>0&&stop<entry&&target>entry&&feeReserveUsd>=0))throw Error('Invalid protective levels');
    if(quantity*entry+feeReserveUsd>limitUsd)throw Error('Exposure cap exceeded');
    const order={clientOrderId,quantity,entry,stop,target,feeReserveUsd,filled:0,protectedQuantity:0,state:'PREPARED',exit:null};
    orders.set(clientOrderId,order);push('PREPARED',order);return order;
  }
  function acknowledge(id){const o=required(id);if(o.state!=='PREPARED')throw Error('Invalid acknowledgment');o.state='ACKNOWLEDGED';push('ACKNOWLEDGED',o);return o;}
  function required(id){const o=orders.get(id);if(!o)throw Error('Unknown order');return o;}
  function fill(id,quantity){const o=required(id);if(!['ACKNOWLEDGED','PARTIAL'].includes(o.state))throw Error('Cannot fill order');if(!Number.isFinite(quantity)||quantity<=0||quantity>o.quantity-o.filled+1e-10)throw Error('Invalid fill');o.filled=Number((o.filled+quantity).toFixed(10));o.state=o.filled+1e-10>=o.quantity?'FILLED':'PARTIAL';push(o.state,o,{filled:o.filled});return o;}
  function attachProtection(id,quantity){const o=required(id);if(!['FILLED','PARTIAL','PROTECTED'].includes(o.state))throw Error('No filled quantity to protect');if(!Number.isFinite(quantity)||quantity<=0||quantity>o.filled+1e-10)throw Error('Invalid protection quantity');o.protectedQuantity=quantity;o.state='PROTECTED';push('PROTECTED',o,{protectedQuantity:quantity});return o;}
  function reject(id){const o=required(id);if(o.filled>0)throw Error('Filled order cannot be rejected');o.state='REJECTED';push('REJECTED',o);return o;}
  function exit(id,price){const o=required(id);if(o.state!=='PROTECTED'||o.protectedQuantity+1e-10<o.filled)throw Error('Unprotected quantity blocks exit');if(!Number.isFinite(price)||price<=0)throw Error('Invalid exit price');const gross=(price-o.entry)*o.filled;const net=gross-o.feeReserveUsd;realizedLossUsd+=Math.max(0,-net);o.exit={price,net};o.state='CLOSED';push('CLOSED',o,{net});if(realizedLossUsd>=dailyLossLimitUsd){halted=true;push('DAILY_LOSS_HALT',o,{realizedLossUsd});}return o;}
  function recoverAfterRestart(id,exchangeStatus){const o=required(id);if(!exchangeStatus||!exchangeStatus.authoritative||exchangeStatus.clientOrderId!==id){halted=true;push('RESTART_UNCERTAIN',o);return {ok:false,halted:true};}if(!['REJECTED','CANCELLED','CLOSED'].includes(exchangeStatus.state)){halted=true;push('RESTART_UNRESOLVED',o);return {ok:false,halted:true};}o.state=exchangeStatus.state;push('RESTART_RECONCILED',o);return {ok:true,halted};}
  return {prepare,acknowledge,fill,attachProtection,reject,exit,recoverAfterRestart,get:(id)=>orders.get(id),snapshot:()=>({halted,realizedLossUsd,events:[...events],orders:[...orders.values()].map(x=>({...x}))})};
}
export function runExecutionDrills(){
  const checks=[];
  const check=(name,fn)=>{try{fn();checks.push({name,passed:true,detail:'Simulation passed'})}catch(e){checks.push({name,passed:false,detail:e.message})}};
  const id=n=>'friday-'+n.toString(16).padStart(32,'0');
  check('Rejected entry creates no position',()=>{const x=createDryRunExecutor();x.prepare({clientOrderId:id(1),quantity:.00005,entry:80000,stop:79000,target:83000});x.reject(id(1));if(x.get(id(1)).filled!==0)throw Error('Rejected entry filled');});
  check('Duplicate client order IDs blocked',()=>{const x=createDryRunExecutor(),o={clientOrderId:id(2),quantity:.00005,entry:80000,stop:79000,target:83000};x.prepare(o);let blocked=false;try{x.prepare(o)}catch{blocked=true}if(!blocked)throw Error('Duplicate was accepted');});
  check('Partial fill requires exact protective quantity',()=>{const x=createDryRunExecutor();x.prepare({clientOrderId:id(3),quantity:.0001,entry:80000,stop:79000,target:83000});x.acknowledge(id(3));x.fill(id(3),.00004);x.attachProtection(id(3),.00004);if(x.get(id(3)).protectedQuantity!==.00004)throw Error('Protection not attached');});
  check('Invalid stop or target rejected',()=>{const x=createDryRunExecutor();let blocked=false;try{x.prepare({clientOrderId:id(4),quantity:.00005,entry:80000,stop:81000,target:83000})}catch{blocked=true}if(!blocked)throw Error('Bad stop accepted');});
  check('Daily loss cap halts next entry',()=>{const x=createDryRunExecutor({dailyLossLimitUsd:.05});x.prepare({clientOrderId:id(5),quantity:.0001,entry:80000,stop:79000,target:83000});x.acknowledge(id(5));x.fill(id(5),.0001);x.attachProtection(id(5),.0001);x.exit(id(5),79000);let blocked=false;try{x.prepare({clientOrderId:id(6),quantity:.00001,entry:80000,stop:79000,target:83000})}catch{blocked=true}if(!blocked)throw Error('Loss limit bypassed');});
  check('Unknown restart outcome halts trading',()=>{const x=createDryRunExecutor();x.prepare({clientOrderId:id(7),quantity:.00005,entry:80000,stop:79000,target:83000});if(x.recoverAfterRestart(id(7),null).ok||!x.snapshot().halted)throw Error('Recovery failed open');});
  check('Exposure cap enforced',()=>{const x=createDryRunExecutor({limitUsd:5});let blocked=false;try{x.prepare({clientOrderId:id(8),quantity:.0001,entry:80000,stop:79000,target:83000})}catch{blocked=true}if(!blocked)throw Error('Exposure cap bypassed');});
  check('Exit blocked if fill is unprotected',()=>{const x=createDryRunExecutor();x.prepare({clientOrderId:id(9),quantity:.00005,entry:80000,stop:79000,target:83000});x.acknowledge(id(9));x.fill(id(9),.00005);let blocked=false;try{x.exit(id(9),79000)}catch{blocked=true}if(!blocked)throw Error('Unprotected exit accepted');});
  return {mode:'SIMULATION_ONLY',allPassed:checks.every(x=>x.passed),passed:checks.filter(x=>x.passed).length,total:checks.length,checks,liveExchangeVerified:false,liveTradingEnabled:false};
}
