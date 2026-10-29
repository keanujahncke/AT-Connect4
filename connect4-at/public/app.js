const $=s=>document.querySelector(s);let token=null,me=null,code=null,latest=null,busy=false;
const show=s=>$(s).classList.remove('hidden');
const msg=s=>$('#message').textContent=s;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-session':token||''},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j;}
$('#login').addEventListener('submit',async e=>{e.preventDefault();try{msg('Signing in...');const r=await api('login',{handle:$('#handle').value.trim(),password:$('#password').value});token=r.token;me=r.did;$('#identity').textContent='Signed in as '+r.handle;$('#loginPanel').classList.add('hidden');show('#lobby');msg('');}catch(e){msg(e.message)}});
$('#create').onclick=async()=>{try{const r=await api('create',{});code=r.code;show('#game');msg('Match created. Share the invite code with your opponent.');await refresh()}catch(e){msg(e.message)}};
$('#join').onclick=async()=>{try{code=$('#roomInput').value.trim();await api('join',{code});show('#game');msg('Joined match!');await refresh()}catch(e){msg(e.message)}};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);msg('Invite code copied.')}catch{msg('Copy this code: '+code)}};
$('#refresh').onclick=()=>refresh();
async function refresh(){if(!token||!code||busy)return;try{const s=await api('state?code='+encodeURIComponent(code));latest=s;render(s)}catch(e){msg(e.message)}}
function render(s){const mySide=me===s.host?1:me===s.guest?2:0;const turnSide=s.turn%2+1;const canMove=s.guest&&!s.winner&&!s.draw&&mySide===turnSide;
$('#players').textContent='You are '+(mySide===1?'Red (first)':mySide===2?'Yellow (second)':'Spectator')+' · '+s.moves.length+' moves';
$('#status').textContent=!s.guest?'Waiting for player two…':s.winner?(s.winner===mySide?'You won!':(s.winner===1?'Red':'Yellow')+' wins!'):s.draw?'Draw!':canMove?'Your turn!':'Opponent’s turn…';
const b=$('#board');b.replaceChildren();for(let r=0;r<6;r++)for(let c=0;c<7;c++){const btn=document.createElement('button');btn.className='cell '+(s.board[r][c]===1?'red':s.board[r][c]===2?'yellow':'');btn.title='Column '+(c+1);btn.setAttribute('aria-label','Row '+(r+1)+' column '+(c+1));btn.disabled=!canMove||!!s.board[0][c]||busy;btn.onclick=()=>move(c);b.append(btn)}}
async function move(column){if(busy)return;busy=true;try{await api('move',{code,column});msg('Move published!');}catch(e){msg(e.message)}finally{busy=false;await refresh()}}
setInterval(refresh,3000);
