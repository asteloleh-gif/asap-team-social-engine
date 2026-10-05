# EXTRA OPPORTUNITIES: marketing input

Для объединения инженерным координатором в docs/EXTRA_ROADMAP.md. Статус модулей ниже основан на точках кода, перечисленных в Mission 02; этот маркетинговый поток не подтверждал их работу. Ни новые аккаунты, ни новые расходы, ни другие каналы публикации не включены.

## TOP 3

### 1. Evidence + asset gate перед очередью — NOW

Проблема: красивый готовый файл легко принять за доказательство или незаметно перенести старую дату. Польза: меньше исправлений после публикации и меньше ручного повторного чтения; измерять долю заблокированных реальных ошибок, время review и false-positive holds.

Reuse: threads-bot app/content/* и app/publishing/publishEngine.js + claim_register/first_wave из этого пакета. Уже есть исходные манифесты, SHA, source type и известные holds. Не хватает проверенного исполнения gate и source_checked_at в publish audit.

Первый тест: пропустить G01; отклонить generated cover38 с огромной картой и cover43 с «IS HERE»; разрешить отдельно проверенный SOURCE-38 для критического разбора без ложного заголовка. Качество gate определяется этим тестом, не новым LLM review каждого статуса.

Зависимости: scoped publish queue и resolver существующих файлов. Трудоёмкость: ориентир 0.5–1 инженерного дня после готовой очереди, требуется оценка по фактическому коду. Новый платный сервис не нужен; runtime/storage стоимость unknown. Публикационный путь уже в основном scope, поэтому NOW.

### 2. Один master → три проверяемых payload — NOW

Проблема: вручную переписанный текст теряет source/CTA, а второй publisher создаёт дубли. Польза: быстрее готовить один материал для площадок; измерять время упаковки, pass rate длины/ассетов, duplicate attempts prevented.

Reuse: ContentEnvelope из asteloleh-gif-astel-lazy-distribution через targeted adapter в ASAP Social Engine. Уже есть 10 core IDs и 30 точных текстов. Не хватает подтверждённого соответствия существующему Envelope и версии/hash в едином job state. Distribution упаковывает; единственный Meta publisher — ASAP Publish Engine.

Первый тест: один G01 → 3 dry payload; проверить разные captions, исходный content_id, источник, brand и media requirements; повтор отдаёт тот же hash. Не вызывать preview, пока не доказано отсутствие платного AI/побочных эффектов.

Зависимости: Bearer auth, scope, cost gate, idempotency; только три одобренных repo. Трудоёмкость: ориентир 0.5–1 день для минимальной детерминированной упаковки после review кода. API AI cost должен быть фактически no call, а не assumed zero; hosting unknown. NOW, поскольку убирает ручную работу без нового контентного контура.

### 3. Возрастные метрики + библиотека learning — NEXT

Проблема: lifetime totals и account-level follows выглядят как доказательство эффективности конкретного hook. Польза: решения по сопоставимым данным; измерять coverage 24h/72h, правильность brand mapping, долю unavailable вместо ложных нулей и число повторённых гипотез.

Reuse: threads-bot app/analytics/internalAnalyticsRouter.js и отдельный ASAP binding astel-hyper-crew src/analytics/connectors/socialEngineConnector.js. Уже есть metric contract и predeclared decision rules. Не хватает живых provider mappings, возрастных snapshots и достаточного baseline.

Первый тест: один реально опубликованный G01 записать с post ID и age; прогнать fixture с unavailable follows — conversion должна остаться null; один и тот же provider row через два источника не должен удвоиться. После трёх сопоставимых повторов выбрать следующую серию, а не объявлять универсального победителя.

Зависимости: реальный readback, отдельный analytics binding, доступные permissions. Трудоёмкость: ориентир 1–2 дня после живого publish route; endpoint limits и runtime cost unknown, новые paid services не требуются. NEXT, потому что meaningful learning зависит от публикаций и времени.

## Другие возможности только при доказанной нужде

- NEXT: собрать темы из реальных комментариев собственных ASAP-аккаунтов. Reuse existing polling/owned-media read + event log. Первый тест — 10 обезличенных questions → 3 source-linked draft ideas с ссылкой на исходный comment ID. Не публиковать ответы, не имитировать аудиторию и не считать вопрос из плана настоящим комментарием. Оценка 0.5 дня после доступа; стоимость unknown. Запускать после появления содержательных комментариев.
- LATER: единый read-only Kevin dashboard над queue/errors/metrics/cost. Использовать уже построенные runtime endpoints, без ещё одного источника состояния. Первый тест — оператор за минуту отвечает, что ждёт публикации, где блокер и где null-метрика. Оценка 1–2 дня, hosting unknown. Пока аккуратный JSON/отчёт дешевле и достаточно.
- LATER: YouTube/Pinterest packaging readiness через уже выбранный Distribution. Только оценка/подготовка; текущий scope не разрешает новые публикации там. Не загружать спорный longform voice в новый канал. Проверять пользу лишь после работающего Meta-цикла.

## Не делать сейчас

Новую видеофабрику, Telegram UI, полную crew.start цепь на каждый status, массовый конкурентный мониторинг и монетизационные обещания до данных. Сначала подтвердить десять редакционных единиц, реальные route IDs и один честный learning-cycle.
