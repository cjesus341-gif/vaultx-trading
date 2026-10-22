// Read-only quote validation for EDITH. Never calls an order endpoint.
const positive = value => { const n=Number(value); return Number.isFinite(n)&&n>0?n:null; };
export function quoteFromProduct(data, observedAt) {
  const product=data?.product||data;
  const price=positive(product?.price);
  return price?{price,observedAt,source:'coinbase-product'}:null;
}
export function quoteFromBook(data, productId, observedAt) {
  const books=Array.isArray(data?.pricebooks)?data.pricebooks:[];
  const book=books.find(x=>x?.product_id===productId);
  if(!book)return null;
  const bid=positive(book.bids?.[0]?.price),ask=positive(book.asks?.[0]?.price);
  if(!bid||!ask||bid>ask||((ask-bid)/((ask+bid)/2))>.05)return null;
  return {price:(bid+ask)/2,observedAt,source:'coinbase-best-bid-ask',bid,ask};
}
export async function readEdithQuote({id,now,readProduct,readBook}){
  let productError=null;
  try {const product=await readProduct(id);const quote=quoteFromProduct(product,new Date(now()).toISOString());if(quote)return quote;}
  catch(e){productError=e?.message||String(e);}
  let bookError=null;
  try {const book=await readBook(id);const quote=quoteFromBook(book,id,new Date(now()).toISOString());if(quote)return quote;}
  catch(e){bookError=e?.message||String(e);}
  throw Error('EDITH quote unavailable for '+id+' (product price missing/invalid'+(productError?'; product request: '+String(productError).slice(0,75):'')+(bookError?'; bid/ask request: '+String(bookError).slice(0,75):'')+')');
}
