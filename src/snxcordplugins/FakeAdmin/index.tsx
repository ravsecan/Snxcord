/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Snxcord: yama (patch) yerine PermissionStore metotlarini calisirken sarmalayacak sekilde yeniden yazildi.
 * Sadece GORSEL: Discord sunucusu gercek yetkileri kontrol ettigi icin yetkin olmayan islemler yine reddedilir.
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, Menu, PermissionStore, RestAPI, Toasts } from "@webpack/common";

const logger = new Logger("FakeAdmin");

export const settings = definePluginSettings({
    enabledServers: {
        type: OptionType.STRING,
        description: "Comma-separated list of server IDs where fake admin is enabled",
        default: "",
        hidden: true
    }
});

function getEnabledServers(): Set<string> {
    return new Set((settings.store.enabledServers || "").split(",").map(s => s.trim()).filter(Boolean));
}

function isServerEnabled(guildId?: string | null): boolean {
    return !!guildId && getEnabledServers().has(guildId);
}

/** Kanal ya da sunucu nesnesinden sunucu ID'sini bulur. */
function guildIdOf(ctx: any, explicitGuildId?: any): string | undefined {
    if (typeof explicitGuildId === "string") return explicitGuildId;
    if (!ctx) return;
    if (typeof ctx === "string") return GuildStore.getGuild(ctx) ? ctx : undefined;
    if (typeof ctx.guild_id === "string") return ctx.guild_id;
    if (typeof ctx.guildId === "string") return ctx.guildId;
    if (typeof ctx.getGuildId === "function") return ctx.getGuildId();
    if (typeof ctx.id === "string" && GuildStore.getGuild(ctx.id)) return ctx.id;
}

/** Bilinen tum yetki bitleri (Administrator dahil). */
const ALL_PERMISSIONS = (1n << 60n) - 1n;

type Wrapper = (orig: Function) => Function;

const wrappers: Record<string, Wrapper> = {
    // (permission, channelOrGuild, guildId?, overwrites?, userId?)
    can: orig => function (this: any, perm: any, ctx: any, gid?: any, ow?: any, userId?: any) {
        if (!userId && isServerEnabled(guildIdOf(ctx, gid))) return true;
        return orig.apply(this, arguments);
    },
    canBasicChannel: orig => function (this: any, perm: any, ctx: any, gid?: any, ow?: any, userId?: any) {
        if (!userId && isServerEnabled(guildIdOf(ctx, gid))) return true;
        return orig.apply(this, arguments);
    },
    canWithPartialContext: orig => function (this: any, perm: any, ctx: any) {
        const gid = ctx?.guildId ?? (ctx?.channelId ? ChannelStore.getChannel(ctx.channelId)?.guild_id : undefined);
        if (isServerEnabled(gid)) return true;
        return orig.apply(this, arguments);
    },
    canManageUser: orig => function (this: any, perm: any, user: any, guild: any) {
        if (isServerEnabled(guildIdOf(guild))) return true;
        return orig.apply(this, arguments);
    },
    canAccessGuildSettings: orig => function (this: any, guild: any) {
        if (isServerEnabled(guildIdOf(guild))) return true;
        return orig.apply(this, arguments);
    },
    canAccessMemberSafetyPage: orig => function (this: any, guild: any) {
        if (isServerEnabled(guildIdOf(guild))) return true;
        return orig.apply(this, arguments);
    },
    canImpersonateRole: orig => function (this: any, guild: any) {
        if (isServerEnabled(guildIdOf(guild))) return true;
        return orig.apply(this, arguments);
    },
    // (channel, guildId?, overwrites?, userId?)
    computePermissions: orig => function (this: any, ctx: any, gid?: any, ow?: any, userId?: any) {
        if (!userId && isServerEnabled(guildIdOf(ctx, gid))) return ALL_PERMISSIONS;
        return orig.apply(this, arguments);
    },
    getChannelPermissions: orig => function (this: any, ctx: any) {
        if (isServerEnabled(guildIdOf(ctx))) return ALL_PERMISSIONS;
        return orig.apply(this, arguments);
    },
    getGuildPermissions: orig => function (this: any, guild: any) {
        if (isServerEnabled(guildIdOf(guild))) return ALL_PERMISSIONS;
        return orig.apply(this, arguments);
    }
};

