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

| Qism | Servis | Bepul limit |
|---|---|---|
| Ilova va bot | Render Web Service | Faolsizlikda uxlaydi, keyingi so'rov 1 daqiqagacha kutadi |
| PostgreSQL | Neon | 0.5 GB |
| Rasmlar va CDN | Cloudflare R2 | 10 GB, chiqish trafigi bepul |
| Xatolar | Sentry | Developer rejasi |

1. Neon'da baza yarating, `DATABASE_URL` ni oling.
2. R2'da bucket yarating, public access yoqing. `S3_ENDPOINT`, `S3_BUCKET`, kalitlarni va
   `MEDIA_BASE_URL=https://<public-domain>` ni oling.
3. Bucket CORS'iga Mini App domenini qo'shing, aks holda 3D teksturalar yuklanmaydi.
4. Render'da `render.yaml` bilan Blueprint yarating, qiymatlarni kiriting. `PUBLIC_URL` va
   `MINI_APP_URL` Render manzili bo'ladi. `VITE_TG_APP_LINK` Docker build argument sifatida beriladi.

Render'ning bepul diski vaqtinchalik, shuning uchun production'da R2 majburiy.

## Buyruqlar

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:generate`.

## Tuzilma

- `apps/server`: Fastify API, grammY bot, Drizzle, rasm pipeline
- `apps/web`: React ilova, `src/scene` ichida Three.js sahna
- `packages/shared`: umumiy tiplar va zod sxemalar

## Litsenziyalar

Mushuk, osmon, sayyoralar va platforma kod bilan yaratilgan, tashqi 3D fayl yoki tekstura ishlatilmagan. Boshlang'ich rasmlar
The Met Open Access dasturidan (CC0).
# image-gallery
