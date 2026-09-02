---
title: Integracja z frameworkami
description: "Mechanika wspólna dla każdego frameworka działającego na Rapirze: pętla workera, stan pojedynczego żądania i stan rezydentny, obsługa błędów, pliki statyczne i OPcache."
---

# Integracja z frameworkami

W trybie klasycznym aplikacja frameworkowa działa na Rapirze bez żadnych zmian: wskazujesz serwerowi front controller, który już masz. W trybie workera proces PHP zostaje przy życiu między żądaniami, a to, co aplikacja może utrzymać rezydentnie, zależy od budowy samego frameworka. Ta strona opisuje mechanikę, która wygląda tak samo w każdym frameworku; trzy przewodniki po poszczególnych frameworkach zakładają, że masz ją już za sobą, i opisują wyłącznie to, co swoiste dla nich.

::: info Sprawdzone na

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** i **8.1.2**, **Yii3** szablon aplikacji 1.4 (yii-runner-http 3.2.1)

Wszystko, co znajdziesz na tej stronie, zostało zaobserwowane na tych aplikacjach uruchomionych na Linuksie, na jednym procesie workera. Stwierdzenia o zachowaniu frameworków opierają się na tych przebiegach. Klucze konfiguracyjne pochodzą z własnego opisu [konfiguracji](/pl/docs/configuration) Rapiry.
:::

## Tryb klasyczny i tryb workera

**W trybie klasycznym nie zmienia się nic.** Skryptem wejściowym jest twój front controller, Rapira wykonuje go od zera przy każdym żądaniu i działa tu każdy framework, który działa pod php-fpm, łącznie z tymi, których stan nigdy nie przeżyłby drugiego żądania. Więcej znajdziesz na stronie [tryb klasyczny](/pl/docs/classic); z sekcji poniżej dotyczą go tylko pliki statyczne, TLS i OPcache.

**W trybie Worker proces zostaje przy życiu.** Twój skrypt raz podnosi aplikację, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie. Framework przestaje być rozbierany między żądaniami. Gdzie ten tryb stoi wśród trzech, pokazują [tryby wykonania](/pl/docs/execution-modes), a jego API opisuje [tryb workera](/pl/docs/worker).

Jedna baza kodu działa w obu trybach: zostaw `public/index.php` takim, jaki jest, i dołóż obok `worker.php`. Sprawdzone aplikacje Symfony i Yii3 trzymają oba pliki obok siebie, a o tym, który się uruchomi, decyduje flaga `--mode`: `rapira serve --mode classic public/index.php` albo `rapira serve --mode worker worker.php`. Na czas migracji tryb klasyczny zostaje więc pod ręką jako droga odwrotu.

## Pętla linijka po linijce

Każdy skrypt workera ma ten sam kształt, niezależnie od tego, jaki framework siedzi w środku:

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Czytając od góry:

