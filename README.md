<div align="center">

# Snxcord

**Ravse & North** tarafından yönetilen bir Discord client mod'u — [Equicord](https://github.com/Equicord/Equicord) ve [Vencord](https://github.com/Vendicated/Vencord) tabanlı.

A Discord client mod maintained by **Ravse & North** — based on [Equicord](https://github.com/Equicord/Equicord) and [Vencord](https://github.com/Vendicated/Vencord).

[Discord](https://discord.gg/snx) · GPL-3.0

</div>

---

## 🇹🇷 Türkçe

### Snxcord nedir?
Snxcord, Equicord'un ([Kernixcord](https://github.com/kanvekin/Kernixcord) üzerinden) bir fork'udur. 100'den fazla eklenti, tema desteği ve Snxcord'a özel özellikler içerir.

### Özellikler
- **Owner rozeti** — Ravse ve North'un isminin yanında Snxcord simgesi.
- **Hazır rozetler** — Snx VIP, Staff, Mod, Doğrulandı, Booster, Efsane, OG, Developer ve daha fazlası. Owner panelinden tek tıkla dağıtılır.
- **Admin paneli** — Sadece owner'larda, **Insert** tuşuyla açılır. Rozet dağıtma, duyuru gönderme ve owner araçları.
- **Duyuru sistemi** — Yayınladığınız duyuru, tüm Snxcord kullanıcılarına bildirim olarak ulaşır.
- Equicord ve Vencord'un bütün eklentileri.

### Kurulum
Bilgisayarında **Git**, **Node.js 22+** ve **pnpm** kurulu olmalı.

```bash
git clone https://github.com/ravsecan/Snxcord
cd Snxcord
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

Yönetici (admin) olmayan bir terminal kullan. Kurulumdan sonra Discord'u tamamen kapatıp yeniden aç.

### Güvenlik notu
Snxcord hiçbir yere token veya kişisel veri göndermez. Rozet/duyuru verisi ayrı bir GitHub reposunda, sadece veri olarak tutulur ve asla kod olarak çalıştırılmaz.

---

## 🇬🇧 English

### What is Snxcord?
Snxcord is a fork of Equicord (via [Kernixcord](https://github.com/kanvekin/Kernixcord)). It ships 100+ plugins, theme support and Snxcord-specific features.

### Features
- **Owner badge** — a Snxcord icon next to Ravse's and North's names.
- **Preset badges** — Snx VIP, Staff, Mod, Verified, Booster, Legend, OG, Developer and more, handed out from the owner panel in one click.
- **Admin panel** — owners only, opened with the **Insert** key. Hand out badges, post announcements, and owner tools.
- **Announcements** — a published announcement reaches every Snxcord user as a notification.
- Every Equicord and Vencord plugin.

### Installation
You need **Git**, **Node.js 22+** and **pnpm** installed.

```bash
git clone https://github.com/ravsecan/Snxcord
cd Snxcord
pnpm install --frozen-lockfile
pnpm build
pnpm inject
```

Use a non-admin terminal. Fully close and reopen Discord after installing.

### Security note
Snxcord never sends your token or personal data anywhere. Badge/announcement data lives in a separate GitHub repo, is read as data only, and is never executed as code.

---

## Credits / Teşekkür

Snxcord is built on the work of:
- [Vencord](https://github.com/Vendicated/Vencord) by Vendicated and contributors
- [Equicord](https://github.com/Equicord/Equicord) by the Equicord team
- [Kernixcord](https://github.com/kanvekin/Kernixcord) by kanvekin

## License / Lisans

GPL-3.0-or-later. See [LICENSE](./LICENSE). / Ayrıntılar için [LICENSE](./LICENSE) dosyasına bakın.
