// V32: turn a fresh V31 paper LONG into a candidate for the EXISTING guarded order pipeline.
// This is only a nomination, never a trade authorization; previews, costs and global exposure checks follow.
import {DEFAULT_WATCHLIST} from './friday-market-selector.mjs';
export function selectDualSpotLong(scan,{requireFeeWarningClear=false}={}){
 if(!scan||scan.readOnly!==true||!Array.isArray(scan.results))return null;
 const list=scan.results.filter(r=>DEFAULT_WATCHLIST.includes(r.productId)&&r.long?.qualified===true&&
    typeof r.closedAt==='string'&&Number.isFinite(Date.parse(r.closedAt))&&
    Number.isFinite(Number(r.long.entry))&&Number(r.long.entry)>0&&
    Number(r.long.stop)>0&&Number(r.long.stop)<Number(r.long.entry)&&
    Number(r.long.target)>Number(r.long.entry)&&
    (!requireFeeWarningClear||r.long.costViable===true));
 list.sort((a,b)=>(Number(b.long.estimatedNetRR)||0)-(Number(a.long.estimatedNetRR)||0)||a.productId.localeCompare(b.productId));
 const chosen=list[0];
 if(!chosen)return null;
 return {productId:chosen.productId,side:'LONG',qualified:true,closedAt:chosen.closedAt,
   price:chosen.long.entry,stop:chosen.long.stop,target:chosen.long.target,
   source:'V31_DUAL_SPOT_LONG',technicalScore:chosen.long.estimatedNetRR};
}
