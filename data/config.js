const _cfg=new Map();
const cfg={get(guildId,key,def=null){const g=_cfg.get(guildId)??{};return key in g?g[key]:def;},set(guildId,key,value){const g=_cfg.get(guildId)??{};g[key]=value;_cfg.set(guildId,g);}};
module.exports=cfg;