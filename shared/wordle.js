(() => {
'use strict';
const KEY='bjhWordle_v1';
const $=id=>document.getElementById(id);
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const say=text=>{$('notice').textContent=text||'';};
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const COMMON_ANSWERS=`
about above abuse actor acute admit adopt adore adult after again agent agile agree ahead alarm album alert alien align alike alive allow alone along alter amber among angel anger angle angry apart apple apply arena argue arise array aside asset audio avoid awake award aware awful bacon badge badly baker basic basin beach beard beast begin being below bench berry birth black blade blame blank blast blend blind block blood bloom blown board boast bonus boost booth bound brain brake brand brave bread break brick bride brief bring broad broke brown brush build built buyer cabin cable camel candy carry carve catch cause chain chair chalk charm chart chase cheap check cheer chest chief child chill choir chose civic claim class clean clear clerk click climb clock close cloud coach coast could count court cover craft crash crazy cream crime crisp cross crowd crown curve daily dairy dance dealt death debut delay delta dense depth diary digit dirty doubt dozen draft drama dream dress dried drill drink drive drove eager early earth eight elect elite empty enemy enjoy enter entry equal error event every exact exist extra faith false fancy fault favor feast field fifth fifty fight final first flame flash fleet floor flour fluid focus force forth forty forum found frame frank fresh front fruit funny giant given glass globe glory grace grade grain grand grant grape graph grasp grass great green greet grief gross group grown guard guess guest guide habit happy heart heavy hence honey horse hotel house human ideal image imply index inner input issue ivory joint judge juice knife known label large later laugh layer learn least leave lemon light limit local loose lucky lunch magic major maker maple march match maybe mayor medal media mercy metal might minor model money month moral motor mount mouse mouth movie music nasty naval nerve never night noise north novel nurse occur ocean offer often order other ought paint panel paper party peace phase phone photo piece pilot pitch place plain plane plant plate point pound power press price pride prime print prior prize proof proud queen quick quiet quite radio raise range rapid ratio reach ready realm reply right river robot rough round route royal rural scale scene scope score sense serve seven shade shake shall shape share sharp sheet shelf shell shift shine shirt shock shoot short shown sight since skill sleep small smart smile solid solve sorry sound south space spare speak speed spend spice split sport staff stage stair stake stand start state steam steel stick still stock stone store storm story strip style sugar suite super sweet table taken taste teach thank their theme there thick thing think third those three throw tight times tired title today topic total touch tough tower track trade train treat trend trial tribe trick truck truly trust truth twice under union unity until upper urban usual vague valid value video visit vital voice waste watch water wheel where which while white whole woman world worry worth would write wrong young youth zebra
`.trim().split(/\s+/);
const ANSWERS=[...new Set(COMMON_ANSWERS.filter(w=>/^[a-z]{5}$/.test(w)))];
let data={version:1,session:null},activePeriod='',currentInput='',dictionary=new Set(ANSWERS),dictionaryReady=false,blocked=false;
try{
  const raw=localStorage.getItem(KEY);
  if(raw){
    const parsed=JSON.parse(raw);
    if(!parsed||parsed.version!==1||!Object.prototype.hasOwnProperty.call(parsed,'session')) throw Error('Invalid Wordle data');
    data=parsed;
  }
}catch(e){blocked=true;say('Saved Wordle data could not be read. It has been preserved in this browser.');}
function persist(){if(blocked)throw Error('Saved Wordle data could not be read, so no changes were saved.');localStorage.setItem(KEY,JSON.stringify(data));}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){const message=e.message||'The action could not be completed.';say(message);if(document.querySelector('dialog[open]'))alert(message);}};}
function on(id,fn){$(id).onclick=safe(fn);}
function classes(){return window.DashboardData?.getClasses({activeOnly:true})||[];}
function options(el,items,value){el.replaceChildren(...items.map(([v,t])=>{const o=make('option',t);o.value=v;return o;}));if(value!==undefined)el.value=String(value);if(el.selectedIndex<0)el.selectedIndex=0;}
function session(){return data.session;}
function round(){return session()?.rounds?.[activePeriod];}
function normalize(value){return String(value||'').trim().toLowerCase();}
function shuffle(items){const copy=[...items];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
function scoreGuess(answer,guess){
  const out=Array(5).fill('absent'),counts={};
  for(const ch of answer)counts[ch]=(counts[ch]||0)+1;
  for(let i=0;i<5;i++)if(guess[i]===answer[i]){out[i]='correct';counts[guess[i]]--;}
  for(let i=0;i<5;i++)if(out[i]!=='correct'&&counts[guess[i]]>0){out[i]='present';counts[guess[i]]--;}
  return out;
}
function roundScore(r){return r?.status==='finished'&&r.won?7-r.guesses.length:0;}
function readyForAward(s){const rows=s.periods.map(p=>s.rounds[p.id]);return rows.some(r=>r.status==='finished')&&rows.every(r=>['finished','excluded'].includes(r.status));}
function keyboardStates(r){
  const priority={absent:1,present:2,correct:3},states={};
  for(const guess of r.guesses){scoreGuess(r.answer,guess).forEach((state,i)=>{const letter=guess[i];if((priority[state]||0)>(priority[states[letter]]||0))states[letter]=state;});}
  return states;
}
function hardViolation(r,guess){
  const greens=Array(5).fill(null),forbidden=Array.from({length:5},()=>new Set()),minimum={};
  for(const prior of r.guesses){
    const states=scoreGuess(r.answer,prior),counts={};
    states.forEach((state,i)=>{
      const letter=prior[i];
      if(state==='correct'){greens[i]=letter;counts[letter]=(counts[letter]||0)+1;}
      if(state==='present'){forbidden[i].add(letter);counts[letter]=(counts[letter]||0)+1;}
    });
    for(const [letter,count] of Object.entries(counts))minimum[letter]=Math.max(minimum[letter]||0,count);
  }
  for(let i=0;i<5;i++)if(greens[i]&&guess[i]!==greens[i])return `Hard mode: keep ${greens[i].toUpperCase()} in position ${i+1}.`;
  for(let i=0;i<5;i++)if(forbidden[i].has(guess[i]))return `Hard mode: ${guess[i].toUpperCase()} was yellow there, so try it in another position.`;
  for(const [letter,count] of Object.entries(minimum))if([...guess].filter(ch=>ch===letter).length<count)return `Hard mode: your guess must include ${letter.toUpperCase()}${count>1?` at least ${count} times`:''}.`;
  return '';
}
function currentPeriodRecord(){return session()?.periods.find(p=>p.id===activePeriod);}
function renderBoard(){
  const s=session(),r=round(),board=$('board');board.replaceChildren();
  for(let rowIndex=0;rowIndex<6;rowIndex++){
    const submitted=r?.guesses[rowIndex];
    const live=!submitted&&r?.status==='playing'&&rowIndex===r.guesses.length?currentInput:'';
    const states=submitted?scoreGuess(r.answer,submitted):null;
    for(let col=0;col<5;col++){
      const letter=submitted?.[col]||live[col]||'';
      const tile=make('div',letter,'tile');
      if(letter&&!submitted)tile.classList.add('filled');
      if(submitted){tile.classList.add(states[col],'reveal');tile.style.animationDelay=`${col*55}ms`;}
      board.append(tile);
    }
  }
}
function renderKeyboard(){
  const r=round(),states=r?keyboardStates(r):{},keyboard=$('keyboard');keyboard.replaceChildren();
  const rows=[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['enter','z','x','c','v','b','n','m','back']];
  rows.forEach(row=>{const wrap=make('div',undefined,'key-row');row.forEach(key=>{const label=key==='enter'?'ENTER':key==='back'?'⌫':key.toUpperCase();const b=make('button',label,'key');b.type='button';if(key==='enter'||key==='back')b.classList.add('wide');if(states[key])b.classList.add(states[key]);b.disabled=!r||r.status!=='playing'||!!session()?.posted;b.addEventListener('click',()=>handleKey(key));wrap.append(b);});keyboard.append(wrap);});
}
function renderTeacher(){
  const s=session();$('teacherDialog').querySelector('.teacher-actions').hidden=!s;$('answerReveal').textContent='';$('results').replaceChildren();if(!s){$('resultNote').textContent='Create a game first.';$('postedMessage').textContent='';return;}
  $('resultNote').textContent=s.mode==='day'?'Complete each included period, then award all class results together.':'Finish the single game, then award that result when you are ready.';
  s.periods.forEach(p=>{const r=s.rounds[p.id],tr=make('tr');const status=r.status==='finished'?(r.won?'Solved':'Not solved'):r.status;[p.name,status,r.guesses.length,roundScore(r)].forEach(x=>tr.append(make('td',String(x))));const cell=make('td');if(s.mode==='day'&&!s.posted&&['ready','excluded'].includes(r.status)){const b=make('button',r.status==='excluded'?'Include':'Exclude');b.onclick=safe(()=>{r.status=r.status==='excluded'?'ready':'excluded';persist();render();renderTeacher();});cell.append(b);}else cell.textContent=r.status==='excluded'?'Excluded':'Included';tr.append(cell);$('results').append(tr);});
  $('awardDay').hidden=s.mode!=='day';$('awardDay').disabled=s.mode!=='day'||!readyForAward(s)||!!s.posted;$('postedMessage').textContent=s.posted?`Awarded to ${s.posted.season}.`:'Results have not been added to the scoreboard.';
}
function render(){
  const s=session();$('empty').hidden=!!s;$('game').hidden=!s;if(!s){renderTeacher();return;}
  if(!s.periods.some(p=>p.id===activePeriod))activePeriod=s.periods.find(p=>p.id===String(DashboardData.getCurrentClassId()))?.id||s.periods[0].id;
  options($('period'),s.periods.map(p=>[p.id,p.name]),activePeriod);$('periodLabel').hidden=s.mode==='single';$('gameTitle').textContent=s.title;$('gameMeta').textContent=new Date(s.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})+(s.mode==='day'?(s.rotation==='same'?' · SAME WORD ALL CLASSES':' · DIFFERENT WORD EACH CLASS'):'');$('rulePill').textContent=s.ruleMode==='hard'?'HARD MODE':'NORMAL';$('formatPill').textContent=s.mode==='day'?'CLASS-DAY COMPETITION':'SINGLE GAME';
  const r=round(),p=currentPeriodRecord();$('scoreSummary').textContent=r.status==='finished'?`${p.name}: ${r.won?`Solved in ${r.guesses.length}`:'Not solved'} · ${roundScore(r)} game points`:'';
  $('startRound').hidden=r.status!=='ready'||!!s.posted;$('startRound').disabled=!!s.posted;$('awardSingle').hidden=!(s.mode==='single'&&r.status==='finished'&&!s.posted);$('awardSingle').disabled=!!s.posted;
  if(r.status==='ready')feedback('Press Start when your class is ready.');else if(r.status==='playing')feedback(s.ruleMode==='hard'?'Hard mode: revealed clues must be used in later guesses.':'Guess a five-letter word.');else if(r.status==='excluded')feedback('This class is excluded from the competition.');else if(r.won)feedback(`Solved in ${r.guesses.length}! ${roundScore(r)} game points.`,'success');else feedback(`The word was ${r.answer.toUpperCase()}. 0 game points.`,'error');
  renderBoard();renderKeyboard();renderTeacher();
}
function feedback(text,state=''){$('feedback').textContent=text;$('feedback').className='feedback'+(state?' '+state:'');}
function handleKey(key){
  const s=session(),r=round();if(!s||!r||r.status!=='playing'||s.posted)return;
  if(key==='back'){currentInput=currentInput.slice(0,-1);renderBoard();return;}
  if(key==='enter'){submitGuess();return;}
  if(/^[a-z]$/.test(key)&&currentInput.length<5){currentInput+=key;renderBoard();}
}
function submitGuess(){
  const s=session(),r=round();if(currentInput.length!==5){feedback('Enter five letters.','error');return;}
  const guess=currentInput.toLowerCase();if(dictionaryReady&&!dictionary.has(guess)&&guess!==r.answer){feedback('That word is not in the dictionary.','error');return;}
  if(s.ruleMode==='hard'&&r.guesses.length){const violation=hardViolation(r,guess);if(violation){feedback(violation,'error');return;}}
  r.guesses.push(guess);currentInput='';if(guess===r.answer){r.status='finished';r.won=true;r.finishedAt=Date.now();feedback(`Solved in ${r.guesses.length}! ${roundScore(r)} game points.`,'success');}else if(r.guesses.length>=6){r.status='finished';r.won=false;r.finishedAt=Date.now();feedback(`The word was ${r.answer.toUpperCase()}. 0 game points.`,'error');}
  persist();render();
}
function syncSetup(){
  const mode=$('gameMode').value;$('singlePeriodLabel').hidden=mode!=='single';$('rotationLabel').hidden=mode==='single';const custom=$('wordSource').value==='custom';$('customLabel').hidden=!custom;if(custom&&mode==='day'){$('rotation').value='same';$('rotation').disabled=true;}else $('rotation').disabled=false;
  $('setupNote').textContent=mode==='single'?'Play one class game and optionally send that result to the Scoreboard.':custom?'A custom word is used for every included class.':'Different-word mode helps prevent one period from spoiling the answer for another.';
}
function openSetup(){
  const active=classes();if(!active.length)throw Error('Enable at least one class in Dashboard Settings first.');options($('singlePeriod'),active.map(p=>[String(p.id),p.name]),String(DashboardData.getCurrentClassId()||''));$('title').value='Wordle · '+new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});$('gameMode').value='day';$('ruleMode').value='normal';$('wordSource').value='random';$('rotation').value='different';$('customWord').value='';syncSetup();$('setupDialog').showModal();
}
on('createFirst',openSetup);on('newGame',()=>{const s=session();if(s&&!s.posted&&!confirm('Start a new Wordle and clear the current unawarded results?'))return;data.session=null;activePeriod='';currentInput='';persist();$('teacherDialog').close();render();openSetup();});
$('gameMode').onchange=syncSetup;$('wordSource').onchange=syncSetup;
on('saveGame',()=>{
  const active=classes().map(p=>({id:String(p.id),name:p.name}));const mode=$('gameMode').value==='single'?'single':'day',ruleMode=$('ruleMode').value==='hard'?'hard':'normal',source=$('wordSource').value==='custom'?'custom':'random';const periods=mode==='single'?active.filter(p=>p.id===$('singlePeriod').value):active;if(!periods.length)throw Error('Choose a class period.');const title=$('title').value.trim()||'Wordle';let rotation=mode==='day'?$('rotation').value:'same',answers=[];
  if(source==='custom'){const word=normalize($('customWord').value);if(!/^[a-z]{5}$/.test(word))throw Error('Enter exactly five letters for the secret word.');dictionary.add(word);rotation='same';answers=periods.map(()=>word);}else if(mode==='day'&&rotation==='different'){const pool=shuffle(ANSWERS);if(pool.length<periods.length)throw Error('Not enough random words are available.');answers=periods.map((_,i)=>pool[i]);}else{const word=ANSWERS[Math.floor(Math.random()*ANSWERS.length)];answers=periods.map(()=>word);}
  const id=uid();data.session={id,title,mode,ruleMode,source,rotation,createdAt:Date.now(),periods,rounds:Object.fromEntries(periods.map((p,i)=>[p.id,{status:'ready',answer:answers[i],guesses:[],won:null}])),posted:null};activePeriod=periods.find(p=>p.id===String(DashboardData.getCurrentClassId()))?.id||periods[0].id;currentInput='';persist();$('setupDialog').close();say('');render();
});
$('period').onchange=()=>{activePeriod=$('period').value;currentInput='';render();DashboardData.setCurrentClass(activePeriod);};
on('startRound',()=>{const r=round();if(!r||r.status!=='ready'||session().posted)return;r.status='playing';r.startedAt=Date.now();currentInput='';persist();render();});
on('teacher',()=>{renderTeacher();$('teacherDialog').showModal();});document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
on('revealAnswer',()=>{const r=round();if(!r)throw Error('No class is selected.');$('answerReveal').textContent=r.answer.toUpperCase();});
function awardScores(){const s=session();return s.periods.filter(p=>s.rounds[p.id].status==='finished').map(p=>({period:p.id,name:p.name,score:roundScore(s.rounds[p.id])}));}
function openAward(){const s=session();if(!s||s.posted)throw Error('There are no unawarded results.');if(s.mode==='day'&&!readyForAward(s))throw Error('Finish or exclude every included class before awarding the competition.');if(s.mode==='single'&&round().status!=='finished')throw Error('Finish the game first.');const scores=awardScores();GameCompetitionAward.open({eventId:`wordle-${s.id}`,name:s.title.toLowerCase().startsWith('wordle')?s.title:`Wordle: ${s.title}`,scores,sourceApp:'Wordle',sourceId:s.id,onAward:result=>{s.posted={season:result.season,eventId:result.event.id,at:Date.now()};persist();render();say(result.added?'Wordle results added to the scoreboard.':'These Wordle results were already on the scoreboard; no duplicate points were added.');}});}
on('awardSingle',openAward);on('awardDay',openAward);
on('fullscreen',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.body.requestFullscreen();});document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
document.addEventListener('keydown',event=>{if(document.querySelector('dialog[open]'))return;if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;const key=event.key.toLowerCase();if(key==='enter'){event.preventDefault();handleKey('enter');}else if(key==='backspace'){event.preventDefault();handleKey('back');}else if(/^[a-z]$/.test(key))handleKey(key);});
window.addEventListener('storage',event=>{if(event.key===KEY){blocked=true;say('Wordle changed in another tab. Reload this page to continue with the latest results.');document.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);}});
window.addEventListener(DashboardData.changeEvent,()=>{if(!session())return;render();});
(async()=>{try{const response=await fetch('shared/word-hive-dictionary.json');if(!response.ok)throw Error('Dictionary unavailable');const payload=await response.json();if(!Array.isArray(payload.words))throw Error('Dictionary unavailable');dictionary=new Set(payload.words.filter(w=>/^[a-z]{5}$/.test(w)));ANSWERS.forEach(w=>dictionary.add(w));session()?.periods.forEach(p=>dictionary.add(session().rounds[p.id].answer));dictionaryReady=true;}catch{dictionaryReady=false;say('The broad word dictionary could not load. Wordle will still accept five-letter guesses.');}})();
try{render();}catch(e){blocked=true;say(e.message||'Wordle could not load saved data.');}
})();
