import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  ThreadAutoArchiveDuration,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  MessageFlags,
  TextChannel,
  ThreadChannel,
  GuildMember,
  GuildMemberRoleManager,
  PermissionFlagsBits,
  Message,
} from "discord.js";
import { randomUUID } from "crypto";

// ─── Config ────────────────────────────────────────────────────────────────

const DISCORD_TOKEN     = process.env.BOT_TOKEN!;
const DISCORD_CLIENT_ID = process.env.BOT_CLIENT_ID!;

// League constants
const LEAGUE_CHANNEL_ID    = "1475298597028499606";
const LEAGUE_HOST_ROLE_ID  = "1487896681239548126";
const LEAGUES_PING_ROLE_ID = "1460048729464770693";

// Event constants
const EVENT_CHANNEL_ID        = "1479659610418843791";
const EVENT_HOST_ROLE_ID      = "1482428444070379611";
const EVENT_HOST_ROLE_ID_2    = "1481442792017494087";
const GENERAL_CHANNEL_ID      = "1475202577204383914";
const GIVEAWAY_PING_ROLE_ID   = "1460048231424852180";

// ─── Role check helper ───────────────────────────────────────────────────────

function memberHasRole(
  member: GuildMember | { roles: GuildMemberRoleManager | string[] } | null,
  roleId: string
): boolean {
  if (!member) return false;
  if (member instanceof GuildMember) return member.roles.cache.has(roleId);
  const roles = (member as any).roles;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return (roles as GuildMemberRoleManager).cache.has(roleId);
}

// ─── League Types ──────────────────────────────────────────────────────────

type MatchFormat = "2v2" | "3v3" | "4v4";
type MatchType   = "swift" | "war";
type MatchPerks  = "perks" | "no_perks";
type Region      = "europe" | "asia" | "north_america" | "south_america" | "oceania";

interface League {
  id: string;
  hostId: string;
  matchFormat: MatchFormat;
  matchType: MatchType;
  matchPerks: MatchPerks;
  region: Region;
  maxPlayers: number;
  players: string[];
  messageId: string;
  channelId: string;
  threadId?: string;
  createdAt: Date;
  active: boolean;
}

const leagues = new Map<string, League>();

// ─── Event Types ──────────────────────────────────────────────────────────

type EventStatus = "pending" | "active" | "won" | "ended" | "cancelled";

interface GtnEvent {
  id: string;
  hostId: string;
  hostDisplayName: string;
  funder: string;
  prize: string;
  rangeMin: number;
  rangeMax: number;
  answer: number;
  status: EventStatus;
  winnerId?: string;
  winnerUsername?: string;
  controlMessageId: string;
  announcementMessageId?: string;
  createdAt: Date;
}

const events = new Map<string, GtnEvent>();

// ─── Promotion Types ──────────────────────────────────────────────────────

interface Promotion {
  id: string;
  serverName: string;
  startDate: Date;
  durationDays: number;
  scheduledById: string;
  scheduledAt: Date;
  notified: boolean;
}

const promotions = new Map<string, Promotion>();

// ─── Helpers ───────────────────────────────────────────────────────────────

function shortId(): string {
  return randomUUID().split("-")[0].toUpperCase();
}

function formatName(value: string): string {
  const map: Record<string, string> = {
    "2v2": "2v2", "3v3": "3v3", "4v4": "4v4",
    swift: "Swift Game", war: "War Game",
    perks: "Perks", no_perks: "No Perks",
    europe: "Europe", asia: "Asia",
    north_america: "North America",
    south_america: "South America",
    oceania: "Oceania",
  };
  return map[value] ?? value;
}

function getMaxPlayers(format: MatchFormat): number {
  return { "2v2": 4, "3v3": 6, "4v4": 8 }[format];
}

