import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(resolve=>s.close(resolve));return n}
async function server(n,db,questionSeconds=30){const proc=spawn(process.execPath,['v2/app.js'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(n),DATABASE_PATH:db,QUESTION_SECONDS:String(questionSeconds),NODE_ENV:'production',HOST_PASSWORD:'my-very-strong-host-password',SESSION_SECRET:'a-safe-random-test-secret-longer-than-32-chars'},stdio:['ignore','pipe','pipe']});let logs='';proc.stdout.on('data',x=>logs+=x);proc.stderr.on('data',x=>logs+=x);for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+n+'/api/health');if(r.ok)return proc}catch{}await sleep(100)}throw Error('Server failed: '+logs)}
test('7 questions, immediate scores, organiser review, CSV, and storage restart', {timeout:40000},async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'krillion-v2-'));const db=path.join(dir,'data.json');const n=await port();let proc=await server(n,db);const base='http://127.0.0.1:'+n;const http=async(route,method='GET',body,token)=>{const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json().catch(()=>null)}};
try{
assert.equal((await http('/api/health')).data.version,3);
const playerPage=await fetch(base+'/');assert.equal(playerPage.status,200);assert.ok((await playerPage.text()).includes('BEGIN DESCENDING'));
assert.equal((await http('/host')).status,200);assert.equal((await http('/api/host/games')).status,401);
assert.equal((await http('/api/host/login','POST',{password:'bad'})).status,401);
const formRequest=async password=>fetch(base+'/host/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password})});
const wrongForm=await formRequest('invalid');
assert.equal(wrongForm.status,303);assert.equal(wrongForm.headers.get('location'),'/host?error=incorrect');
const validForm=await formRequest('my-very-strong-host-password');
assert.equal(validForm.status,303);assert.equal(validForm.headers.get('location'),'/host?login=success');
const sessionCookie=validForm.headers.get('set-cookie').split(';')[0];
const sessionResponse=await fetch(base+'/api/host/session',{headers:{Cookie:sessionCookie}});
assert.equal((await sessionResponse.json()).authenticated,true);
const cookieGames=await fetch(base+'/api/host/games',{headers:{Cookie:sessionCookie}});
assert.equal(cookieGames.status,200);

const host=(await http('/api/host/login','POST',{password:'my-very-strong-host-password'})).data.token;assert.ok(host);
const g=(await http('/api/host/games','POST',{},host)).data;assert.match(g.pin,/^\d{6}$/);
assert.equal(g.status,'draft');
assert.equal((await http('/api/games/'+g.pin+'/join','POST',{name:'Too Early',pro:'EARLY'})).status,400);
let bank=(await http('/api/host/games/'+g.pin+'/bank','GET',undefined,host)).data;
assert.equal(bank.questions.length,7);
assert.equal(bank.reviewedQuestions.length,0);
assert.equal((await http('/api/host/games/'+g.pin+'/publish','POST',{confirm:'I reviewed and approved the full answer bank'},host)).status,409);
for(let i=0;i<7;i++){
 const saved=await http('/api/host/games/'+g.pin+'/bank','POST',{questionIndex:i,rows:bank.questions[i].answers},host);
 assert.equal(saved.status,200,'Bank review '+i);
}
bank=(await http('/api/host/games/'+g.pin+'/bank','GET',undefined,host)).data;
assert.equal(bank.reviewedQuestions.length,7);
assert.equal((await http('/api/host/games/'+g.pin+'/publish','POST',{confirm:'I reviewed and approved the full answer bank'},host)).status,200);
assert.equal((await http('/api/host/games/'+g.pin+'/bank','POST',{questionIndex:0,rows:bank.questions[0].answers},host)).status,409,'Published bank must be immutable');

const guest=await http('/api/games/'+g.pin+'/join','POST',{name:'Test Player',pro:'PRO001'});assert.equal(guest.status,201);const token=guest.data.token;
assert.equal((await http('/api/games/'+g.pin+'/join','POST',{name:'Same PRO',pro:'PRO001'})).status,409);
assert.equal((await http('/api/me','GET',undefined,token)).data.question.number,1);
const answers=['Gucci','Tata','Amul','Apple','Coffee','Netflix','Chocolates'];
assert.equal((await http('/api/me/answer','POST',{answer:'Gucci'},token)).status,409,'Cannot answer before timer starts');
for(let i=0;i<7;i++){
 const started=await http('/api/me/start','POST',{},token);
 assert.equal(started.status,200);
 assert.equal(started.data.questionIndex,i);
 assert.equal(started.data.seconds,30);
 const same=await http('/api/me/start','POST',{},token);
 assert.equal(same.data.deadline,started.data.deadline,'Question timer must not reset');
 const result=await http('/api/me/answer','POST',{answer:answers[i]},token);assert.equal(result.status,200,'answer '+i+': '+JSON.stringify(result));assert.equal(result.data.points,10);const state=(await http('/api/me','GET',undefined,token)).data;assert.equal(state.answered,i+1)}
const final=(await http('/api/me','GET',undefined,token)).data;assert.equal(final.completed,true);assert.equal(final.total,70);
assert.equal((await http('/api/me/answer','POST',{answer:'extra'},token)).status,400);
let view=(await http('/api/host/games/'+g.pin,'GET',undefined,host)).data;assert.equal(view.players[0].pro,'PRO001');assert.equal(view.players[0].total,70);assert.equal(view.answers.length,7);
const file=await fetch(base+'/api/host/games/'+g.pin+'/export/scores',{headers:{Authorization:'Bearer '+host}});assert.equal(file.status,200);assert.ok((await file.text()).includes('PRO001'));
const other=(await http('/api/games/'+g.pin+'/join','POST',{name:'Unusual',pro:'PRO002'})).data.token;
await http('/api/me/start','POST',{},other);
const unknown=await http('/api/me/answer','POST',{answer:'Unusual luxury brand'},other);assert.equal(unknown.data.status,'unlisted');assert.equal(unknown.data.points,0);assert.equal(unknown.data.tier,'NOT ON THE BOARD');
view=(await http('/api/host/games/'+g.pin,'GET',undefined,host)).data;
assert.equal(view.answers.find(x=>x.status==='unlisted').points,0);
assert.equal((await http('/api/me','GET',undefined,other)).data.total,0);
proc.kill();await once(proc,'exit');proc=await server(n,db);
assert.equal((await http('/api/me','GET',undefined,token)).data.total,70);
assert.equal((await http('/api/host/games/'+g.pin,'GET',undefined,host)).data.players.length,2);
assert.equal((await http('/api/host/games/'+g.pin+'/close','POST',{},host)).status,200);
assert.equal((await http('/api/games/'+g.pin+'/join','POST',{name:'Late',pro:'PRO003'})).status,400);
}finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true})}});

