const{SlashCommandBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('trade').setDescription('Trade alerts');
async function execute(i){await i.reply({content:'Trade command.',ephemeral:true});}
function setAlertChannelId(){}
module.exports={data,execute,setAlertChannelId};