- **`require .../vendor/autoload.php`** — autoloader rejestruje się raz na całe życie workera, a każda klasa, którą rozwiąże, zostaje potem załadowana.
- **`$app = new App();`** — tutaj aplikacja podnosi się raz, jeszcze zanim ruszy pętla. To w tej linii rozchodzą się dwa przewodniki po trybie workera: Symfony trzyma tu rezydentny kernel, a Yii3 albo trzyma tu rezydentny runner, albo buduje go w środku handlera — i każdy przewodnik dokłada własny rozruch nad pętlą i własne sprzątanie po każdym żądaniu w handlerze.
- **`$handler = static function () use ($app): void`** — handler nie przyjmuje żadnych argumentów. Żądanie siedzi w superglobalach, a wszystko inne, czego potrzebuje, przechwytuje przez `use`.
- **`header()`, `http_response_code()`, `echo`** — odpowiedź tworzysz dokładnie tak samo jak w klasycznym skrypcie. Jak to zamienia się w bajty lecące po sieci, opisuje [HTTP](/pl/docs/http).
- **`while (\Rapira\handle_request($handler))`** - `handle_request()` blokuje wykonanie, dopóki nie przyjdzie żądanie. Wypełnia nim superglobale, uruchamia twój handler, zamyka żądanie i zwraca `true`. Zwraca `false`, gdy worker zaczyna się wygaszać, i tak właśnie kończy się pętla. Wywołuj ją wyłącznie na najwyższym poziomie skryptu rozruchowego. Poza trybem Worker rzuca `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** — ciało pętli wykonuje się *między* żądaniami i to tam trafia praca, która ma się wydarzyć w przewidywalnym momencie, a nie w trakcie samego żądania. Wywołanie zbiera zwykłe cykle referencji i nie jest sposobem na rosnące zużycie pamięci — zobacz [Pamięć i recykling](#pamiec-i-recykling).

Skryptem wejściowym jest `worker.php`, więc `SCRIPT_NAME` to `/worker.php`, `DOCUMENT_ROOT` to katalog, w którym ten plik leży, a ścieżkę, o którą naprawdę poprosił klient, niesie `REQUEST_URI`. Zarówno Symfony, jak i Yii3 trasowały i generowały adresy URL na tej podstawie poprawnie — bez `worker.php` w wygenerowanych adresach i bez najmniejszego łatania `$_SERVER`. Framework, który buduje adresy URL na podstawie `SCRIPT_NAME`, a nie `REQUEST_URI`, to pierwszy przypadek do sprawdzenia.

## Stan pojedynczego żądania i stan rezydentny

Wszystko z lewej kolumny Rapira odbudowuje przy każdym żądaniu, więc zwykły kod PHP, który stamtąd czyta, działa dalej. Wszystko z prawej kolumny trwa tak długo jak sam worker i musi tym zarządzać skrypt workera.

| Świeże przy każdym żądaniu | Przeżywa każde żądanie |
| -------------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — wypełnione na nowo danymi tego żądania | Autoloader Composera i każda klasa już przez niego wczytana |
| `php://input` — surowa treść tego żądania, a obok niej `CONTENT_TYPE` i `CONTENT_LENGTH` | Właściwości i zmienne `static`, które liczą dalej przez kolejne żądania |
| `$_FILES` i stojące za nim tymczasowe pliki wysłane przez klienta | Obiekty utworzone przed pętlą — kontener, kernel, twoja aplikacja |
| Obsługa sesji: `session_start()`, ciasteczko na wejściu, `Set-Cookie` na wyjściu | Otwarte zasoby: uchwyty do bazy, klienty cache'a, strumienie |
| Stan odpowiedzi: kod statusu, nagłówki, `setcookie()`, bufory wyjścia | Sam proces — ten sam pid, jeden rezydentny interpreter PHP na workera |
| Funkcje shutdown zarejestrowane **wewnątrz** handlera | Własne liczniki workera: `handled` i `errors` zwiększają się dalej |
| Zegar `max_execution_time`, uzbrajany na nowo przy każdym żądaniu | |

Na Linuksie (i na FreeBSD), gdzie zendowy licznik czasu żądania w ogóle istnieje, zegar `max_execution_time` jest uzbrajany na nowo przy każdym żądaniu, a czas, który worker spędza zaparkowany w oczekiwaniu na kolejne, nigdy się do niego nie wlicza — na zegarze tyka wyłącznie samo żądanie. Wszędzie indziej, macOS w to wliczając, żaden limit czasu żądania nie jest uzbrajany w ogóle.

Trzy opisane niżej zachowania są cechą rezydentnego PHP, a nie Rapiry. Wszystkie trzy są sprawdzone i wszystkie trzy pojawiają się na etapie rozruchu.

::: warning Destruktor rezydentnego obiektu odpala się na końcu pierwszego żądania

Daj obiektowi utworzonemu *poza* pętlą `__destruct` napisany w PHP, a ten się wykona — raz, na końcu **pierwszego** żądania, kiedy PHP przy zamykaniu żądania przechodzi po swoim magazynie obiektów. Samemu obiektowi nic się przy tym nie dzieje: dalej jest obiektem, metody dalej można wywoływać, a destruktor już nigdy się nie odpali — ani przy kolejnych żądaniach, ani przy zamykaniu workera.

