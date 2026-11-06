// Strict user-supplied TradingView chart CSV parser. No storage or network access.
export function parseTradingViewCsv(csv,{maxRows=40000}={}){
 if(typeof csv!=='string'||csv.length>5_000_000)throw Error('CSV exceeds 5 MB limit');
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const cols=lines.shift()?.split(',').map(s=>s.trim().replace(/^"|"$/g,'').toLowerCase())||[];
 const idx=(...names)=>cols.findIndex(c=>names.includes(c));
 const ti=idx('time','timestamp','date'),o=idx('open'),h=idx('high'),l=idx('low'),c=idx('close'),v=idx('volume','vol');
 if([ti,o,h,l,c].some(n=>n<0))throw Error('CSV requires time, open, high, low, close columns');
 if(lines.length>maxRows)throw Error('Too many candles; maximum '+maxRows);
 const bars=lines.filter(x=>x.trim()).map((line,i)=>{
  const values=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));
  const raw=values[ti],numeric=Number(raw);
  const ms=raw!==''&&Number.isFinite(numeric)?numeric*(numeric<1e11?1000:1):Date.parse(raw);
  if(!Number.isFinite(ms)||ms%900000!==0)throw Error('Invalid or non-15-minute-aligned timestamp on row '+(i+2));
  const bar={time:new Date(ms).toISOString(),open:Number(values[o]),high:Number(values[h]),low:Number(values[l]),close:Number(values[c]),volume:v>=0&&values[v]!==''?Number(values[v]):0};
  if(![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite)||bar.low<=0||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)||bar.volume<0)throw Error('Invalid OHLCV on row '+(i+2));
  return bar;
 });
 bars.sort((a,b)=>a.time.localeCompare(b.time));
 for(let i=1;i<bars.length;i++)if(bars[i].time===bars[i-1].time)throw Error('Duplicate timestamps in CSV');
 if(bars.length<70)throw Error('At least 70 candles required');
 return bars;
}
