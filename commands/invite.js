const{SlashCommandBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('invite').setDescription('Invite tracking');
async function execute(i){await i.reply({content:'Invite command.',ephemeral:true});}
async function trackInvite(guild,inviterId){return null;}
module.exports={data,execute,trackInvite};