Klasa, która w destruktorze zamyka uchwyt, opróżnia bufor albo dopisuje pożegnalną linię do logu, zrobi to więc raz, na końcu pierwszego żądania, i nigdy więcej przez całe życie procesu. Ze wszystkiego, co trzymasz rezydentnie, wynieś sprzątanie poza destruktor.
:::

::: warning `register_shutdown_function()` w rozruchu odpala się raz i nigdy więcej

Wywołana poza handlerem, funkcja zwrotna wykona się na końcu pierwszego żądania i zostanie zwolniona; żadne późniejsze żądanie już jej nie uruchomi. Zarejestrowana *wewnątrz* handlera zachowuje się dokładnie tak jak pod php-fpm: wykonuje się na końcu tego żądania, i tak przy każdym.

Jeśli twój rozruch instaluje handler shutdown — żeby wypchnąć metryki, złapać błąd krytyczny albo coś domknąć — zarejestruj go zamiast tego w środku handlera, przy każdym obrocie pętli.
:::

::: warning `$_ENV` po cichu importuje się na nowo w środku żądania

Przy domyślnych ustawieniach ini (`variables_order = "GPCS"`, `auto_globals_jit = On`) PHP przy każdym żądaniu uzbraja na nowo flagę JIT dla `$_ENV`. Pierwszy skompilowany w trakcie tego żądania plik, w którym pada `$_ENV`, każe PHP odbudować superglobal — a skoro w `variables_order` nie ma `E`, nie ma czego importować, więc `$_ENV` wraca **puste**: wszystko, co rozruch w stylu Dotenva wpisał do niego przy starcie workera, przepada w środku żądania, a PHP nie zgłasza przy tym niczego.

Efekt zależy od tego, *kiedy* dany plik zostanie skompilowany. Konfiguracja, którą framework rozwiązuje zachłannie już podczas rozruchu, siedzi w cache'u i działa poprawnie; to, co rozwiązuje się leniwie, przy pierwszym żądaniu, czyta `$_ENV` opróżnione chwilę wcześniej. Dokładnie z tego powodu ta sama aplikacja w jednym środowisku działa, a w drugim odpowiada `500` na każde żądanie.

Obejścia są dwa. Pierwsze jest sprawdzone: niech rozruch zapisze te wartości również do prawdziwego środowiska — `putenv()` przeżywa ponowny import, a framework, który spada z powrotem na `getenv()`, wtedy je znajdzie. Na produkcji wybieraj drugie: ustaw prawdziwe zmienne środowiskowe w jednostce usługi albo w kontenerze i przestań parsować `.env` w czasie działania. Żadne z nich nie wstawia niczego z powrotem do `$_ENV` — pod `GPCS` zostaje ono puste bez względu na to, skąd wzięło się środowisko, a wartości widzi `getenv()`. Konkretną awarię i jednolinijkową poprawkę pokazuje [przewodnik po Symfony](/pl/docs/frameworks/symfony).

Trafia na to każde środowisko uruchomieniowe PHP, które trzyma proces przy życiu między żądaniami.
:::

## Obsługa błędów

Trzy rodzaje awarii, wszystkie obejrzane na jednym workerze z pilnowanym pidem:

- **`exit` albo `die` w handlerze** — odpowiedź trafia do klienta razem ze statusem i tym, co zdążyło powstać z treści, a worker obsługuje dalej. Frameworki robią tak w normalnej pracy — na przykład sprawdzenie trybu konserwacji kończy żądanie przez `exit` — i dla procesu nie jest to zabójcze.
- **Nieprzechwycony wyjątek** — `500`. Jeśli złapie go najpierw handler błędów twojego frameworka, narysuje własną stronę błędu; jeśli nie złapie go nic, Rapira odpowiada `500` z pustą treścią. Tak czy inaczej worker obsługuje dalej.
- **Nieprzechwycony `Error`** — na przykład wywołanie funkcji, która nie istnieje. PHP zapisuje to w logu jako `Uncaught Error`, a dalej idzie tą samą drogą co każdy inny nieprzechwycony throwable — `500`, i worker obsługuje dalej na tym samym pidzie.

