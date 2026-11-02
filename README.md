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
| Ilova va bot | Render Web Service | Faolsizlikda uxlaydi, keyingi so'rov 1 daqiqagacha kutadi |
| PostgreSQL | Neon | Bepul reja |
| Rasmlar va CDN | Cloudflare R2 | Chiqish trafigi bepul |

Limitlar va karta talablari o'zgarib turadi, ro'yxatdan o'tishdan oldin har bir servisning narx
sahifasini tekshiring.

1. **Neon:** loyiha yarating, `DATABASE_URL` ni oling (`?sslmode=require` bilan).
2. **R2:** `gallery` bucket yarating. Public development URL yoki o'z domeningizni yoqing, shu manzil
   `MEDIA_BASE_URL` bo'ladi. "Manage API tokens" orqali Object Read & Write kaliti oling.
   `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`.
3. **R2 CORS:** bucket sozlamasida Render manzilingizga `GET` ruxsat bering, aks holda 3D rasmlar
   yuklanmaydi:
   `[{"AllowedOrigins":["https://<app>.onrender.com"],"AllowedMethods":["GET"],"AllowedHeaders":["*"]}]`
4. **Lokal rasmlarni ko'chirish:** `pnpm dev` ni to'xtating, ildizda `.env.production` yarating
   (git'ga kirmaydi) va `pnpm data:push` ni ishga tushiring. Qayta ishga tushirish xavfsiz, bor
   yozuvlar o'tkazib yuboriladi.

   ```
   DATABASE_URL=postgres://...neon.tech/neondb?sslmode=require
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_BUCKET=gallery
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   MEDIA_BASE_URL=https://<r2-public-domain>
   ```
5. **Render:** New > Blueprint, GitHub repozitoriyini va `main` branch'ni tanlang. `render.yaml`
   so'ragan qiymatlarni kiriting. Birinchi deploy'dan keyin `https://<app>.onrender.com` manzilini
   `PUBLIC_URL` va `MINI_APP_URL` ga yozib, qayta deploy qiling.
6. **Telegram:** @BotFather'da `/newapp` bilan Mini App yarating, URL sifatida Render manzilini bering.
   Hosil bo'lgan `https://t.me/<bot>/<app>` havolasini Render'da `VITE_TG_APP_LINK` ga yozib, qayta
   deploy qiling. Botga `/start` yuboring.

Render'ning bepul diski vaqtinchalik, shuning uchun production'da R2 majburiy.

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
