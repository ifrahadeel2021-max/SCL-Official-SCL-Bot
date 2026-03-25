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
const LEAGUE_HOST_ROLE_ID  = "1460146847912952090";
const LEAGUES_PING_ROLE_ID = "1460048729464770693";

// Event constants
const EVENT_CHANNEL_ID        = "1479659610418843791";
const EVENT_HOST_ROLE_ID      = "1482428444070379611";
const EVENT_HOST_ROLE_ID_2    = "1481442792017494087";
const GENERAL_CHANNEL_ID      = "1475202577204383914";
const GIVEAWAY_PING_ROLE_ID   = "1460048231424852180";

// ─── Role check helper ──────────────────────────────────────────────────────

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

// ─── League Types ───────────────────────────────────────────────────────────

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

// ─── Event Types ────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── League Embeds / Buttons ────────────────────────────────────────────────

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

// ─── Event Embeds / Buttons ─────────────────────────────────────────────────

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

// ─── Lock / Unlock General Chat ─────────────────────────────────────────────

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

// ─── Commands ───────────────────────────────────────────────────────────────

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
];

// ─── Deploy ─────────────────────────────────────────────────────────────────

async function deployCommands() {
  const rest = new REST().setToken(DISCORD_TOKEN);
  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
    body: commands.map((c) => c.toJSON()),
  });
  console.log("Slash commands registered.");
}

// ─── Client ─────────────────────────────────────────────────────────────────

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
});

// ─── League Handlers ────────────────────────────────────────────────────────

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

// ─── Event Handlers ─────────────────────────────────────────────────────────

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

// ─── Button: Start Event ─────────────────────────────────────────────────────

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

// ─── Button: Cancel Event ────────────────────────────────────────────────────

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

// ─── Button: End Event ───────────────────────────────────────────────────────

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

// ─── Message Listener (guess detection) ─────────────────────────────────────

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

// ─── Interaction Router ──────────────────────────────────────────────────────

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

// ─── Login ───────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login Discord bot:", err);
});