// ─── Promotion Helpers ────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "NOW";
  const diffMins  = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays  = Math.floor(diffMs / 86400000);
  if (diffMins < 60)  return `In ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  if (diffHours < 24) return `In ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  return `In ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
}

function formatPromotionDate(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

/** Returns a DD/MM/YY string suitable for passing back into parsePromotionDate */
function formatPromotionDateForParsing(date: Date): string {
  const d  = String(date.getDate()).padStart(2, "0");
  const m  = String(date.getMonth() + 1).padStart(2, "0");
  const y  = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

function promotionEnd(p: Promotion): Date {
  return new Date(p.startDate.getTime() + p.durationDays * 86400000);
}

function isActive(p: Promotion): boolean {
  const now = new Date();
  return now >= p.startDate && now < promotionEnd(p);
}

function isUpcoming(p: Promotion): boolean {
  return new Date() < p.startDate;
}

function parseRelativeTime(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase();
  // Patterns: 1h, 2h, 30m, 1 hour, 2 hours, 30 minutes, 30 min, 1h30m
  const combined = s.match(/^(\d+)h(?:(\d+)m)?$/);
  if (combined) {
    const hours   = parseInt(combined[1], 10);
    const minutes = combined[2] ? parseInt(combined[2], 10) : 0;
    return (hours * 60 + minutes) * 60000;
  }
  const hoursOnly = s.match(/^(\d+)\s*h(?:ours?)?$/);
  if (hoursOnly) return parseInt(hoursOnly[1], 10) * 3600000;
  const minsOnly = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (minsOnly) return parseInt(minsOnly[1], 10) * 60000;
  return null;
}

function parseTimeString(timeStr: string): { hour: number; minute: number } | null {
  // HH:MM format (e.g. "15:00", "9:30")
  const tp = timeStr.split(":");
  if (tp.length === 2) {
    const hour   = Number(tp[0]);
    const minute = Number(tp[1]);
    if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  return null;
}

function parsePromotionDate(dateStr: string, timeStr: string | null): Date | null {
  const dp = dateStr.split("/");
  if (dp.length !== 3) return null;
  const [day, month, year] = dp.map(Number);
  if ([day, month, year].some(isNaN)) return null;

  const now = new Date();
  const selectedDate = new Date(2000 + year, month - 1, day, 0, 0, 0, 0);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // PAST DATE - TIME IS OPTIONAL
  if (selectedDate < todayMidnight) {
    if (timeStr) {
      const relativeMs = parseRelativeTime(timeStr);
      if (relativeMs !== null) return new Date(Date.now() + relativeMs);

      const parsed = parseTimeString(timeStr);
      if (!parsed) return null;
      return new Date(2000 + year, month - 1, day, parsed.hour, parsed.minute, 0, 0);
    }
    // Default: use current time
    return new Date(2000 + year, month - 1, day, now.getHours(), now.getMinutes(), 0, 0);
  }

  // TODAY - TIME IS REQUIRED
  if (selectedDate.getTime() === todayMidnight.getTime()) {
    if (!timeStr) return null;

    const relativeMs = parseRelativeTime(timeStr);
    if (relativeMs !== null) return new Date(Date.now() + relativeMs);

    const parsed = parseTimeString(timeStr);
    if (!parsed) return null;
    return new Date(2000 + year, month - 1, day, parsed.hour, parsed.minute, 0, 0);
  }

  // FUTURE DATE - TIME IS OPTIONAL
  if (timeStr) {
    const relativeMs = parseRelativeTime(timeStr);
    if (relativeMs !== null) return new Date(Date.now() + relativeMs);

    const parsed = parseTimeString(timeStr);
    if (!parsed) return null;
    return new Date(2000 + year, month - 1, day, parsed.hour, parsed.minute, 0, 0);
  }

  // Default for future dates: midnight of that day
  return new Date(2000 + year, month - 1, day, 0, 0, 0, 0);
}

function findConflict(start: Date, durationDays: number, excludeId?: string): Promotion | undefined {
  const end = new Date(start.getTime() + durationDays * 86400000);
  return Array.from(promotions.values()).find((p) => {
    if (excludeId && p.id === excludeId) return false;
    return start < promotionEnd(p) && end > p.startDate;
  });
}

function getSortedPromotions(): Promotion[] {
  return Array.from(promotions.values())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

// ─── League Embeds / Buttons ────────────────────────────────────────────

function buildLeagueEmbed(league: League): EmbedBuilder {
  const spotsLeft = league.maxPlayers - league.players.length;
  const isFull = spotsLeft === 0;
  return new EmbedBuilder()
    .setTitle("LEAGUE OPEN")
    .setColor(isFull ? 0x2ecc71 : 0x5865f2)
    .addFields(
      { name: "Match Format",    value: formatName(league.matchFormat), inline: true },
      { name: "Match Type",      value: formatName(league.matchType),   inline: true },
      { name: "Perks",           value: formatName(league.matchPerks),  inline: true },
      { name: "Region",          value: formatName(league.region),      inline: true },
      { name: "Host",            value: `<@${league.hostId}>`,          inline: true },
      { name: "Players",         value: `${league.players.length} / ${league.maxPlayers}`, inline: true },
      { name: "Spots Remaining", value: isFull ? "Full — League Starting" : `${spotsLeft} open`, inline: true },
      { name: "League ID",       value: `\`${league.id}\``,            inline: true },
    )
    .setFooter({ text: "Click Join League to participate | /league cancel to cancel" })
    .setTimestamp(league.createdAt);
}

function buildJoinButton(league: League): ActionRowBuilder<ButtonBuilder> {
  const isFull = league.players.length >= league.maxPlayers;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_league_${league.id}`)
      .setLabel(isFull ? "League Full" : "Join League")
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(isFull),
  );
}

// ─── Event Embeds / Buttons ────────────────────────────────────────────

function buildEventControlEmbed(ev: GtnEvent): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Event Control Panel")
    .setDescription("Use the buttons below to manage this event. Only you can see this message.")
    .setColor(0xf1c40f)
    .addFields(
      { name: "Event ID",   value: `\`${ev.id}\``,                          inline: true },
      { name: "Host",       value: ev.hostDisplayName,                        inline: true },
      { name: "Funder",     value: ev.funder,                                 inline: true },
      { name: "Prize",      value: ev.prize,                                  inline: true },
      { name: "Range",      value: `${ev.rangeMin} – ${ev.rangeMax}`,         inline: true },
      { name: "Answer",     value: `||${ev.answer}||`,                        inline: true },
      { name: "Status",     value: ev.status.toUpperCase(),                   inline: true },
    )
    .setFooter({ text: "The answer is hidden — click to reveal." })
    .setTimestamp(ev.createdAt);
}

function buildEventControlButtons(ev: GtnEvent): ActionRowBuilder<ButtonBuilder> {
  const isPending   = ev.status === "pending";
  const isActive    = ev.status === "active" || ev.status === "won";
  const isCancelled = ev.status === "cancelled" || ev.status === "ended";

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_start_${ev.id}`)
      .setLabel("Start Event")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isPending),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${ev.id}`)
      .setLabel("Cancel Event")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isCancelled),
    new ButtonBuilder()
      .setCustomId(`event_end_${ev.id}`)
      .setLabel("End Event")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isActive),
  );
}

function buildEventAnnouncementContent(ev: GtnEvent): string {
  return `@everyone <@&${GIVEAWAY_PING_ROLE_ID}>`;
}

