const{SlashCommandBuilder,EmbedBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('advertise').setDescription('Post an advertisement');
async function execute(i){await i.reply({content:'Advertise command.',ephemeral:true});}
function buildAdEmbed(guild){return new EmbedBuilder().setTitle('Advertisement').setDescription('Check us out!');}
module.exports={data,execute,buildAdEmbed};