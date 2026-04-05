import type { Twitch } from './twitch-helix.js';

/** In-memory + persistence state for one tracked streamer login. */
export interface StreamerState {
  user?: Twitch.User;
  live: boolean;
  stream?: Twitch.Channel;
  /** Helix `stream.id` we already posted a Discord notification for this session. */
  announcedStreamId?: string;
}

export type StreamerStatusMap = Record<string, StreamerState>;

/** Map Twitch login → last announced Helix stream id (persisted across process restarts). */
export type AnnouncementStore = Record<string, string>;

export interface StreamerListFile {
  logins: string[];
}

export enum TwitchErrors {
  MissingCredentials = 'Could not find Twitch client id or secret in your environment',
  MissingDiscordTextChannel = 'Could not find DISCORD_CHANNEL_ID in your environment',
  ChannelNotInCache = 'Could not find channel',
  ChannelNotText = 'Could not find valid text channel'
}

/** Twitch login: 4–25 chars, lowercase letters, digits, underscore. */
export const TWITCH_LOGIN_RE = /^[a-z0-9_]{4,25}$/;
