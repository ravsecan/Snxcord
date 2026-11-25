/*
 * Snxcord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * TranslateAI — yapay zeka ile sohbet cevirisi.
 * - Yazma kutusunun saginda ac/kapa butonu (💬 + yari saydam translate simgesi).
 * - Butona tiklayinca dil secicileri acilir (gelen/giden icin ayri kaynak+hedef dil).
 * - Acikken: gelen mesajlar senin diline cevrilip altinda gosterilir,
 *   senin yazdigin mesaj otomatik hedef dile cevrilip oyle gonderilir.
 * - Ceviri Reidverse/Pollinations/Groq (SnxcordAI altyapisi) uzerinden.
 * - Stil: virgul yok, kesme isareti yok, kisaltmali; Ingilizce ciktida ı yerine i.
 */

import { definePluginSettings } from "@api/Settings";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { updateMessage } from "@api/MessageUpdater";
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Modal, openModal, Parser, SearchableSelect, Toasts, UserStore, useEffect, useMemo, useState } from "@webpack/common";

import { GoogleLanguages } from "../../plugins/translate/languages";
import { SnxcordChat } from "../SnxcordAI/aiProvider";

const logger = new Logger("TranslateAI");

// ── Ayarlar ──────────────────────────────────────────────────────────────────
const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Ceviri acik mi (butondan da acilir/kapanir)",
        default: false
    },
    translateIncoming: {
        type: OptionType.BOOLEAN,
        description: "Gelen mesajlari cevir",
        default: true
    },
    translateOutgoing: {
        type: OptionType.BOOLEAN,
        description: "Giden mesajlari cevir",
        default: true
    },
    incomingInput: {
        type: OptionType.STRING,
        description: "Karsi tarafin dili",
        default: "auto",
        hidden: true
    },
    incomingOutput: {
        type: OptionType.STRING,
        description: "Senin dilin (gelenin cevrilecegi dil)",
        default: "tr",
        hidden: true
    },
    outgoingInput: {
        type: OptionType.STRING,
        description: "Senin dilin",
        default: "auto",
        hidden: true
    },
    outgoingOutput: {
        type: OptionType.STRING,
        description: "Gidenin cevrilecegi dil",
        default: "en",
        hidden: true
    },
    aiProvider: {
        type: OptionType.SELECT,
        description: "Ceviri icin AI kaynagi",
        options: [
            { label: "Otomatik ucretsiz (Reidverse -> Pollinations)", value: "reidverse", default: true },
            { label: "Pollinations (ucretsiz)", value: "pollinations" },
            { label: "SnxcordAI ayarlari", value: "Snxcord" },
            { label: "Groq (SnxcordAI'da API anahtari gerekir)", value: "groq" }
        ] as const
    },
    openPanel: {
        type: OptionType.COMPONENT,
        component: () => (
            <button onClick={openTranslateAIModal} style={openBtnStyle}>
                Dil secicilerini ve ac/kapa panelini ac
            </button>
        )
    }
});

const openBtnStyle: any = {
    background: "var(--button-secondary-background, #4e5058)",
    color: "var(--white-500, #fff)",
    border: "none",
    borderRadius: "6px",
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "14px"
};

// ── Ceviri cekirdegi (AI) ─────────────────────────────────────────────────────
export interface TranslationValue {
    sourceLanguage: string;
    text: string;
}

function langName(code: string): string {
    return (GoogleLanguages as Record<string, string>)[code] ?? code;
}

function isEnglish(code: string): boolean {
    return code === "en" || code.startsWith("en");
}

function buildSystemPrompt(fromCode: string, toCode: string): string {
    const toName = langName(toCode);
    const fromPart = fromCode === "auto"
        ? "Detect the source language automatically."
        : `The source language is ${langName(fromCode)}.`;

    let p =
        `You are a translation engine for a casual chat and gaming app. ${fromPart} ` +
        `Translate the user message into ${toName}. ` +
        `Output ONLY the translated text, nothing else. No quotes, no notes, no explanations, no language labels. ` +
        `Keep emojis, mentions like <@123>, custom emojis like <:name:123>, links, URLs and :emoji: codes exactly as they are. ` +
        `Style rules you MUST follow:\n` +
        `- Never use commas.\n` +
        `- Never use apostrophes or any quotation marks.\n` +
        `- Use short casual chat style and contractions written WITHOUT apostrophes (dont, im, youre, cant, wont, gonna, wanna).\n` +
        `- Keep it natural and informal like how gamers text.`;

    if (isEnglish(toCode)) {
        p += `\n- Write with plain English letters only. Never use the Turkish dotless letter ı. Always write i instead.`;
    }
    return p;
}

