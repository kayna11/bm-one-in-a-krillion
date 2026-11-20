import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {Server} from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {norm,matchAnswer,rankPlayers,safeCsv,TIERS} from './scoring.js';

const PORT=Number(process.env.PORT||3000), SECRET=process.env.SESSION_SECRET||'DEVELOPMENT_ONLY_NOT_FOR_PRODUCTION', HOST_PASSWORD=process.env.HOST_PASSWORD||'development-only';
if(process.env.NODE_ENV==='production' && (SECRET.length<32||HOST_PASSWORD==='development-only')) throw Error('Set strong HOST_PASSWORD and SESSION_SECRET');
const dbPath=path.resolve(process.env.DATABASE_PATH||'./data/game.sqlite');fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT, position INTEGER NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL, bank TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, pin TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'lobby', current_index INTEGER NOT NULL DEFAULT -1, deadline INTEGER DEFAULT 0, duration INTEGER DEFAULT 20, revealed INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), name TEXT NOT NULL, college TEXT NOT NULL, reg_id TEXT NOT NULL, token_hash TEXT NOT NULL, joined_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(game_id,reg_id));
CREATE TABLE IF NOT EXISTS submissions(game_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id), question_id INTEGER NOT NULL REFERENCES questions(id), raw_answer TEXT NOT NULL, canonical TEXT, points INTEGER, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(game_id,player_id,question_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, game_id TEXT, actor TEXT, action TEXT, detail TEXT, occurred_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
// Existing PINs created by the earlier host-controlled version should stay usable.
// Previously finished games remain closed; only in-progress legacy sessions migrate.
db.prepare("UPDATE games SET status='open' WHERE status IN ('lobby','active','review')").run();
if(db.prepare('SELECT count(*) c FROM questions').get().c===0){
 const seed=JSON.parse(fs.readFileSync(new URL('./questions.json',import.meta.url),'utf8'));
 const insert=db.prepare('INSERT INTO questions(position,type,text,bank) VALUES(?,?,?,?)');
 db.transaction(()=>seed.forEach((q,i)=>insert.run(i,q.type,q.text,JSON.stringify(q.answers.map(a=>({answer:a[0],score:a[1],aliases:a[2]||[],source:'curated_seed'}))))))();
}
const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'200kb'}));app.use('/api',rateLimit({windowMs:60_000,limit:160,standardHeaders:'draft-7',legacyHeaders:false}));app.use(express.static(path.resolve('public')));
app.get('/host',(_req,res)=>res.sendFile(path.resolve('public/host.html')));
app.get('/screen',(_req,res)=>res.sendFile(path.resolve('public/screen.html')));
const server=http.createServer(app),io=new Server(server,{cors:{origin:false}});
const uid=()=>crypto.randomUUID();const mac=s=>crypto.createHmac('sha256',SECRET).update(s).digest('hex');
const token=(role,id)=>{const core=`${role}.${id}.${Date.now()}`;return core+'.'+mac(core)};
function parseToken(t){if(!t||typeof t!=='string')return null;const parts=t.split('.');if(parts.length!==4)return null;const core=parts.slice(0,3).join('.');if(!crypto.timingSafeEqual(Buffer.from(mac(core)),Buffer.from(parts[3].padEnd(64,'0').slice(0,64))))return null;return {role:parts[0],id:parts[1],created:Number(parts[2])}}
function host(req,res,next){const t=parseToken((req.headers.authorization||'').replace(/^Bearer /,''));if(!t||t.role!=='host'||Date.now()-t.created>86400000*7)return res.status(401).json({error:'Host login required'});next()}
function player(req,res,next){const t=parseToken((req.headers.authorization||'').replace(/^Bearer /,''));if(!t||t.role!=='player')return res.status(401).json({error:'Join game first'});const p=db.prepare('SELECT * FROM players WHERE id=?').get(t.id);if(!p||p.token_hash!==mac((req.headers.authorization||'').replace(/^Bearer /,'')))return res.status(401).json({error:'Session expired'});req.player=p;next()}
const questions=()=>db.prepare('SELECT * FROM questions ORDER BY position').all().map(q=>({...q,bank:JSON.parse(q.bank)}));
const gameByPin=p=>db.prepare('SELECT * FROM games WHERE pin=?').get(p);
const gameById=id=>db.prepare('SELECT * FROM games WHERE id=?').get(id);
const qAt=g=>questions().filter(q=>q.type==='main' || (g.current_index>=7 && q.type==='tie'))[g.current_index];
function entries(g){const ps=db.prepare('SELECT id,name,college,reg_id FROM players WHERE game_id=? ORDER BY joined_at').all(g.id);
 const qs=questions(),subs=db.prepare('SELECT * FROM submissions WHERE game_id=?').all(g.id);
 return rankPlayers(ps.map(p=>{const scores=Array(7).fill(0);for(const s of subs.filter(x=>x.player_id===p.id)){const k=qs.find(x=>x.id===s.question_id);if(k?.type==='main' && k.position<7)scores[k.position]=s.points||0;}return {...p,scores,total:scores.reduce((a,b)=>a+b,0),tieScore:subs.filter(x=>x.player_id===p.id&&qs.find(q=>q.id===x.question_id)?.type==='tie').reduce((a,b)=>a+(b.points||0),0)}}));}