// ── Ozel davet baglantisi sayfasi ──────────────────────────────────────────
// Ayarlardaki "Ozel Davet Baglantisi" sayfasi /guilds/{id}/vanity-url ister; yetki olmadigi icin sunucu reddeder
// ve sayfa sonsuza dek yuklenir. Fake admin acik sunucularda bu istegi, herkese acik olan sunucu bilgisindeki
// vanityURLCode ile cevaplariz. Kullanim sayisi bilinmedigi icin 0 gosterilir. Baska hicbir istege dokunulmaz.
const VANITY_RE = /\/guilds\/(\d+)\/vanity-url\/?$/;
let origRestGet: Function | null = null;

function installVanityHook() {
    const api = RestAPI as any;
    if (!api || typeof api.get !== "function" || origRestGet) return;
    origRestGet = api.get;
    api.get = function (this: any, req: any, ...rest: any[]) {
        try {
            const url: string = typeof req === "string" ? req : req?.url ?? "";
            const gid = VANITY_RE.exec(url.split("?")[0])?.[1];
            if (gid && isServerEnabled(gid)) {
                const code = GuildStore.getGuild(gid)?.vanityURLCode ?? null;
                const body = { code, uses: 0 };
                return Promise.resolve({ ok: true, status: 200, body, text: JSON.stringify(body), headers: {} });
            }
        } catch (e) {
            logger.error("vanity hook", e);
        }
        return origRestGet!.call(this, req, ...rest);
    };
}

function uninstallVanityHook() {
    if (origRestGet) (RestAPI as any).get = origRestGet;
    origRestGet = null;
}

const originals = new Map<string, Function>();

function install() {
    const store = PermissionStore as any;
    for (const [name, wrap] of Object.entries(wrappers)) {
        const orig = store?.[name];
        if (typeof orig !== "function" || originals.has(name)) continue;
        originals.set(name, orig);
        store[name] = wrap(orig);
    }
    logger.info(`PermissionStore: ${originals.size} metot sarmalandı`);
}

function uninstall() {
    const store = PermissionStore as any;
    for (const [name, orig] of originals) store[name] = orig;
    originals.clear();
}

function refresh() {
    try { (PermissionStore as any).emitChange?.(); } catch { }
}

function toggleServer(guildId: string) {
    const enabled = getEnabledServers();
    const turningOn = !enabled.has(guildId);
    if (turningOn) enabled.add(guildId); else enabled.delete(guildId);
    settings.store.enabledServers = Array.from(enabled).join(",");
    refresh();
    Toasts.show({
        message: turningOn ? "Fake admin bu sunucuda açıldı (sadece görsel)" : "Fake admin bu sunucuda kapatıldı",
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
}

function copyVanity(guildId: string) {
    const code = GuildStore.getGuild(guildId)?.vanityURLCode;
    if (code) {
        copyWithToast(`https://discord.gg/${code}`, `Kopyalandı: discord.gg/${code}`);
    } else {
        Toasts.show({
            message: "Bu sunucunun özel davet bağlantısı yok",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
    }
}

function MenuItems({ guildId, id }: { guildId: string; id: string; }) {
    const code = GuildStore.getGuild(guildId)?.vanityURLCode;
    return [
        <Menu.MenuCheckboxItem
            key={id}
            id={id}
            label="Fake Admin"
            checked={isServerEnabled(guildId)}
            action={() => toggleServer(guildId)}
        />,
        <Menu.MenuItem
            key={id + "-vanity"}
            id={id + "-vanity"}
            label={code ? `Özel davet: discord.gg/${code}` : "Özel davet bağlantısını kopyala"}
            action={() => copyVanity(guildId)}
        />
    ];
}

export default definePlugin({
    name: "FakeAdmin",
    description: "Seçtiğin sunucularda kendini admin gibi görürsün (sadece görsel; gerçek yetki vermez, işlemler Discord tarafından reddedilir).",
    authors: [Devs.feelslove],
    settings,

    start() {
        install();
        installVanityHook();
        refresh();
    },

    stop() {
        uninstall();
        uninstallVanityHook();
        refresh();
    },

    contextMenus: {
        "guild-context"(children: any[], { guild }: any) {
            if (!guild?.id) return;
            children.push(<Menu.MenuSeparator />, ...MenuItems({ guildId: guild.id, id: "fakeadmin-toggle" }));
        },
        "guild-header-popout"(children: any[], { guild }: any) {
            if (!guild?.id) return;
            children.push(<Menu.MenuSeparator />, ...MenuItems({ guildId: guild.id, id: "fakeadmin-toggle-header" }));
        }
    }
});
