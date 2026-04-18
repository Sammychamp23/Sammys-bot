const{SlashCommandBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('giveaway').setDescription('Manage giveaways');
async function execute(i){await i.reply({content:'Giveaway command.',ephemeral:true});}
async function handleEntry(i){await i.reply({content:'You entered the giveaway!',ephemeral:true});}
module.exports={data,execute,handleEntry};