Licznik `errors` workera rośnie przy obu wariantach błędu; żądanie z `exit` to zwykłe `200` i rusza wyłącznie `handled`. We wszystkich trzech przypadkach `recycles` i `restarts` zostają na zerze: nieprzechwycony throwable nie kładzie workera i nie dotyka następnego żądania. Więcej dzieje się tylko przy błędzie krytycznym klasy bailout — zwija on rezydentny skrypt, więc worker uruchamia go od góry i jeszcze raz podnosi twoją aplikację, a właśnie to zlicza `recycles`. Te liczniki dla każdego workera wypisuje zrzut stanu opisany na stronie [model procesów](/pl/docs/process-model).

## Pliki statyczne

Zasoby statyczne Rapira serwuje przez [middleware plików statycznych](/pl/docs/static-files). Ustaw `root` w sekcji `[http.static]` na katalog `public/` frameworka i wypisz middleware w `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

Middleware odpowiada na żądanie tylko wtedy, gdy ścieżka trafia w plik leżący w tym katalogu. Domyślna lista `forbid` trzyma poza nim pliki `.php`, więc front controller z `public/` nigdy nie zostanie oddany jako plik. Każdy inny adres URL uruchamia skrypt wejściowy, tak samo w trybie Classic, jak i w trybie Worker. `$_SERVER['REQUEST_URI']` mówi aplikacji, dokąd chciał trafić klient. Adres wskazujący katalog też uruchamia skrypt wejściowy, bo middleware nie serwuje dla niego żadnego pliku indeksu.

Zasoby może zamiast tego serwować CDN albo reverse proxy stojące z przodu. Takie proxy stawia [wdrożenie produkcyjne](/pl/docs/deployment).

## TLS i proxy

Nasłuch Rapiry mówi nieszyfrowanym HTTP, a w konfiguracji nie ma żadnej sekcji od TLS-a. Zakończ TLS na proxy, które i tak już masz, i pozwól mu dobić do Rapiry po loopbacku albo po unixowym gnieździe. Proxy musi zapisywać przekazywane pola z `-`, nigdy z `_`, bo obie pisownie schodzą się pod tym samym kluczem `$_SERVER`. To mapowanie wyjaśnia [HTTP](/pl/docs/http), a konfigurację proxy — [wdrożenie produkcyjne](/pl/docs/deployment).

## Pamięć i recykling

Worker, który odbudowuje aplikację wewnątrz handlera — prostszy z dwóch wariantów Yii3 — trzyma rezydentnie mniej niż kernel w stylu Symfony, ale więcej niż tryb klasyczny, a pętla leży w twoim własnym skrypcie, więc pracę da się kawałek po kawałku wynosić poza handler w miarę tego, jak sprawdzasz, co przetrwa drugie żądanie. Czego ten wariant nie daje, to kontenera zbudowanego już w chwili, gdy przychodzi żądanie.

W tym wariancie każde żądanie zostawia po sobie porzucony graf obiektów. PHP nie zwalnia ich po kolei. Spinają je cykle referencji, więc sterta rośnie żądanie po żądaniu, aż odpali się kolektor cykli i zabierze naraz dużą partię: to piłokształtny wykres, a nie wyciek — tyle że jego szczyty leżą sporo wyżej niż ślad pamięciowy pojedynczego żądania.

Samodzielne wywołanie `gc_collect_cycles()` tego nie wypłaszcza — sprawdzone, i w pętli, i w środku handlera. Stare grafy pozostają silnie referencjonowane, dopóki nie zwolni ich kolejny rozruch, więc kolektor nie ma jeszcze czego zabrać. Wynikają z tego dwie rzeczy. Daj `memory_limit` realny zapas, bo zmieścić musi się szczyt, a nie średnia. I ustaw budżet na recykling:

```toml
[pool]
max_requests = 100
```

Po tylu żądaniach worker kończy pracę (plus niewielki rozrzut, żeby pula nie wymieniała się równym krokiem), a proces nadrzędny forkuje następcę startującego ze świeżą stertą. Sprawdzone na setkach kolejnych żądań, przez kilka wymian: workery się rotują, pamięć zeruje się przy każdym cyklu, a ani jedno żądanie nie zostało zgubione ani nie dostało odpowiedzi innej niż `200`. To deterministyczna granica dla profilu pamięciowego, który w innym razie zostaje w całości po stronie kolektora.

Warianty rezydentne — kernel Symfony, kontener Yii3 za `StateResetter` — są przy tym płaskie: w tych samych przebiegach pamięć trzymała poziom. Recykling trzymaj włączony również dla nich, jako zabezpieczenie. Klucz opisuje [konfiguracja](/pl/docs/configuration), a to, co recykling robi z pulą — [model procesów](/pl/docs/process-model).

## OPcache i zmieniony kod

Rapira uruchamia PHP dokładnie raz, w procesie nadrzędnym, zanim sforkuje choćby jednego workera — dzięki temu OPcache tworzy swój segment pamięci współdzielonej jeden jedyny raz, a każdy worker dziedziczy to samo mapowanie. Skompilowane skrypty zostają rozgrzane między żądaniami *i* w obrębie całej puli, w obu trybach. Worker, który ponownie dołącza pliki twojego frameworka, nie parsuje ich od nowa.

Na produkcji `opcache.validate_timestamps = 0` zdejmuje `stat` na każdym pliku przy każdym żądaniu. Cena jest taka, że nic już nie unieważnia cache'u: segment należy do procesu nadrzędnego i przeżywa każde pokolenie workerów, więc przeładowanie kroczące dalej serwowałoby stare opcode'y, a wdrożenie wymaga pełnego restartu. Kolejność kroków opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

Przy pracy nad kodem ten sam efekt ma inną przyczynę. Rezydentny rozruch nigdy nie czyta ponownie kodu wczytanego przy starcie, cokolwiek robi OPcache: zmiany w serwisie, który kontener już zbudował, albo w samym skrypcie workera, nie docierają do działającego procesu. Restartuj po każdej zmianie — `rapira serve` działa na pierwszym planie i nigdy nie ucieka w tło, więc wystarczy Ctrl-C i uruchomienie od nowa.

## Przewodniki po frameworkach

- **[Symfony](/pl/docs/frameworks/symfony)** — kernel podnosi się raz i zostaje rezydentny, a własny `services_resetter` frameworka przywraca między żądaniami usługi ze stanem do postaci, w jakiej je zastał. Jeden plik workera obsługuje 7.4 i 8.1, bajt w bajt.
- **[Laravel](/pl/docs/frameworks/laravel)** — tryb klasyczny: standardowy `public/index.php` działa bez zmian. Tryb workera dla Laravela jest w opracowaniu — rezydentna aplikacja Laravela potrzebuje takiego przywracania stanu, jakie realizuje Octane, a Rapira nie ma jeszcze sterownika do Octane'a.
- **[Yii3](/pl/docs/frameworks/yii3)** — rezydentny kontener zerowany przy każdym żądaniu przez `StateResetter`, czyli własny pomysł Yii3 na długo żyjące procesy (jego runner do RoadRunnera ma ten sam kształt), albo prostszy wariant ze świeżym runnerem na każde żądanie, jeśli wolisz zacząć od niego.

Framework, którego nie opisuje żaden z tych przewodników, uruchamia się tym samym skryptem workera, a o tym, czy zadziała w trybie workera, decyduje to, czy aplikacja obsłuży drugie żądanie w tym samym procesie. Zacznij od wariantu, w którym aplikacja jest odbudowywana wewnątrz handlera, bo nie wymaga on od frameworka niczego; wariantem docelowym jest rezydentna aplikacja z resetem stanu przy każdym żądaniu. Jeśli żaden z tych dwóch nie działa, [tryb klasyczny](/pl/docs/classic) uruchomi aplikację bez zmian.
