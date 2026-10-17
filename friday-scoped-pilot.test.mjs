import test from 'node:test';
import assert from 'node:assert/strict';
import {assessScopedPilot} from './friday-scoped-pilot.mjs';
const good={permissions:{can_view:true,can_trade:true,portfolio_uuid:'vault'},portfolios:{portfolios:[{uuid:'vault'}]},accounts:{complete:true,rows:[{currency:'BTC',available_balance:{value:'0'},hold:{value:'0'}}]}};
test('single scoped portfolio allowed, but full history never asserted',()=>{const s=assessScopedPilot(good);assert.equal(s.ok,true);assert.equal(s.fullTransferHistoryVerified,false)});
test('no trade permission blocked',()=>assert.equal(assessScopedPilot({...good,permissions:{...good.permissions,can_trade:false}}).ok,false));
test('multiple portfolios blocked',()=>assert.equal(assessScopedPilot({...good,portfolios:{portfolios:[{uuid:'vault'},{uuid:'other'}]}}).ok,false));
test('incomplete accounts blocked',()=>assert.equal(assessScopedPilot({...good,accounts:{complete:false,rows:[]}}).ok,false));
test('foreign account blocked',()=>assert.equal(assessScopedPilot({...good,accounts:{complete:true,rows:[{retail_portfolio_id:'other',available_balance:{value:'0'},hold:{value:'0'}}]}}).ok,false));