function state(g,admin=false,pid=null){if(!g)return null;const q=qAt(g);const all=entries(g);const sub=q&&pid?db.prepare('SELECT raw_answer,status,points FROM submissions WHERE game_id=? AND player_id=? AND question_id=?').get(g.id,pid,q.id):null;
return {pin:g.pin,status:g.status,current:g.current_index,deadline:g.deadline,serverNow:Date.now(),duration:g.duration,revealed:!!g.revealed,question:g.current_index>=0&&q?{text:q.text,number:g.current_index+1,type:q.type}:null,players:all.length,submitted:q?db.prepare('SELECT count(*) n FROM submissions WHERE game_id=? AND question_id=?').get(g.id,q.id).n:0,me:sub||null,leaderboard:g.revealed||g.status==='finished'||admin?all.map(({id,name,college,total,rank,scores,tieScore,reg_id})=>admin?{id,name,college,total,rank,scores,tieScore,reg_id}:{name,college,total,rank}):[], ...(admin?{submissions:q?db.prepare('SELECT s.*,p.name,p.college,p.reg_id FROM submissions s JOIN players p ON p.id=s.player_id WHERE s.game_id=? AND s.question_id=? ORDER BY s.created_at').all(g.id,q.id):[],questionId:q?.id}: {})};}
function emit(g){io.to('game:'+g.pin).emit('game:update',{pin:g.pin});}
function audit(gid,action,detail){db.prepare('INSERT INTO audit(game_id,actor,action,detail) VALUES(?,?,?,?)').run(gid,'host',action,JSON.stringify(detail))}
function closeExpired(g){if(g?.status==='active'&&Date.now()>=g.deadline){db.prepare("UPDATE games SET status='review',deadline=0 WHERE id=? AND status='active'").run(g.id);emit(gameById(g.id));return gameById(g.id)}return g}