function postProcess(text: string, toCode: string): string {
    let t = (text ?? "").trim();
    // modelin ekleyebilecegi dis tirnaklari temizle
    t = t.replace(/^["'`“”‘’]+/, "").replace(/["'`“”‘’]+$/, "");
    // virgul yok
    t = t.replace(/[,，、]/g, "");
    // kesme isaretleri / tirnaklar yok
    t = t.replace(/['’‘`´"“”]/g, "");
    // Ingilizce ciktida ı -> i
    if (isEnglish(toCode)) {
        t = t.replace(/ı/g, "i").replace(/İ/g, "I");
    }
    return t.trim();
}

async function callAI(messages: { role: "system" | "user" | "assistant"; content: string; }[]): Promise<string> {
    const provider = settings.store.aiProvider || "reidverse";
    return SnxcordChat({
        provider,
        forceModel: provider === "reidverse" ? "sakana-fugu-ultra" : undefined,
        messages,
        temperature: 0.2,
        maxTokens: 800
    });
}

async function aiTranslate(kind: "received" | "sent", text: string): Promise<TranslationValue> {
    const fromCode = kind === "received" ? settings.store.incomingInput : settings.store.outgoingInput;
    const toCode = kind === "received" ? settings.store.incomingOutput : settings.store.outgoingOutput;

    const system = buildSystemPrompt(fromCode, toCode);
    const raw = await callAI([
        { role: "system", content: system },
        { role: "user", content: text }
    ]);
    const cleaned = postProcess(raw, toCode);
    return {
        sourceLanguage: fromCode === "auto" ? "oto" : langName(fromCode),
        text: cleaned || text
    };
}

// ── Gelen mesaj aksesuari (ceviriyi mesajin altinda gosterir) ─────────────────
const translationCache = new Map<string, TranslationValue>();

interface TranslationSetter {
    messageId: string;
    set(v: TranslationValue): void;
}
const setters = new Set<TranslationSetter>();

function pushTranslation(messageId: string, data: TranslationValue) {
    translationCache.set(messageId, data);
    for (const s of setters) if (s.messageId === messageId) s.set(data);
}

const accessoryStyle: any = {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    color: "var(--text-muted, #b5bac1)",
    fontSize: "0.95em"
};

function TranslationAccessory({ message }: { message: Message; }) {
    const [translation, setTranslation] = useState<TranslationValue | undefined>(
        () => translationCache.get(message.id)
    );

    useEffect(() => {
        if ((message as any).vencordEmbeddedBy) return;
        const cached = translationCache.get(message.id);
        if (cached) setTranslation(cached);
        const setter: TranslationSetter = { messageId: message.id, set: setTranslation };
        setters.add(setter);
        return () => void setters.delete(setter);
    }, []);

    if (!translation) return null;

    return (
        <span style={accessoryStyle}>
            <TranslateAIIcon width={16} height={16} />
            <span style={{ marginLeft: 6 }}>{Parser.parse(translation.text)}</span>
            <span style={{ opacity: 0.6, marginLeft: 6, fontSize: "11px" }}>(TranslateAI)</span>
        </span>
    );
}

// ── Ozel ikon: 💬 arkada + yari saydam translate simgesi (A 文) onde ───────────
export const TranslateAIIcon = ({ height = 20, width = 20, color, className }: { height?: number; width?: number; color?: string; className?: string; }) => {
    return (
        <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
            <path
                fill={color ?? "currentColor"}
                d="M4 3h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
            />
            <text x="8" y="13.5" fontSize="8.5" fontWeight="700" textAnchor="middle"
                fill="var(--background-primary, #1e1f22)" opacity="0.55">A</text>
            <text x="15.5" y="13.5" fontSize="8.5" fontWeight="700" textAnchor="middle"
                fill="var(--background-primary, #1e1f22)" opacity="0.55">文</text>
        </svg>
    );
};

const TranslateAIIconComponent: any = ({ height = 20, width = 20, className }: any) =>
    <TranslateAIIcon height={height} width={width} className={className} />;

// ── Chatbar butonu ─────────────────────────────────────────────────────────────
const TranslateAIChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    const { active } = settings.use(["active"]);
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={active ? "TranslateAI: ACIK (sag tik veya shift+tik: kapat)" : "TranslateAI: kapali (tikla: panel)"}
            onClick={e => {
                if (e.shiftKey) {
                    settings.store.active = !settings.store.active;
                    return;
                }
                openTranslateAIModal();
            }}
            onContextMenu={() => { settings.store.active = !settings.store.active; }}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <TranslateAIIcon color={active ? "var(--green-360, #23a55a)" : undefined} />
        </ChatBarButton>
    );
};

// ── Modal (dil secicileri + ac/kapa) ──────────────────────────────────────────
const LANG_KEYS = ["incomingInput", "incomingOutput", "outgoingInput", "outgoingOutput"] as const;

function LanguageSelect({ settingsKey, label, includeAuto }: {
    settingsKey: typeof LANG_KEYS[number];
    label: string;
    includeAuto: boolean;
}) {
    const currentValue = settings.use([settingsKey])[settingsKey];
    const options = useMemo(() => {
        const opts = Object.entries(GoogleLanguages).map(([value, lbl]) => ({ value, label: lbl as string }));
        if (!includeAuto) opts.shift(); // "auto" (Detect language) ilk sirada
        return opts;
    }, []);

    return (
        <section className={Margins.bottom16}>
            <Heading className={Margins.bottom8}>{label}</Heading>
            <SearchableSelect
                options={options}
                value={options.find(o => o.value === currentValue)?.value}
                placeholder="Bir dil sec"
                maxVisibleItems={6}
                closeOnSelect={true}
                onChange={(v: string) => { settings.store[settingsKey] = v; }}
            />
        </section>
    );
}

function TranslateAIModal({ rootProps }: { rootProps: any; }) {
    const s = settings.use(["active", "translateIncoming", "translateOutgoing"]);
    return (
        <Modal {...rootProps} title="TranslateAI">
            <FormSwitch
                title="Ceviri acik"
                description="Acikken gelen mesajlar cevrilir ve yazdigin mesajlar otomatik cevrilip gonderilir."
                value={s.active}
                onChange={(v: boolean) => { settings.store.active = v; }}
                hideBorder
            />
            <Divider className={Margins.bottom16} />

            <Heading className={Margins.bottom8}>Gelen mesajlar (karsi taraf -&gt; sen)</Heading>
            <FormSwitch
                title="Gelen mesajlari cevir"
                value={s.translateIncoming}
                onChange={(v: boolean) => { settings.store.translateIncoming = v; }}
                hideBorder
            />
            <LanguageSelect settingsKey="incomingInput" label="Karsi tarafin yazdigi dil" includeAuto />
            <LanguageSelect settingsKey="incomingOutput" label="Senin dilin (buna cevrilecek)" includeAuto={false} />

            <Divider className={Margins.bottom16} />

            <Heading className={Margins.bottom8}>Giden mesajlar (sen -&gt; karsi taraf)</Heading>
            <FormSwitch
                title="Giden mesajlari cevir"
                value={s.translateOutgoing}
                onChange={(v: boolean) => { settings.store.translateOutgoing = v; }}
                hideBorder
            />
            <LanguageSelect settingsKey="outgoingInput" label="Senin yazdigin dil" includeAuto />
            <LanguageSelect settingsKey="outgoingOutput" label="Karsi tarafin dili (buna cevrilecek)" includeAuto={false} />
        </Modal>
    );
}

function openTranslateAIModal() {
    openModal(props => <TranslateAIModal rootProps={props} />);
}

// ── Plugin ─────────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "TranslateAI",
    description: "Yapay zeka ile sohbet cevirisi: gelen mesajlari kendi diline cevirir, yazdigin mesaji otomatik karsi tarafin diline cevirip gonderir. Yazma kutusunun saginda ac/kapa butonu.",
    authors: [{ name: "North", id: 376097269797093377n }, { name: "Ravse", id: 1566387153401942076n }],
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI"],
    tags: ["Chat", "Utility", "AI", "Translate"],
    settings,

    renderMessageAccessory: (props: any) => <TranslationAccessory message={props.message} />,

    chatBarButton: {
        icon: TranslateAIIconComponent,
        render: TranslateAIChatBarIcon
    },

    flux: {
        async MESSAGE_CREATE({ message, channelId, optimistic }: any) {
            try {
                if (!settings.store.active || !settings.store.translateIncoming) return;
                if (optimistic) return;
                if (!message?.content) return;
                if (message.state === "SENDING") return;

                const me = UserStore.getCurrentUser();
                if (message.author?.id && me?.id && message.author.id === me.id) return;
                if (translationCache.has(message.id)) return;

                const trans = await aiTranslate("received", message.content);
                pushTranslation(message.id, trans);
                updateMessage(channelId ?? message.channel_id, message.id);
            } catch (e) {
                logger.error("gelen ceviri hatasi", e);
            }
        }
    },

    async onBeforeMessageSend(_channelId: string, message: any) {
        try {
            if (!settings.store.active || !settings.store.translateOutgoing) return;
            if (!message.content?.trim()) return;
            const trans = await aiTranslate("sent", message.content);
            if (trans.text) message.content = trans.text;
        } catch (e) {
            logger.error("giden ceviri hatasi", e);
            Toasts.show({ message: "TranslateAI: ceviri basarisiz, mesaj orijinal gitti", id: Toasts.genId(), type: Toasts.Type.FAILURE });
        }
    },

    stop() {
        translationCache.clear();
        setters.clear();
    }
});
