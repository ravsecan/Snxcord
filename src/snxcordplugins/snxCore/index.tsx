/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Snxcord'un temel eklentisi:
 *  - Owner'larin (Ravse & North) isminin yaninda snx simgesi
 *  - Uzaktan (sadece veri olarak) okunan rozetler ve duyurular
 *  - Sadece owner'larin gordugu "Snx Admin" paneli
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { isSnxcordOwner, SNXCORD_DATA_PATH, SNXCORD_DATA_REPO, SNXCORD_OWNERS } from "@utils/constants";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { relaunch } from "@utils/native";
import definePlugin, { type Plugin } from "@utils/types";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize } from "@utils/modal";
import { Alerts, closeModal, openModal, React, showToast, UserStore, useState } from "@webpack/common";
import gitHash from "~git-hash";
import Plugins from "~plugins";

import { emptyData, getData, getToken, getUnseenAnnouncements, isAllowedIcon, isDataRepoConfigured, loadData, logger, markAnnouncementsSeen, resolveBadgeIcon, saveData, setToken, type SnxAnnouncement, type SnxData } from "./data";
import { BADGE_PRESETS, PRESET_ORDER } from "./presets";
import ownerWide from "file://owner-wide.png?base64";

const OWNER_ICON = `data:image/png;base64,${ownerWide}`;
const DEFAULT_BADGE_ICON = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23E6141B' d='M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z'/%3E%3C/svg%3E";
const REFRESH_MS = 30 * 60 * 1000;

const isCurrentUserOwner = () => isSnxcordOwner(UserStore.getCurrentUser()?.id);

// ── Isim yanindaki owner simgesi ───────────────────────────────────────────

function OwnerIcon({ size = 16 }: { size?: number; }) {
    return (
        <img
            src={OWNER_ICON}
            alt="Snxcord Owner"
            title="Snxcord Owner"
            style={{ height: size, width: "auto", marginLeft: 4, verticalAlign: "middle", flexShrink: 0 }}
            draggable={false}
        />
    );
}

// ── Admin paneli ───────────────────────────────────────────────────────────

const box: React.CSSProperties = {
    background: "var(--background-secondary)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16
};
const input: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: 4,
    border: "1px solid var(--background-modifier-accent)",
    background: "var(--input-background, var(--background-tertiary))",
    color: "var(--text-normal)",
    marginBottom: 8,
    fontFamily: "inherit",
    fontSize: 14
};
const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const item: React.CSSProperties = { ...row, justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--background-modifier-accent)" };

function useAction() {
    const [busy, setBusy] = useState(false);
    const run = async (fn: () => Promise<void>, ok: string) => {
        setBusy(true);
        try {
            await fn();
            showToast(ok, "success");
        } catch (e: any) {
            logger.error(e);
            showToast(String(e?.message ?? e), "failure");
        } finally {
            setBusy(false);
        }
    };
    return [busy, run] as const;
}

function TokenSection() {
    const [token, setTokenInput] = useState("");
    const [saved, setSaved] = useState<boolean | null>(null);
    React.useEffect(() => { getToken().then(t => setSaved(!!t)); }, []);

    return (
        <div style={box}>
            <Heading>GitHub bağlantısı</Heading>
            <Paragraph>
                Rozet ve duyurular <code>{SNXCORD_DATA_REPO || "(repo ayarlanmamış)"}</code> reposundaki <code>{SNXCORD_DATA_PATH}</code> dosyasında tutulur.
                Değişiklik yapmak için sadece bu repoya "Contents: Read and write" izni olan bir fine-grained GitHub token'ı gir.
                Token sadece bu bilgisayarda saklanır, hiçbir yere gönderilmez (GitHub hariç).
            </Paragraph>
            <Paragraph style={{ marginTop: 8 }}>Durum: {saved == null ? "…" : saved ? "✅ Token kayıtlı" : "❌ Token yok"}</Paragraph>
            <input style={{ ...input, marginTop: 8 }} type="password" placeholder="github_pat_..." value={token} onChange={e => setTokenInput(e.currentTarget.value)} />
            <div style={row}>
                <Button size="small" disabled={!token.trim()} onClick={async () => { await setToken(token); setTokenInput(""); setSaved(true); showToast("Token kaydedildi", "success"); }}>Kaydet</Button>
                <Button size="small" variant="dangerSecondary" onClick={async () => { await setToken(""); setSaved(false); showToast("Token silindi", "success"); }}>Sil</Button>
            </div>
        </div>
    );
}

