import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||3000);
const QUESTION_SECONDS=Math.max(1,Math.min(300,Number(process.env.QUESTION_SECONDS)||30));
const PASSWORD=process.env.HOST_PASSWORD||'local-host-password';
const SECRET=process.env.SESSION_SECRET||'local-secret-only-for-development';
const STORE=path.resolve(process.env.DATABASE_PATH||path.join(ROOT,'data','krillion.json'));
if(process.env.NODE_ENV==='production'&&(PASSWORD==='local-host-password'||SECRET.length<32))throw new Error('Set HOST_PASSWORD and a 32+ character SESSION_SECRET');
const SEED=JSON.parse(fs.readFileSync(path.join(ROOT,'../questions.json'),'utf8')).filter(q=>q.type==='main').slice(0,7);
const QUESTIONS=SEED.map(q=>({question:q.text,answers:q.answers}));
fs.mkdirSync(path.dirname(STORE),{recursive:true});
let db;
try{db=JSON.parse(fs.readFileSync(STORE,'utf8'))}catch(err){if(err.code!=='ENOENT')throw err;db={games:[],players:[],answers:[],version:2};save()}
function save(){const tmp=STORE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,STORE)}
const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const id=()=>crypto.randomUUID();
function sign(payload){const content=Buffer.from(JSON.stringify(payload)).toString('base64url');const sig=crypto.createHmac('sha256',SECRET).update(content).digest('base64url');return content+'.'+sig}
function verify(token){try{const [content,sig]=String(token||'').split('.');if(!content||!sig)return null;const actual=crypto.createHmac('sha256',SECRET).update(content).digest();const provided=Buffer.from(sig,'base64url');if(actual.length!==provided.length||!crypto.timingSafeEqual(actual,provided))return null;return JSON.parse(Buffer.from(content,'base64url').toString())}catch{return null}}
function bearer(req){const authorization=(req.headers.authorization||'').replace(/^Bearer /i,'');const fromCookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('krillion_host='));return verify(authorization)||verify(fromCookie?.slice('krillion_host='.length))}
function authHost(req){const t=bearer(req);return t?.role==='host'&&Date.now()<t.expires}
function authPlayer(req){const t=bearer(req);return t?.role==='player'?db.players.find(p=>p.id===t.id&&p.tokenNonce===t.nonce):null}
function response(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload))}
function err(res,status,message){response(res,status,{error:message})}
async function parseBody(req){let content='';for await(const chunk of req){content+=chunk;if(content.length>20000)throw Error('Request too large')}try{return JSON.parse(content||'{}')}catch{throw Error('Invalid request format')}}
function gameByPin(pin){return db.games.find(g=>g.pin===String(pin))}
function gameQuestions(game){return game?.bank||QUESTIONS}
const ALLOWED_POINTS=new Set([10,15,30,60,85,100]);
function cleanBankRows(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>250)throw Error('Supply 1–250 approved answers');
 const used=new Set();
 return rows.map((entry,i)=>{
   const name=String(entry[0]||'').trim().slice(0,120),points=Number(entry[1]);
   const aliases=Array.isArray(entry[2])?entry[2].map(v=>String(v||'').trim().slice(0,120)).filter(Boolean):[];
   if(!name||!ALLOWED_POINTS.has(points)||aliases.length>12)throw Error('Invalid answer or points at row '+(i+1));
   const local=new Set(),uniqueAliases=[];
   for(const term of [name,...aliases]){
     const key=norm(term);if(!key)throw Error('Empty answer or alias');
     if(local.has(key))continue; // Spelling variants with identical normalization are harmless.
     if(used.has(key))throw Error('Answer appears under two different score tiers: '+term);
     local.add(key);used.add(key);
     if(term!==name)uniqueAliases.push(term);
   }
   return [name,points,uniqueAliases];
 });
}

