const coins=new Map(),xpStore=new Map(),warnings=new Map(),lastMsgXP=new Map(),lastMsgCoin=new Map();
const lastDaily=new Map(),lastWeekly=new Map(),giveaways=new Map(),sessions=new Map();
const voiceMinutes=new Map(),messageCounts=new Map(),questProgress=new Map(),mysteryDrops=new Map();
const inventory=new Map(),activityStreak=new Map(),contracts=new Map(),achievements=new Map();
const lastSeen=new Map(),comebackRewards=new Map(),claimableRewards=new Map(),auctions=new Map();
const sessionJoins=new Map(),firstActions=new Map(),xpBoosts=new Map(),upgrades=new Map();
let chaosMode={active:false,expiresAt:0},seasonData={season:1,startedAt:Date.now()};
function getLevel(xp){return Math.floor(xp/200);}
function addXp(userId,amount){const d=xpStore.get(userId)??{xp:0,level:0};d.xp+=amount;d.level=getLevel(d.xp);xpStore.set(userId,d);return d;}
function addCoins(userId,amount){const c=(coins.get(userId)??0)+amount;coins.set(userId,c);return c;}
function getCoins(userId){return coins.get(userId)??0;}
function addVoiceMinutes(userId,m){voiceMinutes.set(userId,(voiceMinutes.get(userId)??0)+m);}
function incrementMessageCount(userId){messageCounts.set(userId,(messageCounts.get(userId)??0)+1);}
function incrementQuestProgress(userId,type){const q=questProgress.get(userId)??{};q[type]=(q[type]??0)+1;questProgress.set(userId,q);return q[type];}
function createMysteryDrop(userId){const items=['common_crate','rare_crate','epic_crate','legendary_crate'];const drop={item:items[Math.floor(Math.random()*items.length)],createdAt:Date.now()};mysteryDrops.set(userId,drop);return drop;}
function claimMysteryDrop(userId){const d=mysteryDrops.get(userId);mysteryDrops.delete(userId);return d??null;}
function advanceSeason(){seasonData.season+=1;seasonData.startedAt=Date.now();return seasonData;}
function getLeaderboard(type='xp'){if(type==='xp')return[...xpStore.entries()].sort((a,b)=>b[1].xp-a[1].xp).slice(0,10).map(([id,d])=>({userId:id,...d}));if(type==='coins')return[...coins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,v])=>({userId:id,coins:v}));return[];}
function getSeasonData(){return{...seasonData};}
function hasActiveXpBoost(userId){return Date.now()<(xpBoosts.get(userId)??0);}
function recordSessionJoin(userId){sessionJoins.set(userId,Date.now());}
function recordSessionComplete(userId){const j=sessionJoins.get(userId);sessionJoins.delete(userId);return j?Date.now()-j:0;}
function getUpgradeMultiplier(userId){return(upgrades.get(userId)??{multiplier:1}).multiplier;}
function getChaosMode(){return{...chaosMode};}
function trackMessageAnalytics(){}
function activateChaosMode(ms=3600000){chaosMode={active:true,expiresAt:Date.now()+ms};setTimeout(()=>{chaosMode={active:false,expiresAt:0};},ms);return chaosMode;}
function rotateGames(){return[];}
function load(){return true;}
function getInactiveUsers(t=7*24*60*60*1000){const c=Date.now()-t;return[...lastSeen.entries()].filter(([,ts])=>ts<c).map(([id])=>id);}
function canGiveComebackReward(u){return Date.now()-(comebackRewards.get(u)??0)>7*24*60*60*1000;}
function recordComebackReward(u){comebackRewards.set(u,Date.now());}
function addClaimableReward(u,r){const l=claimableRewards.get(u)??[];l.push(r);claimableRewards.set(u,l);}
function getAuctions(){return[...auctions.values()];}
function endAuction(id){const a=auctions.get(id);auctions.delete(id);return a??null;}
function checkFirstAction(u,action){const s=firstActions.get(u)??new Set();if(s.has(action))return false;s.add(action);firstActions.set(u,s);return true;}
function updateActivityStreak(u){const now=Date.now(),d=86400000,rec=activityStreak.get(u)??{streak:0,lastActive:0};const diff=now-rec.lastActive;if(diff>=d&&diff<d*2)rec.streak+=1;else if(diff>=d*2)rec.streak=1;rec.lastActive=now;activityStreak.set(u,rec);return{current:rec.streak,streaked:diff>=d};}
function updateContractProgress(u,t){const c=contracts.get(u)??{};c[t]=(c[t]??0)+1;contracts.set(u,c);return c[t];}
function updateAchievementProgress(u,t){const a=achievements.get(u)??{};a[t]=(a[t]??0)+1;achievements.set(u,a);return a[t];}
function updateLastSeen(u){lastSeen.set(u,Date.now());}
function addToInventory(u,item){const inv=inventory.get(u)??[];inv.push(item);inventory.set(u,inv);}
function claimDaily(u){const now=Date.now(),last=lastDaily.get(u)??0,cd=24*60*60*1000;if(now-last<cd)return{success:false,remaining:cd-(now-last)};lastDaily.set(u,now);addCoins(u,200);return{success:true,coins:200};}
function setAlertChannelId(){}
module.exports={coins,xpStore,warnings,lastMsgXP,lastMsgCoin,lastDaily,lastWeekly,giveaways,sessions,addXp,addCoins,getCoins,addVoiceMinutes,incrementMessageCount,incrementQuestProgress,createMysteryDrop,claimMysteryDrop,advanceSeason,getLeaderboard,getSeasonData,hasActiveXpBoost,recordSessionJoin,recordSessionComplete,getUpgradeMultiplier,getChaosMode,trackMessageAnalytics,activateChaosMode,rotateGames,load,getInactiveUsers,canGiveComebackReward,recordComebackReward,addClaimableReward,getAuctions,endAuction,checkFirstAction,updateActivityStreak,updateContractProgress,updateAchievementProgress,updateLastSeen,addToInventory,claimDaily,setAlertChannelId};