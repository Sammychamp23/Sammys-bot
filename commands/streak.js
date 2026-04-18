const{SlashCommandBuilder}=require('discord.js');
const data=new SlashCommandBuilder().setName('streak').setDescription('View your activity streak');
async function execute(i){await i.reply({content:'Streak command.',ephemeral:true});}
const MILESTONES=[{days:3,coins:100},{days:7,coins:300},{days:14,coins:600},{days:30,coins:1500},{days:60,coins:3000},{days:100,coins:5000}];
module.exports={data,execute,MILESTONES};