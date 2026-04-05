import axios from 'axios';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { Client } from 'discordx';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TWITCH_OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_HELIX = 'https://api.twitch.tv/helix';
const TWITCH_FOOTER_ICON = 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png';
/** Twitch brand purple (decimal) */
const EMBED_COLOR = 6570405;
const EMBED_TITLE_MAX = 256;
const EMBED_FIELD_VALUE_MAX = 1024;

function truncateForDiscord(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

interface StreamerState {
  user?: Twitch.User;
  live: boolean;
  stream?: Twitch.Channel;
  /** Helix `stream.id` we already posted a Discord notification for this session. */
  announcedStreamId?: string;
}

type StreamerStatusMap = Record<string, StreamerState>;

interface HelixStreamsResponse {
  data: Twitch.Channel[];
}

enum TwitchErrors {
  MissingCredentials = 'Could not find Twitch client id or secret in your environment',
  MissingDiscordTextChannel = 'Could not find DISCORD_CHANNEL_ID in your environment',
  ChannelNotInCache = 'Could not find channel',
  ChannelNotText = 'Could not find valid text channel'
}

/** Map Twitch login → last announced Helix stream id (persisted across process restarts). */
type AnnouncementStore = Record<string, string>;

export default class TwitchService {
  private readonly clientId = process.env.TWITCH_CLIENT_ID;
  private readonly clientSecret = process.env.TWITCH_SECRET;
  private readonly discordChannelId = process.env.DISCORD_CHANNEL_ID;
  private readonly announcementStorePath = path.resolve(
    process.env.TWITCH_ANNOUNCE_STORE_PATH ?? path.join(process.cwd(), 'data', 'twitch-announcements.json')
  );
  private token = '';
  private streamers: StreamerStatusMap = {};

  public async init(): Promise<void> {
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }

    for (const key of Object.keys(process.env)) {
      if (!key.includes('TWITCH_STREAMER_')) continue;
      const login = process.env[key];
      if (login) this.streamers[login] = { live: false };
    }

    await this.loadAnnouncementStore();
    // Rewrite store so keys removed from TWITCH_STREAMER_* env are dropped from disk (file is not append-only).
    await this.persistAnnouncementStore();

    const { data } = await axios.post<{ access_token: string }>(
      `${TWITCH_OAUTH_TOKEN}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );
    this.token = data.access_token;
  }

  async checkStreamers(): Promise<void> {
    await Promise.all(Object.keys(this.streamers).map((login) => this.refreshStreamer(login)));
    await this.hydrateUsers();
  }

  public async sendLiveNotifications(bot: Client): Promise<void> {
    const channel = this.resolveAnnounceChannel(bot);

    for (const [login, state] of Object.entries(this.streamers)) {
      const { user, live, stream, announcedStreamId } = state;
      if (!live || !stream || !user || announcedStreamId === stream.id) continue;

      const displayName = user.display_name ?? user.login ?? 'Streamer';

      try {
        await channel.send({
          content: `Hey @everyone, **${displayName}** is live now!`,
          embeds: [this.buildLiveEmbed(stream, user)],
          components: []
        });
        const entry = this.streamers[login];
        if (entry.live) {
          entry.announcedStreamId = stream.id;
          await this.persistAnnouncementStore();
        }
      } catch (err: unknown) {
        console.error('[twitch] failed to send live notification', displayName, err);
      }
    }
  }

  public checkTwitchEnvVars(): boolean {
    if (!this.clientId || !this.clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }
    return true;
  }

  public findLiveChannel(bot: Client): TextChannel {
    return this.resolveAnnounceChannel(bot);
  }

  private helixHeaders(): Record<string, string> {
    const id = this.clientId;
    if (!id) throw Error(TwitchErrors.MissingCredentials);
    return {
      'Client-ID': id,
      Authorization: `Bearer ${this.token}`
    };
  }

  private resolveAnnounceChannel(bot: Client): TextChannel {
    if (!this.discordChannelId) {
      throw Error(TwitchErrors.MissingDiscordTextChannel);
    }

    const channel = bot.channels.cache.get(this.discordChannelId);
    if (!channel) throw Error(TwitchErrors.ChannelNotInCache);
    if (!(channel instanceof TextChannel)) {
      throw Error(TwitchErrors.ChannelNotText);
    }
    return channel;
  }

  private async refreshStreamer(login: string): Promise<void> {
    const { data } = await axios.get<HelixStreamsResponse>(`${TWITCH_HELIX}/streams`, {
      params: { user_login: login },
      headers: this.helixHeaders()
    });

    const stream = data.data.length > 0 ? data.data[0] : undefined;
    const entry = this.streamers[login];

    if (stream !== undefined) {
      if (!entry.live) {
        const priorAnnounced = entry.announcedStreamId;
        this.streamers[login] = {
          user: { id: stream.user_id },
          live: true,
          stream,
          announcedStreamId: priorAnnounced === stream.id ? priorAnnounced : undefined
        };
      } else {
        entry.stream = undefined;
      }
    } else {
      const hadAnnounced = entry.announcedStreamId !== undefined;
      entry.live = false;
      entry.announcedStreamId = undefined;
      if (hadAnnounced) {
        await this.persistAnnouncementStore();
      }
    }
  }

  private async loadAnnouncementStore(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.announcementStorePath, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      console.error('[twitch] could not read announcement store', e);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.error('[twitch] announcement store JSON invalid, ignoring');
      return;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const store = parsed as AnnouncementStore;
    for (const login of Object.keys(this.streamers)) {
      const id = store[login];
      if (typeof id === 'string' && id.length > 0) {
        this.streamers[login].announcedStreamId = id;
      }
    }
  }

  /** Full replace (never append): at most one stream id per configured streamer; shrinks when they go offline. */
  private async persistAnnouncementStore(): Promise<void> {
    const data: AnnouncementStore = {};
    for (const [login, s] of Object.entries(this.streamers)) {
      if (s.announcedStreamId) data[login] = s.announcedStreamId;
    }

    try {
      await mkdir(path.dirname(this.announcementStorePath), { recursive: true });
      const tmpPath = `${this.announcementStorePath}.${String(process.pid)}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(tmpPath, this.announcementStorePath);
    } catch (e) {
      console.error('[twitch] could not write announcement store', e);
    }
  }

  private buildLiveEmbed(stream: Twitch.Channel, user: Twitch.User): EmbedBuilder {
    const login = stream.user_login;
    const channelUrl = `https://www.twitch.tv/${login}`;
    const displayName = user.display_name ?? stream.user_name;
    const profileUrl = user.profile_image_url;
    const previewUrl = stream.thumbnail_url.replaceAll('{width}', '1280').replaceAll('{height}', '720');
    const startedAt = new Date(stream.started_at);
    const startedUnix = Math.floor(startedAt.getTime() / 1000);
    const title = truncateForDiscord(stream.title.trim() || 'Live', EMBED_TITLE_MAX);
    const game = truncateForDiscord(stream.game_name || 'Just Chatting', EMBED_FIELD_VALUE_MAX);
    const tags = stream.tags.length > 0 ? truncateForDiscord(stream.tags.slice(0, 8).join(', '), EMBED_FIELD_VALUE_MAX) : '';

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(title)
      .setURL(channelUrl)
      .setAuthor({
        name: displayName,
        url: channelUrl,
        ...(profileUrl ? { iconURL: profileUrl } : {})
      })
      .setImage(previewUrl)
      .addFields(
        { name: 'Game', value: game, inline: true },
        { name: 'Viewers', value: String(stream.viewer_count), inline: true },
        { name: 'Started', value: `<t:${String(startedUnix)}:R>`, inline: true }
      )
      .setTimestamp(startedAt)
      .setFooter({
        text: stream.is_mature ? 'Twitch · Mature audience' : 'Twitch',
        iconURL: TWITCH_FOOTER_ICON
      });

    if (profileUrl) {
      embed.setThumbnail(profileUrl);
    }
    if (tags) {
      embed.addFields({ name: 'Tags', value: tags, inline: false });
    }

    return embed;
  }

  private async hydrateUsers(): Promise<void> {
    const ids = Object.values(this.streamers)
      .map((s) => s.user?.id)
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) return;

    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
    const { data } = await axios.get<{ data: Twitch.User[] }>(`${TWITCH_HELIX}/users?${qs}`, { headers: this.helixHeaders() });

    for (const user of data.data) {
      if (user.login) {
        this.streamers[user.login].user = user;
      }
    }
  }
}
