const{SlashCommandBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('reactionroles').setDescription('Manage reaction roles');
async function execute(i){await i.reply({content:'Reaction roles.',ephemeral:true});}
function loadData(){return{};}
module.exports={data,execute,loadData};