(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {pin:'', games:[], game:null, busy:false, query:''};
  const banner = $('error');

  function message(value) {
    banner.textContent = String(value);
    banner.classList.remove('hidden');
  }
  function clear() {banner.classList.add('hidden');}
  function node(tag, content, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (content !== undefined) e.textContent = String(content);
    return e;
  }
  async function request(route, data) {
    const response = await fetch(route, {
      method:data === undefined ? 'GET' : 'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:data === undefined ? undefined : JSON.stringify(data)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(value.error || 'Server request failed');
    return value;
  }
  async function perform(fn) {
    if(state.busy)return;
    state.busy=true;clear();
    try {await fn();} catch(error) {message(error.message);}
    finally {state.busy=false;}
  }
  function tableRow(values) {
    const tr = node('tr');
    for(const v of values) tr.append(node('td',v === null || v === undefined ? '—' : v));
    return tr;
  }
  function scoreboard() {
    const body=$('players');
    body.replaceChildren();
    if(!state.game)return;
    for(const p of state.game.players) {
      if(!(p.name+' '+p.pro).toLowerCase().includes(state.query)) continue;
      body.append(tableRow([p.rank,p.name,p.pro,...p.scores,p.total,p.answered+'/7'+(p.pending?' · '+p.pending+' pending':'')]));
    }
  }
  async function refresh() {
    if(!state.pin)return;
    state.game=await request('/api/host/games/'+state.pin);
    render();
  }
  function render() {
    const g=state.game;
    if(!g)return;
    $('gameArea').classList.remove('hidden');
    $('gameLabel').textContent='Game '+g.pin;
    $('gameStatus').textContent=g.status==='open'?'Open — contestants can play independently':'Closed — results are saved';
    $('currentPin').textContent=g.pin;
    $('playerLink').href=location.origin+'/?pin='+g.pin;
    $('closeGame').disabled=g.status!=='open';
    const completed=g.players.filter(p=>p.completed).length;
    const pending=g.answers.filter(a=>a.status==='pending');
    const metrics=$('metrics');
    metrics.replaceChildren();
    for(const [count,label] of [[g.players.length,'PLAYERS'],[completed,'FINISHED'],[pending.length,'PENDING']]) {
      const d=node('div');
      d.append(node('strong',count),node('span',label));
      metrics.append(d);
    }
    scoreboard();
    $('pendingCount').textContent=pending.length+' pending';
    const area=$('reviews');
    area.replaceChildren();
    if(!pending.length)area.append(node('p','No answers need reviewing.','none'));
    for(const answer of pending) {
      const box=node('div',undefined,'review-row');
      const description=node('div');
      description.append(
        node('strong',answer.player+' — '+answer.pro),
        node('small','Q'+(answer.questionIndex+1)+' · '+answer.question),
        node('p',answer.answer)
      );
      const controls=node('div',undefined,'buttons');
      const select=node('select');
      for(const [score,label] of [[0,'Reject: 0'],[10,'Plankton: 10'],[15,'Too Clever: 15'],[30,'Schooler: 30'],[60,'Rare: 60'],[85,'Deep Cut: 85'],[100,'Krillion: 100']]) {
        const option=node('option',label);
        option.value=score;
        select.append(option);
      }
      const save=node('button','SAVE SCORE');
      save.type='button';
      save.addEventListener('click',()=>perform(async()=>{
        await request('/api/host/games/'+g.pin+'/review',{answerId:answer.id,points:Number(select.value)});
        await refresh();
      }));
      controls.append(select,save);
      box.append(description,controls);
      area.append(box);
    }
    const tbody=$('answers');
    tbody.replaceChildren();
    for(const a of g.answers)tbody.append(tableRow([a.player,a.pro,'Q'+(a.questionIndex+1),a.answer,a.status,a.points]));
  }
  async function load() {
    state.games=await request('/api/host/games');
    $('loginPanel').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    const select=$('gameSelect');
    select.replaceChildren();
    for(const g of state.games) {
      const option=node('option',g.pin+' ('+g.status+')');
      option.value=g.pin;
      select.append(option);
    }
    if(!state.games.length) {
      $('gameArea').classList.add('hidden');
      return;
    }
    if(!state.games.some(g=>g.pin===state.pin))state.pin=state.games[0].pin;
    select.value=state.pin;
    await refresh();
  }
  function download(kind) {
    if(!state.pin)return;
    perform(async()=>{
      const response=await fetch('/api/host/games/'+state.pin+'/export/'+kind,{credentials:'same-origin'});
      if(!response.ok)throw Error('Export failed');
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const a=node('a');
      a.href=url;
      a.download='krillion-'+kind+'-'+state.pin+'.csv';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  $('newGame').addEventListener('click',()=>perform(async()=>{
    const created=await request('/api/host/games',{});
    state.pin=created.pin;
    await load();
  }));
  $('gameSelect').addEventListener('change',()=>perform(async()=>{
    state.pin=$('gameSelect').value;
    await refresh();
  }));
  $('search').addEventListener('input',()=>{
    state.query=$('search').value.trim().toLowerCase();
    scoreboard();
  });
  $('copyLink').addEventListener('click',()=>perform(async()=>{
    await navigator.clipboard.writeText(location.origin+'/?pin='+state.pin);
    $('copyLink').textContent='COPIED ✓';
    setTimeout(()=>{$('copyLink').textContent='COPY PLAYER LINK';},1500);
  }));
  $('exportScores').addEventListener('click',()=>download('scores'));
  $('exportAnswers').addEventListener('click',()=>download('answers'));
  $('closeGame').addEventListener('click',()=>{
    if(!confirm('Close this game? Players can no longer join or submit answers.'))return;
    perform(async()=>{
      await request('/api/host/games/'+state.pin+'/close',{});
      await refresh();
    });
  });
  request('/api/host/session').then(session=>{
    if(session.authenticated)return load();
    $('loginPanel').classList.remove('hidden');
    $('dashboard').classList.add('hidden');
  }).catch(error=>message('Host session check failed: '+error.message));
  setInterval(()=>{if(state.pin&&!state.busy)refresh().catch(error=>message(error.message));},9000);
})();