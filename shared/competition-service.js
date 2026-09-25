(function(root){
'use strict';
const STORAGE_KEY='bjhScoreboard_v1';
const DEFAULT_SEASON='Fall Semester Championship';
const roundScore=value=>Math.round((Number(value)||0)*10)/10;
function normalizeState(raw){
  let state=raw;
  if(!state) state={schemaVersion:4,activeSeason:DEFAULT_SEASON,seasons:{}};
  if(Array.isArray(state.events)){
    const title=state.seasonName||DEFAULT_SEASON;
    state={schemaVersion:4,activeSeason:title,seasons:{[title]:{events:state.events}}};
  }
  if(!state||typeof state.activeSeason!=='string'||!state.seasons||typeof state.seasons!=='object') throw Error('Scoreboard data could not be read. Open Scoreboard to check it first.');
  for(const season of Object.values(state.seasons)){
    if(!season||!Array.isArray(season.events)) throw Error('Scoreboard data could not be read. Open Scoreboard to check it first.');
  }
  return state;
}
function load(){
  let parsed=null;
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{parsed=JSON.parse(raw);}catch{throw Error('Scoreboard data could not be read. Open Scoreboard to check it first.');}
  }
  return normalizeState(parsed);
}
function save(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(normalizeState(state)));}
function calculate(scores,method='balanced'){
  const rows=scores.map(row=>({...row,period:String(row.period),score:roundScore(row.score)}));
  if(method==='straight') return rows.map(row=>({...row,award:roundScore(row.score)}));
  const best=Math.max(0,...rows.map(row=>row.score));
  return rows.map(row=>({...row,award:best>0?roundScore(row.score/best*10):0}));
}
function findEvent(state,id){
  for(const [seasonName,season] of Object.entries(state.seasons)){
    const event=season.events.find(item=>item.id===id);
    if(event) return {seasonName,event};
  }
  return null;
}
function makeId(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);}
function addCompetition(options){
  const state=load();
  const id=String(options.id||makeId());
  const prior=findEvent(state,id);
  if(prior) return {added:false,season:prior.seasonName,event:prior.event,state};
  const seasonName=options.season||state.activeSeason;
  if(seasonName!==state.activeSeason&&options.requireActiveSeason!==false) throw Error('The active championship changed. Reopen the points preview.');
  const scores=(options.scores||[]).map(row=>({period:String(row.period),score:roundScore(row.score)}));
  if(!scores.length) throw Error('There are no game results to award.');
  if(scores.some(row=>!/^\d+$/.test(row.period)||row.score<0||!Number.isFinite(row.score))) throw Error('One or more competition scores are invalid.');
  const scoringMethod=options.scoringMethod==='straight'?'straight':'balanced';
  const rows=calculate(scores,scoringMethod);
  const gameScores=Object.fromEntries(rows.map(row=>[row.period,row.score]));
  const changes=Object.fromEntries(rows.map(row=>[row.period,row.award]));
  const event={
    id,
    type:'competition',
    date:(options.date instanceof Date?options.date:new Date(options.date||Date.now())).toISOString(),
    reason:String(options.name||'Class Competition'),
    scoringMethod,
    scoringScale:scoringMethod==='balanced'?10:null,
    gameScores,
    changes
  };
  if(options.sourceApp) event.sourceApp=String(options.sourceApp);
  if(options.sourceId) event.sourceId=String(options.sourceId);
  state.seasons[seasonName]??={events:[]};
  state.seasons[seasonName].events.push(event);
  save(state);
  return {added:true,season:seasonName,event,state,rows};
}
async function withLock(fn){
  if(navigator.locks) return navigator.locks.request('bjh-scoreboard-write',fn);
  return fn();
}
root.DashboardCompetitionService={STORAGE_KEY,load,save,calculate,findEvent,addCompetition,roundScore,withLock};
})(window);
