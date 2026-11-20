import test from 'node:test';import assert from 'node:assert/strict';import {norm,matchAnswer,rankPlayers,safeCsv} from './scoring.js';
test('aliases and punctuation',()=>{assert.equal(norm(' McDonald’s!  '),'mcdonald s');assert.equal(matchAnswer('HUL',[{answer:'Hindustan Unilever',aliases:['HUL'],score:30}]).score,30)});
test('unknown stays unknown',()=>assert.equal(matchAnswer('Unexpected',[{answer:'Known',score:15}]),null));
test('ties ranked correctly',()=>assert.deepEqual(rankPlayers([{name:'A',total:30},{name:'B',total:30},{name:'C',total:10}]).map(x=>x.rank),[1,1,3]));
test('CSV formula neutralization',()=>assert.ok(safeCsv('=1+1').includes("'=1+1")));
