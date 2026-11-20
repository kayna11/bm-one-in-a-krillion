(() => {
'use strict';
const $=id=>document.getElementById(id);const tokenKey='krillion-v2-player';let token=localStorage.getItem(tokenKey),state=null,reveal=null,busy=false;
let countdownInterval=null,timerDeadline=null,serverOffset=0,timerHandling=false;
function error(m){$('error').textContent=String(m);$('error').classList.remove('hidden')}
function clearError(){$('error').classList.add('hidden')}
function reset(){stopTimer();localStorage.removeItem(tokenKey);token=null;state=null;reveal=null;$('registration').classList.remove('hidden');$('playing').classList.add('hidden');clearError()}
async function api(path,body){let res;try{res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})}catch{throw Error('Cannot connect to the game server. Check your connection.')}
let v;try{v=await res.json()}catch{throw Error('Server returned an invalid response')}if(!res.ok)throw Error(v.error||'Request failed');return v}
function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e}
function list(container,items){container.replaceChildren();items.forEach(({name,score})=>{const r=el('div','log');r.append(el('span','',name),el('b','',score));container.append(r)})}
async function refresh(){if(!token)return;state=await api('/api/me');$('registration').classList.add('hidden');$('playing').classList.remove('hidden');render()}
function stopTimer(){
  if(countdownInterval!==null)clearInterval(countdownInterval);
  countdownInterval=null;timerDeadline=null;
  $('questionTimer').classList.remove('timer-warning','timer-danger');
}
function updateCountdown(){
  if(timerDeadline===null)return;
  const remaining=Math.max(0,timerDeadline-(Date.now()+serverOffset));
  const seconds=Math.ceil(remaining/1000);
  $('timerNumber').textContent=String(seconds).padStart(2,'0');
  $('timerFill').style.width=(Math.min(1,remaining/30000)*100)+'%';
  $('questionTimer').classList.toggle('timer-warning',seconds<=10&&seconds>5);
  $('questionTimer').classList.toggle('timer-danger',seconds<=5);
  if(remaining<=0){
    if(countdownInterval!==null)clearInterval(countdownInterval);
    countdownInterval=null;
    if(!busy&&!timerHandling)void submitTimeout();
  }
}
async function beginQuestion(){
  stopTimer();
  if(!token||!state||state.completed||reveal)return;
  const started=await api('/api/me/start',{});
  if(!state||state.completed||reveal||started.questionIndex!==state.answered)return;
  timerDeadline=started.deadline;
  serverOffset=started.serverNow-Date.now();
  updateCountdown();
  if(timerDeadline!==null&&countdownInterval===null&&Date.now()+serverOffset<timerDeadline){
    countdownInterval=setInterval(updateCountdown,110);
  }
}
async function submitTimeout(){
  if(timerHandling||!token||!state||state.completed||reveal)return;
  timerHandling=true;
  stopTimer();
  try{
    const before=state.total||0;
    reveal=await api('/api/me/timeout',{});
    await refresh();
    await playDescent(before,state.total??before,0);
  }catch(e){
    if(/not expired/i.test(e.message)){
      // A network or clock offset difference can reach zero a fraction early.
      await beginQuestion();
    }else error(e.message);
  }finally{timerHandling=false;}
}

function render(){
  if(!state)return;
  $('depth').textContent='▼ '+String(state.total*10).padStart(4,'0')+' M';
  $('progress').textContent=state.completed?'7 / 7 COMPLETE':'QUESTION '+state.question.number+' / 7';
  $('total').textContent=state.total+' POINTS';
  // Keep the most recent score visible even after question seven.
  // The final scoreboard appears only when the contestant presses Continue.
  $('resultsPanel').classList.toggle('hidden',!state.completed||!!reveal);
  if(reveal){
    stopTimer();
    $('questionPanel').classList.add('hidden');
    $('revealPanel').classList.remove('hidden');
    $('revealRound').textContent='◈ QUESTION '+String(state.answered).padStart(2,'0')+' SCORE ◈';
    $('revealAnswer').textContent=reveal.answer;
    const pending=reveal.points===null;
    const points=pending?null:Number(reveal.points);
    $('revealPoints').textContent=pending?'PENDING':points+' POINTS';
    $('revealTier').textContent=pending?'AWAITING ORGANISER REVIEW':points===0?'INVALID / NO POINTS':reveal.tier||'ANSWER ACCEPTED';
    $('revealNote').textContent=pending
      ?'Your answer is saved. The organiser will assign its rarity score. You can continue playing.'
      :'You earned '+points+' points on this answer.';
    $('revealTotal').textContent=state.total+' POINTS'+(state.pending?' (PROVISIONAL)':'');
    $('nextButton').textContent=state.completed?'▼ SEE FINAL RESULTS ▼':'▼ NEXT QUESTION ▼';
    $('revealPanel').classList.toggle('score-pending',pending);
    return;
  }
  $('revealPanel').classList.add('hidden');
  if(state.completed){
    stopTimer();
    $('questionPanel').classList.add('hidden');
    $('finalPoints').textContent=state.total+' / 700 POINTS';
    $('pendingNote').textContent=state.pending?state.pending+' answer(s) are under review. Your final score can still change.':'All answers scored.';
    list($('roundScores'),state.rounds.map(x=>({name:'Q'+x.number+' · '+(x.answer||'—'),score:x.points===null?'REVIEW':x.points+' PTS'})));
    list($('leaderboard'),state.leaderboard.map(x=>({name:x.rank+'. '+x.name,score:x.total+' PTS'})));
    return;
  }
  $('questionPanel').classList.remove('hidden');
  $('questionNumber').textContent='◈ QUESTION '+String(state.question.number).padStart(2,'0')+' OF 07 ◈';
  $('question').textContent=state.question.text;
}