function buildEventAnnouncementEmbed(ev: GtnEvent): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Guess the Number — Event Started")
    .setColor(0xe67e22)
    .addFields(
      { name: "Host",            value: ev.hostDisplayName,                    inline: true },
      { name: "Funder",          value: ev.funder,                             inline: true },
      { name: "Prize",           value: ev.prize,                              inline: true },
      { name: "Range",           value: `${ev.rangeMin} – ${ev.rangeMax}`,     inline: true },
      { name: "Participate In",  value: `<#${GENERAL_CHANNEL_ID}>`,            inline: true },
      { name: "Event ID",        value: `\`${ev.id}\``,                        inline: true },
      {
        name: "How Does the Event Work?",
        value:
          "In This Event, you'll try to guess a randomly selected number within the given range.\n\n" +
          "The first person to guess the correct number wins the prize for this event! " +
          "And you cannot say more than 2 numbers at once!",
        inline: false,
      },
    )
    .setTimestamp();
}

// ─── Lock / Unlock General Chat ────────────────────────────────────────

async function lockGeneral(reason: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(GENERAL_CHANNEL_ID) as TextChannel;
    const everyoneRole = channel.guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
    }, { reason });
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("General Chat Locked")
          .setDescription("The event has concluded. The host will announce the winner shortly.")
          .setColor(0xed4245)
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.error("Failed to lock general:", err);
  }
}

async function unlockGeneral(reason: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(GENERAL_CHANNEL_ID) as TextChannel;
    const everyoneRole = channel.guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: null,
    }, { reason });
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("General Chat Unlocked")
          .setDescription("The event has ended. Chat is open again.")
          .setColor(0x2ecc71)
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.error("Failed to unlock general:", err);
  }
}

// ─── Commands ──────────────────────────────────────────────────────────

const commands = [
  // League
  new SlashCommandBuilder()
    .setName("league")
    .setDescription("League management commands")
    .addSubcommand((sub) =>
      sub
        .setName("host")
        .setDescription("Host a new league")
        .addStringOption((o) =>
          o.setName("format").setDescription("Match format").setRequired(true)
            .addChoices(
              { name: "2v2", value: "2v2" },
              { name: "3v3", value: "3v3" },
              { name: "4v4", value: "4v4" },
            )
        )
        .addStringOption((o) =>
          o.setName("type").setDescription("Match type").setRequired(true)
            .addChoices(
              { name: "Swift Game", value: "swift" },
              { name: "War Game",   value: "war"   },
            )
        )
        .addStringOption((o) =>
          o.setName("perks").setDescription("Perks setting").setRequired(true)
            .addChoices(
              { name: "Perks",    value: "perks"    },
              { name: "No Perks", value: "no_perks" },
            )
        )
        .addStringOption((o) =>
          o.setName("region").setDescription("Region").setRequired(true)
            .addChoices(
              { name: "Europe",        value: "europe"        },
              { name: "Asia",          value: "asia"          },
              { name: "North America", value: "north_america" },
              { name: "South America", value: "south_america" },
              { name: "Oceania",       value: "oceania"       },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel an active league")
        .addStringOption((o) =>
          o.setName("id").setDescription("League ID to cancel").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("kick")
        .setDescription("Kick a player from an active league")
        .addStringOption((o) =>
          o.setName("id").setDescription("League ID").setRequired(true)
        )
        .addUserOption((o) =>
          o.setName("player").setDescription("Player to kick").setRequired(true)
        )
    ),

  // Host Event
  new SlashCommandBuilder()
    .setName("hostevent")
    .setDescription("Host an event")
    .addStringOption((o) =>
      o.setName("type").setDescription("Type of event").setRequired(true)
        .addChoices(
          { name: "Guess the Number", value: "guess_the_number" },
        )
    )
    .addStringOption((o) =>
      o.setName("host").setDescription("Event host display name").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("funder").setDescription("Who is funding the event").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("prize").setDescription("Prize for the winner").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("range_min").setDescription("Minimum number (e.g. 1)").setRequired(true).setMinValue(0)
    )
    .addIntegerOption((o) =>
      o.setName("range_max").setDescription("Maximum number (e.g. 1000)").setRequired(true).setMinValue(1)
    ),

  // End Event
  new SlashCommandBuilder()
    .setName("endevent")
    .setDescription("End an active event and unlock general chat")
    .addStringOption((o) =>
      o.setName("id").setDescription("Event ID to end").setRequired(true)
    ),

  // Promotion Timings
  new SlashCommandBuilder()
    .setName("promotion")
    .setDescription("Promotion timing management")
    .addSubcommand((sub) =>
      sub
        .setName("schedule")
        .setDescription("Select The Promotion Timings — schedule a new server promotion")
        .addStringOption((o) =>
          o.setName("server").setDescription("Server name").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("date").setDescription("Date of promotion (DD/MM/YY, e.g. 22/03/26)").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("time").setDescription("Time (15:00, 1h, 30m) - Optional for past/future dates, REQUIRED for today").setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName("duration").setDescription("Duration in days").setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("View the full promotion schedule")
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing promotion")
        .addStringOption((o) =>
          o.setName("promotion_id").setDescription("Promotion ID to edit").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("server_name").setDescription("New server name").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("date").setDescription("New date (DD/MM/YY, e.g. 22/03/26)").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("time").setDescription("New time (15:00, 1h, 30m) — required if changing to today").setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName("duration").setDescription("New duration in days").setRequired(false).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a scheduled promotion")
        .addStringOption((o) =>
          o.setName("promotion_id").setDescription("Promotion ID to delete").setRequired(true)
        )
    ),
];

// ─── Deploy ────────────────────────────────────────────────────────────

async function deployCommands() {
  const rest = new REST().setToken(DISCORD_TOKEN);
  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
    body: commands.map((c) => c.toJSON()),
  });
  console.log("Slash commands registered.");
}

// ─── Client ─────────────────────────────────────────────────��──────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async () => {
  console.log(`Discord bot online as ${client.user?.tag}`);
  try {
    await deployCommands();
  } catch (err) {
    console.error("Failed to register commands:", err);
  }

  // ── Promotion notification ticker ────────────────────────────────────
  setInterval(async () => {
    const now = new Date();
    for (const p of promotions.values()) {
      if (p.notified) continue;
      if (now < p.startDate) continue;

      p.notified = true;

      try {
        const user = await client.users.fetch(p.scheduledById);
        const dm   = await user.createDM();
        await dm.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("Promotion Time!")
              .setDescription(
                `It is time for the promotion of **${p.serverName}**. Please start the promotion now!`
              )
              .setColor(0x2ecc71)
              .addFields(
                { name: "Server",      value: p.serverName,                                               inline: true },
                { name: "Started",     value: formatPromotionDate(p.startDate),                           inline: true },
                { name: "Duration",    value: `${p.durationDays} DAYS`,                                   inline: true },
                { name: "Ends",        value: formatPromotionDate(promotionEnd(p)),                       inline: true },
                { name: "Scheduled",   value: formatPromotionDate(p.scheduledAt),                        inline: true },
                { name: "Promotion ID", value: `\`${p.id}\``,                                            inline: true },
              )
              .setTimestamp(),
          ],
        });
      } catch {
        console.error(`Failed to DM promotion notification for ${p.serverName}`);
      }
    }
  }, 60000);
});