test('Time limit is enforced by server, survives a page reload, and scores a timeout zero', {timeout:20000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'krillion-timer-'));
 const db=path.join(dir,'game.json'),n=await port();
 const proc=await server(n,db,1);
 const base='http://127.0.0.1:'+n;
 async function call(endpoint,method='GET',body,token){
  const response=await fetch(base+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,value:await response.json()};
 }
 try {
  const host=(await call('/api/host/login','POST',{password:'my-very-strong-host-password'})).value.token;
  const game=(await call('/api/host/games','POST',{},host)).value;
  const bank=(await call('/api/host/games/'+game.pin+'/bank','GET',undefined,host)).value;
  for(let i=0;i<7;i++)assert.equal((await call('/api/host/games/'+game.pin+'/bank','POST',{questionIndex:i,rows:bank.questions[i].answers},host)).status,200);
  assert.equal((await call('/api/host/games/'+game.pin+'/publish','POST',{confirm:'I reviewed and approved the full answer bank'},host)).status,200);
  const player=(await call('/api/games/'+game.pin+'/join','POST',{name:'Timer Tester',pro:'TIME01'})).value.token;
  const first=await call('/api/me/start','POST',{},player);
  assert.equal(first.value.seconds,1);
  assert.ok(first.value.deadline>Date.now());
  const reload=await call('/api/me','GET',undefined,player);
  assert.equal(reload.value.timer.deadline,first.value.deadline);
  const duplicate=await call('/api/me/start','POST',{},player);
  assert.equal(duplicate.value.deadline,first.value.deadline);
  assert.equal((await call('/api/me/timeout','POST',{},player)).status,409,'Cannot force early timeout');
  await sleep(1200);
  assert.equal((await call('/api/me/answer','POST',{answer:'Gucci'},player)).status,409,'Late answers must be rejected');
  const timeout=await call('/api/me/timeout','POST',{},player);
  assert.equal(timeout.status,200);
  assert.equal(timeout.value.points,0);
  assert.equal(timeout.value.tier,'TIME UP');
  const after=await call('/api/me','GET',undefined,player);
  assert.equal(after.value.answered,1);
  assert.equal(after.value.total,0);
  assert.equal(after.value.rounds[0].status,'timed_out');
  assert.equal(after.value.question.number,2);
  assert.equal(after.value.timer.deadline,null,'Next question must wait until reveal is dismissed');
  const next=await call('/api/me/start','POST',{},player);
  assert.equal(next.value.questionIndex,1);
  assert.equal(next.value.seconds,1);
 } finally {proc.kill();fs.rmSync(dir,{recursive:true,force:true})}
});