function BadgeSection({ data, setData }: { data: SnxData; setData(d: SnxData): void; }) {
    const [userId, setUserId] = useState("");
    const [presetKey, setPresetKey] = useState(PRESET_ORDER[0]);
    const [label, setLabel] = useState(BADGE_PRESETS[PRESET_ORDER[0]].label);
    const [icon, setIcon] = useState("");
    const [busy, run] = useAction();

    const isCustom = presetKey === "custom";

    const pickPreset = (key: string) => {
        setPresetKey(key);
        if (key !== "custom") {
            setLabel(BADGE_PRESETS[key].label);
            setIcon("");
        }
    };

    const add = () => run(async () => {
        if (!/^\d{15,21}$/.test(userId.trim())) throw new Error("Geçersiz kullanıcı ID'si");
        if (!label.trim()) throw new Error("Rozet adı boş olamaz");
        if (isCustom && icon.trim() && !isAllowedIcon(icon.trim()))
            throw new Error("İkon linki cdn.discordapp.com, media.discordapp.net, i.imgur.com veya raw.githubusercontent.com olmalı");
        const next = structuredClone(data);
        const badge = isCustom
            ? { label: label.trim(), icon: icon.trim() || undefined }
            : { label: label.trim(), preset: presetKey };
        (next.badges[userId.trim()] ??= []).push(badge);
        await saveData(next, `Rozet eklendi: ${label.trim()} -> ${userId.trim()}`);
        setData(getData());
        setUserId("");
    }, "Rozet eklendi");

    const remove = (uid: string, idx: number) => run(async () => {
        const next = structuredClone(data);
        next.badges[uid].splice(idx, 1);
        if (!next.badges[uid].length) delete next.badges[uid];
        await saveData(next, `Rozet kaldırıldı (${uid})`);
        setData(getData());
    }, "Rozet kaldırıldı");

    const entries = Object.entries(data.badges);

    return (
        <div style={box}>
            <Heading>Rozet dağıtma</Heading>
            <Paragraph>Verdiğiniz rozetleri Snxcord kullanan herkes görür. Normal Discord kullananlar görmez.</Paragraph>

            <Paragraph style={{ marginTop: 10, marginBottom: 4, opacity: .8 }}>Hazır rozetler:</Paragraph>
            <div style={{ ...row, marginBottom: 10 }}>
                {PRESET_ORDER.map(k => (
                    <button
                        key={k}
                        onClick={() => pickPreset(k)}
                        title={BADGE_PRESETS[k].label}
                        style={{
                            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                            padding: "4px 8px", borderRadius: 6, fontFamily: "inherit", fontSize: 13,
                            color: "var(--text-normal)",
                            background: presetKey === k ? "var(--brand-500, #5865F2)" : "var(--background-tertiary)",
                            border: "1px solid var(--background-modifier-accent)"
                        }}
                    >
                        <img src={BADGE_PRESETS[k].icon} style={{ width: 16, height: 16 }} />
                        {BADGE_PRESETS[k].label}
                    </button>
                ))}
                <button
                    onClick={() => pickPreset("custom")}
                    style={{
                        cursor: "pointer", padding: "4px 8px", borderRadius: 6, fontFamily: "inherit", fontSize: 13,
                        color: "var(--text-normal)",
                        background: isCustom ? "var(--brand-500, #5865F2)" : "var(--background-tertiary)",
                        border: "1px solid var(--background-modifier-accent)"
                    }}
                >
                    + Özel
                </button>
            </div>

            <input style={input} placeholder="Kullanıcı ID'si" value={userId} onChange={e => setUserId(e.currentTarget.value)} />
            <input style={input} placeholder="Rozet adı" maxLength={40} value={label} onChange={e => setLabel(e.currentTarget.value)} />
            {isCustom && (
                <input style={input} placeholder="İkon linki (isteğe bağlı, boşsa kırmızı yıldız)" value={icon} onChange={e => setIcon(e.currentTarget.value)} />
            )}
            <Button size="small" disabled={busy} onClick={add}>Rozet ver</Button>

            <div style={{ marginTop: 12 }}>
                {entries.length === 0 && <Paragraph>Henüz rozet yok.</Paragraph>}
                {entries.flatMap(([uid, list]) => list.map((b, i) => {
                    const user = UserStore.getUser(uid);
                    return (
                        <div key={uid + i} style={item}>
                            <span style={row}>
                                <img src={resolveBadgeIcon(b) ?? DEFAULT_BADGE_ICON} style={{ width: 18, height: 18 }} />
                                <b>{b.label}</b> — {user ? (user.globalName ?? user.username) : uid}
                            </span>
                            <Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => remove(uid, i)}>Kaldır</Button>
                        </div>
                    );
                }))}
            </div>
        </div>
    );
}


