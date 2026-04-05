import axios from 'axios';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { Client } from 'discordx';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectEnvStreamers, truncateForDiscord } from '../ulits/helper.js';
import { ensureStreamTags, type HelixStreamsResponse, type Twitch } from '../types/twitch-helix.js';
import {
  type AnnouncementStore,
  type StreamerListFile,
  TwitchErrors,
  TWITCH_LOGIN_RE,
  type StreamerStatusMap
} from '../types/twitch-service.js';

const TWITCH_OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_HELIX = 'https://api.twitch.tv/helix';
const TWITCH_FOOTER_ICON = 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png';
/** Twitch brand purple (decimal) */
const EMBED_COLOR = 6570405;
const EMBED_TITLE_MAX = 256;
const EMBED_FIELD_VALUE_MAX = 1024;

/**
 * Twitch Helix polling and Discord announcements for configured streamer logins.
 *
 * Streamers come from `TWITCH_STREAMER_*` env vars merged with `data/twitch-streamers.json`;
 * on startup the combined list is written back to the JSON file (path: `TWITCH_STREAMER_LIST_PATH` or default).
 * Announcement store path: `TWITCH_ANNOUNCE_STORE_PATH` or default.
 */
export default class TwitchService {
  private readonly clientId = process.env.TWITCH_CLIENT_ID;
  private readonly clientSecret = process.env.TWITCH_SECRET;
  private readonly discordChannelId = process.env.DISCORD_CHANNEL_ID;
  private readonly announcementStorePath = path.resolve(
    process.env.TWITCH_ANNOUNCE_STORE_PATH ?? path.join(process.cwd(), 'data', 'twitch-announcements.json')
  );
  private readonly streamerListPath = path.resolve(
    process.env.TWITCH_STREAMER_LIST_PATH ?? path.join(process.cwd(), 'data', 'twitch-streamers.json')
  );
  private token = '';
  private streamers: StreamerStatusMap = {};

  /**
   * Loads streamer list (env ∪ file), persists that union to `twitch-streamers.json`, loads announcement store,
   * obtains an app access token, and rebuilds in-memory `streamers` state. Prunes announcement file keys that are no longer configured.
   *
   * @throws If Twitch client id/secret are missing.
   */
  public async init(): Promise<void> {
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }

    this.streamers = {};
    const fromEnv = collectEnvStreamers();
    const fromFile = await this.loadStreamerListFile();
    const merged = [...new Set([...fromEnv, ...fromFile])];
    for (const login of merged) {
      this.streamers[login] = { live: false };
    }

    try {
      await this.saveStreamerListFile(merged);
    } catch (e) {
      console.error('[twitch] could not write merged streamer list (env + file) to disk', e);
    }

    await this.loadAnnouncementStore();
    // Rewrite store so keys removed from TWITCH_STREAMER_* env are dropped from disk (file is not append-only).
    await this.persistAnnouncementStore();

