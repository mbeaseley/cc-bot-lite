import type TwitchService from '../services/twitch.service.js';

declare module 'discord.js' {
  interface Client {
    /** Set in `main.ts` after constructing `TwitchService`. */
    twitchService?: TwitchService;
  }
}

export {};