function AnnouncementSection({ data, setData }: { data: SnxData; setData(d: SnxData): void; }) {
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [busy, run] = useAction();

    const publish = () => run(async () => {
        if (!title.trim()) throw new Error("Başlık boş olamaz");
        const next = structuredClone(data);
        next.announcements.push({
            id: `${Date.now()}`,
            title: title.trim(),
            message: message.trim(),
            date: new Date().toISOString()
        });
        await saveData(next, `Duyuru: ${title.trim()}`);
        setData(getData());
        setTitle(""); setMessage("");
    }, "Duyuru yayınlandı");

    const remove = (id: string) => run(async () => {
        const next = structuredClone(data);
        next.announcements = next.announcements.filter(a => a.id !== id);
        await saveData(next, "Duyuru silindi");
        setData(getData());
    }, "Duyuru silindi");

    return (
        <div style={box}>
            <Heading>Duyuru gönderme</Heading>
            <Paragraph>Duyuru, Snxcord kullanan herkese bir sonraki açılışta (veya en geç 30 dakika içinde) bildirim olarak bir kez çıkar.</Paragraph>
            <div style={{ marginTop: 12 }}>
                <input style={input} placeholder="Başlık" maxLength={100} value={title} onChange={e => setTitle(e.currentTarget.value)} />
                <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} placeholder="Mesaj" maxLength={1000} value={message} onChange={e => setMessage(e.currentTarget.value)} />
                <Button size="small" disabled={busy} onClick={publish}>Yayınla</Button>
            </div>
            <div style={{ marginTop: 12 }}>
                {data.announcements.length === 0 && <Paragraph>Henüz duyuru yok.</Paragraph>}
                {[...data.announcements].reverse().map(a => (
                    <div key={a.id} style={item}>
                        <span><b>{a.title}</b> <span style={{ opacity: .6 }}>· {new Date(a.date).toLocaleString("tr-TR")}</span></span>
                        <Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => remove(a.id)}>Sil</Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OwnerTools() {
    const enabled = Object.keys(Plugins).filter(n => Settings.plugins[n]?.enabled);

    const debugInfo = () => [
        `Snxcord v${VERSION} (${gitHash.slice(0, 12)})`,
        `Açık eklenti: ${enabled.length} / ${Object.keys(Plugins).length}`,
        `Platform: ${navigator.platform}`,
        `Kullanıcı: ${UserStore.getCurrentUser()?.username} (${UserStore.getCurrentUser()?.id})`,
        `Açık eklentiler: ${enabled.join(", ")}`
    ].join("\n");

    const safeMode = () => Alerts.show({
        title: "Güvenli mod",
        body: "Zorunlu olanlar hariç bütün eklentiler kapatılacak ve Discord yeniden başlatılacak. Emin misin?",
        confirmText: "Kapat ve yeniden başlat",
        cancelText: "Vazgeç",
        onConfirm() {
            for (const name of enabled) {
                const p: Plugin | undefined = Plugins[name];
                if (!p || p.required || name === "SnxCore") continue;
                try { stopPlugin(p); } catch { }
                Settings.plugins[name].enabled = false;
            }
            setTimeout(relaunch, 500);
        }
    });

    return (
        <div style={box}>
            <Heading>Owner araçları</Heading>
            <div style={{ ...row, marginTop: 12 }}>
                <Button size="small" onClick={() => copyWithToast(debugInfo(), "Hata ayıklama bilgisi kopyalandı")}>Hata ayıklama bilgisini kopyala</Button>
                <Button size="small" variant="secondary" onClick={() => VencordNative.settings.openFolder()}>Ayar klasörünü aç</Button>
                <Button size="small" variant="secondary" onClick={() => relaunch()}>Discord'u yeniden başlat</Button>
                <Button size="small" variant="dangerSecondary" onClick={safeMode}>Güvenli mod (tüm eklentileri kapat)</Button>
            </div>
        </div>
    );
}

function AdminPanel() {
    const [data, setData] = useState<SnxData>(getData());
    const [loading, setLoading] = useState(false);

    if (!isCurrentUserOwner()) return <Paragraph>Bu paneli sadece Snxcord owner'ları görebilir.</Paragraph>;

    const refresh = async () => {
        setLoading(true);
        setData(await loadData());
        setLoading(false);
    };

    return (
        <div>
            <div style={{ ...box, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <img src={OWNER_ICON} style={{ height: 40 }} alt="Snxcord" />
                <div style={{ flex: 1, minWidth: 180 }}>
                    <Heading>Snxcord · Yapımcılar</Heading>
                    <Paragraph>{SNXCORD_OWNERS.map(o => o.name).join(" & ")}</Paragraph>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {SNXCORD_OWNERS.map(o => (
                        <Button key={o.id} size="small" variant="secondary" onClick={() => o.id && openUserProfile(o.id)}>
                            {o.name} profili
                        </Button>
                    ))}
                </div>
            </div>
            <Paragraph style={{ marginBottom: 16 }}>
                Hoş geldin, {UserStore.getCurrentUser()?.globalName ?? UserStore.getCurrentUser()?.username}.
            </Paragraph>
            {!isDataRepoConfigured() && (
                <div style={{ ...box, border: "1px solid var(--status-warning)" }}>
                    <Paragraph>⚠️ Veri reposu ayarlanmamış. Rozet ve duyuru için <code>src/utils/constants.ts</code> içindeki <code>SNXCORD_DATA_REPO</code> değerini doldurup yeniden derle.</Paragraph>
                </div>
            )}
            {isDataRepoConfigured() && (
                <>
                    <TokenSection />
                    <div style={{ ...row, marginBottom: 16 }}>
                        <Button size="small" variant="secondary" disabled={loading} onClick={refresh}>{loading ? "Yükleniyor…" : "Verileri yenile"}</Button>
                    </div>
                    <BadgeSection data={data} setData={setData} />
                    <AnnouncementSection data={data} setData={setData} />
                </>
            )}
            <OwnerTools />
        </div>
    );
}

// ── Eklenti ────────────────────────────────────────────────────────────────

// Insert tusu ile acilip kapanan panel (sadece owner'lar)
let panelKey: string | null = null;

function closePanel() {
    if (panelKey) {
        closeModal(panelKey);
        panelKey = null;
    }
}

function togglePanel() {
    if (panelKey) return closePanel();
    if (!isCurrentUserOwner()) return;

    const key = openModal(props => (
        <ErrorBoundary>
            <ModalRoot {...props} size={ModalSize.LARGE}>
                <ModalHeader>
                    <Heading tag="h2" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <img src={OWNER_ICON} style={{ height: 22 }} /> Admin <span style={{ opacity: .5, fontSize: 12 }}>(Insert ile aç/kapat)</span>
                    </Heading>
                    <ModalCloseButton onClick={props.onClose} />
                </ModalHeader>
                <ModalContent style={{ padding: "16px 0" }}>
                    <AdminPanel />
                </ModalContent>
            </ModalRoot>
        </ErrorBoundary>
    ), {
        onCloseCallback() {
            if (panelKey === key) panelKey = null;
        }
    });
    panelKey = key;
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Insert" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (!isCurrentUserOwner()) return;
    e.preventDefault();
    e.stopPropagation();
    togglePanel();
}

// ── Ust duyuru seridi ───────────────────────────────────────────────────────
const BANNER_CONTAINER_ID = "snx-announcement-banners";

function ensureBannerContainer(): HTMLElement {
    let c = document.getElementById(BANNER_CONTAINER_ID);
    if (!c) {
        if (!document.getElementById("snx-banner-style")) {
            const st = document.createElement("style");
            st.id = "snx-banner-style";
            st.textContent = "@keyframes snxSlideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}";
            document.head.appendChild(st);
        }
        c = document.createElement("div");
        c.id = BANNER_CONTAINER_ID;
        c.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;display:flex;flex-direction:column;pointer-events:none;";
        document.body.appendChild(c);
    }
    return c;
}

function showAnnouncementBanner(a: SnxAnnouncement) {
    const c = ensureBannerContainer();
    const bar = document.createElement("div");
    bar.style.cssText = "pointer-events:auto;display:flex;align-items:flex-start;gap:12px;padding:10px 16px;background:linear-gradient(90deg,#E6141B,#8f0d11);color:#fff;font-family:var(--font-primary,sans-serif);box-shadow:0 2px 8px rgba(0,0,0,.4);animation:snxSlideDown .25s ease;";

    const text = document.createElement("div");
    text.style.cssText = "flex:1;min-width:0;";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:700;font-size:14px;";
    title.textContent = "\uD83D\uDCE2 " + a.title; // metni duz string olarak basiyoruz (HTML degil)
    text.appendChild(title);
    if (a.message) {
        const msg = document.createElement("div");
        msg.style.cssText = "font-size:13px;opacity:.95;white-space:pre-wrap;word-break:break-word;margin-top:2px;";
        msg.textContent = a.message;
        text.appendChild(msg);
    }

    const close = document.createElement("button");
    close.textContent = "\u2715";
    close.style.cssText = "pointer-events:auto;background:transparent;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;flex-shrink:0;opacity:.85;padding:0 4px;";
    close.setAttribute("aria-label", "Kapat");
    close.onclick = () => bar.remove();

    bar.appendChild(text);
    bar.appendChild(close);
    c.appendChild(bar);
}

function clearAnnouncementBanners() {
    document.getElementById(BANNER_CONTAINER_ID)?.remove();
}

async function refreshAndAnnounce() {
    await loadData();
    const unseen = await getUnseenAnnouncements();
    if (!unseen.length) return;
    for (const a of unseen) showAnnouncementBanner(a);
    await markAnnouncementsSeen(unseen.map(a => a.id));
}

let interval: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "SnxCore",
    description: "Snxcord owner simgesi, rozetler, duyurular ve owner paneli.",
    authors: [{ name: "Ravse", id: 1566387153401942076n }, { name: "North", id: 376097269797093377n }],
    required: true,
    dependencies: ["BadgeAPI", "CommandsAPI"],

    userProfileBadges: [{
        getBadges: ({ userId }) => (getData().badges[userId] ?? []).map(b => {
            const ic = resolveBadgeIcon(b) ?? DEFAULT_BADGE_ICON;
            return {
                description: b.label,
                name: b.label,
                infoLabel: "Snxcord",
                iconSrc: ic,
                largeIconSrc: ic
            };
        })
    }],

    commands: [
        {
            name: "snx",
            description: "Snx admin panelini aç/kapat (sadece owner'lar)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => { togglePanel(); }
        }
    ],

    renderMessageDecoration: ({ message }) => isSnxcordOwner(message?.author?.id) ? <OwnerIcon /> : null,
    renderMemberListDecorator: ({ user }) => isSnxcordOwner(user?.id) ? <OwnerIcon /> : null,
    renderNicknameIcon: ({ userId }) => isSnxcordOwner(userId) ? <OwnerIcon size={18} /> : null,

    flux: {
        CONNECTION_OPEN() {
            void refreshAndAnnounce();
        }
    },

    start() {
        document.addEventListener("keydown", onKeyDown, true);
        if (isDataRepoConfigured()) {
            void refreshAndAnnounce();
            interval = setInterval(() => void refreshAndAnnounce(), REFRESH_MS);
        }
    },

    stop() {
        clearInterval(interval);
        document.removeEventListener("keydown", onKeyDown, true);
        closePanel();
        clearAnnouncementBanners();
        Object.assign(getData(), emptyData());
    }
});
