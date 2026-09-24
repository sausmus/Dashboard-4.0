(function(root){
'use strict';
const normalize=s=>String(s).trim().toLowerCase();
const letters=s=>[...new Set(normalize(s))].sort().join('');
const mask=s=>[...s].reduce((m,c)=>m|(1<<(c.charCodeAt(0)-97)),0);
function validWord(word,hive,center){return /^[a-z]{4,}$/.test(word)&&word.includes(center)&&[...word].every(c=>hive.includes(c));}
function points(word){return word.length===4?1:word.length+(letters(word).length===7?7:0);}
function answers(words,hive,center){const m=mask(hive),bit=mask(center);return words.filter(x=>(x.mask&m)===x.mask&&(x.mask&bit)).map(x=>x.word);}
function puzzle(words,hive,center){hive=letters(hive);center=normalize(center);if(!/^[a-z]{7}$/.test(hive))throw Error('Use exactly seven different letters, A–Z.');if(!/^[a-z]$/.test(center)||!hive.includes(center))throw Error('Choose a center letter from the hive.');const bank=answers(words,hive,center);if(bank.length<10)throw Error('This combination has fewer than 10 words. Try another center letter or hive.');if(!bank.some(w=>letters(w).length===7))throw Error('No pangram found. Try another combination.');return {letters:hive,center,words:bank};}
function roundScore(c,r){const bank=new Set(c.words);return r.attempts.filter(w=>bank.has(w)).reduce((s,w)=>s+points(w),0);}
function remaining(r,now=Date.now()){return r.status==='running'?Math.max(0,r.deadline-now):Math.max(0,r.remainingMs||0);}
function expire(r,now=Date.now()){if(r.status==='running'&&remaining(r,now)===0){r.status='finished';r.remainingMs=0;r.finishedAt=now;r.deadline=null;return true;}return false;}
function ready(c){return c.periods.every(p=>['finished','excluded'].includes(c.rounds[p.id].status))&&c.periods.some(p=>c.rounds[p.id].status==='finished');}
function awards(c){const rows=c.periods.filter(p=>c.rounds[p.id].status==='finished').map(p=>({...p,score:roundScore(c,c.rounds[p.id])}));const best=Math.max(0,...rows.map(p=>p.score));return rows.map(p=>({...p,award:best?Math.round((p.score/best*10+Number.EPSILON)*10)/10:0}));}
function validate(c){return c&&typeof c.id==='string'&&typeof c.title==='string'&&Number.isFinite(c.createdAt)&&/^[a-z]{7}$/.test(c.letters)&&letters(c.letters)===c.letters&&c.center?.length===1&&c.letters.includes(c.center)&&Number.isFinite(c.durationMs)&&c.durationMs>=60000&&c.durationMs<=3600000&&Array.isArray(c.words)&&c.words.length>=1&&new Set(c.words).size===c.words.length&&c.words.every(w=>validWord(w,c.letters,c.center))&&Array.isArray(c.periods)&&c.periods.length>0&&new Set(c.periods.map(p=>p.id)).size===c.periods.length&&c.periods.every(p=>typeof p.id==='string'&&/^[1-7]$/.test(p.id)&&typeof p.name==='string'&&c.rounds?.[p.id]&&['ready','running','paused','finished','excluded'].includes(c.rounds[p.id].status)&&Array.isArray(c.rounds[p.id].attempts)&&new Set(c.rounds[p.id].attempts).size===c.rounds[p.id].attempts.length&&c.rounds[p.id].attempts.every(w=>validWord(w,c.letters,c.center))&&Number.isFinite(c.rounds[p.id].remainingMs)&&c.rounds[p.id].remainingMs>=0&&c.rounds[p.id].remainingMs<=c.durationMs&&(c.rounds[p.id].status!=='running'||Number.isFinite(c.rounds[p.id].deadline)));}
root.WordHiveCore={normalize,letters,mask,validWord,points,answers,puzzle,roundScore,remaining,expire,ready,awards,validate};
})(typeof module==='object'?module.exports:window);