// ─── League Handlers ───────────────────────────────────────────────────

async function handleHostLeague(interaction: ChatInputCommandInteraction) {
  if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
    await interaction.reply({
      content: "You do not have permission to host leagues. Only members with the **League Host** role can do this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
    await interaction.reply({
      content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const format = interaction.options.getString("format", true) as MatchFormat;
  const type   = interaction.options.getString("type",   true) as MatchType;
  const perks  = interaction.options.getString("perks",  true) as MatchPerks;
  const region = interaction.options.getString("region", true) as Region;

  const id         = shortId();
  const maxPlayers = getMaxPlayers(format);

  const league: League = {
    id,
    hostId: interaction.user.id,
    matchFormat: format,
    matchType: type,
    matchPerks: perks,
    region,
    maxPlayers,
    players: [interaction.user.id],
    messageId: "",
    channelId: interaction.channelId,
    active: true,
    createdAt: new Date(),
  };

  await interaction.deferReply();

  const msg = await interaction.editReply({
    content: `<@&${LEAGUES_PING_ROLE_ID}>`,
    embeds: [buildLeagueEmbed(league)],
    components: [buildJoinButton(league)],
  });

  league.messageId = msg.id;
  leagues.set(id, league);

  const channel = interaction.channel as TextChannel;
  try {
    const thread = await channel.threads.create({
      name: `League ${id} — ${formatName(format)} ${formatName(type)}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      type: ChannelType.PrivateThread,
      reason: `League ${id} private thread`,
    });

    league.threadId = thread.id;
    await thread.members.add(interaction.user.id);

    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`League ${id} — Private Channel`)
          .setDescription(
            `Welcome to the private thread for **League ${id}**.\n\n` +
            `Only players who have joined this league will be added here.\n\n` +
            `Wait for all spots to fill — the league will begin once all players have joined.`
          )
          .setColor(0x5865f2)
          .addFields(
            { name: "Format",  value: formatName(format), inline: true },
            { name: "Type",    value: formatName(type),   inline: true },
            { name: "Perks",   value: formatName(perks),  inline: true },
            { name: "Region",  value: formatName(region), inline: true },
            { name: "Host",    value: `<@${interaction.user.id}>`, inline: true },
            { name: "Spots",   value: `${maxPlayers - 1} remaining`, inline: true },
          )
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.error("Failed to create league thread:", err);
  }
}

async function handleCancelLeague(interaction: ChatInputCommandInteraction) {
  if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
    await interaction.reply({
      content: "You do not have permission to cancel leagues. Only members with the **League Host** role can do this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id     = interaction.options.getString("id", true).toUpperCase();
  const league = leagues.get(id);

  if (!league || !league.active) {
    await interaction.reply({
      content: `No active league found with ID \`${id}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  league.active = false;

  try {
    const channel = interaction.channel as TextChannel;
    const msg = await channel.messages.fetch(league.messageId);
    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("LEAGUE CANCELLED")
          .setColor(0xed4245)
          .addFields(
            { name: "League ID",    value: `\`${league.id}\``,            inline: true },
            { name: "Cancelled by", value: `<@${interaction.user.id}>`,   inline: true },
          )
          .setTimestamp(),
      ],
      components: [],
    });
  } catch {}

  if (league.threadId) {
    try {
      const thread = await client.channels.fetch(league.threadId) as ThreadChannel;
      await thread.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("League Cancelled")
            .setDescription(`League \`${id}\` has been cancelled by <@${interaction.user.id}>.`)
            .setColor(0xed4245)
            .setTimestamp(),
        ],
      });
      await thread.setArchived(true);
    } catch {}
  }

  await interaction.reply({
    content: `League \`${id}\` has been cancelled.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKickLeague(interaction: ChatInputCommandInteraction) {
  if (!memberHasRole(interaction.member, LEAGUE_HOST_ROLE_ID)) {
    await interaction.reply({
      content: "You do not have permission to kick players from leagues. Only members with the **League Host** role can do this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id     = interaction.options.getString("id", true).toUpperCase();
  const target = interaction.options.getUser("player", true);
  const league = leagues.get(id);

  if (!league || !league.active) {
    await interaction.reply({
      content: `No active league found with ID \`${id}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (target.id === league.hostId) {
    await interaction.reply({
      content: "You cannot kick the league host.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!league.players.includes(target.id)) {
    await interaction.reply({
      content: `<@${target.id}> is not in League \`${id}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove from players list
  league.players = league.players.filter((uid) => uid !== target.id);

  // Remove from private thread
  if (league.threadId) {
    try {
      const thread = await client.channels.fetch(league.threadId) as ThreadChannel;
      await thread.members.remove(target.id);
      await thread.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Player Removed")
            .setDescription(`<@${target.id}> has been removed from League \`${id}\` by <@${interaction.user.id}>.`)
            .setColor(0xed4245)
            .addFields(
              { name: "Spots Remaining", value: `${league.maxPlayers - league.players.length}`, inline: true },
            )
            .setTimestamp(),
        ],
      });
    } catch {}
  }

  // Update the public league embed
  try {
    const channel = interaction.channel as TextChannel;
    const msg = await channel.messages.fetch(league.messageId);
    await msg.edit({
      embeds: [buildLeagueEmbed(league)],
      components: [buildJoinButton(league)],
    });
  } catch {}

  await interaction.reply({
    content: `<@${target.id}> has been removed from League \`${id}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Event Handlers ────────────────────────────────────────────────────

async function handleHostEvent(interaction: ChatInputCommandInteraction) {
  if (!memberHasRole(interaction.member, EVENT_HOST_ROLE_ID) && !memberHasRole(interaction.member, EVENT_HOST_ROLE_ID_2)) {
    await interaction.reply({
      content: "You do not have permission to host events. Only members with the **Head of Event** role can do this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.channelId !== EVENT_CHANNEL_ID) {
    await interaction.reply({
      content: `Events can only be hosted in <#${EVENT_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const hostDisplay = interaction.options.getString("host",      true);
  const funder      = interaction.options.getString("funder",    true);
  const prize       = interaction.options.getString("prize",     true);
  const rangeMin    = interaction.options.getInteger("range_min", true);
  const rangeMax    = interaction.options.getInteger("range_max", true);

  if (rangeMin >= rangeMax) {
    await interaction.reply({
      content: "The minimum range value must be less than the maximum range value.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const answer = Math.floor(Math.random() * (rangeMax - rangeMin + 1)) + rangeMin;
  const id     = shortId();

  const ev: GtnEvent = {
    id,
    hostId: interaction.user.id,
    hostDisplayName: hostDisplay,
    funder,
    prize,
    rangeMin,
    rangeMax,
    answer,
    status: "pending",
    controlMessageId: "",
    createdAt: new Date(),
  };

  await interaction.reply({
    embeds: [buildEventControlEmbed(ev)],
    components: [buildEventControlButtons(ev)],
    flags: MessageFlags.Ephemeral,
  });

  events.set(id, ev);

  // DM the host
  try {
    const dm = await interaction.user.createDM();
    await dm.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Your Event Details — Keep This Private")
          .setColor(0xf1c40f)
          .addFields(
            { name: "Event ID",     value: `\`${id}\``,                    inline: true },
            { name: "Answer",       value: `**${answer}**`,                 inline: true },
            { name: "Range",        value: `${rangeMin} – ${rangeMax}`,     inline: true },
            { name: "Host",         value: hostDisplay,                     inline: true },
            { name: "Funder",       value: funder,                         inline: true },
            { name: "Prize",        value: prize,                           inline: true },
          )
          .setDescription(
            `The randomly selected answer for your Guess the Number event is **${answer}**.\n\n` +
            `Your Event ID is \`${id}\`. Use \`/endevent id:${id}\` to end the event and unlock general chat.`
          )
          .setTimestamp(),
      ],
    });
  } catch {
    console.error("Could not DM host — they may have DMs disabled.");
  }
}

async function handleEndEvent(interaction: ChatInputCommandInteraction) {
  if (!memberHasRole(interaction.member, EVENT_HOST_ROLE_ID) && !memberHasRole(interaction.member, EVENT_HOST_ROLE_ID_2)) {
    await interaction.reply({
      content: "You do not have permission to end events. Only members with the **Head of Event** role can do this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = interaction.options.getString("id", true).toUpperCase();
  const ev = events.get(id);

  if (!ev) {
    await interaction.reply({
      content: `No event found with ID \`${id}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (ev.status === "ended" || ev.status === "cancelled") {
    await interaction.reply({
      content: `Event \`${id}\` is already ended or cancelled.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await endEvent(ev, interaction.user.id);

  await interaction.reply({
    content: `Event \`${id}\` has been ended. General chat has been unlocked.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function endEvent(ev: GtnEvent, endedById: string) {
  ev.status = "ended";

  // Unlock general chat
  await unlockGeneral(`Event ${ev.id} ended by ${endedById}`);

  // DM the winner if there is one
  if (ev.winnerId) {
    try {
      const winner = await client.users.fetch(ev.winnerId);
      const dm = await winner.createDM();
      await dm.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("You Won the Event!")
            .setDescription(
              `Congratulations! You guessed the correct number (**${ev.answer}**) and won the **${ev.prize}** prize.\n\n` +
              `Contact the event host to claim your reward.`
            )
            .setColor(0x2ecc71)
            .addFields(
              { name: "Event",  value: `\`${ev.id}\``, inline: true },
              { name: "Prize",  value: ev.prize,        inline: true },
              { name: "Answer", value: `${ev.answer}`,  inline: true },
            )
            .setTimestamp(),
        ],
      });
    } catch {}
  }
}

