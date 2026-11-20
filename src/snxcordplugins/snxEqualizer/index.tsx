/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Snx Equalizer — mikrofon sesini 10 bantlı bir ekolayzırdan geçirir.
 * Sadece senin kendi sesine uygulanır. Sürüklenebilir küçük bir paneli vardır.
 * Mikrofona dokunan diğer eklentilerle (LeftAndRightVoice, SnxStereo, BetterMicrophone)
 * aynı anda açma — sadece birini aç.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SNXCORD_OWNERS } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import ownerWide from "file://owner-wide.png?base64";

const LOGO = `data:image/png;base64,${ownerWide}`;
const logger = new Logger("SnxEqualizer");

const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const PRESETS: Record<string, number[]> = {
    "Flat": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "Bass": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    "Vokal": [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1],
    "Tiz": [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
    "Temiz Ses": [-1, 0, 0, 1, 2, 2, 3, 3, 2, 1]
};

// Kalıcı kazançlar (voice'a tekrar girince de uygulanır)
const gains: number[] = new Array(10).fill(0);

let origGUM: typeof navigator.mediaDevices.getUserMedia | null = null;
let ctx: AudioContext | null = null;
let bands: BiquadFilterNode[] = [];
let active = false;

function buildChain(rawTrack: MediaStreamTrack): MediaStreamTrack {
    if (!ctx) ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    if (ctx.state === "suspended") ctx.resume();

    const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const dest = ctx.createMediaStreamDestination();

    bands = FREQS.map((f, i) => {
        const b = ctx!.createBiquadFilter();
        b.type = "peaking";
        b.frequency.value = f;
        b.Q.value = 1;
        b.gain.value = gains[i];
        return b;
    });

    let node: AudioNode = src;
    for (const b of bands) { node.connect(b); node = b; }
    node.connect(dest);

    return dest.stream.getAudioTracks()[0];
}

function applyGains() {
    bands.forEach((b, i) => { b.gain.value = gains[i]; });
}

function install() {
    if (active) return;
    active = true;
    try {
        const md = navigator.mediaDevices;
        origGUM = md.getUserMedia.bind(md);
        md.getUserMedia = async (constraints: any) => {
            if (!constraints?.audio) return origGUM!(constraints);
            const stream = await origGUM!(constraints);
            const aTrack = stream.getAudioTracks()[0];
            if (!aTrack) return stream;
            try {
                const proc = buildChain(aTrack);
                return new MediaStream([proc, ...stream.getVideoTracks()]);
            } catch (e) {
                logger.error("chain", e);
                return stream;
            }
        };
        buildPanel();
        logger.info("EQ açık");
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
        document.getElementById("snx-eq-panel")?.remove();
        document.getElementById("snx-eq-style")?.remove();
        logger.info("EQ kapandı (tam sıfırlama için Discord'u yeniden başlat)");
    } catch (e) {
        logger.error("uninstall", e);
    }
}

// ── Sürüklenebilir panel (düz DOM) ──────────────────────────────────────────
function buildPanel() {
    if (document.getElementById("snx-eq-panel")) return;

    if (!document.getElementById("snx-eq-style")) {
        const st = document.createElement("style");
        st.id = "snx-eq-style";
        st.textContent = `
          #snx-eq-panel{position:fixed;top:80px;right:16px;z-index:2147483646;width:360px;
            background:#111318e8;border:1px solid #2a2d36;border-radius:12px;color:#ccc;
            font:12px/1.4 'gg sans','Noto Sans',sans-serif;box-shadow:0 8px 32px #000a;
            backdrop-filter:blur(12px);user-select:none;}
          #snx-eq-panel h2{margin:0;padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:1px;
            text-transform:uppercase;color:#E6141B;border-bottom:1px solid #1e2029;cursor:move;
            display:flex;align-items:center;gap:6px;}
          #snx-eq-panel .snx-eq-body{padding:12px 14px;}
          #snx-eq-panel .snx-eq-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;align-items:end;height:150px;}
          #snx-eq-panel .snx-eq-col{display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;}
          #snx-eq-panel .snx-eq-col input{writing-mode:vertical-lr;direction:rtl;flex:1;width:16px;accent-color:#E6141B;cursor:pointer;}
          #snx-eq-panel .snx-eq-col span{font-size:8px;color:#888;}
          #snx-eq-panel .snx-eq-col .v{font-size:8px;color:#E6141B;min-width:20px;text-align:center;}
          #snx-eq-panel .snx-eq-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;}
          #snx-eq-panel button.snx-eq-btn{padding:3px 9px;border-radius:4px;border:1px solid #2a2d36;
            background:#1a1d24;color:#aaa;font-size:10px;cursor:pointer;}
          #snx-eq-panel button.snx-eq-btn:hover{border-color:#E6141B;color:#E6141B;}
        `;
        document.head.appendChild(st);
    }

    const p = document.createElement("div");
    p.id = "snx-eq-panel";

    const h = document.createElement("h2");
    const logoImg = document.createElement("img");
    logoImg.src = LOGO;
    logoImg.style.cssText = "height:14px;width:auto";
    h.appendChild(logoImg);
    h.appendChild(document.createTextNode("Snx Equalizer"));
    p.appendChild(h);

    const body = document.createElement("div");
    body.className = "snx-eq-body";

    const grid = document.createElement("div");
    grid.className = "snx-eq-grid";
    const valEls: HTMLElement[] = [];
    FREQS.forEach((_, i) => {
        const col = document.createElement("div");
        col.className = "snx-eq-col";

        const val = document.createElement("div");
        val.className = "v";
        val.textContent = String(gains[i]);
        valEls.push(val);

        const sl = document.createElement("input");
        sl.type = "range";
        sl.min = "-12"; sl.max = "12"; sl.step = "0.5";
        sl.value = String(gains[i]);
        sl.addEventListener("input", () => {
            const g = parseFloat(sl.value) || 0;
            gains[i] = g;
            if (bands[i]) bands[i].gain.value = g;
            val.textContent = (g > 0 ? "+" : "") + g;
        });

        const lbl = document.createElement("span");
        lbl.textContent = LABELS[i];

        col.appendChild(val);
        col.appendChild(sl);
        col.appendChild(lbl);
        grid.appendChild(col);
    });
    body.appendChild(grid);

    const row = document.createElement("div");
    row.className = "snx-eq-row";
    const setAll = (arr: number[]) => {
        for (let i = 0; i < 10; i++) {
            gains[i] = arr[i] ?? 0;
            if (bands[i]) bands[i].gain.value = gains[i];
            const sl = grid.children[i].querySelector("input") as HTMLInputElement;
            if (sl) sl.value = String(gains[i]);
            valEls[i].textContent = (gains[i] > 0 ? "+" : "") + gains[i];
        }
    };
    for (const [name, arr] of Object.entries(PRESETS)) {
        const b = document.createElement("button");
        b.className = "snx-eq-btn";
        b.textContent = name;
        b.addEventListener("click", () => setAll(arr));
        row.appendChild(b);
    }
    body.appendChild(row);
    p.appendChild(body);
    document.body.appendChild(p);

    // sürükleme
    let dragging = false, dx = 0, dy = 0;
    h.addEventListener("mousedown", e => {
        dragging = true;
        const r = p.getBoundingClientRect();
        dx = e.clientX - r.left; dy = e.clientY - r.top;
    });
    document.addEventListener("mousemove", e => {
        if (!dragging) return;
        p.style.right = "auto";
        p.style.left = (e.clientX - dx) + "px";
        p.style.top = (e.clientY - dy) + "px";
    });
    document.addEventListener("mouseup", () => { dragging = false; });
}

function SnxAbout() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "8px 0 16px" }}>
            <img src={LOGO} style={{ height: 40 }} alt="Snxcord" />
            <div style={{ flex: 1, minWidth: 160 }}>
                <Heading>Snxcord · Snx Equalizer</Heading>
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
    name: "SnxEqualizer",
    description: "Mikrofon sesini 10 bantlı ekolayzırdan geçirir (sürüklenebilir panel, hazır ayarlar). Diğer mikrofon eklentileriyle aynı anda açma.",
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    settingsAboutComponent: SnxAbout,

    start() { install(); },
    stop() { uninstall(); }
});
