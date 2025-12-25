import { dirname, importx } from '@discordx/importer';
import type { Interaction, Message } from 'discord.js';
import { IntentsBitField } from 'discord.js';
import { Client } from 'discordx';
import dotenv from 'dotenv';
import TwitchService from './services/twitch.service.js';

// Load environment variables
dotenv.config();

export const bot = new Client({
  // Discord intents
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildModeration,
    IntentsBitField.Flags.GuildExpressions,
    IntentsBitField.Flags.GuildIntegrations,
    IntentsBitField.Flags.GuildInvites,
    IntentsBitField.Flags.GuildWebhooks,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.DirectMessageTyping,
    IntentsBitField.Flags.MessageContent
  ],

  // Debug logs are disabled in silent mode
  silent: false,

  // Configuration for @SimpleCommand
  simpleCommand: {
    prefix: '!'
  }
});

/**
 * Bot ready event
 */
bot.once('clientReady', async () => {
  // Synchronize applications commands with Discord
  await bot.initApplicationCommands();
  console.log('Bot started');
});

/**
 * Handle interaction and message create events
 */
bot.on('interactionCreate', (interaction: Interaction) => {
  bot.executeInteraction(interaction);
});

/**
 * Handle message create events
 */
bot.on('messageCreate', (message: Message) => {
  void bot.executeCommand(message);
});

/**
 * Main function to run the bot
 */
async function run() {
  // The following syntax should be used in the ECMAScript environment
  await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.{ts,js}`);

  // Let's start the bot
  if (!process.env.BOT_TOKEN) {
    throw Error('Could not find BOT_TOKEN in your environment');
  }

  // Log in with your bot token
  await bot.login(process.env.BOT_TOKEN);

  const twitchService = new TwitchService();
  if (twitchService.checkTwitchEnvVars()) {
    twitchService.init();

    setInterval(async () => {
      if (twitchService.findLiveChannel(bot)) {
        await twitchService.checkStreamers();
        twitchService.sendLiveNotifications(bot);
      }
    }, 60000);
  }
}

void run();
