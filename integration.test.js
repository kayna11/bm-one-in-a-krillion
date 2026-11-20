import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';

async function freePort(){
 const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;
}
test('host generates PIN and player independently completes seven questions with instant scoring and host review', {timeout:35000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'krillion-e2e-'));
 const port=await freePort(),hostPassword='integration-host-pass';
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',PORT:String(port),DATABASE_PATH:join(dir,'game.sqlite'),HOST_PASSWORD:hostPassword,SESSION_SECRET:'a_very_long_secret_for_test_only_123456789'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;
 async function call(url,body=null,token=null){
 const r=await fetch(base+url,{method:body===null?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:body===null?undefined:JSON.stringify(body)});
 const value=await r.json();assert.ok(r.ok,url+' returned '+r.status+' '+JSON.stringify(value));return value;
 }
 let alive=false;for(let i=0;i<70;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/api/health');if(r.ok){alive=true;break}}catch{}await new Promise(r=>setTimeout(r,120))}
 assert.ok(alive,'server did not start: '+logs);
 const {token:host}=await call('/api/host/login',{password:hostPassword});
 const {pin}=await call('/api/host/games',{},host);
 assert.match(pin,/^\d{6}$/);
 const player=await call('/api/join',{pin,name:'Test Player',college:'Test College',regId:'TEST-001'});
 let state=await call('/api/player/game',null,player.token);
 assert.equal(state.question.number,1);
 const submitted=[
 {answer:'Gucci',expected:10},
 {answer:'Tata',expected:10},
 {answer:'Amul',expected:10},
 {answer:'Apple',expected:10},
 {answer:'Coffee',expected:10},
 {answer:'Netflix',expected:10},
 {answer:'Chocolates',expected:10}
 ];
 for(let i=0;i<7;i++){
  const r=await call('/api/player/answer',{answer:submitted[i].answer},player.token);
  assert.equal(r.points,submitted[i].expected);
  state=await call('/api/player/game',null,player.token);
  assert.equal(state.answered,i+1);
  if(i<6)assert.equal(state.question.number,i+2);
 }
 assert.equal(state.completed,true);assert.equal(state.total,70);
 const hostView=await call('/api/host/game/'+pin,null,host);
 assert.equal(hostView.players[0].name,'Test Player');
 assert.equal(hostView.players[0].answered,7);
 assert.equal(hostView.players[0].total,70);
 assert.equal(hostView.submissions.length,7);
 const {pin:pin2}=await call('/api/host/games',{},host);
 const p2=await call('/api/join',{pin:pin2,name:'Unknown Test',college:'Another College',regId:'TEST-002'});
 const pending=await call('/api/player/answer',{answer:'An unknown but valid brand'},p2.token);
 assert.equal(pending.status,'pending');assert.equal(pending.points,null);
 let detail=await call('/api/host/game/'+pin2,null,host);
 assert.equal(detail.submissions[0].status,'pending');
 await call('/api/host/game/'+pin2+'/review',{playerId:detail.players[0].id,questionId:detail.submissions[0].question_id,points:85},host);
 const after=await call('/api/player/game',null,p2.token);
 assert.equal(after.rounds[0].points,85);
 assert.equal(after.question.number,2);
});