(() => {
'use strict';
const C=window.WordHiveCore, KEY='bjhWordHive_v1';
const $=id=>document.getElementById(id), copy=x=>JSON.parse(JSON.stringify(x));
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const say=text=>{$('notice').textContent=text||'';};
let data={version:1,revision:0,selected:null,challenges:[]},blocked=false,activePeriod='',draft=null,index=[],dictionary=new Set(),seeds=[],dictionaryReady=false,outer=[];

function validData(d){return d&&d.version===1&&Number.isInteger(d.revision)&&Array.isArray(d.challenges)&&d.challenges.every(C.validate)&&new Set(d.challenges.map(c=>c.id)).size===d.challenges.length&&(!d.selected||d.challenges.some(c=>c.id===d.selected))&&d.challenges.flatMap(c=>Object.values(c.rounds)).filter(r=>['running','paused'].includes(r.status)).length<=1;}
try{const raw=localStorage.getItem(KEY);if(raw){const parsed=JSON.parse(raw);if(!validData(parsed))throw Error('Invalid saved data');data=parsed;}}catch(e){blocked=true;say('Saved Word Hive data could not be read. It has been preserved. Import a valid backup in Teacher controls to recover it.');}
function current(){return data.challenges.find(c=>c.id===data.selected);}
function currentRound(){return current()?.rounds[activePeriod];}
function isTimed(c=current()){return c?.timed!==false;}
function fresh(){if(blocked)throw Error('Reload this page or import a valid backup before continuing.');const raw=localStorage.getItem(KEY);if(raw&&JSON.parse(raw).revision!==data.revision){blocked=true;throw Error('Word Hive changed in another tab. Reload to use the latest results.');}}
function mutate(fn){fresh();const next=copy(data);fn(next);next.revision=data.revision+1;localStorage.setItem(KEY,JSON.stringify(next));data=next;}
function change(fn){const id=data.selected;mutate(d=>fn(d.challenges.find(c=>c.id===id)));}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){const msg=e.message||'The action could not be completed.';say(msg);if(document.querySelector('dialog[open]'))alert(msg);}};}
function on(id,fn){$(id).onclick=safe(fn);}
function options(el,items,value){el.replaceChildren(...items.map(([v,t])=>{const o=node('option',t);o.value=v;return o;}));if(value)el.value=value;if(el.selectedIndex<0&&el.options.length)el.selectedIndex=0;}
function running(){return data.challenges.flatMap(c=>c.periods.map(p=>({c,p,r:c.rounds[p.id]}))).find(x=>['running','paused'].includes(x.r.status));}
function expireAll(){if(blocked)return;const now=Date.now();if(data.challenges.some(c=>Object.values(c.rounds).some(r=>r.status==='running'&&C.remaining(r,now)===0))){mutate(d=>d.challenges.forEach(c=>Object.values(c.rounds).forEach(r=>C.expire(r,now))));render();}}
function time(ms){const seconds=Math.ceil(ms/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
function feedback(text){$('feedback').textContent=text;}
function clearGuess(){ $('guess').value=''; paintGuess(); }
function paintGuess(){
  const c=current(), value=$('guess')?.value||'';
  if(!$('guessVisual'))return;
  $('guessVisual').replaceChildren(...[...value].map(ch=>{
    const lower=ch.toLowerCase();
    return node('span',ch.toUpperCase(),'guess-letter'+(c&&/^[a-z]$/.test(lower)&&c.letters.includes(lower)?'':' invalid'));
  }));
}
function paintHive(){
  const c=current();if(!c)return;
  const rest=c.letters.split('').filter(x=>x!==c.center);if(outer.slice().sort().join('')!==rest.join(''))outer=rest;
  const enabled=currentRound()?.status==='running'&&!c.posted&&!blocked;
  $('hive').replaceChildren(...[c.center,...outer].map((letter,i)=>{const b=node('button',letter.toUpperCase(),'hex'+(i===0?' center':''));b.type='button';b.disabled=!enabled;b.setAttribute('aria-label',letter.toUpperCase()+(i===0?', required center letter':''));b.onclick=()=>{if(isTimed(c)&&C.remaining(currentRound())<=0){safe(expireAll)();return;}$('guess').value+=letter;paintGuess();$('guess').focus();};return b;}));
}
function render(){
  const c=current();$('empty').hidden=!!c;$('game').hidden=!c;
  if(!c){clearGuess();renderTeacher();return;}
  if(!c.periods.some(p=>p.id===activePeriod))activePeriod=c.periods.find(p=>['running','paused'].includes(c.rounds[p.id].status))?.id||c.periods.find(p=>p.id===String(DashboardData.getCurrentClassId()))?.id||c.periods[0].id;
  options($('period'),c.periods.map(p=>[p.id,p.name]),activePeriod);
  $('challengeTitle').textContent=c.title;
  $('challengeDate').textContent=new Date(c.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})+' · '+String(c.difficulty||'medium').toUpperCase()+' · '+(isTimed(c)?c.durationMs/60000+' MINUTES PER CLASS':'NO TIME LIMIT');
  const r=currentRound();$('roundStatus').textContent=c.posted?'RESULTS POSTED':r.status.toUpperCase();$('score').textContent=C.roundScore(c,r);
  const accepted=r.attempts.filter(w=>c.words.includes(w)).sort();$('foundCount').textContent=accepted.length;$('found').replaceChildren(...accepted.map(w=>node('span',w,C.letters(w).length===7?'word pangram':'word')));if(!accepted.length)$('found').append(node('p',r.status==='ready'?'A fresh word list for this class.':'Your accepted words will appear here.','subtle'));
  const enabled=r.status==='running'&&!c.posted&&!blocked;for(const id of ['guess','enter','delete'])$(id).disabled=!enabled;
  $('startRound').hidden=r.status!=='ready'||!!c.posted;$('startRound').disabled=!!running()||blocked;$('startRound').textContent=isTimed(c)?'Start '+c.durationMs/60000+'-minute round':'Start untimed round';
  $('roundNote').textContent=r.status==='ready'?(running()?'Finish the active round before starting this class.':isTimed(c)?'The timer starts when you click Start.':'No timer will run. End the round from Teacher controls when the class is finished.'):r.status==='running'?(isTimed(c)?'The timer continues if you refresh or leave this page.':'No time limit. End the round from Teacher controls when the class is finished.'):r.status==='paused'?'Round paused. Resume in Teacher controls.':r.status==='excluded'?'This class is excluded from this challenge.':'Round complete. Results are saved for the teacher.';
  paintGuess();paintHive();paintClock();renderTeacher();
}
function paintClock(){
  const c=current(),r=currentRound();if(!r||!c)return;
  if(!isTimed(c)){$('timer').textContent='NO TIME LIMIT';$('timer').classList.add('untimed');$('timer').classList.remove('urgent');$('timer').setAttribute('aria-label','No time limit');return;}
  const ms=C.remaining(r);$('timer').textContent=time(ms);$('timer').classList.remove('untimed');$('timer').classList.toggle('urgent',r.status==='running'&&ms<=30000);$('timer').setAttribute('aria-label','Time remaining '+time(ms));
}
function renderTeacher(){
  const choices=data.challenges.map(c=>[c.id,c.title+(c.mode==='single'?' · Single':' · Competition')+(c.posted?' · Posted':'')]);
  options($('challengeSelect'),choices,data.selected);$('challengeSelect').disabled=!choices.length;$('deleteChallenge').disabled=!current();$('deleteAllChallenges').disabled=!data.challenges.length;
  $('teacherCurrent').hidden=!current();const c=current();if(!c)return;
  const r=currentRound();$('pause').disabled=!r||!['running','paused'].includes(r.status)||!!c.posted;$('pause').textContent=r?.status==='paused'?'Resume current round':'Pause current round';$('finish').disabled=!r||!['running','paused'].includes(r.status)||!!c.posted;
  $('resultNote').textContent=c.mode==='single'?'Finish this class round, then award the result when you are ready.':'Complete each period or exclude periods that will not play. Earlier classes’ answers are hidden on the game screen.';
  $('results').replaceChildren(...c.periods.map(p=>{const round=c.rounds[p.id],tr=node('tr');const found=round.attempts.filter(w=>c.words.includes(w));for(const text of [p.name,round.status,found.length,C.roundScore(c,round)])tr.append(node('td',String(text)));const cell=node('td');if(['ready','excluded'].includes(round.status)&&!c.posted){const b=node('button',round.status==='excluded'?'Include':'Exclude');b.onclick=safe(()=>{change(ch=>{ch.rounds[p.id].status=round.status==='excluded'?'ready':'excluded';});render();});cell.append(b);}else cell.textContent=round.status==='excluded'?'Excluded':'Included';tr.append(cell);return tr;}));
  $('disputes').disabled=!C.ready(c)||!!c.posted;$('post').disabled=!C.ready(c)||!!c.posted;$('postedMessage').textContent=c.posted?'Awarded to '+c.posted.season+'.':'Results have not been added to the scoreboard.';
}

$('period').onchange=safe(()=>{activePeriod=$('period').value;clearGuess();feedback('Use the gold center letter in every word.');render();DashboardData.setCurrentClass(activePeriod);});
$('guess').addEventListener('input',paintGuess);
on('startRound',()=>{expireAll();if(running())throw Error('Finish the active round first.');const c=current();if(c.posted||currentRound().status!=='ready')return;change(ch=>{const r=ch.rounds[activePeriod];r.status='running';if(isTimed(ch)){r.remainingMs=ch.durationMs;r.startedAt=Date.now();r.deadline=r.startedAt+ch.durationMs;r.untimed=false;}else{r.remainingMs=0;r.startedAt=Date.now();r.deadline=null;r.untimed=true;}});render();$('guess').focus();});
$('guessForm').onsubmit=safe(e=>{e.preventDefault();expireAll();const c=current(),r=currentRound();if(!c||r.status!=='running'||c.posted||(isTimed(c)&&C.remaining(r)===0))return;const word=C.normalize($('guess').value);if(!/^[a-z]+$/.test(word)){feedback('Use letters A–Z only.');return;}if(word.length<4){feedback('Use at least four letters.');return;}if(!word.includes(c.center)){feedback('Include the gold center letter.');return;}if([...word].some(l=>!c.letters.includes(l))){feedback('Use only the seven hive letters.');return;}if(r.attempts.includes(word)){feedback(c.words.includes(word)?'Already found!':'Already tried!');clearGuess();$('guess').focus();return;}change(ch=>ch.rounds[activePeriod].attempts.push(word));const accepted=c.words.includes(word);feedback(accepted?(C.letters(word).length===7?'Pangram! ':'')+'+'+C.points(word)+' points':'Not in this word bank. Saved for teacher review.');clearGuess();render();$('guess').focus();});
on('delete',()=>{$('guess').value=$('guess').value.slice(0,-1);paintGuess();$('guess').focus();});
on('shuffle',()=>{for(let i=outer.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[outer[i],outer[j]]=[outer[j],outer[i]];}paintHive();});
on('teacher',()=>{expireAll();renderTeacher();$('teacherDialog').showModal();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('challengeSelect').onchange=safe(()=>{mutate(d=>d.selected=$('challengeSelect').value||null);activePeriod='';clearGuess();feedback('Use the gold center letter in every word.');render();});
on('pause',()=>{expireAll();const c=current(),r=currentRound();if(r.status==='running'){change(ch=>{const round=ch.rounds[activePeriod];if(isTimed(ch))round.remainingMs=C.remaining(round);round.status='paused';round.deadline=null;});}else if(r.status==='paused'){change(ch=>{const round=ch.rounds[activePeriod];if(isTimed(ch))round.deadline=Date.now()+round.remainingMs;round.status='running';});}render();});
on('finish',()=>{expireAll();if(!['running','paused'].includes(currentRound().status))return;if(!confirm('End this class’s round early? No more words can be entered for this period.'))return;change(ch=>{const r=ch.rounds[activePeriod];if(isTimed(ch))r.remainingMs=C.remaining(r);else r.remainingMs=0;r.status='finished';r.finishedAt=Date.now();r.deadline=null;});render();});

function refreshSinglePeriods(){const items=DashboardData.getClasses({activeOnly:true}).map(p=>[String(p.id),p.name]);options($('singlePeriod'),items,String(DashboardData.getCurrentClassId()||''));}
function syncChallengeMode(){$('singlePeriodLabel').hidden=$('challengeMode').value!=='single';}
function syncTimingMode(){$('minutesLabel').hidden=$('timingMode').value==='untimed';}
function newChallenge(mode='day'){
  if(running())throw Error('Finish the active round before creating another game.');
  if($('teacherDialog').open)$('teacherDialog').close();draft=null;$('preview').hidden=true;$('title').value='Word Hive · '+new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});$('reviewed').checked=false;$('challengeMode').value=mode==='single'?'single':'day';$('timingMode').value='timed';$('difficulty').value='medium';$('minutes').value='5';refreshSinglePeriods();syncChallengeMode();syncTimingMode();$('setupDialog').showModal();
}
on('createSingle',()=>newChallenge('single'));on('createCompetition',()=>newChallenge('day'));on('newSingle',()=>newChallenge('single'));on('newCompetition',()=>newChallenge('day'));
$('challengeMode').onchange=syncChallengeMode;$('timingMode').onchange=syncTimingMode;
function resetPreview(){draft=null;$('preview').hidden=true;$('reviewed').checked=false;}
function setCenters(){resetPreview();const hive=$('method').value==='letters'?$('letters').value.replace(/\s/g,''):$('method').value==='pangram'?$('pangram').value.trim():'';options($('center'),[['auto','Choose automatically'],...C.letters(hive).split('').filter(l=>/[a-z]/.test(l)).map(l=>[l,l.toUpperCase()])]);}
$('method').onchange=()=>{$('letterLabel').hidden=$('method').value!=='letters';$('pangramLabel').hidden=$('method').value!=='pangram';setCenters();};$('letters').oninput=setCenters;$('pangram').oninput=setCenters;$('center').onchange=resetPreview;$('difficulty').onchange=resetPreview;$('bank').oninput=()=>{$('reviewed').checked=false;};
const DIFFICULTY={
  easy:{target:155,min:120,max:180},
  medium:{target:92,min:60,max:130},
  hard:{target:36,min:10,max:70}
};
const CENTER_EASE={e:1,a:.98,r:.96,i:.94,o:.92,t:.9,n:.88,s:.86,l:.84,c:.74,d:.72,h:.7,m:.68,p:.66,u:.64,g:.61,b:.58,f:.55,y:.5,w:.48,v:.34,k:.28,j:.16,x:.13,q:.09,z:.07};
function difficultyScore(candidate,difficulty){
  const profile=DIFFICULTY[difficulty]||DIFFICULTY.medium,count=candidate.words.length,short=candidate.words.filter(w=>w.length<=5).length,pangrams=candidate.words.filter(w=>C.letters(w).length===7).length,ease=CENTER_EASE[candidate.center]??.5;
  let score=Math.abs(count-profile.target);
  if(count<profile.min)score+=(profile.min-count)*3;if(count>profile.max)score+=(count-profile.max)*3;
  if(difficulty==='easy'){score+=(1-ease)*34;score+=Math.max(0,55-short)*.35;score+=Math.max(0,2-pangrams)*8;}
  else if(difficulty==='hard'){score+=ease*24;score+=Math.max(0,short-35)*.18;}
  else score+=Math.abs(ease-.65)*8;
  return score;
}
function build(hive,center,difficulty='medium'){
  if(center!=='auto')return C.puzzle(index,hive,center);
  const possibilities=[];for(const letter of hive){try{possibilities.push(C.puzzle(index,hive,letter));}catch{}}
  if(!possibilities.length)throw Error('No playable center letter found. Try another hive.');
  return possibilities.sort((a,b)=>difficultyScore(a,difficulty)-difficultyScore(b,difficulty))[0];
}
function randomPuzzle(difficulty){
  const profile=DIFFICULTY[difficulty]||DIFFICULTY.medium,shuffled=seeds.slice();for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  let best=null,bestScore=Infinity,attempts=0;
  for(const seed of shuffled){
    attempts++;try{const candidate=build(C.letters(seed),'auto',difficulty),score=difficultyScore(candidate,difficulty);if(score<bestScore){best=candidate;bestScore=score;}if(candidate.words.length>=profile.min&&candidate.words.length<=profile.max){return candidate;}}catch{}
    if(attempts>=28)break;
  }
  return best;
}
on('generate',async()=>{if(!dictionaryReady)throw Error('The dictionary is still loading. If it failed, refresh the page.');$('generate').disabled=true;resetPreview();try{await new Promise(resolve=>setTimeout(resolve,0));const method=$('method').value,difficulty=$('difficulty').value;let hive;if(method==='random'){draft=randomPuzzle(difficulty);if(!draft)throw Error('No random puzzle is available. Try entering your own pangram.');}else{const raw=C.normalize(method==='letters'?$('letters').value.replace(/\s/g,''):$('pangram').value);if(!/^[a-z]+$/.test(raw))throw Error('Enter letters A–Z only.');if(method==='letters'&&raw.length!==7)throw Error('Enter seven different letters, without repeats.');hive=C.letters(raw);if(hive.length!==7)throw Error('The puzzle needs exactly seven unique letters.');if(method==='pangram'&&!dictionary.has(raw))throw Error('That pangram is not in the built-in dictionary. Use Choose seven letters, then add your word to the answer bank.');draft=build(hive,$('center').value,difficulty);} $('previewLetters').textContent=draft.letters.toUpperCase().split('').join(' · ')+' — CENTER: '+draft.center.toUpperCase()+' · '+difficulty.toUpperCase();$('bankCount').textContent=draft.words.length+' words · '+draft.words.reduce((s,w)=>s+C.points(w),0)+' possible points · Pangrams: '+draft.words.filter(w=>C.letters(w).length===7).join(', ');$('bank').value=draft.words.join('\n');$('preview').hidden=false;}finally{$('generate').disabled=false;}});
on('saveChallenge',()=>{
  if(!draft)throw Error('Generate a puzzle first.');if(running())throw Error('Finish the active round first.');
  const title=$('title').value.trim(),timed=$('timingMode').value!=='untimed',minutes=timed?Number($('minutes').value):0,difficulty=$('difficulty').value;
  if(!title)throw Error('Enter a challenge name.');if(timed&&(!Number.isInteger(minutes)||minutes<1||minutes>60))throw Error('Choose a whole number from 1 to 60 minutes.');
  const words=[...new Set($('bank').value.split(/[\s,]+/).map(C.normalize).filter(Boolean))].sort();if(words.length<10)throw Error('Keep at least 10 words in the answer bank.');if(words.some(w=>!C.validWord(w,draft.letters,draft.center)))throw Error('Every answer must have at least four letters, use only the hive letters, and include the center.');if(!words.some(w=>C.letters(w).length===7))throw Error('Keep at least one pangram.');if(!$('reviewed').checked)throw Error('Review the answer bank and check the confirmation box.');
  const allPeriods=DashboardData.getClasses({activeOnly:true}).map(p=>({id:String(p.id),name:p.name}));if(!allPeriods.length)throw Error('Enable at least one class in Dashboard Settings.');const mode=$('challengeMode').value==='single'?'single':'day';const periods=mode==='single'?allPeriods.filter(p=>p.id===$('singlePeriod').value):allPeriods;if(!periods.length)throw Error('Choose a class period for the single game.');
  const durationMs=timed?minutes*60000:0;const c={id:uid(),title,mode,timed,difficulty,letters:draft.letters,center:draft.center,words,durationMs,createdAt:Date.now(),periods,rounds:Object.fromEntries(periods.map(p=>[p.id,{status:'ready',remainingMs:durationMs,deadline:null,attempts:[],untimed:!timed}])),posted:null};
  mutate(d=>{d.challenges.push(c);d.selected=c.id;});activePeriod='';$('setupDialog').close();render();say(mode==='single'?'Single game saved. Play this class, then award the result when you are ready.':'Competition saved. Every included class gets the same puzzle'+(timed?' and time limit.':'.'));
});

on('deleteChallenge',()=>{
  const c=current();if(!c)throw Error('Choose a saved game first.');if(Object.values(c.rounds).some(r=>['running','paused'].includes(r.status)))throw Error('End the active round before deleting this saved game.');
  if(!confirm(`Delete “${c.title}” from Word Hive saved games?\n\nThis removes the saved game and its local results only. Any points already awarded to the Scoreboard will stay there.`))return;
  const id=c.id;mutate(d=>{d.challenges=d.challenges.filter(ch=>ch.id!==id);d.selected=d.challenges.at(-1)?.id||null;});activePeriod='';clearGuess();render();say('Saved Word Hive game deleted.');
});
on('deleteAllChallenges',()=>{
  if(!data.challenges.length)return;if(running())throw Error('End the active round before deleting saved games.');
  if(!confirm(`Delete all ${data.challenges.length} saved Word Hive games from this browser?\n\nThis cannot be undone from Word Hive unless you have an exported backup. Points already awarded to the Scoreboard will not be changed.`))return;
  mutate(d=>{d.challenges=[];d.selected=null;});activePeriod='';clearGuess();render();say('All saved Word Hive games deleted.');
});

function disputes(){const c=current(),bank=new Set(c.words);return [...new Set(c.periods.flatMap(p=>c.rounds[p.id].attempts.filter(w=>!bank.has(w))))].sort();}
function renderDisputes(){const words=disputes();$('disputeList').replaceChildren(...words.map(word=>{const row=node('div',undefined,'dispute-row');row.append(node('strong',word));const b=node('button','Approve for every class');b.onclick=safe(()=>{const c=current();if(!C.ready(c)||c.posted)throw Error('Corrections are only available after all rounds end and before posting.');if(!confirm('Accept “'+word+'” and credit every class that tried it?'))return;change(ch=>{if(!ch.words.includes(word))ch.words.push(word);});render();renderDisputes();});row.append(b);return row;}));if(!words.length)$('disputeList').append(node('p','No disputed words to review.'));}
on('disputes',()=>{if(!C.ready(current())||current().posted)return;renderDisputes();$('disputeDialog').showModal();});
on('post',()=>{expireAll();const c=current();if(!C.ready(c)||c.posted)throw Error(c?.mode==='single'?'Finish the game before awarding points.':'Finish or exclude every class before awarding points.');const scores=c.periods.filter(p=>c.rounds[p.id].status==='finished').map(p=>({period:p.id,name:p.name,score:C.roundScore(c,c.rounds[p.id])}));GameCompetitionAward.open({eventId:'word-hive-'+c.id,name:c.title.toLowerCase().startsWith('word hive')?c.title:'Word Hive: '+c.title,scores,sourceApp:'Word Hive',sourceId:c.id,onAward:result=>{change(ch=>ch.posted={season:result.season,at:Date.now(),eventId:result.event.id});render();say(result.added?'Results added to the scoreboard.':'These results were already on the scoreboard; no duplicate points were added.');}});});
on('export',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='Word-Hive-Backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
on('import',()=>$('importFile').click());$('importFile').onchange=safe(async()=>{const f=$('importFile').files[0];if(!f)return;try{if(f.size>10000000)throw Error('Choose a Word Hive backup smaller than 10 MB.');const next=JSON.parse(await f.text());if(!validData(next))throw Error('This is not a valid Word Hive backup.');if(!confirm('Replace Word Hive saved games and results in this browser with this backup? Scoreboard entries will not be changed.'))return;next.revision=data.revision+1;localStorage.setItem(KEY,JSON.stringify(next));data=next;blocked=false;activePeriod='';expireAll();render();say('Word Hive backup imported.');}finally{$('importFile').value='';}});
on('fullscreen',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.body.requestFullscreen();});document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null){blocked=true;say('Word Hive changed in another tab. Reload this page to continue with the latest scores.');document.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);}});
document.addEventListener('visibilitychange',()=>{safe(expireAll)();paintClock();});setInterval(()=>{safe(expireAll)();paintClock();},250);
(async()=>{try{const response=await fetch('shared/word-hive-dictionary.json');if(!response.ok)throw Error('Dictionary file could not be loaded.');const d=await response.json();if(!Array.isArray(d.words)||!Array.isArray(d.seeds))throw Error('Invalid dictionary file.');dictionary=new Set(d.words);index=d.words.map(word=>({word,mask:C.mask(word)}));seeds=d.seeds;dictionaryReady=true;$('dictionaryStatus').textContent=dictionary.size.toLocaleString()+' words available';$('generate').disabled=false;}catch(e){$('dictionaryStatus').textContent='Dictionary unavailable. Upload shared/word-hive-dictionary.json and refresh.';$('generate').disabled=true;say('The dictionary could not load. Saved games can still be played.');}})();
$('generate').disabled=true;try{expireAll();render();}catch(e){blocked=true;say(e.message);}
})();