/* Visual transition only. Actual points and game progress remain server-authoritative. */
function playDescent(previousPoints,nextPoints,awardedPoints){
  const overlay=$('descentOverlay');
  if(!overlay)return Promise.resolve();
  const from=Math.max(0,Number(previousPoints)||0)*10;
  const to=Math.max(0,Number(nextPoints)||0)*10;
  const reduced=typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration=reduced?320:2300;
  $('descentDepth').textContent=String(Math.round(from)).padStart(4,'0')+' M';
  $('descentLabel').textContent='OCEAN DEPTH';
  $('descentGain').textContent=awardedPoints===null?'ANSWER PENDING REVIEW':awardedPoints===undefined?'READY TO DIVE':('+'+awardedPoints+' POINTS');
  overlay.classList.remove('hidden');
  return new Promise(resolve=>{
    let finished=false;
    const started=Date.now();
    let ticker=null,timeout=null;
    function finish(){
      if(finished)return;
      finished=true;
      if(ticker!==null)clearInterval(ticker);
      if(timeout!==null)clearTimeout(timeout);
      $('skipDescent').removeEventListener('click',finish);
      $('descentDepth').textContent=String(Math.round(to)).padStart(4,'0')+' M';
      overlay.classList.add('hidden');
      resolve();
    }
    $('skipDescent').addEventListener('click',finish);
    ticker=setInterval(()=>{
      const fraction=Math.min(1,(Date.now()-started)/duration);
      const eased=1-Math.pow(1-fraction,3);
      $('descentDepth').textContent=String(Math.round(from+(to-from)*eased)).padStart(4,'0')+' M';
      if(fraction>=1)finish();
    },40);
    timeout=setTimeout(finish,duration+120);
  });
}

async function withButton(button,fn){if(busy)return;busy=true;const old=button.textContent;button.disabled=true;button.textContent='PLEASE WAIT…';clearError();try{await fn()}catch(e){error(e.message)}finally{busy=false;button.disabled=false;button.textContent=old}}
$('joinForm').addEventListener('submit',ev=>{ev.preventDefault();withButton($('joinButton'),async()=>{const pin=$('pin').value.trim(),name=$('name').value.trim(),pro=$('pro').value.trim();if(!/^\d{6}$/.test(pin))throw Error('Enter the six-digit game PIN from your organiser.');if(!name)throw Error('Enter your full name.');if(!pro)throw Error('Enter your PRO number.');token=null;const joined=await api('/api/games/'+pin+'/join',{name,pro});token=joined.token;localStorage.setItem(tokenKey,token);await refresh();await playDescent(0,0,undefined);await beginQuestion()})});
$('answerForm').addEventListener('submit',ev=>{ev.preventDefault();withButton($('answerButton'),async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('Type an answer first.');const previousPoints=state?.total||0;
  // The backend checks the actual deadline; the clock cannot be reset by refreshing.
  try{
    reveal=await api('/api/me/answer',{answer});
  }catch(e){
    if(/time is up/i.test(e.message)){await submitTimeout();return;}
    await beginQuestion();
    throw e;
  }
  stopTimer();$('answer').value='';await refresh();await playDescent(previousPoints,state?.total??previousPoints,reveal.points)})});
$('nextButton').addEventListener('click',()=>withButton($('nextButton'),async()=>{reveal=null;render();await beginQuestion()}));$('switchButton').addEventListener('click',()=>{if(confirm('Switch player? Your current progress is saved under the original registration.'))reset()});
const queryPin=new URLSearchParams(location.search).get('pin');if(queryPin)$('pin').value=queryPin;
if(token)refresh().then(()=>beginQuestion()).catch(()=>reset());
setInterval(()=>{if(token&&!busy&&state?.completed)refresh().catch(()=>{})},12000);
})();