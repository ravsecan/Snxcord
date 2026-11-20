/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Snx Stereo — sadece sesi stereo (sol/sağ) + yüksek kalite yapar. Efekt/panel yok.
 * Left And Right Voice'un hafif sürümü: ikisinden sadece BİRİNİ aynı anda aç.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { SNXCORD_OWNERS } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import ownerWide from "file://owner-wide.png?base64";

const LOGO = `data:image/png;base64,${ownerWide}`;
const logger = new Logger("SnxStereo");

const OPUS = {
    stereo: "1",
    "sprop-stereo": "1",
    maxaveragebitrate: "512000",
    maxplaybackrate: "48000",
    usedtx: "0",
    useinbandfec: "0"
};
const MIC_CLEAN = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

// ── SDP: Opus'u stereo + 512kbps yap ────────────────────────────────────────
function rewriteSdp(sdp: string): string {
    if (typeof sdp !== "string") return sdp;
    // kapasite sınırlarını kaldır
    let out = sdp.replace(/^b=AS:\d+\r?\n?/gm, "").replace(/^b=TIAS:\d+\r?\n?/gm, "");
    // opus payload türlerini bul
    const pts = new Set<string>();
    const re = /^a=rtpmap:(\d+)\s+opus\/48000\/2/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sdp)) !== null) pts.add(m[1]);

    for (const pt of pts) {
        const fmtpRe = new RegExp(`^a=fmtp:${pt}\\s+(.*)$`, "m");
        const match = fmtpRe.exec(out);
        if (!match) continue;
        const params: Record<string, string> = {};
        for (const part of match[1].split(";")) {
            const [k, ...v] = part.trim().split("=");
            if (k) params[k.trim()] = v.join("=").trim();
        }
        delete params.cbr;
        delete params.usedtx;
        Object.assign(params, OPUS);
        const encoded = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(";");
        out = out.replace(match[0], `a=fmtp:${pt} ${encoded}`);
    }
    return out;
}

// ── Patch durumu (geri alınabilir) ──────────────────────────────────────────
let origGUM: typeof navigator.mediaDevices.getUserMedia | null = null;
const origPC: Record<string, any> = {};
let active = false;

function patchDesc(orig: Function, desc: any) {
    if (desc?.sdp) return orig.call(this, { type: desc.type, sdp: rewriteSdp(desc.sdp) });
    return orig.call(this, desc);
}

function install() {
    if (active) return;
    active = true;
    try {
        // Mikrofonu stereo iste + işlemeyi kapat
        const md = navigator.mediaDevices;
        origGUM = md.getUserMedia.bind(md);
        md.getUserMedia = (constraints: any) => {
            if (!constraints?.audio) return origGUM!(constraints);
            const audio = {
                ...(typeof constraints.audio === "object" ? constraints.audio : {}),
                channelCount: { ideal: 2 },
                sampleRate: { ideal: 48000 },
                ...MIC_CLEAN
            };
            return origGUM!({ ...constraints, audio });
        };

        // SDP'yi stereo + 512k yap
        const PC = (window as any).RTCPeerConnection?.prototype;
        if (PC) {
            for (const name of ["setLocalDescription", "setRemoteDescription"]) {
                origPC[name] = PC[name];
                PC[name] = function (desc: any) { return patchDesc.call(this, origPC[name], desc); };
            }
            for (const name of ["createOffer", "createAnswer"]) {
                origPC[name] = PC[name];
                PC[name] = async function (...args: any[]) {
                    const r = await origPC[name].apply(this, args);
                    return { type: r.type, sdp: rewriteSdp(r.sdp) };
                };
            }
        }
        logger.info("Stereo açık");
    } catch (e) {
        logger.error("install", e);
    }
}

function uninstall() {
    if (!active) return;
    active = false;
    try {
        if (origGUM) navigator.mediaDevices.getUserMedia = origGUM;
        origGUM = null;
        const PC = (window as any).RTCPeerConnection?.prototype;
        if (PC) for (const name of Object.keys(origPC)) { PC[name] = origPC[name]; delete origPC[name]; }
        logger.info("Stereo kapandı (tam sıfırlama için Discord'u yeniden başlat)");
    } catch (e) {
        logger.error("uninstall", e);
    }
}

function SnxAbout() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "8px 0 16px" }}>
            <img src={LOGO} style={{ height: 40 }} alt="Snxcord" />
            <div style={{ flex: 1, minWidth: 160 }}>
                <Heading>Snxcord · Snx Stereo</Heading>
                <Paragraph>Yapımcılar: {SNXCORD_OWNERS.map(o => o.name).join(" & ")}</Paragraph>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SNXCORD_OWNERS.map(o => (
                    <Button key={o.id} size="small" variant="secondary" onClick={() => o.id && openUserProfile(o.id)}>
                        {o.name} profili
                    </Button>
                ))}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "SnxStereo",
    description: "Sesini stereo (sol/sağ) ve yüksek kaliteli (512kbps) gönderir. Left And Right Voice ile aynı anda açma.",
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    settingsAboutComponent: SnxAbout,

    start() { install(); },
    stop() { uninstall(); }
});
