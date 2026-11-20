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

app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.post('/api/host/login',(req,res)=>{if(typeof req.body.password!=='string'||req.body.password!==HOST_PASSWORD)return res.status(401).json({error:'Incorrect password'});res.json({token:token('host','host')})});
app.get('/api/host/games',host,(_req,res)=>res.json(db.prepare('SELECT * FROM games ORDER BY created_at DESC').all()));
app.post('/api/host/games',host,(req,res)=>{let pin;do{pin=String(crypto.randomInt(100000,999999))}while(gameByPin(pin));const id=uid();db.prepare('INSERT INTO games(id,pin,duration) VALUES(?,?,?)').run(id,pin,Math.min(30,Math.max(10,Number(req.body.duration)||20)));res.json({pin,id})});
app.get('/api/host/game/:pin',host,(req,res)=>{const g=closeExpired(gameByPin(req.params.pin));if(!g)return res.status(404).json({error:'Game not found'});res.json({...state(g,true),questions:questions().map(({id,position,type,text,bank})=>({id,position,type,text,bank}))})});
app.post('/api/host/game/:pin/action',host,(req,res)=>{let g=closeExpired(gameByPin(req.params.pin));if(!g)return res.status(404).json({error:'No game'});let q=qAt(g);const action=req.body.action;
 if(action==='start'||action==='next'){if(action==='next'&&(g.status!=='review'||!g.revealed))return res.status(400).json({error:'Reveal current round first'});if(action==='start'&&g.status!=='lobby')return res.status(400).json({error:'Already started'});const idx=action==='start'?0:g.current_index+1;if(idx>=9)return res.status(400).json({error:'No questions left'});db.prepare("UPDATE games SET status='active',current_index=?,deadline=?,revealed=0 WHERE id=?").run(idx,Date.now()+g.duration*1000,g.id)}
 else if(action==='pause'){if(g.status!=='active')return res.status(400).json({error:'Not active'});db.prepare("UPDATE games SET status='review',deadline=0 WHERE id=?").run(g.id)}
 else if(action==='reveal'){if(g.status==='active')return res.status(400).json({error:'Close answer window first'});if(db.prepare("SELECT count(*) n FROM submissions WHERE game_id=? AND question_id=? AND status='pending'").get(g.id,q?.id).n)return res.status(400).json({error:'Review all pending answers first'});db.prepare('UPDATE games SET revealed=1 WHERE id=?').run(g.id)}
 else if(action==='finish'){if(g.status==='active')return res.status(400).json({error:'Close active question first'});db.prepare("UPDATE games SET status='finished',revealed=1 WHERE id=?").run(g.id)}
 else return res.status(400).json({error:'Unknown action'});
 audit(g.id,action,{});g=gameById(g.id);emit(g);res.json(state(g,true));});
app.post('/api/host/game/:pin/review',host,(req,res)=>{const g=closeExpired(gameByPin(req.params.pin));if(!g)return res.status(404).json({error:'No game'});if(g.status==='active'||g.revealed)return res.status(400).json({error:'Review when submissions are closed and before reveal'});const {playerId,points,canonical}=req.body;const q=qAt(g);const score=Number(points);if(!TIERS.includes(score))return res.status(400).json({error:'Invalid score tier'});const s=db.prepare('SELECT * FROM submissions WHERE game_id=? AND question_id=? AND player_id=?').get(g.id,q.id,playerId);if(!s)return res.status(404).json({error:'Submission not found'});
 const same=db.prepare("SELECT * FROM submissions WHERE game_id=? AND question_id=? AND status='pending'").all(g.id,q.id).filter(x=>norm(x.raw_answer)===norm(s.raw_answer));db.transaction(()=>same.forEach(x=>db.prepare("UPDATE submissions SET points=?,canonical=?,status=? WHERE game_id=? AND question_id=? AND player_id=?").run(score,canonical||s.raw_answer,score===0?'rejected':'accepted',g.id,q.id,x.player_id)))();audit(g.id,'review',{answer:s.raw_answer,points:score,affected:same.length});emit(g);res.json({ok:true,affected:same.length})});