function playerAnswers(playerId){return db.answers.filter(a=>a.playerId===playerId).sort((a,b)=>a.questionIndex-b.questionIndex)}
function sum(playerId){return playerAnswers(playerId).reduce((n,a)=>n+(a.points||0),0)}
function roster(game){const all=db.players.filter(p=>p.gameId===game.id).map(p=>{const answers=playerAnswers(p.id);const scores=QUESTIONS.map((_,i)=>answers.find(a=>a.questionIndex===i)?.points??null);return {id:p.id,name:p.name,pro:p.pro,answered:answers.length,pending:answers.filter(a=>a.status==='pending').length,scores,total:sum(p.id),completed:answers.length===7}});all.sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));let prev=null;all.forEach((p,i)=>{p.rank=prev&&prev.total===p.total?prev.rank:i+1;prev=p});return all}
function playerState(player){const game=db.games.find(g=>g.id===player.gameId);const answers=playerAnswers(player.id);const next=answers.length;const completed=next===7;const rounds=gameQuestions(game).map((q,i)=>{const a=answers.find(a=>a.questionIndex===i);return {number:i+1,question:q.question,answer:a?.answer??null,points:a?.points??null,status:a?.status??'unanswered',tier:a?.tier??null}});return {name:player.name,pro:player.pro,pin:game.pin,completed,answered:next,total:sum(player.id),pending:answers.filter(a=>a.status==='pending').length,question:completed?null:{number:next+1,text:gameQuestions(game)[next].question},timer:completed?null:{seconds:QUESTION_SECONDS,deadline:player.timerQuestion===next?player.timerDeadline??null:null,serverNow:Date.now()},rounds,leaderboard:completed?roster(game).filter(p=>p.completed).map(({name,rank,total,pending})=>({name,rank,total,pending})):[]}}
function scoreAnswer(questionIndex,text,game){const n=norm(text);if(!n)return null;const record=gameQuestions(game)[questionIndex].answers.find(row=>[row[0],...row.slice(2).flat()].some(a=>norm(a)===n));return record?{points:record[1],tier:({10:'PLANKTON',15:'TOO CLEVER',30:'SCHOOLER',60:'RARE',85:'DEEP CUT',100:'ONE IN A KRILLION'})[record[1]],canonical:record[0]}:null}
function scoreFromLegacyReview(gameId,index,text){
 const key=norm(text);
 const old=db.answers.find(a=>a.questionIndex===index&&a.status==='accepted'&&Number.isFinite(a.points)&&db.players.some(p=>p.id===a.playerId&&p.gameId===gameId)&&norm(a.answer)===key);
 return old?{points:old.points,tier:old.tier,canonical:old.canonical||old.answer}:null;
}
function csv(s){const v=String(s??'');return '"'+(/^[=+\-@\t\r]/.test(v)?"'":'')+v.replaceAll('"','""')+'"'}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
function staticFile(res,urlPath){const route=urlPath==='/'?'index.html':urlPath==='/host'?'host.html':urlPath.slice(1);const filename=path.resolve(ROOT,'public',route);if(!filename.startsWith(path.resolve(ROOT,'public')+path.sep))return err(res,403,'Forbidden');try{const content=fs.readFileSync(filename);res.writeHead(200,{'Content-Type':MIME[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content)}catch{return err(res,404,'Not found')}}
function goodPassword(value){const expected=crypto.createHash('sha256').update(PASSWORD).digest();const given=crypto.createHash('sha256').update(String(value||'')).digest();return crypto.timingSafeEqual(expected,given)}
async function readForm(req){let body='';for await (const chunk of req){body+=chunk;if(body.length>4096)throw Error('Form too large')}return Object.fromEntries(new URLSearchParams(body))}
function redirect(res,where,cookie){res.writeHead(303,{'Location':where,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end()}
const server=http.createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
try{
if(req.method==='POST'&&pathname==='/host/login'){
 const data=await readForm(req);
 if(!goodPassword(data.password))return redirect(res,'/host?error=incorrect');
 const signed=sign({role:'host',expires:Date.now()+7*86400000});
 return redirect(res,'/host?login=success','krillion_host='+signed+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800');
}
if(req.method==='GET'&&pathname==='/api/host/session')return response(res,200,{authenticated:!!authHost(req)});
if(req.method==='GET'&&pathname==='/api/health')return response(res,200,{ok:true,version:3,mode:'fixed-host-approved-scoring'});
if(req.method==='POST'&&pathname==='/api/host/login'){const body=await parseBody(req);if(!goodPassword(body.password))return err(res,401,'Incorrect organiser password');return response(res,200,{token:sign({role:'host',expires:Date.now()+7*86400000})})}
if(pathname.startsWith('/api/host/')&&!authHost(req))return err(res,401,'Organiser login required');
if(req.method==='GET'&&pathname==='/api/host/games')return response(res,200,db.games.map(g=>({pin:g.pin,id:g.id,status:g.status,createdAt:g.createdAt})).reverse());
if(req.method==='POST'&&pathname==='/api/host/games'){let pin;do{pin=String(crypto.randomInt(100000,1000000))}while(gameByPin(pin));const game={id:id(),pin,status:'draft',createdAt:new Date().toISOString(),bank:structuredClone(QUESTIONS),bankApprovedAt:null,reviewedQuestions:[]};db.games.push(game);save();return response(res,201,{pin,id:game.id,status:game.status})}
let bankMatch=pathname.match(/^\/api\/host\/games\/(\d{6})\/bank$/);
if(bankMatch){
 const game=gameByPin(bankMatch[1]);if(!game)return err(res,404,'Game not found');
 if(req.method==='GET')return response(res,200,{pin:game.pin,status:game.status,approvedAt:game.bankApprovedAt||null,reviewedQuestions:game.reviewedQuestions||[],questions:gameQuestions(game),note:'Starter tier values have not been empirically calibrated. Organiser must review and approve every question before publishing.'});
 if(req.method==='POST'){
  if(game.status!=='draft')return err(res,409,'Bank is locked once the game is published');
  const b=await parseBody(req),index=Number(b.questionIndex);
  if(!Number.isInteger(index)||index<0||index>=7)return err(res,400,'Invalid question number');
  let cleaned;try{cleaned=cleanBankRows(b.rows)}catch(error){return err(res,400,error.message)}
  game.bank[index].answers=cleaned;game.reviewedQuestions=[...new Set([...(game.reviewedQuestions||[]),index])].sort();save();
  return response(res,200,{ok:true,questionIndex:index,count:cleaned.length});
 }
}
bankMatch=pathname.match(/^\/api\/host\/games\/(\d{6})\/publish$/);
if(req.method==='POST'&&bankMatch){
 const game=gameByPin(bankMatch[1]);if(!game)return err(res,404,'Game not found');
 if(game.status!=='draft')return err(res,409,'Game already published or closed');
 if((game.reviewedQuestions||[]).length!==7)return err(res,409,'Review and save all seven question banks before publishing');
 const b=await parseBody(req);
 if(b.confirm!=='I reviewed and approved the full answer bank')return err(res,400,'Confirm that all seven answer lists and tier scores have been checked');
 try{game.bank.forEach(q=>cleanBankRows(q.answers))}catch(error){return err(res,400,error.message)}
 game.status='open';game.bankApprovedAt=new Date().toISOString();save();
 return response(res,200,{ok:true,pin:game.pin,status:game.status,approvedAt:game.bankApprovedAt});
}
let m=pathname.match(/^\/api\/host\/games\/(\d{6})$/);
if(req.method==='GET'&&m){const game=gameByPin(m[1]);if(!game)return err(res,404,'Game not found');const players=roster(game);const answers=db.answers.filter(a=>players.some(p=>p.id===a.playerId)).map(a=>({...a,player:players.find(p=>p.id===a.playerId)?.name,pro:players.find(p=>p.id===a.playerId)?.pro,question:gameQuestions(game)[a.questionIndex].question}));return response(res,200,{pin:game.pin,status:game.status,createdAt:game.createdAt,players,answers})}
m=pathname.match(/^\/api\/host\/games\/(\d{6})\/close$/);
if(req.method==='POST'&&m){const game=gameByPin(m[1]);if(!game)return err(res,404,'Game not found');game.status='closed';save();return response(res,200,{ok:true})}
m=pathname.match(/^\/api\/host\/games\/(\d{6})\/review$/);
if(req.method==='POST'&&m){const game=gameByPin(m[1]);if(!game)return err(res,404,'Game not found');const b=await parseBody(req),points=Number(b.points);if(![0,10,15,30,60,85,100].includes(points))return err(res,400,'Invalid score');const original=db.answers.find(a=>a.id===b.answerId&&db.players.some(p=>p.id===a.playerId&&p.gameId===game.id)&&a.status==='pending');if(!original)return err(res,404,'Pending answer not found');const related=db.answers.filter(a=>a.questionIndex===original.questionIndex&&norm(a.answer)===norm(original.answer)&&db.players.some(p=>p.id===a.playerId&&p.gameId===game.id));related.forEach(a=>{a.points=points;a.status=points===0?'rejected':'accepted';a.tier=points===0?'INVALID':({10:'PLANKTON',15:'TOO CLEVER',30:'SCHOOLER',60:'RARE',85:'DEEP CUT',100:'ONE IN A KRILLION'})[points]});save();return response(res,200,{ok:true,updated:related.length})}
m=pathname.match(/^\/api\/host\/games\/(\d{6})\/export\/(scores|answers)$/);
if(req.method==='GET'&&m){const game=gameByPin(m[1]);if(!game)return err(res,404,'Game not found');const players=roster(game);const rows=m[2]==='scores'?[['Rank','Name','PRO Number','Q1','Q2','Q3','Q4','Q5','Q6','Q7','Total','Answered','Pending','Completed'],...players.map(p=>[p.rank,p.name,p.pro,...p.scores,p.total,p.answered,p.pending,p.completed])]:[['Name','PRO Number','Question','Answer','Status','Points'],...db.answers.filter(a=>players.some(p=>p.id===a.playerId)).map(a=>{const p=players.find(x=>x.id===a.playerId);return[p.name,p.pro,gameQuestions(game)[a.questionIndex].question,a.answer,a.status,a.points]})];res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="krillion-'+m[2]+'-'+m[1]+'.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+rows.map(r=>r.map(csv).join(',')).join('\r\n'))}
m=pathname.match(/^\/api\/games\/(\d{6})\/join$/);
if(req.method==='POST'&&m){const game=gameByPin(m[1]);if(!game||game.status!=='open')return err(res,400,'Invalid or closed game PIN');const b=await parseBody(req),name=String(b.name||'').trim().slice(0,80),pro=String(b.pro||'').trim().slice(0,60);if(!name||!pro)return err(res,400,'Enter name and PRO number');if(db.players.some(p=>p.gameId===game.id&&norm(p.pro)===norm(pro)))return err(res,409,'PRO number already registered for this PIN');const player={id:id(),gameId:game.id,name,pro,tokenNonce:id()};db.players.push(player);save();return response(res,201,{token:sign({role:'player',id:player.id,nonce:player.tokenNonce}),pin:game.pin})}
if(pathname.startsWith('/api/me')){const p=authPlayer(req);if(!p)return err(res,401,'Player session expired. Use your original browser or join a new PIN');if(req.method==='GET'&&pathname==='/api/me')return response(res,200,playerState(p));
if(req.method==='POST'&&pathname==='/api/me/start'){
 const game=db.games.find(g=>g.id===p.gameId);
 if(game.status!=='open')return err(res,400,'This game is closed');
 const next=playerAnswers(p.id).length;
 if(next>=7)return err(res,400,'All seven questions are completed');
 if(p.timerQuestion!==next||!Number.isFinite(p.timerDeadline)){
   p.timerQuestion=next;
   p.timerDeadline=Date.now()+QUESTION_SECONDS*1000;
   save();
 }
 return response(res,200,{questionIndex:next,deadline:p.timerDeadline,seconds:QUESTION_SECONDS,serverNow:Date.now()});
}
if(req.method==='POST'&&pathname==='/api/me/timeout'){
 const game=db.games.find(g=>g.id===p.gameId);
 if(game.status!=='open')return err(res,400,'This game is closed');
 const next=playerAnswers(p.id).length;
 if(next>=7)return err(res,400,'All seven questions are completed');
 if(p.timerQuestion!==next||!Number.isFinite(p.timerDeadline))return err(res,409,'Question timer has not started');
 if(Date.now()<p.timerDeadline)return err(res,409,'Question time has not expired');
 const entry={id:id(),playerId:p.id,questionIndex:next,answer:'TIME UP',status:'timed_out',points:0,tier:'TIME UP',canonical:null};
 db.answers.push(entry);p.timerQuestion=null;p.timerDeadline=null;save();
 return response(res,200,{points:0,tier:'TIME UP',status:'timed_out',answer:'TIME UP',total:sum(p.id),next:next+1});
}if(req.method==='POST'&&pathname==='/api/me/answer'){const game=db.games.find(g=>g.id===p.gameId);if(game.status!=='open')return err(res,400,'This game is closed');const next=playerAnswers(p.id).length;if(next>=7)return err(res,400,'All seven questions are already completed');if(p.timerQuestion!==next||!Number.isFinite(p.timerDeadline))return err(res,409,'Start the question timer first');if(Date.now()>=p.timerDeadline)return err(res,409,'Time is up');const b=await parseBody(req),answer=String(b.answer||'').trim().slice(0,150);if(!answer)return err(res,400,'Type an answer');const fixed=!!game.bank;
const scoring=scoreAnswer(next,answer,game)||(fixed?null:scoreFromLegacyReview(p.gameId,next,answer));
const entry={id:id(),playerId:p.id,questionIndex:next,answer,status:scoring?'accepted':fixed?'unlisted':'pending',points:scoring?.points??(fixed?0:null),tier:scoring?.tier??(fixed?'NOT ON THE BOARD':null),canonical:scoring?.canonical??null};db.answers.push(entry);p.timerQuestion=null;p.timerDeadline=null;save();return response(res,200,{points:entry.points,tier:entry.tier,status:entry.status,answer,total:sum(p.id),next:next+1})}}
if(req.method==='GET'&&pathname==='/host'){
 const bad=new URL(req.url,'http://localhost').searchParams.get('error')==='incorrect';
 if(bad){const file=fs.readFileSync(path.join(ROOT,'public','host.html'),'utf8');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(file.replace('</form>','</form><p style="color:#b71c46;font-weight:bold" role="alert">Incorrect password. Try again.</p>'))}
}
if(req.method==='GET'&&!pathname.startsWith('/api/'))return staticFile(res,pathname);
return err(res,404,'Not found');
}catch(e){console.error('Request failed:',e);return err(res,500,'Server error. Please try again.')}});
server.listen(PORT,'0.0.0.0',()=>console.log('Krillion v2 ready on port '+PORT));