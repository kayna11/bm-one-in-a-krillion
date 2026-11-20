(() => {
'use strict';
const $=id=>document.getElementById(id);const tokenKey='krillion-v2-player';let token=localStorage.getItem(tokenKey),state=null,reveal=null,busy=false;
function error(m){$('error').textContent=String(m);$('error').classList.remove('hidden')}
function clearError(){$('error').classList.add('hidden')}
function reset(){localStorage.removeItem(tokenKey);token=null;state=null;reveal=null;$('registration').classList.remove('hidden');$('playing').classList.add('hidden');clearError()}
async function api(path,body){let res;try{res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})}catch{throw Error('Cannot connect to the game server. Check your connection.')}
let v;try{v=await res.json()}catch{throw Error('Server returned an invalid response')}if(!res.ok)throw Error(v.error||'Request failed');return v}
function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e}
function list(container,items){container.replaceChildren();items.forEach(({name,score})=>{const r=el('div','log');r.append(el('span','',name),el('b','',score));container.append(r)})}
async function refresh(){if(!token)return;state=await api('/api/me');$('registration').classList.add('hidden');$('playing').classList.remove('hidden');render()}
function render(){if(!state)return;$('depth').textContent='▼ '+String(state.total*10).padStart(4,'0')+' M';$('progress').textContent=state.completed?'7 / 7 COMPLETE':'QUESTION '+state.question.number+' / 7';$('total').textContent=state.total+' POINTS';$('resultsPanel').classList.toggle('hidden',!state.completed);if(state.completed){$('questionPanel').classList.add('hidden');$('revealPanel').classList.add('hidden');$('finalPoints').textContent=state.total+' / 700 POINTS';$('pendingNote').textContent=state.pending?state.pending+' answer(s) are under review. Your final score can still change.':'All answers scored.';list($('roundScores'),state.rounds.map(x=>({name:'Q'+x.number+' · '+(x.answer||'—'),score:x.points===null?'REVIEW':x.points})));list($('leaderboard'),state.leaderboard.map(x=>({name:x.rank+'. '+x.name,score:x.total})));return}
if(reveal){$('questionPanel').classList.add('hidden');$('revealPanel').classList.remove('hidden');$('revealTier').textContent=reveal.tier||'ANSWER UNDER REVIEW';$('revealAnswer').textContent=reveal.answer;$('revealPoints').textContent=reveal.points===null?'PENDING':reveal.points+' POINTS';$('revealNote').textContent=reveal.points===null?'Your answer is saved. You may continue; the organiser will review its score.':'Rare answers take you deeper!';return}
$('questionPanel').classList.remove('hidden');$('revealPanel').classList.add('hidden');$('questionNumber').textContent='◈ QUESTION '+String(state.question.number).padStart(2,'0')+' OF 07 ◈';$('question').textContent=state.question.text}

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
$('joinForm').addEventListener('submit',ev=>{ev.preventDefault();withButton($('joinButton'),async()=>{const pin=$('pin').value.trim(),name=$('name').value.trim(),pro=$('pro').value.trim();if(!/^\d{6}$/.test(pin))throw Error('Enter the six-digit game PIN from your organiser.');if(!name)throw Error('Enter your full name.');if(!pro)throw Error('Enter your PRO number.');token=null;const joined=await api('/api/games/'+pin+'/join',{name,pro});token=joined.token;localStorage.setItem(tokenKey,token);await refresh();await playDescent(0,0,undefined)})});
$('answerForm').addEventListener('submit',ev=>{ev.preventDefault();withButton($('answerButton'),async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('Type an answer first.');const previousPoints=state?.total||0;reveal=await api('/api/me/answer',{answer});$('answer').value='';await refresh();await playDescent(previousPoints,state?.total??previousPoints,reveal.points)})});
$('nextButton').addEventListener('click',()=>{reveal=null;render()});$('switchButton').addEventListener('click',()=>{if(confirm('Switch player? Your current progress is saved under the original registration.'))reset()});
const queryPin=new URLSearchParams(location.search).get('pin');if(queryPin)$('pin').value=queryPin;
if(token)refresh().catch(()=>reset());
setInterval(()=>{if(token&&!busy&&state?.completed)refresh().catch(()=>{})},12000);
})();