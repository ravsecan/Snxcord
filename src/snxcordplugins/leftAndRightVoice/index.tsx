/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Left And Right Voice — kullanıcının ses aracını (stereo sol/sağ, 8D, EQ,
 * efektler, müzik oynatıcı) açıp kapanabilir bir plugine çevirir.
 * Motor kodu olduğu gibi engine.js içinde; burada sadece aç/kapat ve logo/profiller var.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SNXCORD_OWNERS } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import { hideLRVPanel, showLRVPanel, startLeftAndRightVoice } from "./engine";
import ownerWide from "file://owner-wide.png?base64";

const LOGO = `data:image/png;base64,${ownerWide}`;

function SnxAbout() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "8px 0 16px" }}>
            <img src={LOGO} style={{ height: 40 }} alt="Snxcord" />
            <div style={{ flex: 1, minWidth: 160 }}>
                <Heading>Snxcord · Left And Right Voice</Heading>
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
    name: "LeftAndRightVoice",
    description: "Sesini stereo (sol/sağ) yapar; 8D, EQ, efektler ve müzik oynatıcılı yüzen panel. Açınca panel gelir.",
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    settingsAboutComponent: SnxAbout,

    start() {
        startLeftAndRightVoice();
        showLRVPanel();
    },

    stop() {
        // Panel gizlenir. Çekirdek ses ayarları (stereo/bitrate) Discord yeniden başlayana kadar durur.
        hideLRVPanel();
    }
});