app.put('/api/host/question/:id',host,(req,res)=>{const {text,bank}=req.body;if(typeof text!=='string'||text.length<5||!Array.isArray(bank)||bank.length>20000)return res.status(400).json({error:'Invalid question'});if(!bank.every(x=>typeof x.answer==='string'&&x.answer.length>0&&TIERS.includes(Number(x.score))&&Array.isArray(x.aliases)))return res.status(400).json({error:'Invalid answer bank'});db.prepare('UPDATE questions SET text=?,bank=? WHERE id=?').run(text,JSON.stringify(bank),Number(req.params.id));res.json({ok:true})});
app.get('/api/host/game/:pin/export/:type',host,(req,res)=>{const g=gameByPin(req.params.pin);if(!g)return res.status(404).json({error:'No game'});const ps=entries(g),qs=questions(),ss=db.prepare('SELECT * FROM submissions WHERE game_id=?').all(g.id);const rows=req.params.type==='scores'?[['Rank','Name','College','Participant ID',...Array.from({length:7},(_,i)=>'Q'+(i+1)),'Total','Tie score'],...ps.map(p=>[p.rank,p.name,p.college,p.reg_id,...p.scores,p.total,p.tieScore])]:[['Name','College','Participant ID','Question','Answer','Canonical','Status','Score'],...ss.map(s=>{const p=ps.find(x=>x.id===s.player_id),q=qs.find(x=>x.id===s.question_id);return [p?.name,p?.college,p?.reg_id,q?.text,s.raw_answer,s.canonical,s.status,s.points??'']})];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="krillion-${req.params.type}-${g.pin}.csv"`);res.send('\uFEFF'+rows.map(r=>r.map(safeCsv).join(',')).join('\r\n'))});
app.post('/api/join',(req,res)=>{const g=gameByPin(String(req.body.pin||''));if(!g||g.status!=='lobby')return res.status(400).json({error:'Game not found or registration closed'});const name=String(req.body.name||'').trim().slice(0,80),college=String(req.body.college||'').trim().slice(0,120),reg=String(req.body.regId||'').trim().slice(0,60);if(!name||!college||!reg)return res.status(400).json({error:'Name, college and participant ID required'});if(db.prepare('SELECT id FROM players WHERE game_id=? AND reg_id=?').get(g.id,reg))return res.status(409).json({error:'Participant ID already registered. Reuse your original browser.'});const id=uid(),t=token('player',id);db.prepare('INSERT INTO players(id,game_id,name,college,reg_id,token_hash) VALUES(?,?,?,?,?,?)').run(id,g.id,name,college,reg,mac(t));emit(g);res.json({token:t,name,pin:g.pin})});
app.get('/api/player/game',player,(req,res)=>res.json(state(closeExpired(gameById(req.player.game_id)),false,req.player.id)));
app.get('/api/screen/:pin',(req,res)=>{const g=closeExpired(gameByPin(req.params.pin));if(!g)return res.status(404).json({error:'No game'});res.json(state(g,false))});
app.post('/api/player/answer',player,(req,res)=>{const p=req.player,g=closeExpired(gameById(p.game_id));if(g.status!=='active'||Date.now()>g.deadline)return res.status(400).json({error:'Answer window is closed'});const q=qAt(g),raw=String(req.body.answer||'').trim().slice(0,150);if(!raw)return res.status(400).json({error:'Enter an answer'});const m=matchAnswer(raw,q.bank),status=m?'accepted':'pending';try{db.prepare('INSERT INTO submissions(game_id,player_id,question_id,raw_answer,canonical,points,status) VALUES(?,?,?,?,?,?,?)').run(g.id,p.id,q.id,raw,m?.answer||null,m?.score??null,status)}catch{return res.status(409).json({error:'Answer already submitted'})}emit(g);res.json({ok:true,status:'received'})});
io.on('connection',socket=>{socket.on('watch',pin=>{if(typeof pin==='string'&&/^\d{6}$/.test(pin)&&gameByPin(pin))socket.join('game:'+pin)})});
setInterval(()=>{for(const g of db.prepare("SELECT * FROM games WHERE status='active' AND deadline <= ?").all(Date.now()))closeExpired(g)},300);
server.listen(PORT,()=>console.log(`ONE IN A KRILLION running at http://localhost:${PORT}`));