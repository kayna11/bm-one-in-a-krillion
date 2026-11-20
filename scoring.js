export const TIERS=[0,10,15,30,60,85,100];
export function norm(s){return String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
export function matchAnswer(input, bank){ const x=norm(input);if(!x)return null;return bank.find(a=>[a.answer,...(a.aliases||[])].some(n=>norm(n)===x))||null }
export function rankPlayers(players){const out=[];for(const p of players.map(p=>({...p,total:p.total||0})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name))){const i=out.length;out.push({...p,rank:i&&out[i-1].total===p.total?out[i-1].rank:i+1})}return out}
export function safeCsv(s){const v=String(s??'');return '"'+( /^[=+\-@\t\r]/.test(v)?"'"+v:v).replaceAll('"','""')+'"'}
