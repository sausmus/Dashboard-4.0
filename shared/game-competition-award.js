(function(root){
'use strict';
const Service=root.DashboardCompetitionService;
if(!Service) throw Error('competition-service.js must load before game-competition-award.js');
let current=null,method='balanced';
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
function dateKey(date=new Date()){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function format(value){const n=Service.roundScore(value);return Number.isInteger(n)?String(n):n.toFixed(1);}
function labelFor(row){return row.name||`Period ${row.period}`;}
function medal(index){return ['🥇','🥈','🥉'][index]||String(index+1);}
function ensure(){
  let back=document.getElementById('sharedCompetitionAward');
  if(back) return back;
  back=make('div','game-competition-backdrop');back.id='sharedCompetitionAward';back.setAttribute('aria-hidden','true');
  back.innerHTML=`<div class="game-competition-modal" role="dialog" aria-modal="true" aria-labelledby="sharedCompetitionTitle"><div class="game-competition-header"><div><div class="game-competition-title" id="sharedCompetitionTitle">Award to Scoreboard</div><div class="game-competition-subtitle" id="sharedCompetitionSubtitle">Review the game scores and choose how they become championship points.</div></div><button class="game-competition-close" id="sharedCompetitionClose" type="button" aria-label="Close">×</button></div><div class="game-competition-top"><input id="sharedCompetitionName" type="text" maxlength="120" aria-label="Competition name"><input id="sharedCompetitionDate" type="date" aria-label="Competition date"></div><div class="game-competition-scoring"><div class="game-competition-label">Scoring Method</div><div class="game-competition-toggle" role="group" aria-label="Competition scoring method"><button class="game-competition-method" id="sharedStraight" type="button" aria-pressed="false">Straight Points</button><button class="game-competition-method active" id="sharedBalanced" type="button" aria-pressed="true">⚖ Balanced to 10</button></div><div class="game-competition-explanation" id="sharedCompetitionExplanation"></div></div><div class="game-competition-table-wrap"><table class="game-competition-table"><thead><tr><th>Rank</th><th>Class</th><th>Game Score</th><th>Championship Points</th></tr></thead><tbody id="sharedCompetitionRows"></tbody></table></div><div class="game-competition-winner" id="sharedCompetitionWinner"></div><div class="game-competition-actions"><button id="sharedCompetitionCancel" type="button">Cancel</button><button id="sharedCompetitionSave" type="button" class="primary">Add Results to Championship</button></div></div>`;
  document.body.append(back);
  const close=()=>hide();
  document.getElementById('sharedCompetitionClose').onclick=close;
  document.getElementById('sharedCompetitionCancel').onclick=close;
  document.getElementById('sharedStraight').onclick=()=>setMethod('straight');
  document.getElementById('sharedBalanced').onclick=()=>setMethod('balanced');
  document.getElementById('sharedCompetitionSave').onclick=save;
  back.addEventListener('click',e=>{if(e.target===back)hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&back.classList.contains('open'))hide();});
  return back;
}
function setMethod(next){method=next==='straight'?'straight':'balanced';const straight=method==='straight';document.getElementById('sharedStraight').classList.toggle('active',straight);document.getElementById('sharedBalanced').classList.toggle('active',!straight);document.getElementById('sharedStraight').setAttribute('aria-pressed',String(straight));document.getElementById('sharedBalanced').setAttribute('aria-pressed',String(!straight));document.getElementById('sharedCompetitionExplanation').textContent=straight?'Game scores are added directly to the championship standings.':'The highest game score earns 10 championship points. Every other class earns a proportional amount.';render();}
function render(){if(!current)return;const rows=Service.calculate(current.scores,method);const body=document.getElementById('sharedCompetitionRows');body.replaceChildren();const ranked=[...rows].sort((a,b)=>b.score-a.score||Number(a.period)-Number(b.period));let previous=null,rank=0;ranked.forEach((row,index)=>{if(previous===null||row.score!==previous)rank=index+1;row.rank=rank;previous=row.score;});rows.forEach(row=>{const match=ranked.find(x=>x.period===String(row.period));const tr=make('tr');const rankCell=make('td','game-competition-rank',medal((match?.rank||1)-1));const periodCell=make('td','game-competition-period',labelFor(row));const scoreCell=make('td');const scoreInput=document.createElement('input');scoreInput.type='number';scoreInput.value=format(row.score);scoreInput.readOnly=true;scoreInput.setAttribute('aria-label',`${labelFor(row)} game score`);scoreCell.append(scoreInput);const awardCell=make('td');const awardInput=document.createElement('input');awardInput.type='number';awardInput.value=format(row.award);awardInput.readOnly=true;awardInput.className='game-competition-points';awardInput.setAttribute('aria-label',`${labelFor(row)} championship points`);awardCell.append(awardInput);tr.append(rankCell,periodCell,scoreCell,awardCell);body.append(tr);});
  const winner=document.getElementById('sharedCompetitionWinner');if(!ranked.length){winner.textContent='No game results are available.';return;}const top=ranked[0].score,leaders=ranked.filter(x=>x.score===top).map(labelFor);winner.textContent=leaders.length===1?`🏆 ${leaders[0]} wins with ${format(top)} points.`:`🏆 Tie for first: ${leaders.join(' & ')} with ${format(top)} points.`;
}
function open(options){
  if(!Array.isArray(options?.scores)||!options.scores.length) throw Error('There are no game results to award.');
  const state=Service.load();
  const scores=options.scores.map(row=>({period:String(row.period),name:row.name,score:Number(row.score)}));
  if(scores.some(row=>!Number.isFinite(row.score)||row.score<0)) throw Error('One or more game scores are invalid.');
  current={...options,scores,season:state.activeSeason};
  ensure();
  document.getElementById('sharedCompetitionName').value=options.name||'Class Competition';
  document.getElementById('sharedCompetitionDate').value=options.date||dateKey(new Date());
  document.getElementById('sharedCompetitionSubtitle').textContent=`Review the game scores, then award them to ${state.activeSeason}.`;
  setMethod(options.defaultMethod||'balanced');
  const back=document.getElementById('sharedCompetitionAward');back.classList.add('open');back.setAttribute('aria-hidden','false');
}
function hide(){const back=document.getElementById('sharedCompetitionAward');if(back){back.classList.remove('open');back.setAttribute('aria-hidden','true');}current=null;}
async function save(){if(!current)return;const button=document.getElementById('sharedCompetitionSave');button.disabled=true;try{const name=document.getElementById('sharedCompetitionName').value.trim()||'Class Competition';const date=document.getElementById('sharedCompetitionDate').value;const result=await Service.withLock(()=>Service.addCompetition({id:current.eventId,name,date:date?new Date(`${date}T12:00:00`):new Date(),season:current.season,scoringMethod:method,scores:current.scores,sourceApp:current.sourceApp,sourceId:current.sourceId}));const callback=current.onAward;hide();if(callback)callback(result);}finally{button.disabled=false;}}
root.GameCompetitionAward={open,hide};
})(window);
