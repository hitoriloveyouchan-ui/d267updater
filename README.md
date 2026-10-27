<div align="center">

<img src="docs/banner.svg" alt="D2Changer" width="100%">

# D2Changer

**Dota2 OpenSource SkinChanger**

[![Release](https://img.shields.io/github/v/release/ryuson3/d267updater?style=for-the-badge&color=2f7fd6)](https://github.com/ryuson3/d267updater/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ryuson3/d267updater/total?style=for-the-badge&color=2f7fd6)](https://github.com/ryuson3/d267updater/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-2f7fd6?style=for-the-badge)](#лицензия)

[**⬇ Скачать**](https://github.com/ryuson3/d267updater/releases/latest) · [Возможности](#возможности) · [Скриншоты](#скриншоты) · [Установка](#установка)

</div>

---

## Возможности

- **Косметика** - бесплатные слоты: курьер, вард, погода, загрузочный экран, анонсер и другие
- **Предметы героев** - наборы, стили, арканы, эффекты, камни Kinetic Gem
- **Эмблемы** - со своими эффектами атаки
- **Перекраска эффектов** - свой цвет гема (например, аркана Terrorblade)
- **Иконки способностей** - подмена картинок способностей
- **3D-превью** - героя с надетыми предметами
- **Пресеты** - сохраняй и меняй наборы одним кликом
- **Автообновление** - новые версии ставятся сами

## D2Changer

<div align="center">

<img src="docs/intro.webp" alt="D2Changer" width="800">

</div>

## Скриншоты

<div align="center">

| Список героев | Слоты героя |
|:---:|:---:|
| <img src="docs/screenshots/heroes.png" width="420"> | <img src="docs/screenshots/slots.png" width="420"> |

| Инвентарь и пресеты | Результат в игре |
|:---:|:---:|
| <img src="docs/screenshots/inventory.png" width="420"> | <img src="docs/screenshots/ingame.png" width="420"> |

</div>

## Установка

1. Открой страницу [Releases](https://github.com/ryuson3/d267updater/releases/latest).
2. Скачай `DotaModLauncher-Setup-….exe` (с автообновлением) или `DotaModLauncher-Portable-….exe` (без установки).
3. Запусти. Папка игры найдётся сама, если не нашлась — укажи `…\dota 2 beta\game`.
4. Выбери косметику и нажми **«Применить косметику»**, потом **«Играть»**.

> Portable-версия сама не обновляется: показывает ссылку на новый релиз.

## Сборка из исходников

```bash
npm install
npm start          # запуск
npm run dist       # сборка установщика и portable
```

## Благодарности

Окно «Косметика» собрано на коде [Dota 2 Mod Manager](https://github.com/TheFleece) (© 2026 TheFleece). Это изменённая версия.
## Лицензия

GPL-3.0-or-later. Приложение не связано с Valve.
