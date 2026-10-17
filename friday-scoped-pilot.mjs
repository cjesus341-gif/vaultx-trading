// Explicit one-entry experimental Coinbase scoped-portfolio pilot.
// Does not represent full account-history or transfer reconciliation.
export function assessScopedPilot({permissions,portfolios,accounts}={}) {
  const reasons=[];
  if(permissions?.can_trade!==true||permissions?.can_view!==true) reasons.push('Coinbase key must explicitly permit view and trade');
  const keyId=permissions?.portfolio_uuid;
  const visible=portfolios?.portfolios;
  if(!keyId||!Array.isArray(visible)||visible.length!==1||
     !visible.some(p=>(p.uuid||p.portfolio_uuid)===keyId))reasons.push('Exactly one visible portfolio must match the API key');
  if(accounts?.complete!==true||!Array.isArray(accounts?.rows)||!accounts.rows.length)reasons.push('Account inventory is incomplete');
  for(const account of accounts?.rows||[]){
    const p=account.retail_portfolio_id||account.retail_portfolio_uuid;
    if(p&&p!==keyId)reasons.push('An account belongs to a different portfolio');
    const available=Number(account.available_balance?.value),hold=Number(account.hold?.value);
    if(!Number.isFinite(available)||available<0||!Number.isFinite(hold)||hold<0)reasons.push('Account balances invalid');
  }
  return {ok:reasons.length===0,reasons:[...new Set(reasons)],scope:'KEY_PORTFOLIO_ONLY',fullTransferHistoryVerified:false};
}