// ─── Button: Start Event ────────────────────────────────────────────────

async function handleStartEventButton(btn: ButtonInteraction, ev: GtnEvent) {
  if (btn.user.id !== ev.hostId) {
    await btn.reply({ content: "Only the event host can start this event.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (ev.status !== "pending") {
    await btn.reply({ content: "This event has already been started or cancelled.", flags: MessageFlags.Ephemeral });
    return;
  }

  ev.status = "active";

  await btn.deferUpdate();

  // Post public announcement in event channel
  try {
    const eventChannel = await client.channels.fetch(EVENT_CHANNEL_ID) as TextChannel;
    const annMsg = await eventChannel.send({
      content: buildEventAnnouncementContent(ev),
      embeds: [buildEventAnnouncementEmbed(ev)],
    });
    ev.announcementMessageId = annMsg.id;
  } catch (err) {
    console.error("Failed to send event announcement:", err);
  }

  // Update control panel
  await btn.editReply({
    embeds: [buildEventControlEmbed(ev)],
    components: [buildEventControlButtons(ev)],
  });
}

// ─── Button: Cancel Event ───────────────────────────────────────────────

async function handleCancelEventButton(btn: ButtonInteraction, ev: GtnEvent) {
  if (btn.user.id !== ev.hostId) {
    await btn.reply({ content: "Only the event host can cancel this event.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (ev.status === "cancelled" || ev.status === "ended") {
    await btn.reply({ content: "This event is already cancelled or ended.", flags: MessageFlags.Ephemeral });
    return;
  }

  const wasActive = ev.status === "active" || ev.status === "won";
  ev.status = "cancelled";

  await btn.deferUpdate();

  if (wasActive) {
    await unlockGeneral(`Event ${ev.id} cancelled`);
  }

  // Edit announcement if it exists
  if (ev.announcementMessageId) {
    try {
      const eventChannel = await client.channels.fetch(EVENT_CHANNEL_ID) as TextChannel;
      const annMsg = await eventChannel.messages.fetch(ev.announcementMessageId);
      await annMsg.edit({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setTitle("Event Cancelled")
            .setDescription(`The Guess the Number event (ID: \`${ev.id}\`) has been cancelled by the host.`)
            .setColor(0xed4245)
            .setTimestamp(),
        ],
      });
    } catch {}
  }

  await btn.editReply({
    embeds: [buildEventControlEmbed(ev)],
    components: [buildEventControlButtons(ev)],
  });
}

// ─── Button: End Event ──────────────────────────────────────────────────

async function handleEndEventButton(btn: ButtonInteraction, ev: GtnEvent) {
  if (btn.user.id !== ev.hostId) {
    await btn.reply({ content: "Only the event host can end this event.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (ev.status !== "active" && ev.status !== "won") {
    await btn.reply({ content: "This event is not currently active.", flags: MessageFlags.Ephemeral });
    return;
  }

  await btn.deferUpdate();

  await endEvent(ev, btn.user.id);

  await btn.editReply({
    embeds: [buildEventControlEmbed(ev)],
    components: [buildEventControlButtons(ev)],
  });
}

// ─── Promotion Handlers ────────────────────────────────────────────────

const PROMOTION_ALLOWED_USERS = ["1180944141291634728", "1459790270370676798"];

async function handleSchedulePromotion(interaction: ChatInputCommandInteraction) {
  if (!PROMOTION_ALLOWED_USERS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to schedule promotions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const serverName    = interaction.options.getString("server",   true);
  const dateStr       = interaction.options.getString("date",     true);
  const timeStr       = interaction.options.getString("time",     false);
  const durationDays  = interaction.options.getInteger("duration", true);

  const startDate = parsePromotionDate(dateStr, timeStr);

  if (!startDate) {
    await interaction.reply({
      content: "Invalid format. Date must be DD/MM/YY (e.g. 22/03/26). For today's date, time is REQUIRED. For past/future dates, time is optional (e.g. 15:00, 1h, 30m, 2 hours).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // REMOVED: Future date validation - now accepts past, present, and future dates

  const conflict = findConflict(startDate, durationDays);
  if (conflict) {
    await interaction.reply({
      content: `A scheduling conflict was detected with **${conflict.serverName}** (${formatPromotionDate(conflict.startDate)} – ${formatPromotionDate(promotionEnd(conflict))}). Two promotions cannot run at the same time.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id: string = shortId();
  const promotion: Promotion = {
    id,
    serverName,
    startDate,
    durationDays,
    scheduledById: interaction.user.id,
    scheduledAt: new Date(),
    notified: false,
  };

  promotions.set(id, promotion);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Promotion Scheduled")
        .setColor(0x5865f2)
        .setDescription(
          `1).\nServer | ${serverName}\nDate: ${formatRelativeTime(startDate)} | ${formatPromotionDate(startDate)}\nDuration: ${durationDays} DAYS`
        )
        .addFields(
          { name: "Promotion ID", value: `\`${id}\``, inline: true },
          { name: "Scheduled by", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleListPromotions(interaction: ChatInputCommandInteraction) {
  if (!PROMOTION_ALLOWED_USERS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to view the promotion schedule.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = new Date();

  const visible = getSortedPromotions().filter((p) => promotionEnd(p) > now);

  if (visible.length === 0) {
    await interaction.reply({
      content: "No promotions are currently scheduled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const active   = visible.filter(isActive);
  const upcoming = visible.filter(isUpcoming);

  let description = "";

  if (active.length > 0) {
    description += "**🟢 Currently Active**\n";
    for (const p of active) {
      const endsIn = formatRelativeTime(promotionEnd(p)).replace("In ", "Ends in ");
      description += `\`${p.id}\` — **${p.serverName}**\nStarted: ${formatPromotionDate(p.startDate)} | ${endsIn}\nDuration: ${p.durationDays} day${p.durationDays !== 1 ? "s" : ""}\n\n`;
    }
  }

  if (upcoming.length > 0) {
    const next = upcoming[0];
    description += `**⏭️ Next in Queue**\n\`${next.id}\` — **${next.serverName}**\nStarts: ${formatRelativeTime(next.startDate)} | ${formatPromotionDate(next.startDate)}\nDuration: ${next.durationDays} day${next.durationDays !== 1 ? "s" : ""}\n\n`;

    if (upcoming.length > 1) {
      description += "**📋 Upcoming**\n";
      for (const p of upcoming.slice(1)) {
        description += `\`${p.id}\` — **${p.serverName}**\nStarts: ${formatRelativeTime(p.startDate)} | ${formatPromotionDate(p.startDate)}\nDuration: ${p.durationDays} day${p.durationDays !== 1 ? "s" : ""}\n\n`;
      }
    }
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Promotion Schedule")
        .setDescription(description.trim())
        .setColor(0x5865f2)
        .setFooter({ text: "Use /promotion edit or /promotion delete with the ID shown above" })
        .setTimestamp(),
    ],
  });
}

async function handleEditPromotion(interaction: ChatInputCommandInteraction) {
  if (!PROMOTION_ALLOWED_USERS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to edit promotions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const promotionId = interaction.options.getString("promotion_id", true).toUpperCase();
  const promotion   = promotions.get(promotionId);

  if (!promotion) {
    await interaction.reply({
      content: `No promotion found with ID \`${promotionId}\`. Use \`/promotion list\` to see all promotion IDs.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const newServerName  = interaction.options.getString("server_name", false);
  const newDateStr     = interaction.options.getString("date",         false);
  const newTimeStr     = interaction.options.getString("time",         false);
  const newDuration    = interaction.options.getInteger("duration",    false);

  if (!newServerName && !newDateStr && !newTimeStr && !newDuration) {
    await interaction.reply({
      content: "You must provide at least one field to update (server_name, date, time, or duration).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Resolve new start date
  let newStartDate = promotion.startDate;
  if (newDateStr || newTimeStr) {
    // Build the date string — fall back to existing date if only time is changing
    const dateStr = newDateStr ?? formatPromotionDateForParsing(promotion.startDate);
    const timeStr = newTimeStr ?? null;
    const parsed  = parsePromotionDate(dateStr, timeStr);
    if (!parsed) {
      await interaction.reply({
        content: "Invalid date/time format. Date must be DD/MM/YY (e.g. 22/03/26). Time can be HH:MM (e.g. 15:00), 1h, 30m, or 1h30m.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    newStartDate = parsed;
  }

  const newDurationDays = newDuration ?? promotion.durationDays;

  // Check for conflicts, excluding this promotion itself
  const conflict = findConflict(newStartDate, newDurationDays, promotionId);
  if (conflict) {
    await interaction.reply({
      content: `A scheduling conflict was detected with **${conflict.serverName}** (\`${conflict.id}\`, ${formatPromotionDate(conflict.startDate)} – ${formatPromotionDate(promotionEnd(conflict))}). Two promotions cannot overlap.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Apply updates
  const oldServerName = promotion.serverName;
  const oldStartDate  = promotion.startDate;
  const oldDuration   = promotion.durationDays;

  if (newServerName)  promotion.serverName  = newServerName;
  if (newDateStr || newTimeStr) promotion.startDate = newStartDate;
  if (newDuration)    promotion.durationDays = newDurationDays;

  // Reset notified flag if the start date moved into the future
  if (promotion.startDate > new Date()) {
    promotion.notified = false;
  }

  const changes: string[] = [];
  if (newServerName && newServerName !== oldServerName)
    changes.push(`Server: **${oldServerName}** → **${newServerName}**`);
  if (newDateStr || newTimeStr)
    changes.push(`Date: **${formatPromotionDate(oldStartDate)}** → **${formatPromotionDate(promotion.startDate)}** (${formatRelativeTime(promotion.startDate)})`);
  if (newDuration && newDuration !== oldDuration)
    changes.push(`Duration: **${oldDuration} day${oldDuration !== 1 ? "s" : ""}** → **${newDurationDays} day${newDurationDays !== 1 ? "s" : ""}**`);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Promotion Updated")
        .setColor(0xf1c40f)
        .addFields(
          { name: "Promotion ID",  value: `\`${promotion.id}\``,                    inline: true },
          { name: "Server",        value: promotion.serverName,                      inline: true },
          { name: "Starts",        value: `${formatPromotionDate(promotion.startDate)} (${formatRelativeTime(promotion.startDate)})`, inline: false },
          { name: "Duration",      value: `${promotion.durationDays} day${promotion.durationDays !== 1 ? "s" : ""}`, inline: true },
          { name: "Changes",       value: changes.length > 0 ? changes.join("\n") : "No changes detected", inline: false },
        )
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDeletePromotion(interaction: ChatInputCommandInteraction) {
  if (!PROMOTION_ALLOWED_USERS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to delete promotions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const promotionId = interaction.options.getString("promotion_id", true).toUpperCase();
  const promotion   = promotions.get(promotionId);

  if (!promotion) {
    await interaction.reply({
      content: `No promotion found with ID \`${promotionId}\`. Use \`/promotion list\` to see all promotion IDs.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  promotions.delete(promotionId);

  const status = isActive(promotion)
    ? "🟢 Was active"
    : isUpcoming(promotion)
    ? "⏳ Was upcoming"
    : "✅ Had already ended";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Promotion Deleted")
        .setColor(0xed4245)
        .addFields(
          { name: "Promotion ID", value: `\`${promotionId}\``,                                                    inline: true },
          { name: "Server",       value: promotion.serverName,                                                     inline: true },
          { name: "Status",       value: status,                                                                   inline: true },
          { name: "Was Scheduled", value: `${formatPromotionDate(promotion.startDate)} – ${formatPromotionDate(promotionEnd(promotion))}`, inline: false },
          { name: "Deleted by",   value: `<@${interaction.user.id}>`,                                             inline: true },
        )
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Message Listener (guess detection) ─────────────────────────────────

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (message.channelId !== GENERAL_CHANNEL_ID) return;

  // Find any active event
  const activeEvent = Array.from(events.values()).find(
    (ev) => ev.status === "active"
  );

  if (!activeEvent) return;

  const content = message.content.trim();
  const guessed = parseInt(content, 10);

  if (isNaN(guessed) || content !== String(guessed)) return;

  if (guessed === activeEvent.answer) {
    activeEvent.status = "won";
    activeEvent.winnerId = message.author.id;
    activeEvent.winnerUsername = message.author.username;

    // Lock general chat
    await lockGeneral(`Event ${activeEvent.id} won by ${message.author.username}`);

    // DM the host
    try {
      const host = await client.users.fetch(activeEvent.hostId);
      const dm = await host.createDM();
      await dm.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Event Winner Found!")
            .setDescription(
              `**${message.author.username}** has won the event!\n\n` +
              `The number **${activeEvent.answer}** was guessed.\n\n` +
              `General chat is now locked. Use the End Event button or \`/endevent id:${activeEvent.id}\` to unlock it once you have announced the winner.`
            )
            .setColor(0x2ecc71)
            .addFields(
              { name: "Winner", value: `<@${message.author.id}>`, inline: true },
              { name: "Number", value: `${activeEvent.answer}`,   inline: true },
              { name: "Event",  value: `\`${activeEvent.id}\``,   inline: true },
            )
            .setTimestamp(),
        ],
      });
    } catch {}
  }
});

// ─── Interaction Router ────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const cmd = interaction as ChatInputCommandInteraction;

    if (cmd.commandName === "league") {
      const sub = cmd.options.getSubcommand();
      if (sub === "host")   await handleHostLeague(cmd);
      if (sub === "cancel") await handleCancelLeague(cmd);
      if (sub === "kick")   await handleKickLeague(cmd);
    }

    if (cmd.commandName === "hostevent") {
      const type = cmd.options.getString("type");
      if (type === "guess_the_number") await handleHostEvent(cmd);
    }

    if (cmd.commandName === "endevent") {
      await handleEndEvent(cmd);
    }

    if (cmd.commandName === "promotion") {
      const sub = cmd.options.getSubcommand();
      if (sub === "schedule") await handleSchedulePromotion(cmd);
      if (sub === "list")     await handleListPromotions(cmd);
      if (sub === "edit")     await handleEditPromotion(cmd);
      if (sub === "delete")   await handleDeletePromotion(cmd);
    }

    return;
  }

  // Buttons
  if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    const id  = btn.customId;

    // League join
    if (id.startsWith("join_league_")) {
      const leagueId = id.replace("join_league_", "");
      const league   = leagues.get(leagueId);

      if (!league || !league.active) {
        await btn.reply({ content: "This league is no longer active.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (league.players.includes(btn.user.id)) {
        await btn.reply({ content: "You have already joined this league.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (league.players.length >= league.maxPlayers) {
        await btn.reply({ content: "This league is already full.", flags: MessageFlags.Ephemeral });
        return;
      }

      league.players.push(btn.user.id);

      if (league.threadId) {
        try {
          const thread = await client.channels.fetch(league.threadId) as ThreadChannel;
          await thread.members.add(btn.user.id);
          await thread.send({
            content: `<@${btn.user.id}> has joined the league. **${league.maxPlayers - league.players.length} spots remaining.**`,
          });
        } catch {}
      }

      const isFull = league.players.length >= league.maxPlayers;
      try {
        await btn.message.edit({
          embeds: [buildLeagueEmbed(league)],
          components: [buildJoinButton(league)],
        });
      } catch {}

      if (isFull && league.threadId) {
        try {
          const thread = await client.channels.fetch(league.threadId) as ThreadChannel;
          const playerList = league.players.map((uid) => `<@${uid}>`).join(", ");
          await thread.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("League Full — Starting Now")
                .setDescription(`All spots have been filled. The league is starting.\n\n**Players:** ${playerList}`)
                .setColor(0x2ecc71)
                .setTimestamp(),
            ],
          });
        } catch {}
      }

      await btn.reply({
        content: `You have joined **League ${league.id}**. Check the private thread for details.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Event buttons
    if (id.startsWith("event_")) {
      const parts   = id.split("_");
      const action  = parts[1];
      const eventId = parts.slice(2).join("_");
      const ev      = events.get(eventId);

      if (!ev) {
        await btn.reply({ content: "Event not found.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === "start")  await handleStartEventButton(btn, ev);
      if (action === "cancel") await handleCancelEventButton(btn, ev);
      if (action === "end")    await handleEndEventButton(btn, ev);

      return;
    }
  }
});

// ─── Login ────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login Discord bot:", err);
});
