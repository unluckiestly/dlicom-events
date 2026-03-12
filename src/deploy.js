// Clears all guild slash commands (no longer used — everything is button-driven)
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Clearing guild slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] },
    );
    console.log('Done — all slash commands removed.');
  } catch (error) {
    console.error('Failed:', error);
  }
})();