/* Self-paced game mode: each player advances independently. */
const mainQuestions=()=>questions().filter(q=>q.type==='main').slice(0,7);
function selfResults(g){
 const ps=db.prepare('SELECT id,name,college,reg_id,joined_at FROM players WHERE game_id=? ORDER BY joined_at').all(g.id);
 const qs=mainQuestions(), all=db.prepare('SELECT * FROM submissions WHERE game_id=?').all(g.id);
 return rankPlayers(ps.map(p=>{
  const mine=all.filter(x=>x.player_id===p.id);
  const scores=qs.map(q=>mine.find(x=>x.question_id===q.id)?.points??0);
  const answered=qs.filter(q=>mine.some(x=>x.question_id===q.id)).length;
  return {...p,scores,total:scores.reduce((a,b)=>a+b,0),answered,pending:mine.filter(x=>x.status==='pending').length,status:answered===7?'Completed':answered>0?'In progress':'Not started'};
 }));
}
function selfProgress(g,p){
 const qs=mainQuestions(), ss=db.prepare('SELECT * FROM submissions WHERE game_id=? AND player_id=?').all(g.id,p.id);
 const rounds=qs.map((q,i)=>{const s=ss.find(x=>x.question_id===q.id);return {number:i+1,question:q.text,answer:s?.raw_answer??null,points:s?.points??null,status:s?.status||'unanswered'}});
 const next=rounds.findIndex(x=>x.status==='unanswered'), all=selfResults(g),mine=all.find(x=>x.id===p.id);
 return {pin:g.pin,name:p.name,college:p.college,gameStatus:g.status,completed:next===-1,question:next===-1?null:{number:next+1,text:qs[next].text},answered:7-rounds.filter(x=>x.status==='unanswered').length,total:mine?.total||0,pending:mine?.pending||0,rank:next===-1?mine?.rank:null,rounds,leaderboard:next===-1?all.filter(x=>x.answered===7).map(({rank,name,college,total,pending})=>({rank,name,college,total,pending})):[]};
}
function emitSelf(g){io.to('game:'+g.pin).emit('game:update',{pin:g.pin})}
app.post('/api/host/games',host,(_req,res)=>{
 let pin;do{pin=String(crypto.randomInt(100000,1000000))}while(gameByPin(pin));
 const id=uid();db.prepare("INSERT INTO games(id,pin,status) VALUES(?,?,'open')").run(id,pin);
 res.json({pin,id});
});
app.get('/api/host/game/:pin',host,(req,res)=>{
 const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'Game not found'});
 const all=db.prepare('SELECT s.*,p.name,p.college,p.reg_id,q.text question FROM submissions s JOIN players p ON p.id=s.player_id JOIN questions q ON q.id=s.question_id WHERE s.game_id=? ORDER BY q.position,p.joined_at').all(g.id);
 res.json({pin:g.pin,status:g.status,createdAt:g.created_at,players:selfResults(g),submissions:all});
});
app.post('/api/host/game/:pin/review',host,(req,res)=>{
 const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'Game not found'});
 const {playerId,questionId,canonical}=req.body, score=Number(req.body.points);
 if(!TIERS.includes(score))return res.status(400).json({error:'Invalid rarity score'});
 const s=db.prepare("SELECT * FROM submissions WHERE game_id=? AND question_id=? AND player_id=? AND status='pending'").get(g.id,questionId,playerId);
 if(!s)return res.status(404).json({error:'Pending answer not found'});
 const matching=db.prepare("SELECT * FROM submissions WHERE game_id=? AND question_id=? AND status='pending'").all(g.id,s.question_id).filter(x=>norm(x.raw_answer)===norm(s.raw_answer));
 db.transaction(()=>matching.forEach(x=>db.prepare("UPDATE submissions SET points=?,canonical=?,status=? WHERE game_id=? AND question_id=? AND player_id=?").run(score,String(canonical||s.raw_answer).slice(0,150),score===0?'rejected':'accepted',g.id,x.question_id,x.player_id)))();
 audit(g.id,'review',{answer:s.raw_answer,score,affected:matching.length});emitSelf(g);res.json({ok:true,affected:matching.length});
});
app.post('/api/host/game/:pin/close',host,(req,res)=>{
 const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'Game not found'});
 db.prepare("UPDATE games SET status='closed' WHERE id=?").run(g.id);
 audit(g.id,'close',{});emitSelf(g);res.json({ok:true});
});
app.post('/api/join',(req,res)=>{
 const g=gameByPin(String(req.body.pin||''));if(!g||g.status!=='open')return res.status(400).json({error:'Invalid or closed game PIN'});
 const name=String(req.body.name||'').trim().slice(0,80), college=String(req.body.college||'').trim().slice(0,120)||'—', reg=String(req.body.regId||'').trim().slice(0,60);
 if(!name||!reg)return res.status(400).json({error:'Please enter your name and PRO number'});
 if(db.prepare('SELECT id FROM players WHERE game_id=? AND reg_id=?').get(g.id,reg))return res.status(409).json({error:'PRO number already registered. Use your original device to continue.'});
 const id=uid(),t=token('player',id);
 db.prepare('INSERT INTO players(id,game_id,name,college,reg_id,token_hash) VALUES(?,?,?,?,?,?)').run(id,g.id,name,college,reg,mac(t));emitSelf(g);
 res.json({token:t,pin:g.pin,name});
});
app.get('/api/player/game',player,(req,res)=>{
 const g=gameById(req.player.game_id);if(!g)return res.status(404).json({error:'Game not found'});
 res.json(selfProgress(g,req.player));
});
app.post('/api/player/answer',player,(req,res)=>{
 const p=req.player,g=gameById(p.game_id);
 if(!g||g.status!=='open')return res.status(400).json({error:'Game is closed'});
 const qs=mainQuestions(),existing=db.prepare('SELECT question_id FROM submissions WHERE game_id=? AND player_id=?').all(g.id,p.id);
 const q=qs.find(x=>!existing.some(y=>y.question_id===x.id));
 if(!q)return res.status(400).json({error:'You have completed all seven questions'});
 const raw=String(req.body.answer||'').trim().slice(0,150);if(!raw)return res.status(400).json({error:'Enter an answer'});
 const matched=matchAnswer(raw,q.bank),status=matched?'accepted':'pending';
 try{db.prepare('INSERT INTO submissions(game_id,player_id,question_id,raw_answer,canonical,points,status) VALUES(?,?,?,?,?,?,?)').run(g.id,p.id,q.id,raw,matched?.answer??null,matched?.score??null,status)}
 catch{return res.status(409).json({error:'This question was already answered'})}
 emitSelf(g);
 const total=selfResults(g).find(x=>x.id===p.id)?.total||0;
 res.json({ok:true,points:matched?.score??null,status,tier:matched?({10:'PLANKTON',15:'TOO CLEVER',30:'SCHOOLER',60:'RARE',85:'DEEP CUT',100:'ONE IN A KRILLION'})[matched.score]:null,answer:matched?.answer||raw,total});
});
app.get('/api/screen/:pin',(req,res)=>{
 const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'Game not found'});
 res.json({pin:g.pin,status:g.status,players:selfResults(g).map(({name,college,rank,total,answered,pending})=>({name,college,rank,total,answered,pending}))});
});


