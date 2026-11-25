/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SnxDmTemizle — bir DM'deki KENDI mesajlarini topluca siler.
 * Yazma kutusunun saginda cop/temizle butonu (sadece DM'lerde gorunur).
 * Tiklayinca onay + ilerleme penceresi acilir. Rate-limit'e saygilidir.
 * UYARI: Silme geri alinamaz. Sadece SENIN mesajlarin silinir.
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Modal, openModal, RestAPI, SelectedChannelStore, Toasts, UserStore, useState } from "@webpack/common";

const logger = new Logger("SnxDmTemizle");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let running = false;
let stopFlag = false;

async function getMessages(channelId: string, before?: string): Promise<any[]> {
    const query: any = { limit: 100 };
    if (before) query.before = before;
    const res = await RestAPI.get({ url: `/channels/${channelId}/messages`, query });
    return res.body ?? [];
}

async function deleteOne(channelId: string, messageId: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` });
            return;
        } catch (e: any) {
            const status = e?.status ?? e?.body?.code;
            const retry = e?.body?.retry_after;
            if (status === 429 || retry) {
                const wait = (typeof retry === "number" ? retry : 2) * 1000 + 500;
                logger.info(`rate limit, ${wait}ms bekleniyor`);
                await sleep(wait);
                continue;
            }
            if (status === 404) return; // zaten silinmis
            throw e;
        }
    }
}

// onProgress(silinen, taranan) her adimda cagirilir; stop() true donerse durur
async function cleanDm(channelId: string, onProgress: (deleted: number, scanned: number) => void): Promise<number> {
    const me = UserStore.getCurrentUser();
    const myId = me?.id;
    if (!myId) throw new Error("Kullanici bulunamadi");

    let before: string | undefined = undefined;
    let deleted = 0;
    let scanned = 0;

    while (!stopFlag) {
        const batch = await getMessages(channelId, before);
        if (!batch.length) break;

        before = batch[batch.length - 1].id;
        scanned += batch.length;

        for (const m of batch) {
            if (stopFlag) break;
            // sadece kendi mesajlarin, silinebilir tipler (0 normal, 19 reply)
            if (m.author?.id !== myId) continue;
            if (m.type !== 0 && m.type !== 19) continue;
            try {
                await deleteOne(channelId, m.id);
                deleted++;
                onProgress(deleted, scanned);
            } catch (e) {
                logger.error("silinemedi", m.id, e);
            }
            await sleep(900); // rate limit dostu
        }
        onProgress(deleted, scanned);
    }
    return deleted;
}

// ── Onay + ilerleme penceresi ─────────────────────────────────────────────────
function CleanModal({ rootProps, channelId, channelName }: { rootProps: any; channelId: string; channelName: string; }) {
    const [phase, setPhase] = useState<"confirm" | "running" | "done" | "error">("confirm");
    const [deleted, setDeleted] = useState(0);
    const [scanned, setScanned] = useState(0);
    const [err, setErr] = useState("");

    const start = async () => {
        if (running) return;
        running = true;
        stopFlag = false;
        setPhase("running");
        try {
            const total = await cleanDm(channelId, (d, s) => { setDeleted(d); setScanned(s); });
            setDeleted(total);
            setPhase("done");
        } catch (e: any) {
            setErr(String(e?.message ?? e));
            setPhase("error");
        } finally {
            running = false;
        }
    };

    const stop = () => { stopFlag = true; };

    return (
        <Modal {...rootProps} title="DM Temizle">
            <div style={{ padding: "16px", color: "var(--text-normal, #dbdee1)", fontSize: "14px", lineHeight: 1.5 }}>
                {phase === "confirm" && (
                    <>
                        <p><b>{channelName}</b> sohbetindeki <b>senin tum mesajlarin</b> silinecek.</p>
                        <p style={{ color: "var(--text-danger, #f23f43)" }}>Bu islem geri alinamaz. Sadece senin mesajlarin silinir, karsi tarafinkiler kalir.</p>
                        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                            <button onClick={start} style={btn("#da373c")}>Evet temizle</button>
                            <button onClick={rootProps.onClose} style={btn("#4e5058")}>Vazgec</button>
                        </div>
                    </>
                )}
                {phase === "running" && (
                    <>
                        <p>Temizleniyor... <b>{deleted}</b> mesaj silindi ({scanned} tarandi)</p>
                        <p style={{ opacity: 0.7, fontSize: "12px" }}>Discord yavaslatmasin diye yavas gidiyor, pencereyi kapatma.</p>
                        <div style={{ marginTop: "16px" }}>
                            <button onClick={stop} style={btn("#4e5058")}>Durdur</button>
                        </div>
                    </>
                )}
                {phase === "done" && (
                    <>
                        <p>Bitti. Toplam <b>{deleted}</b> mesaj silindi.</p>
                        <div style={{ marginTop: "16px" }}>
                            <button onClick={rootProps.onClose} style={btn("#248046")}>Kapat</button>
                        </div>
                    </>
                )}
                {phase === "error" && (
                    <>
                        <p style={{ color: "var(--text-danger, #f23f43)" }}>Hata: {err}</p>
                        <p>{deleted} mesaj silinmisti.</p>
                        <div style={{ marginTop: "16px" }}>
                            <button onClick={rootProps.onClose} style={btn("#4e5058")}>Kapat</button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

function btn(bg: string): any {
    return {
        background: bg, color: "#fff", border: "none", borderRadius: "6px",
        padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 600
    };
}

// ── Ikon (cop kovasi + yildiz) ─────────────────────────────────────────────────
const DmCleanIcon = ({ height = 20, width = 20, color, className }: any) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill={color ?? "currentColor"} d="M7 4h4l1 1h4a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2h2l1-1zM5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8zm4 3v7h2v-7H9zm4 0v7h2v-7h-2z" />
        <path fill={color ?? "currentColor"} d="M18.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" opacity="0.9" />
    </svg>
);

const DmCleanIconComponent: any = ({ height = 20, width = 20, className }: any) =>
    <DmCleanIcon height={height} width={width} className={className} />;

// ── Chatbar butonu (sadece DM'lerde) ──────────────────────────────────────────
const DmCleanChatBarIcon: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;
    // sadece DM (1) ve grup DM (3)
    if (channel?.type !== 1 && channel?.type !== 3) return null;

    const open = () => {
        const channelId = SelectedChannelStore.getChannelId() ?? channel.id;
        if (!channelId) {
            Toasts.show({ message: "DM bulunamadi", id: Toasts.genId(), type: Toasts.Type.FAILURE });
            return;
        }
        const name = channel?.name || channel?.rawRecipients?.[0]?.username || "bu DM";
        openModal(props => <CleanModal rootProps={props} channelId={channelId} channelName={name} />);
    };

    return (
        <ChatBarButton tooltip="DM Temizle (kendi mesajlarini sil)" onClick={open} buttonProps={{ "aria-haspopup": "dialog" }}>
            <DmCleanIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "SnxDmTemizle",
    description: "Bir DM'deki kendi tum mesajlarini topluca siler. Yazma kutusunun saginda (sadece DM'lerde) temizle butonu. Silme geri alinamaz; sadece senin mesajlarin silinir.",
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    dependencies: ["ChatInputButtonAPI"],
    tags: ["Chat", "Utility", "DM", "Cleanup"],

    chatBarButton: {
        icon: DmCleanIconComponent,
        render: DmCleanChatBarIcon
    },

    stop() {
        stopFlag = true;
    }
});
