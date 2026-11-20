import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
test('Begin Descending registers a handler, calls join API, and opens Question 1',async()=>{
const elements=new Map(),calls=[];
function element(id){if(!elements.has(id)){const listeners={};const el={id,value:'',textContent:'',disabled:false,style:{},className:'',listeners,addEventListener(type,fn){listeners[type]=fn},classList:{add(){},remove(){},toggle(){}},replaceChildren(){},append(){},querySelector(){return element('answerButton')}};elements.set(id,el)}return elements.get(id)}
const document={getElementById:element,createElement:tag=>element('element'+Math.random())};
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const fetch=async(path,opts)=>{calls.push([path,opts?.method]);const value=path.endsWith('/join')?{token:'test-token',pin:'123456'}:path==='/api/me'?{completed:false,question:{number:1,text:'Name a luxury fashion brand.'},total:0,rounds:[],answered:0,leaderboard:[]}:{};return {ok:true,json:async()=>value}};
vm.runInNewContext(fs.readFileSync(new URL('../public/player.js',import.meta.url),'utf8'),{document,localStorage,fetch,URLSearchParams,location:{search:''},setInterval(){},confirm(){return true}});
assert.equal(typeof element('joinForm').listeners.submit,'function');
element('pin').value='123456';element('name').value='Test';element('pro').value='PRO12';
await element('joinForm').listeners.submit({preventDefault(){}});
for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0));
assert.equal(calls[0][0],'/api/games/123456/join');
assert.equal(calls[1][0],'/api/me');
assert.equal(element('question').textContent,'Name a luxury fashion brand.');
});