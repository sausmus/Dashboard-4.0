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
function remaining(r,now=Date.now()){if(r?.untimed)return Number.POSITIVE_INFINITY;return r.status==='running'?Math.max(0,r.deadline-now):Math.max(0,r.remainingMs||0);}
function expire(r,now=Date.now()){if(r?.untimed)return false;if(r.status==='running'&&remaining(r,now)===0){r.status='finished';r.remainingMs=0;r.finishedAt=now;r.deadline=null;return true;}return false;}
function ready(c){return c.periods.every(p=>['finished','excluded'].includes(c.rounds[p.id].status))&&c.periods.some(p=>c.rounds[p.id].status==='finished');}
function awards(c){const rows=c.periods.filter(p=>c.rounds[p.id].status==='finished').map(p=>({...p,score:roundScore(c,c.rounds[p.id])}));const best=Math.max(0,...rows.map(p=>p.score));return rows.map(p=>({...p,award:best?Math.round((p.score/best*10+Number.EPSILON)*10)/10:0}));}
function validate(c){const timed=c?.timed!==false;return c&&typeof c.id==='string'&&typeof c.title==='string'&&Number.isFinite(c.createdAt)&&/^[a-z]{7}$/.test(c.letters)&&letters(c.letters)===c.letters&&c.center?.length===1&&c.letters.includes(c.center)&&Number.isFinite(c.durationMs)&&(timed?(c.durationMs>=60000&&c.durationMs<=3600000):c.durationMs===0)&&Array.isArray(c.words)&&c.words.length>=1&&new Set(c.words).size===c.words.length&&c.words.every(w=>validWord(w,c.letters,c.center))&&Array.isArray(c.periods)&&c.periods.length>0&&new Set(c.periods.map(p=>p.id)).size===c.periods.length&&c.periods.every(p=>{const r=c.rounds?.[p.id];return typeof p.id==='string'&&/^[1-7]$/.test(p.id)&&typeof p.name==='string'&&r&&['ready','running','paused','finished','excluded'].includes(r.status)&&Array.isArray(r.attempts)&&new Set(r.attempts).size===r.attempts.length&&r.attempts.every(w=>validWord(w,c.letters,c.center))&&Number.isFinite(r.remainingMs)&&r.remainingMs>=0&&(timed?r.remainingMs<=c.durationMs:r.remainingMs===0)&&((r.untimed===true)===!timed||r.untimed===undefined)&&(r.status!=='running'||!timed||Number.isFinite(r.deadline));});}
root.WordHiveCore={normalize,letters,mask,validWord,points,answers,puzzle,roundScore,remaining,expire,ready,awards,validate};
})(typeof module==='object'?module.exports:window);