app.get('/api/health',(_req,res)=>res.json({ok:true,mode:'self-paced'}));
app.post('/api/host/login',(req,res)=>{const given=Buffer.from(crypto.createHash('sha256').update(String(req.body.password||'')).digest());const expected=Buffer.from(crypto.createHash('sha256').update(HOST_PASSWORD).digest());if(!crypto.timingSafeEqual(given,expected))return res.status(401).json({error:'Incorrect password'});res.json({token:token('host','host')})});
app.get('/api/host/games',host,(_req,res)=>res.json(db.prepare('SELECT id,pin,status,created_at FROM games ORDER BY created_at DESC').all()));
app.get('/api/host/game/:pin/export/:type',host,(req,res)=>{
 const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'Game not found'});
 const ps=selfResults(g),qs=questions(),ss=db.prepare('SELECT * FROM submissions WHERE game_id=?').all(g.id);
 const rows=req.params.type==='answers'?[['Name','College','PRO Number','Question','Answer','Canonical','Status','Score'],...ss.map(x=>{const p=ps.find(y=>y.id===x.player_id),q=qs.find(y=>y.id===x.question_id);return [p?.name,p?.college,p?.reg_id,q?.text,x.raw_answer,x.canonical,x.status,x.points??'']})]:[['Rank','Name','College','PRO Number','Q1','Q2','Q3','Q4','Q5','Q6','Q7','Total','Answered','Pending','Status'],...ps.map(p=>[p.rank,p.name,p.college,p.reg_id,...p.scores,p.total,p.answered,p.pending,p.status])];
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="krillion-'+req.params.type+'-'+g.pin+'.csv"');res.send('\uFEFF'+rows.map(r=>r.map(safeCsv).join(',')).join('\r\n'));
});
app.put('/api/host/question/:id',host,(req,res)=>{
 const {text,bank}=req.body;
 if(typeof text!=='string'||text.length<5||!Array.isArray(bank)||bank.length>20000||!bank.every(a=>typeof a.answer==='string'&&a.answer.length>0&&TIERS.includes(Number(a.score))&&Array.isArray(a.aliases)))return res.status(400).json({error:'Invalid question or answer bank'});
 const active=db.prepare("SELECT count(*) n FROM games WHERE status='open' AND id IN (SELECT game_id FROM submissions)").get().n;
 if(active)return res.status(409).json({error:'Cannot edit answer banks while a game has active submissions'});
 db.prepare('UPDATE questions SET text=?,bank=? WHERE id=?').run(text,JSON.stringify(bank),Number(req.params.id));
 res.json({ok:true});
});
io.on('connection',socket=>{socket.on('watch',pin=>{if(typeof pin==='string'&&/^\d{6}$/.test(pin)&&gameByPin(pin))socket.join('game:'+pin)})});

server.listen(PORT,()=>console.log(`ONE IN A KRILLION running at http://localhost:${PORT}`));