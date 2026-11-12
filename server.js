 'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=__dirname, pub=path.join(dir,'public'),data=path.resolve(process.env.DATA_DIR||path.join(dir,'data'));fs.mkdirSync(data,{recursive:true});
const PASSWORD=process.env.ADMIN_PASSWORD||'',SECRET=process.env.SESSION_SECRET||'',PORT=Number(process.env.PORT||3000);
if(!PASSWORD||SECRET.length<32){console.error('Set ADMIN_PASSWORD and SESSION_SECRET (32+ chars).');process.exit(1)}
const sessions=new Map(),attempts=new Map();
// Protect authenticated state-changing endpoints against cross-site requests.
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{const u=new URL(origin);const host=req.headers.host;return u.host===host&&(u.protocol==='https:'||(u.protocol==='http:'&&/^(localhost|127\.0\.1)(:\d+)?$/.test(host||'')))}catch{return false}}
function read(){try{return JSON.parse(fs.readFileSync(path.join(data,'campaigns.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e}}
function write(v){const target=path.join(data,'campaigns.json'),tmp=target+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(tmp,target)}
function ledger(){try{return JSON.parse(fs.readFileSync(path.join(data,'payments.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw e}}
function saveLedger(v){const f=path.join(data,'payments.json'),tmp=f+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(tmp,f)}
function totals(){const sums={};for(const v of Object.values(ledger())){if(v.campaignId&&v.status==='paid')sums[v.campaignId]=(sums[v.campaignId]||0)+Math.max(0,v.amount-(v.refunded||0))}return sums}
function withTotals(c){const t=totals();return c.map(x=>({...x,raised:(t[x.id]||0)/100}))}
function supporters(id){return Object.values(ledger()).filter(v=>v.campaignId===id&&v.status==='paid'&&v.amount>0).sort((a,b)=>String(b.paidAt||'').localeCompare(String(a.paidAt||''))).slice(0,20).map(v=>({name:v.anonymous===false&&v.displayName?v.displayName:'Anonymous',amount:v.amount/100,date:v.paidAt||null}))}
function cleanName(v){if(typeof v!=='string')return '';const n=v.trim().replace(/\s+/g,' ');if(n.length>60||/[<>\x00-\x1f]/.test(n))throw Error('Invalid supporter name');return n}

function rawBody(req,max=1048576){return new Promise((resolve,reject)=>{let a=[],n=0;req.on('data',b=>{n+=b.length;if(n>max){reject(Error('Request too large'));req.destroy()}else a.push(b)});req.on('end',()=>resolve(Buffer.concat(a)));req.on('error',reject)})}
async function stripeRequest(endpoint,params){const key=process.env.STRIPE_SECRET_KEY;if(!key||!/^sk_(test|live)_/.test(key))throw Error('Stripe not configured');const r=await fetch('https://api.stripe.com/v1/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});const j=await r.json();if(!r.ok)throw Error('Stripe request failed: '+(j.error?.type||r.status));return j}
function verifyStripe(body,header){const secret=process.env.STRIPE_WEBHOOK_SECRET;if(!secret||!header)return false;const parts=Object.fromEntries(header.split(',').map(x=>x.split('=',2)));const t=Number(parts.t);if(!Number.isFinite(t)||Math.abs(Date.now()/1000-t)>300)return false;const expected=crypto.createHmac('sha256',secret).update(t+'.'+body.toString()).digest('hex');return header.split(',').some(x=>{if(!x.startsWith('v1='))return false;const v=x.slice(3);return /^[a-f0-9]{64}$/i.test(v)&&crypto.timingSafeEqual(Buffer.from(v,'hex'),Buffer.from(expected,'hex'))})}
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
function cookie(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sid='))?.slice(4)}
function authed(req){const t=cookie(req);return !!(t&&sessions.get(crypto.createHash('sha256').update(t).digest('hex'))>Date.now())}
function limit(req){let k=req.socket.remoteAddress||'unknown',a=attempts.get(k)||[],now=Date.now();a=a.filter(x=>now-x<3600000);a.push(now);attempts.set(k,a);return a.length>20}
async function parse(req){let parts=[],n=0;for await(let x of req){n+=x.length;if(n>12000)throw Error('Request too large');parts.push(x)}return JSON.parse(Buffer.concat(parts).toString()||'{}')}
function validate(b){if(typeof b.title!=='string'||!b.title.trim()||b.title.length>100||typeof b.story!=='string'||b.story.trim().length<10||b.story.length>6000||!Number.isInteger(b.goal)||b.goal<1||b.goal>100000000||typeof b.image!=='string'||b.image.length>1500||(b.image&&!/^https:\/\//i.test(b.image))||typeof b.published!=='boolean')throw Error('Invalid fundraiser fields');return {title:b.title.trim(),story:b.story.trim(),goal:b.goal,image:b.image,published:b.published}}
const safeCompare=(a,b)=>{let x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=u.pathname;
if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&p!=='/api/stripe/webhook'&&!sameOrigin(req))return send(res,403,{error:'Invalid request origin'});
if(req.method==='GET'&&(p==='/'||/^\/f\/[a-f0-9-]{36}\/?$/.test(p))){let h=fs.readFileSync(path.join(pub,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});return res.end(h)}
if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,stripeConfigured:!!process.env.STRIPE_SECRET_KEY,webhookConfigured:!!process.env.STRIPE_WEBHOOK_SECRET});
if(req.method==='GET'&&p==='/api/campaigns')return send(res,200,withTotals(read().filter(x=>x.published)));
 let publicMatch=p.match(/^\/api\/campaigns\/([a-f0-9-]{36})$/);
 if(req.method==='GET'&&publicMatch){const c=read().find(x=>x.id===publicMatch[1]&&x.published);return c?send(res,200,{...withTotals([c])[0],supporters:supporters(c.id)}):send(res,404,{error:'Fundraiser unavailable'})}

if(req.method==='POST'&&p==='/api/login'){if(limit(req))return send(res,429,{error:'Too many login attempts'});let b=await parse(req);if(!safeCompare(b.password||'',PASSWORD))return send(res,401,{error:'Incorrect password'});let t=crypto.randomBytes(32).toString('hex');sessions.set(crypto.createHash('sha256').update(t).digest('hex'),Date.now()+8*3600000);res.setHeader('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);return send(res,200,{ok:true})}
if(req.method==='POST'&&p==='/api/logout'){let t=cookie(req);if(t)sessions.delete(crypto.createHash('sha256').update(t).digest('hex'));res.setHeader('Set-Cookie','sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true})}
if(p.startsWith('/api/admin/')){if(!authed(req))return send(res,401,{error:'Admin login required'});if(req.method==='GET'&&p==='/api/admin/campaigns')return send(res,200,withTotals(read()));if(req.method==='POST'&&p==='/api/admin/campaigns'){let b=validate(await parse(req)),a=read(),c={...b,id:crypto.randomUUID(),createdAt:new Date().toISOString()};a.unshift(c);write(a);return send(res,201,c)}let m=p.match(/^\/api\/admin\/campaigns\/([a-f0-9-]{36})$/);if(m){let a=read(),i=a.findIndex(x=>x.id===m[1]);if(i<0)return send(res,404,{error:'Not found'});if(req.method==='PUT'){a[i]={...a[i],...validate(await parse(req))};write(a);return send(res,200,a[i])}if(req.method==='DELETE'){a.splice(i,1);write(a);return send(res,200,{ok:true})}}}
if(req.method==='POST'&&p==='/api/checkout'){
const b=await parse(req),campaign=read().find(x=>x.id===b.campaignId&&x.published);
if(!campaign)return send(res,404,{error:'Fundraiser unavailable'});
const amount=Number(b.amount);if(!Number.isInteger(amount)||amount<100||amount>1000000)return send(res,400,{error:'Enter a donation from $1 to $10,000'});
 const anonymous=b.anonymous!==false,displayName=anonymous?'':cleanName(b.displayName);if(!anonymous&&!displayName)return send(res,400,{error:'Enter a name or choose anonymous'});
const base=process.env.PUBLIC_BASE_URL;if(!base||!(/^https:\/\/[^/]+\/?$/.test(base)||/^http:\/\/(localhost|127\.0\.1)(:\d+)?\/?$/.test(base)))return send(res,503,{error:'Website URL not configured'});
const params={'mode':'payment','success_url':base.replace(/\/$/,'')+'/f/'+campaign.id+'?donation=success','cancel_url':base.replace(/\/$/,'')+'/f/'+campaign.id+'?donation=cancelled','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(amount),'line_items[0][price_data][product_data][name]':'Donation: '+campaign.title,'line_items[0][quantity]':'1','client_reference_id':campaign.id,'metadata[campaign_id]':campaign.id,'metadata[anonymous]':anonymous?'true':'false','metadata[display_name]':displayName,'payment_intent_data[metadata][campaign_id]':campaign.id};
const checkout=await stripeRequest('checkout/sessions',params);return send(res,200,{url:checkout.url});}
if(req.method==='POST'&&p==='/api/stripe/webhook'){
const body=await rawBody(req);if(!verifyStripe(body,req.headers['stripe-signature']))return send(res,400,{error:'Invalid signature'});
const event=JSON.parse(body.toString()),obj=event.data?.object||{};let l=ledger();
if(event.type==='checkout.session.completed'&&obj.payment_status==='paid'||event.type==='checkout.session.async_payment_succeeded'){
const cid=obj.metadata?.campaign_id||obj.client_reference_id;
if(read().some(x=>x.id===cid)&&obj.currency==='usd'&&Number.isInteger(obj.amount_total))l[obj.id]={campaignId:cid,amount:obj.amount_total,refunded:l[obj.id]?.refunded||0,status:'paid',paymentIntent:obj.payment_intent||null,anonymous:obj.metadata?.anonymous!=='false',displayName:obj.metadata?.anonymous==='false'?cleanName(obj.metadata?.display_name||''):'',paidAt:l[obj.id]?.paidAt||new Date((event.created||Math.floor(Date.now()/1000))*1000).toISOString()};
}else if(event.type==='charge.refunded'||event.type==='charge.refund.updated'){
if(event.type==='charge.refunded')for(const item of Object.values(l)){if(item.paymentIntent&&item.paymentIntent===obj.payment_intent)item.refunded=Math.min(item.amount,Math.max(item.refunded||0,obj.amount_refunded||0))}
}
saveLedger(l);return send(res,200,{received:true});}
return send(res,404,{error:'Not found'});
}catch(e){console.error(e);send(res,e.message==='Request too large'?413:400,{error:e.message==='Invalid fundraiser fields'?e.message:'Unable to process request'})}}).listen(PORT,()=>console.log('ChangeLifes.org at http://localhost:'+PORT));
