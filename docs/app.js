// Static AT Protocol Connect Four. No backend or external JS dependencies.
const $ = s => document.querySelector(s);
const COLLECTION = 'games.connectfour.move';
let auth = null, me = null, room = null, code = null, latest = null, busy = false, refreshing = false;
const pdsCache = new Map();
const show = s => $(s).classList.remove('hidden');
const hide = s => $(s).classList.add('hidden');
const msg = s => $('#message').textContent = s;
const rand = () => [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2,'0')).join('');
const encode = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(str) { try { return JSON.parse(atob(str.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-str.length%4)%4))); } catch { throw Error('Invalid code'); } }
function parseInvite(str) { const r=decode(str); if(r?.v!==1 || !/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(r.host) || !/^[a-f0-9]{24}$/.test(r.id)) throw Error('Invalid invite code'); return r; }
function parseAcceptance(str) { const a=decode(str); if(a?.v!==1 || !/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(a.guest) || !/^[a-f0-9]{24}$/.test(a.id) || !/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(a.host)) throw Error('Invalid acceptance code'); return a; }
async function json(url, opts={}) { const res=await fetch(url,opts); let data; try {data=await res.json();}catch{throw Error(`HTTP ${res.status} from ${new URL(url).hostname}`);} if(!res.ok) throw Error(data.message||data.error||`HTTP ${res.status}`); return data; }
async function pdsFor(did) {
  if(pdsCache.has(did)) return pdsCache.get(did);
  let url;
  if(did.startsWith('did:plc:')) url=`https://plc.directory/${encodeURIComponent(did)}`;
  else if(did.startsWith('did:web:')) {const parts=did.slice(8).split(':').map(decodeURIComponent);url=`https://${parts[0]}/${parts.length>1?parts.slice(1).join('/')+'/':'.well-known/'}did.json`;}
  else throw Error('Unsupported DID');
  const doc=await json(url);
  const endpoint=doc.service?.find(s=>s.id==='#atproto_pds'||s.type==='AtprotoPersonalDataServer')?.serviceEndpoint;
  if(typeof endpoint!=='string'||!endpoint.startsWith('https://')) throw Error('No HTTPS PDS for '+did);
  pdsCache.set(did,endpoint.replace(/\/$/,'')); return endpoint.replace(/\/$/,'');
}
async function requestWithAuth(method, params) {
  if(!auth) throw Error('Sign in first');
  const call=()=>json(`${auth.pds}/xrpc/${method}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.accessJwt}`},body:JSON.stringify(params)});
  try {return await call();} catch(e) {
    if(!/expired|token|auth|401/i.test(e.message)) throw e;
    const refreshed=await json(`${auth.pds}/xrpc/com.atproto.server.refreshSession`,{method:'POST',headers:{authorization:`Bearer ${auth.refreshJwt}`}});
    auth={...auth,...refreshed};return call();
  }
}
async function publish(record) {return requestWithAuth('com.atproto.repo.createRecord',{repo:me,collection:COLLECTION,record:{$type:COLLECTION,...record,createdAt:new Date().toISOString()}});}
async function readRecords(did, id) {
  const pds=await pdsFor(did), out=[]; let cursor;
  for(let page=0;page<20;page++) {
    const qs=new URLSearchParams({repo:did,collection:COLLECTION,limit:'100'});
    if(cursor) qs.set('cursor',cursor);
    const data=await json(`${pds}/xrpc/com.atproto.repo.listRecords?${qs}`);
    for(const r of data.records||[]) if(r.value?.gameId===id && ['match','join','confirm','move'].includes(r.value.type)) out.push({...r.value,uri:r.uri,author:did});
    cursor=data.cursor;if(!cursor) break;
  }
  return out;
}
function replay(r, records) {
  const hostRecords=records.filter(x=>x.author===r.host);
  const match=hostRecords.find(x=>x.type==='match' && x.host===r.host);
  if(!match) throw Error('Match invitation not found in host repository');
  const confirmations=hostRecords.filter(x=>x.type==='confirm' && x.guest && x.host===r.host).sort((a,b)=>a.uri.localeCompare(b.uri));
  const guest=confirmations[0]?.guest||null;
  const joined=guest && records.some(x=>x.type==='join'&&x.author===guest&&x.host===r.host);
  const activeGuest=joined?guest:null;
  const board=Array.from({length:6},()=>Array(7).fill(0));const accepted=[];
  let previous=null,winner=0;
  for(let n=0;n<42;n++) {
    const player=n%2===0?r.host:activeGuest;if(!player||winner) break;
    const choices=records.filter(m=>m.type==='move'&&m.author===player&&m.turn===n&&(m.previous||null)===previous&&Number.isInteger(m.column)&&m.column>=0&&m.column<7).sort((a,b)=>a.uri.localeCompare(b.uri));
    const m=choices.find(m=>board[0][m.column]===0);if(!m) break;
    let row=5;while(row>=0&&board[row][m.column])row--;if(row<0)break;
    const side=n%2+1;board[row][m.column]=side;accepted.push({...m,row,side});previous=m.uri;
    for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) {let count=1;for(const sign of [-1,1]) {let y=row+dr*sign,x=m.column+dc*sign;while(y>=0&&y<6&&x>=0&&x<7&&board[y][x]===side){count++;y+=dr*sign;x+=dc*sign;}}if(count>=4)winner=side;}
  }
  return {board,moves:accepted,guest:activeGuest,winner,draw:accepted.length===42,turn:accepted.length,previous,host:r.host};
}
async function state() {
  const hostRecords=await readRecords(room.host,room.id);
  const confirmed=hostRecords.filter(x=>x.type==='confirm'&&x.guest&&x.host===room.host).sort((a,b)=>a.uri.localeCompare(b.uri))[0];
  const guest=confirmed?.guest;
  const guestRecords=guest&&guest!==room.host?await readRecords(guest,room.id):[];
  return replay(room,[...hostRecords,...guestRecords]);
}
function enterGame(){show('#game');show('#lobby');if(me===room.host)show('#confirmPanel');else hide('#confirmPanel');}
$('#login').addEventListener('submit',async e=>{e.preventDefault();try {
  msg('Signing in...');let handle=$('#handle').value.trim().replace(/^@/,'');if(!handle.includes('.')&&!handle.startsWith('did:'))handle+='.bsky.social';
  const password=$('#password').value;
  // For the initial static prototype, use the standard Bluesky entrypoint.
  const data=await json('https://bsky.social/xrpc/com.atproto.server.createSession',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:handle,password})});
  me=data.did;auth={...data,pds:await pdsFor(me)};$('#password').value='';$('#identity').textContent='Signed in as '+data.handle;hide('#loginPanel');show('#lobby');msg('Signed in.');
}catch(err){msg('Login failed: '+err.message+' (Browser/PDS CORS support may vary.)');}});
$('#create').onclick=async()=>{try{if(busy)return;busy=true;room={v:1,host:me,id:rand()};await publish({type:'match',gameId:room.id,host:me});code=encode(room);$('#roomInput').value=code;hide('#acceptPanel');enterGame();msg('Match created. Copy the invite code and send it to your opponent.');}catch(e){msg(e.message);}finally{busy=false;await refresh();}};
$('#join').onclick=async()=>{try{if(busy)return;busy=true;const proposed=$('#roomInput').value.trim(),r=parseInvite(proposed);if(r.host===me)throw Error('You cannot join your own match');const hostRecords=await readRecords(r.host,r.id);if(!hostRecords.some(x=>x.type==='match'&&x.host===r.host))throw Error('Host match record not found');const confirmed=hostRecords.find(x=>x.type==='confirm');if(confirmed&&confirmed.guest!==me)throw Error('This match already has another player');const existing=await readRecords(me,r.id);if(!existing.some(x=>x.type==='join'&&x.host===r.host))await publish({type:'join',gameId:r.id,host:r.host});room=r;code=proposed;$('#acceptCode').value=encode({v:1,host:r.host,id:r.id,guest:me});show('#acceptPanel');enterGame();msg('Joined! Send your acceptance code to the host.');}catch(e){msg(e.message);}finally{busy=false;await refresh();}};
$('#confirm').onclick=async()=>{try{if(busy)return;busy=true;if(!room||me!==room.host)throw Error('Create a match first');const a=parseAcceptance($('#confirmInput').value.trim());if(a.host!==room.host||a.id!==room.id||a.guest===me)throw Error('Acceptance code does not match this game');const records=await readRecords(a.guest,room.id);if(!records.some(x=>x.type==='join'&&x.host===room.host))throw Error('Guest join record not found');const hostRecords=await readRecords(me,room.id);const existing=hostRecords.find(x=>x.type==='confirm');if(existing&&existing.guest!==a.guest)throw Error('Match already confirmed with another player');if(!existing)await publish({type:'confirm',gameId:room.id,host:me,guest:a.guest});msg('Opponent confirmed! You can play.');}catch(e){msg(e.message);}finally{busy=false;await refresh();}};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);msg('Invite code copied.');}catch{msg('Invite code: '+code);}};
$('#copyAccept').onclick=async()=>{try{await navigator.clipboard.writeText($('#acceptCode').value);msg('Acceptance code copied.');}catch{msg('Copy the acceptance code manually.');}};
$('#refresh').onclick=()=>refresh();$('#leave').onclick=()=>{room=null;code=null;latest=null;hide('#game');hide('#acceptPanel');hide('#confirmPanel');msg('Back in lobby.');};
async function refresh(){if(!auth||!room||refreshing||busy)return;refreshing=true;try{latest=await state();render(latest);}catch(e){msg('Sync error: '+e.message);}finally{refreshing=false;}}
function render(s){const mySide=me===s.host?1:me===s.guest?2:0,turnSide=s.turn%2+1,canMove=!!s.guest&&!s.winner&&!s.draw&&mySide===turnSide;
  $('#players').textContent='You are '+(mySide===1?'Red (first)':mySide===2?'Yellow (second)':'Waiting to be confirmed')+' · '+s.moves.length+' moves';
  $('#status').textContent=!s.guest?'Waiting for opponent confirmation…':s.winner?(s.winner===mySide?'You won!':(s.winner===1?'Red':'Yellow')+' wins!'):s.draw?'Draw!':canMove?'Your turn!':'Opponent’s turn…';
  const b=$('#board');b.replaceChildren();for(let r=0;r<6;r++)for(let c=0;c<7;c++){const btn=document.createElement('button');btn.className='cell '+(s.board[r][c]===1?'red':s.board[r][c]===2?'yellow':'');btn.title='Column '+(c+1);btn.setAttribute('aria-label','Row '+(r+1)+' column '+(c+1));btn.disabled=!canMove||!!s.board[0][c]||busy;btn.onclick=()=>move(c);b.append(btn);}}
async function move(column){if(busy)return;busy=true;try{const s=await state();if(!s.guest||s.winner||s.draw||(s.turn%2===0?s.host:s.guest)!==me||s.board[0][column])throw Error('Not a legal move');await publish({type:'move',gameId:room.id,turn:s.turn,column,previous:s.previous});msg('Move published!');}catch(e){msg(e.message);}finally{busy=false;await refresh();}}
setInterval(refresh,3000);
