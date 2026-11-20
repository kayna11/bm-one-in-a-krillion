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
async function server(n,db){const proc=spawn(process.execPath,['v2/app.js'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(n),DATABASE_PATH:db,NODE_ENV:'production',HOST_PASSWORD:'my-very-strong-host-password',SESSION_SECRET:'a-safe-random-test-secret-longer-than-32-chars'},stdio:['ignore','pipe','pipe']});let logs='';proc.stdout.on('data',x=>logs+=x);proc.stderr.on('data',x=>logs+=x);for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+n+'/api/health');if(r.ok)return proc}catch{}await sleep(100)}throw Error('Server failed: '+logs)}
test('7 questions, immediate scores, organiser review, CSV, and storage restart', {timeout:40000},async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'krillion-v2-'));const db=path.join(dir,'data.json');const n=await port();let proc=await server(n,db);const base='http://127.0.0.1:'+n;const http=async(route,method='GET',body,token)=>{const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json().catch(()=>null)}};
try{
assert.equal((await http('/api/health')).data.version,2);
const playerPage=await fetch(base+'/');assert.equal(playerPage.status,200);assert.ok((await playerPage.text()).includes('BEGIN DESCENDING'));
assert.equal((await http('/host')).status,200);assert.equal((await http('/api/host/games')).status,401);
assert.equal((await http('/api/host/login','POST',{password:'bad'})).status,401);
const host=(await http('/api/host/login','POST',{password:'my-very-strong-host-password'})).data.token;assert.ok(host);
const g=(await http('/api/host/games','POST',{},host)).data;assert.match(g.pin,/^\d{6}$/);
const guest=await http('/api/games/'+g.pin+'/join','POST',{name:'Test Player',pro:'PRO001'});assert.equal(guest.status,201);const token=guest.data.token;
assert.equal((await http('/api/games/'+g.pin+'/join','POST',{name:'Same PRO',pro:'PRO001'})).status,409);
assert.equal((await http('/api/me','GET',undefined,token)).data.question.number,1);
const answers=['Gucci','Tata','Amul','Apple','Coffee','Netflix','Chocolates'];
for(let i=0;i<7;i++){const result=await http('/api/me/answer','POST',{answer:answers[i]},token);assert.equal(result.status,200,'answer '+i+': '+JSON.stringify(result));assert.equal(result.data.points,10);const state=(await http('/api/me','GET',undefined,token)).data;assert.equal(state.answered,i+1)}
const final=(await http('/api/me','GET',undefined,token)).data;assert.equal(final.completed,true);assert.equal(final.total,70);
assert.equal((await http('/api/me/answer','POST',{answer:'extra'},token)).status,400);
let view=(await http('/api/host/games/'+g.pin,'GET',undefined,host)).data;assert.equal(view.players[0].pro,'PRO001');assert.equal(view.players[0].total,70);assert.equal(view.answers.length,7);
const file=await fetch(base+'/api/host/games/'+g.pin+'/export/scores',{headers:{Authorization:'Bearer '+host}});assert.equal(file.status,200);assert.ok((await file.text()).includes('PRO001'));
const other=(await http('/api/games/'+g.pin+'/join','POST',{name:'Unusual',pro:'PRO002'})).data.token;
const unknown=await http('/api/me/answer','POST',{answer:'Unusual luxury brand'},other);assert.equal(unknown.data.status,'pending');
view=(await http('/api/host/games/'+g.pin,'GET',undefined,host)).data;
const pending=view.answers.find(x=>x.status==='pending');assert.ok(pending);
assert.equal((await http('/api/host/games/'+g.pin+'/review','POST',{answerId:pending.id,points:85},host)).status,200);
assert.equal((await http('/api/me','GET',undefined,other)).data.total,85);
proc.kill();await once(proc,'exit');proc=await server(n,db);
assert.equal((await http('/api/me','GET',undefined,token)).data.total,70);
assert.equal((await http('/api/host/games/'+g.pin,'GET',undefined,host)).data.players.length,2);
assert.equal((await http('/api/host/games/'+g.pin+'/close','POST',{},host)).status,200);
assert.equal((await http('/api/games/'+g.pin+'/join','POST',{name:'Late',pro:'PRO003'})).status,400);
}finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true})}});