    const { data } = await axios.post<{ access_token: string }>(
      `${TWITCH_OAUTH_TOKEN}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );
    this.token = data.access_token;
  }

  /**
   * Resolves a Twitch login via Helix, appends it to the streamer list file, and registers it in memory.
   * Rejects duplicates already present from env or file (after init, env-only logins also live in the JSON file).
   *
   * @param rawLogin - User input (trimmed, validated, lowercased for storage).
   * @returns Success with canonical login, or failure with a user-facing message.
   */
  public async addStreamer(rawLogin: string): Promise<{ ok: true; login: string } | { ok: false; message: string }> {
    const tentative = rawLogin.trim().toLowerCase();
    if (!TWITCH_LOGIN_RE.test(tentative)) {
      return {
        ok: false,
        message: 'Invalid login. Use 4–25 characters: lowercase letters, numbers, and underscores only.'
      };
    }

    if (Object.hasOwn(this.streamers, tentative)) {
      return {
        ok: false,
        message: `**${tentative}** is already in the notification list (from config or saved list).`
      };
    }

    let helixUser: Twitch.User;
    let helixLogin: string;
    try {
      const { data } = await axios.get<{ data: Twitch.User[] }>(`${TWITCH_HELIX}/users?login=${encodeURIComponent(tentative)}`, {
        headers: this.helixHeaders()
      });
      const users = data.data;
      if (users.length === 0) {
        return { ok: false, message: `No Twitch user found for login **${tentative}**.` };
      }
      const u = users[0];
      const login = u.login;
      if (!login) {
        return { ok: false, message: `No Twitch user found for login **${tentative}**.` };
      }
      helixUser = u;
      helixLogin = login;
    } catch (e) {
      console.error('[twitch] Helix users lookup failed', e);
      return { ok: false, message: 'Twitch API request failed. Try again later.' };
    }

    const canonical = helixLogin.trim().toLowerCase();
    if (canonical !== tentative && Object.hasOwn(this.streamers, canonical)) {
      return {
        ok: false,
        message: `**${canonical}** is already in the notification list (from config or saved list).`
      };
    }

    const fileLogins = await this.loadStreamerListFile();
    const next = [...new Set([...fileLogins, canonical])].sort((a, b) => a.localeCompare(b));
    try {
      await this.saveStreamerListFile(next);
    } catch (e) {
      console.error('[twitch] could not save streamer list', e);
      return { ok: false, message: 'Could not save streamer list to disk.' };
    }

    this.streamers[canonical] = { live: false, user: helixUser };
    await this.persistAnnouncementStore();

    try {
      await this.refreshStreamer(canonical);
      await this.hydrateUsers();
    } catch (e) {
      console.error('[twitch] refresh after add failed', e);
    }

    return { ok: true, login: canonical };
  }

  /**
   * Removes a login from the streamer list file and from memory. Announcement state for that login is dropped.
   * If the same login remains in `TWITCH_STREAMER_*` env vars, it will be tracked again after the next `init()`.
   *
   * @param rawLogin - Twitch login (trimmed, lowercased; must match stored key).
   * @returns Success with `stillInEnv` when env still references this login, or failure with a user-facing message.
   */
  public async removeStreamer(
    rawLogin: string
  ): Promise<{ ok: true; login: string; stillInEnv: boolean } | { ok: false; message: string }> {
    const tentative = rawLogin.trim().toLowerCase();
    if (!TWITCH_LOGIN_RE.test(tentative)) {
      return {
        ok: false,
        message: 'Invalid login. Use 4–25 characters: lowercase letters, numbers, and underscores only.'
      };
    }

    if (!Object.hasOwn(this.streamers, tentative)) {
      return {
        ok: false,
        message: `**${tentative}** is not in the notification list.`
      };
    }

    const stillInEnv = collectEnvStreamers().includes(tentative);

    const fileLogins = await this.loadStreamerListFile();
    const next = fileLogins.filter((l) => l !== tentative).sort((a, b) => a.localeCompare(b));
    try {
      await this.saveStreamerListFile(next);
    } catch (e) {
      console.error('[twitch] could not save streamer list after remove', e);
      return { ok: false, message: 'Could not save streamer list to disk.' };
    }

    this.streamers = Object.fromEntries(
      Object.entries(this.streamers).filter(([login]) => login !== tentative)
    ) as StreamerStatusMap;
    await this.persistAnnouncementStore();

    return { ok: true, login: tentative, stillInEnv };
  }

  /**
   * Refreshes live/offline state for every configured streamer via Helix `/streams`, then hydrates user profiles.
   */
  async checkStreamers(): Promise<void> {
    await Promise.all(Object.keys(this.streamers).map((login) => this.refreshStreamer(login)));
    await this.hydrateUsers();
  }

  /**
   * Posts a “went live” message (with embed) for streamers who are live and not yet announced for the current Helix stream id.
   *
   * @param bot - Discord client (must have the announce channel cached).
   */
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

  /**
   * Verifies Twitch API credentials are present.
   *
   * @returns `true` when client id and secret exist.
   * @throws Error when client id or secret is missing (`TwitchErrors.MissingCredentials` message).
   */
  public checkTwitchEnvVars(): boolean {
    if (!this.clientId || !this.clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }
    return true;
  }

  /**
   * Resolves the configured Discord text channel used for live announcements (validates cache + type).
   *
   * @param bot - Discord client.
   */
  public findLiveChannel(bot: Client): TextChannel {
    return this.resolveAnnounceChannel(bot);
  }

  /**
   * Headers for Helix requests (Client-Id + Bearer app token).
   *
   * @throws If client id is missing.
   */
  private helixHeaders(): Record<string, string> {
    const id = this.clientId;
    if (!id) throw Error(TwitchErrors.MissingCredentials);
    return {
      'Client-ID': id,
      Authorization: `Bearer ${this.token}`
    };
  }

  /**
   * Looks up `DISCORD_CHANNEL_ID` on the client and ensures it is a {@link TextChannel}.
   *
   * @throws If env id is missing, channel is uncached, or not a guild text channel.
   */
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

  /**
   * Updates one streamer’s `live` flag and attached Helix stream snapshot from `GET /helix/streams`.
   * When going offline, clears `announcedStreamId` and may persist the announcement store.
   *
   * @param login - Streamer login key as stored in `this.streamers` (lowercase).
   */
  private async refreshStreamer(login: string): Promise<void> {
    const { data } = await axios.get<HelixStreamsResponse>(`${TWITCH_HELIX}/streams`, {
      params: { user_login: login },
      headers: this.helixHeaders()
    });

    const stream = data.data.length > 0 ? ensureStreamTags(data.data[0]) : undefined;
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
        // Keep stream on the entry: sendLiveNotifications needs it until we set announcedStreamId.
        // Clearing here broke alerts for anyone already live when added (addStreamer refreshes but does not notify until the next poll, which used to wipe stream).
        entry.stream = stream;
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

  /**
   * Merges persisted “last announced stream id” per login into `this.streamers` (only for known logins).
   * Missing or invalid files are ignored.
   */
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

  /**
   * Writes the announcement store to disk (atomic write). Full replace: one stream id per configured login;
   * entries are dropped when a streamer has nothing announced.
   */
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

  /**
   * Reads `{ logins: string[] }` from the streamer list JSON path. Invalid rows are skipped.
   *
   * @returns Sorted unique valid logins, or `[]` if the file is missing.
   */
  private async loadStreamerListFile(): Promise<string[]> {
    let raw: string;
    try {
      raw = await readFile(this.streamerListPath, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      console.error('[twitch] could not read streamer list', e);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.error('[twitch] streamer list JSON invalid, ignoring');
      return [];
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    const logins = (parsed as StreamerListFile).logins;
    if (!Array.isArray(logins)) return [];

    const out: string[] = [];
    for (const v of logins) {
      if (typeof v === 'string' && TWITCH_LOGIN_RE.test(v.trim().toLowerCase())) {
        out.push(v.trim().toLowerCase());
      }
    }
    return [...new Set(out)];
  }

  /**
   * Atomically writes the streamer list file with deduplicated, validated, sorted logins.
   *
   * @param logins - Full list to persist (replaces file contents).
   */
  private async saveStreamerListFile(logins: string[]): Promise<void> {
    const payload: StreamerListFile = {
      logins: [...new Set(logins.map((l) => l.trim().toLowerCase()).filter((l) => TWITCH_LOGIN_RE.test(l)))].sort((a, b) =>
        a.localeCompare(b)
      )
    };

    await mkdir(path.dirname(this.streamerListPath), { recursive: true });
    const tmpPath = `${this.streamerListPath}.${String(process.pid)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.streamerListPath);
  }

  /**
   * Builds the rich embed shown in Discord for a live stream.
   *
   * @param stream - Normalized Helix stream (includes `tags` array).
   * @param user - Helix user (display name, avatars).
   */
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

  /**
   * Fetches full user objects from Helix for every `streamers[*].user.id` and writes them back by login key.
   */
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
