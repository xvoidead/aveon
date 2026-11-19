# авеон на iOS

Нативное приложение (SwiftUI) поверх того же плеера-движка, что и на компьютере.
Движок живёт в WebView (Capacitor), интерфейс нарисован нативно.

## собрать

Без Mac и Xcode — на серверах GitHub: толкни ветку, открой **Actions → ios**,
в job «приложение (симулятор)» внизу есть два артефакта:

- **`aveon-ios-simulator`** — `App.app` для симулятора: запускается в Simulator на Mac,
  на телефон не ставится.
- **`aveon-ios-ipa`** — `aveon-ios-unsigned.ipa`: сборка под настоящий телефон (arm64)
  **без подписи**. Чтобы поставить на iPhone, его надо подписать своим Apple ID:
  бесплатный Apple ID (личная команда) — на 7 дней, платный разработчика — на год.

Лог сборки, если что-то не собралось, — в артефакте `ios-logs`.

На своём Mac:

```bash
npm ci                     # один раз
npm run mobile:build:ios   # веб-часть + cap sync
npm run mobile:ios:build   # и сборка xcodebuild (симулятор)
npm run mobile:ios:ipa     # сборка под телефон без подписи + aveon-ios-unsigned.ipa
```

Чтобы поставить на свой телефон: в Xcode выбери схему `App`, свой iPhone
(потребуется бесплатный Apple ID — Xcode предложит «Manage Signing») и нажми Run.
Скриптом: `npm run mobile:ios:device` — он соберёт без подписи, дальше Xcode
допишет её сам.

### подписать ipa

Скачанный `aveon-ios-unsigned.ipa` ставится на телефон после подписи:

- **Xcode** (Mac): открой `.ipa` как проект? — проще: `unzip`, открой `Payload/App.app`
  в Xcode, в разделе Signing & Capabilities выбери свою команду и нажми Run на своём iPhone.
- **Sideloadly / AltStore / TrollStore** — сторонние программы: открывают `.ipa`,
  подписывают своим Apple ID и ставят на телефон.

Подпись бесплатным Apple ID живёт 7 дней — потом переустановить заново.

## что где

```
mobile/ios/
├── App/App/                    нативный слой (SwiftUI)
│   ├── AveonViewController.swift  контроллер: движок в WebView + SwiftUI поверх, мост window.AveonUI
│   ├── Engine.swift               состояние плеера, библиотеки и панелей; команды движку
│   ├── AveonRootView.swift        вкладки, мини-плеер, тосты, шторки
│   ├── PlayerView.swift           раскрытый плеер: пластинка, перемотка, текст, очередь
│   ├── HomeView / WaveView / LibraryView / ProfileView / FriendsView / AuthView / EqView
│   ├── MirrorView.swift           «зеркало» панелей движка (настройки, рума, будильник)
│   ├── Sheets.swift               визуализатор, итоги года, меню, диалог
│   ├── Kit.swift / Theme.swift    общие детали: обложки, стекло, кнопки, палитра, шрифты
│   ├── Models.swift               разбор JSON движка
│   ├── LocalServer.swift          локальный сервер: веб-часть, /proxy, /_media/*, Range
│   ├── MediaStore.swift           свои файлы: импорт, теги, обложки
│   ├── Vault.swift                шифрование ключом из связки ключей
│   ├── NowPlaying.swift           экран блокировки и пульт
│   ├── CallMonitor.swift          прерывания аудиосессии, смена маршрута
│   └── AveonPlugin.swift          мост с JS (24 метода, те же, что на Android)
├── tools/                     проверки без компилятора
│   ├── check_swift.py         баланс скобок и строк
│   ├── check_symbols.py       члены своих типов, обращения к Engine/Nav, типы в аннотациях
│   └── update_project.py      добавить новый .swift в Xcode-таргет
└── build.sh                   сборка одной командой
```

Новый файл на SwiftUI добавляется в проект так:

```bash
python3 mobile/ios/tools/update_project.py
```

## как устроено

Страница движка живёт на локальном сервере приложения (`http://127.0.0.1:порт`),
поэтому обложки и сам поток отдаются через `/proxy?u=…`: иначе WebKit не даст прочитать
картинку (палитра из обложки) и не отдаст звук в Web Audio (бочка, эквалайзер).
Ровно то же, что на Android делает перехват запросов с CORS-заголовками.
