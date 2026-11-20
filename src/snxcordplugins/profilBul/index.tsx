/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * /profil <id> — ID'den herkese acik profili acar. Ortak sunucu gerekmez.
 * Sadece Discord'un herkese acik profil verisini kullanir (kullanici adi, avatar,
 * banner, hesap acilis tarihi, rozetler, bio). Gizli/ozel hicbir veriye erisemez.
 */

import { ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";

const SNOWFLAKE = /^\d{15,21}$/;

// "<@123>", "https://discord.com/users/123", "123" -> "123"
function extractId(raw: string): string | null {
    const m = raw.trim().match(/\d{15,21}/);
    return m && SNOWFLAKE.test(m[0]) ? m[0] : null;
}

export default definePlugin({
    name: "ProfilBul",
    description: "Arama kutusuna / komuta kullanıcı ID'si girince o kişinin herkese açık profilini açar (ortak sunucu gerekmez).",
    dependencies: ["CommandsAPI"],
    tags: ["Commands", "Utility"],
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    searchTerms: ["profil", "lookup", "id", "user", "profile", "bul"],

    commands: [
        {
            name: "profil",
            description: "Bir kullanıcının profilini ID ile aç (ortak sunucu gerekmez)",
            options: [
                {
                    name: "id",
                    description: "Kullanıcı ID'si (ya da profil linki / @etiket)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            async execute(opts, ctx) {
                const raw = findOption<string>(opts, "id", "");
                const id = extractId(raw);
                if (!id) {
                    return sendBotMessage(ctx.channel.id, {
                        content: "Geçersiz ID. 17-19 haneli bir kullanıcı ID'si yapıştır (Geliştirici Modu açıkken profile sağ tık → \"Kullanıcı ID'sini Kopyala\")."
                    });
                }
                try {
                    await openUserProfile(id);
                } catch {
                    sendBotMessage(ctx.channel.id, {
                        content: `Bu ID'ye ait bir kullanıcı bulunamadı: ${id}`
                    });
                }
            }
        }
    ]
});
