/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rozet ve duyuru verisi. Veri, SNXCORD_DATA_REPO'daki bir JSON dosyasindan okunur.
 * Bu dosya SADECE veri olarak okunur; icindeki hicbir sey kod olarak calistirilmaz.
 */

import * as DataStore from "@api/DataStore";
import { SNXCORD_DATA_PATH, SNXCORD_DATA_REPO } from "@utils/constants";
import { Logger } from "@utils/Logger";

import { BADGE_PRESETS } from "./presets";

export const logger = new Logger("SnxCore");

export interface SnxBadge {
    label: string;
    icon?: string;
    /** Hazir rozet anahtari (presets.ts). Varsa ikon oradan gelir. */
    preset?: string;
}

/** Bir rozetin gosterilecek ikonunu cozer: hazir rozet > ozel URL ikon > null. */
export function resolveBadgeIcon(b: SnxBadge): string | undefined {
    if (b.preset && BADGE_PRESETS[b.preset]) return BADGE_PRESETS[b.preset].icon;
    if (isAllowedIcon(b.icon)) return b.icon;
    return undefined;
}

export interface SnxAnnouncement {
    id: string;
    title: string;
    message: string;
    date: string;
}

export interface SnxData {
    version: 1;
    badges: Record<string, SnxBadge[]>;
    announcements: SnxAnnouncement[];
}

export const emptyData = (): SnxData => ({ version: 1, badges: {}, announcements: [] });

const TOKEN_KEY = "snx-admin-github-token";
const SEEN_KEY = "snx-seen-announcements";

/** Rozet ikonlari icin izin verilen adresler. */
const ALLOWED_ICON_HOSTS = ["cdn.discordapp.com", "media.discordapp.net", "i.imgur.com", "raw.githubusercontent.com"];

export function isAllowedIcon(url: unknown): url is string {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && ALLOWED_ICON_HOSTS.includes(u.hostname);
    } catch {
        return false;
    }
}

const isSnowflake = (v: unknown): v is string => typeof v === "string" && /^\d{15,21}$/.test(v);
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";

/** Uzaktan gelen JSON'u siki sekilde dogrular, gecersiz her seyi atar. */
export function sanitize(raw: any): SnxData {
    const data = emptyData();
    if (!raw || typeof raw !== "object") return data;

    if (raw.badges && typeof raw.badges === "object") {
        for (const [userId, list] of Object.entries(raw.badges)) {
            if (!isSnowflake(userId) || !Array.isArray(list)) continue;
            const badges = list
                .map((b: any) => {
                    const preset = typeof b?.preset === "string" && BADGE_PRESETS[b.preset] ? b.preset : undefined;
                    return { label: str(b?.label, 40).trim(), icon: isAllowedIcon(b?.icon) ? b.icon : undefined, preset };
                })
                .filter(b => b.label || b.preset)
                .slice(0, 10);
            if (badges.length) data.badges[userId] = badges;
        }
    }

    if (Array.isArray(raw.announcements)) {
        data.announcements = raw.announcements
            .map((a: any) => ({
                id: str(a?.id, 64),
                title: str(a?.title, 100).trim(),
                message: str(a?.message, 1000).trim(),
                date: str(a?.date, 40)
            }))
            .filter((a: SnxAnnouncement) => a.id && a.title)
            .slice(-50);
    }

    return data;
}

export const isDataRepoConfigured = () => /^[\w.-]+\/[\w.-]+$/.test(SNXCORD_DATA_REPO);

const contentsUrl = () => `https://api.github.com/repos/${SNXCORD_DATA_REPO}/contents/${SNXCORD_DATA_PATH}`;

let current: SnxData = emptyData();
export const getData = () => current;

export async function loadData(): Promise<SnxData> {
    if (!isDataRepoConfigured()) return current;
    try {
        const res = await fetch(contentsUrl(), {
            headers: { Accept: "application/vnd.github.raw+json" },
            cache: "no-store"
        });
        if (res.status === 404) {
            current = emptyData();
            return current;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        current = sanitize(await res.json());
    } catch (e) {
        logger.error("Veri yuklenemedi", e);
    }
    return current;
}

// ── Duyurular ───────────────────────────────────────────────────────────────

export async function getUnseenAnnouncements(): Promise<SnxAnnouncement[]> {
    const seen: string[] = await DataStore.get(SEEN_KEY) ?? [];
    return current.announcements.filter(a => !seen.includes(a.id));
}

export async function markAnnouncementsSeen(ids: string[]) {
    await DataStore.update<string[]>(SEEN_KEY, seen => [...new Set([...(seen ?? []), ...ids])].slice(-200));
}

// ── Owner: GitHub'a yazma ──────────────────────────────────────────────────

export const getToken = async () => (await DataStore.get<string>(TOKEN_KEY)) ?? "";
export const setToken = (token: string) => DataStore.set(TOKEN_KEY, token.trim());

function toBase64Utf8(text: string) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/** Veriyi GitHub'daki JSON dosyasina yazar. Token sadece bu bilgisayarda saklanir. */
export async function saveData(next: SnxData, commitMessage: string): Promise<void> {
    if (!isDataRepoConfigured()) throw new Error("SNXCORD_DATA_REPO ayarlanmamış.");
    const token = await getToken();
    if (!token) throw new Error("Önce GitHub token'ını kaydet.");

    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    };

    let sha: string | undefined;
    const existing = await fetch(contentsUrl(), { headers, cache: "no-store" });
    if (existing.ok) sha = (await existing.json()).sha;
    else if (existing.status !== 404) throw new Error(`GitHub okuma hatası: ${existing.status}`);

    const clean = sanitize(next);
    const res = await fetch(contentsUrl(), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
            message: commitMessage,
            content: toBase64Utf8(JSON.stringify(clean, null, 2) + "\n"),
            ...(sha ? { sha } : {})
        })
    });
    if (!res.ok) throw new Error(`GitHub yazma hatası: ${res.status} ${(await res.text()).slice(0, 200)}`);
    current = clean;
}
