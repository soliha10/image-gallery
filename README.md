# Mushuk Galereyasi

Telegram Mini App: foydalanuvchi skafandrli mushukchani Somon yo'lida suzib yurgan shisha
observatoriya bo'ylab erkin boshqaradi va rasmlarni yulduzlar orasida tomosha qiladi. Rasmlar bot orqali yoki ilova ichidagi boshqaruv paneli orqali qo'shiladi.

## Lokal ishga tushirish

Hech qanday hisob yoki Docker kerak emas. Baza PGlite'da, rasmlar diskda saqlanadi.

```bash
pnpm install
pnpm seed      # The Met'dan CC0 rasmlarni yuklaydi (bir necha daqiqa)
pnpm dev       # http://localhost:5173
```

`BOT_TOKEN` bo'sh bo'lsa, brauzerda mock admin foydalanuvchi ishlaydi.

## Koinotdagi boshqaruv

- Telefon: chap pastda suring, mushukcha yuradi. Boshqa joyni sursangiz, kamera aylanadi.
- Kompyuter: WASD yoki strelkalar, Shift bilan yugurish, sichqoncha bilan qarash.
- Polga bosing: mushukcha shu joyga boradi. Rasmga bosing: borib tomosha qiladi, yana bossangiz
  rasm to'liq ochiladi. Mushukchaga bossangiz, erkalanadi.
- "Sayohat" tugmasi rasmlarni navbat bilan ko'rsatadi, istalgan harakat uni to'xtatadi.
- Sifat darajasi tugma orqali o'zgaradi va saqlanadi. Sekin qurilmada sahna o'zi pasaytiradi.

| Effekt | Past | O'rta | Yuqori |
|---|---|---|---|
| Osmon teksturasi | 1024 | 2048 | 2048 |
| Yulduzlar | 900 | 2400 | 4200 |
| Nebulalar | 2 | 4 | 5 |
| Asteroidlar | 0 | 24 | 48 |
| Uchuvchi yulduz, yulduz izi, rasmlar suzishi | yo'q | bor | bor |
| Rasm teksturasi | 400 | 800 | 800 |

## Bot ulash

1. @BotFather: `/newbot`, tokenni oling.
2. @userinfobot orqali o'z Telegram ID'ingizni oling.
3. `cp .env.example .env`, `BOT_TOKEN` va `ADMIN_IDS` ni to'ldiring.
4. Lokal HTTPS: `cloudflared tunnel --url http://localhost:5173`, olingan manzilni
   `MINI_APP_URL` ga yozing.
5. @BotFather: `/newapp` bilan Mini App yarating, URL sifatida shu manzilni bering.
   Havolani `VITE_TG_APP_LINK=https://t.me/<bot>/<app>` ga yozing.
6. `pnpm dev`, botga `/start` yuboring.

## Bepul production

| Qism | Servis | Eslatma |
|---|---|---|
| Ilova va bot | Render Web Service (Frankfurt) | Faolsizlikda uxlaydi, keyingi so'rov 1 daqiqagacha kutadi |
| PostgreSQL va rasmlar | Neon (Frankfurt) | Postgres va S3-mos Object Storage bitta loyihada |

Neon loyihasi `mushuk-galereyasi`, `gallery` bucket'i public. Storage manzillari `render.yaml` da
yozilgan. Public bucket brauzerga `Access-Control-Allow-Origin: *` beradi, CORS sozlash shart emas.
Boshqa S3 (masalan Cloudflare R2) ishlatsangiz, `render.yaml` dagi storage qiymatlarini almashtiring.

Maxfiy qiymatlar faqat ikki joyda turadi: Render'ning Environment bo'limi va lokal `.env.production`.

1. **Neon kalitlari:**
   - Postgres: loyiha sahifasida **Connect** tugmasi orqali `DATABASE_URL` ni oling.
   - Storage: **Object storage > Connect** bo'limida kalit yarating, `S3_ACCESS_KEY_ID` va
     `S3_SECRET_ACCESS_KEY` ni oling.
2. **Lokal rasmlarni ko'chirish:** `pnpm dev` ni to'xtating, ildizda `.env.production` yarating
   (git'ga kirmaydi) va `pnpm data:push` ni ishga tushiring. Qayta ishga tushirish xavfsiz, bor
   yozuvlar o'tkazib yuboriladi.

   ```
   DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
   S3_ENDPOINT=https://br-noisy-mouse-bafcubif.storage.c-8.eu-central-1.aws.neon.tech
   S3_BUCKET=gallery
   S3_REGION=eu-central-1
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   MEDIA_BASE_URL=https://br-noisy-mouse-bafcubif.storage.c-8.eu-central-1.aws.neon.tech/gallery
   ```
3. **Render:** New > Blueprint orqali repozitoriyni va `main` branch'ni tanlang. Maxfiy qiymatlarni
   kiriting. Birinchi deploy'dan keyin `https://<app>.onrender.com` manzilini `PUBLIC_URL` va
   `MINI_APP_URL` ga yozib, qayta deploy qiling.
4. **Telegram:** @BotFather'da `/newbot` va `/newapp` bilan bot va Mini App yarating. Mini App URL'i
   Render manzili bo'ladi. `BOT_TOKEN`, `ADMIN_IDS` va `VITE_TG_APP_LINK=https://t.me/<bot>/<app>` ni
   Render'ga yozib, qayta deploy qiling. Botga `/start` yuboring.

Render'ning bepul diski vaqtinchalik, shuning uchun production'da tashqi S3 storage majburiy.

## Buyruqlar

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:generate`, `pnpm data:push`.

## Tuzilma

- `apps/server`: Fastify API, grammY bot, Drizzle, rasm pipeline
- `apps/web`: React ilova, `src/scene` ichida Three.js sahna
- `packages/shared`: umumiy tiplar va zod sxemalar

## Litsenziyalar

Mushuk, osmon, sayyoralar va platforma kod bilan yaratilgan, tashqi 3D fayl yoki tekstura ishlatilmagan. Boshlang'ich rasmlar
The Met Open Access dasturidan (CC0).
# image-gallery
