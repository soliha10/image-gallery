const uz = {
  welcome:
    'Xush kelibsiz! Bu sizning shaxsiy galereyangiz: menga rasm yuboring, mushukcha uni yulduzlar orasiga ilib qo‘yadi. Albom uchun bir nechta rasmni birga yuboring, birinchi izoh albom nomi bo‘ladi.',
  open: 'Galereyani ochish',
  menu: 'Galereya',
  added: 'Rasm galereyangizga qo‘shildi.',
  albumAdded: (title: string, count: number) => `«${title}» albomiga ${count} ta rasm qo‘shildi.`,
  newAlbum: 'Yangi albom',
  unsupported: 'Bu format qo‘llab-quvvatlanmaydi. JPEG, PNG, WebP yoki AVIF yuboring.',
  duplicate: 'Bu rasm galereyangizda allaqachon bor.',
  full: (limit: number) => `Galereyangiz to‘ldi: ${limit} ta rasm. Yangisini qo‘shish uchun eskilarini o‘chiring.`,
  tooLarge: 'Rasm 20 MB dan katta. Telegram botlarga bundan katta faylni bermaydi, kichikroq rasm yuboring.',
  failed: 'Rasmni saqlab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.',
}

type BotText = typeof uz

const ru: BotText = {
  welcome:
    'Добро пожаловать! Это ваша личная галерея: присылайте мне фото, и котёнок развесит их среди звёзд. Чтобы создать альбом, отправьте несколько фото сразу, первая подпись станет названием.',
  open: 'Открыть галерею',
  menu: 'Галерея',
  added: 'Фото добавлено в вашу галерею.',
  albumAdded: (title, count) => `В альбом «${title}» добавлено фото: ${count}.`,
  newAlbum: 'Новый альбом',
  unsupported: 'Этот формат не поддерживается. Пришлите JPEG, PNG, WebP или AVIF.',
  duplicate: 'Это фото уже есть в вашей галерее.',
  full: (limit) => `Галерея заполнена: ${limit} фото. Удалите старые, чтобы добавить новые.`,
  tooLarge: 'Фото больше 20 МБ. Telegram не отдаёт ботам файлы больше, пришлите фото поменьше.',
  failed: 'Не удалось сохранить фото. Попробуйте ещё раз чуть позже.',
}

const en: BotText = {
  welcome:
    'Welcome! This is your own gallery: send me photos and the kitten will hang them among the stars. Send several at once to make an album; the first caption becomes its name.',
  open: 'Open gallery',
  menu: 'Gallery',
  added: 'Photo added to your gallery.',
  albumAdded: (title, count) => `Added ${count} photos to “${title}”.`,
  newAlbum: 'New album',
  unsupported: 'This format is not supported. Send JPEG, PNG, WebP or AVIF.',
  duplicate: 'This photo is already in your gallery.',
  full: (limit) => `Your gallery is full: ${limit} photos. Delete older ones to add new photos.`,
  tooLarge: 'The photo is over 20 MB. Telegram does not give bots larger files, so send a smaller one.',
  failed: 'Could not save the photo. Please try again a little later.',
}

/** Replies follow the sender's Telegram language; anything other than Russian or English gets Uzbek. */
export const botText = (language?: string): BotText => (language === 'ru' ? ru : language === 'en' ? en : uz)
