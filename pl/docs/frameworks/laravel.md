---
title: Laravel
description: Laravel na Rapirze — świeża aplikacja przy każdym żądaniu wewnątrz rezydentnego workera, wynikające z tego zachowanie pamięci i aktualny stan wsparcia dla Octane.
---

# Laravel

Rapira uruchamia Laravela, a robi to tak, że **przy każdym żądaniu buduje świeżą aplikację wewnątrz procesu PHP, który żyje dalej między żądaniami**. To celowo wąska obietnica: rezydentny zostaje worker, nie framework.

::: info Zweryfikowano na
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.6.0**
- szkielet **laravel/laravel** z **laravel/framework v13.23.0**

Wszystko, co jest na tej stronie, sprawdziliśmy na szkielecie `laravel/laravel` z dorzuconą garstką testowych tras, na jednym workerze: trasowanie, sesje, przesyłanie plików, treści JSON i formularzy, cache konfiguracji i tras, odpowiedzi błędów oraz kilkaset kolejnych żądań przechodzących przez kilka wymian workera.
:::

## Dlaczego aplikacja powstaje od nowa przy każdym żądaniu

Kontener Laravela nie jest zaprojektowany tak, żeby bez pomocy przetrwać drugie żądanie. Powiązania zostają rozwiązane, singletony zapamiętują bieżące żądanie, statyczne pola samego frameworka zapełniają się w trakcie obsługi — i ktoś musi to wszystko rozplątać, zanim przyjdzie kolejne żądanie. Robi to **Octane**. Rapira nie ma dziś sterownika dla Octane, a ten przewodnik go nie zastępuje. Daje ci za to wzorzec, który naprawdę został sprawdzony: podnieś framework w handlerze, odpowiedz na żądanie, wyrzuć aplikację.

I tak wychodzisz na tym lepiej niż na php-fpm — po prostu mniej, niż dałby ci rezydentny kontener:

- **Zero skoku przez FastCGI.** PHP jest osadzony w procesie Rapiry, a serwer woła interpreter wprost — bez gniazda, bez protokołu i bez drugiego demona, któremu trzeba przekazać żądanie; worker, który odpowiada, jest tym samym procesem, co trzyma interpreter.
- **Proces żyje długo.** Twój skrypt workera wykonuje się raz. Autoloader Composera i jego mapa klas rejestrują się raz, przy starcie, a nie od nowa przy każdym żądaniu, jak to robi front controller.
- **OPcache jest rozgrzany i wspólny.** PHP startuje raz, w procesie nadrzędnym, jeszcze zanim powstanie pierwszy worker, więc wszystkie workery dziedziczą ten sam cache skompilowanych skryptów — twój kod i całe drzewo `vendor/`. Pliki z `config:cache` i `route:cache` też kompilują się tylko raz, więc wykonywanie ich przy każdym żądaniu nie kosztuje ponownego parsowania. Obie komendy cache'ujące artisana sprawdziliśmy w tym wzorcu — działają.

Jeśli taki układ ci nie odpowiada, [alternatywa w postaci trybu klasycznego](#alternatywa-tryb-klasyczny) z dołu tej strony nie wymaga skryptu workera w ogóle.

## Zanim zaczniesz

Potrzebujesz zainstalowanej Rapiry — patrz [Instalacja](/pl/docs/installation) — i aplikacji Laravel, którą już potrafisz uruchomić. Potrzebujesz też zwykłego PHP CLI na maszynie: to przez niego uruchamiasz Composera i `artisan`. Rapira dostarcza PHP jako bibliotekę (`libphp`), a nie jako polecenie `php`, więc te kroki wykonują się na systemowym PHP, którego Rapira ani nie używa, ani nie rusza.

Jedno warto sprawdzić przed pierwszym startem: świeży szkielet `laravel/laravel` domyślnie sięga po bazę SQLite oraz po sterowniki sesji, cache'u i kolejek oparte na bazie, a to znaczy, że potrzebuje `pdo_sqlite`. PHP dołączone do wydań Rapiry je ma: PDO, `pdo_sqlite` i `sqlite3` są w zestawie rozszerzeń wydanej binarki, wypisanym na stronie [Instalacja](/pl/docs/installation). Jeśli uruchamiasz Rapirę na własnoręcznie skompilowanym PHP, dopilnuj tych rozszerzeń w linii `configure` (opisuje to [Budowanie ze źródeł](/pl/docs/build-from-source)) albo pójdź ścieżką bez bazy i przestaw Laravela na sterowniki plikowe i synchroniczne — `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. Właśnie na takim zestawie działała weryfikacja opisana na tej stronie.

## Skrypt workera

Wrzuć ten plik do katalogu głównego aplikacji, obok `composer.json` — wszystkie ścieżki w środku liczą się względem `__DIR__`, więc musi leżeć tam, gdzie `vendor/`, `bootstrap/` i `storage/`:

```php
<?php

declare(strict_types=1);

use Illuminate\Http\Request;
use Rapira\Plugin\Http\HttpHandlerConfig;

use function Rapira\create_plugin_handler;

define('LARAVEL_START', microtime(true));

// Resident: the autoloader and opcache-compiled classes stay warm.
require __DIR__ . '/vendor/autoload.php';

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function (): void {
    if (file_exists($maintenance = __DIR__ . '/storage/framework/maintenance.php')) {
        require $maintenance;
    }

    // A fresh application per request. `require`, not `require_once`:
    // bootstrap/app.php must run again for every request.
    $app = require __DIR__ . '/bootstrap/app.php';
    $app->handleRequest(Request::capture());
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Czytany od góry to `public/index.php` przecięty na pół: to, co da się zrobić raz, ląduje nad pętlą, a reszta trafia do handlera:

- **`LARAVEL_START`** definiujemy dokładnie tam, gdzie robi to fabryczny front controller: przed wszystkim innym. Stała obowiązuje w całym procesie, więc jej miejsce jest nad pętlą — a to znaczy, że od teraz wyznacza start *workera*, a nie żądania. Każdy pomiar w stylu `microtime(true) - LARAVEL_START` pokaże więc czas życia workera, rosnący aż do jego wymiany; własny znacznik czasu dla żądania załóż w handlerze.
- **Autoloader ładujemy raz**, poza handlerem, i to jest cały rezydentny stan, jaki ten wzorzec naprawdę zachowuje. Wszystko poniżej to praca na potrzeby jednego żądania.
- **Sprawdzenie trybu konserwacji siedzi w handlerze**, bo `php artisan down` można wywołać w dowolnym momencie życia workera, a sprawdzenie musi się odbyć przy każdym żądaniu. Wygenerowany `storage/framework/maintenance.php` kończy żądanie przez `exit` i jest to tutaj bezpieczne: `exit` w handlerze wypycha odpowiedź do klienta, a worker obsługuje dalej — sprawdzone, i taka jest ogólna zasada w [trybie workera](/pl/docs/worker).
- **`$app = require __DIR__ . '/bootstrap/app.php'`** to świeża aplikacja, zbudowana wyłącznie na potrzeby tego żądania.
- **`$app->handleRequest(Request::capture())`** to gotowy jednolinijkowiec Laravela: obsługuje żądanie, odsyła odpowiedź i uruchamia `terminate()` — razem z middleware'ami i domykającymi callbackami. Nie kończy skryptu, więc sterowanie wraca do pętli.
- **`gc_collect_cycles()` w pętli** to kanoniczny kształt pętli w Rapirze: cykle referencji znikają między żądaniami, a nie w środku obsługi któregoś z nich. Zostaw to wywołanie — ale nie licz na to, że rozwiąże zachowanie pamięci opisane w następnej sekcji. Nie rozwiąże.

::: warning `require`, nie `require_once`
To jedyna linia, której nie wolno pomylić. `require_once` od drugiego żądania zwraca `true` zamiast instancji `Application`, więc każde żądanie po pierwszym się sypie. Fabryczny `public/index.php` używa `require_once` i słusznie — tam ten kod i tak wykonuje się raz na proces. W workerze `bootstrap/app.php` musi wykonać się na nowo przy każdym żądaniu.
:::

## Pamięć i przebieg piłokształtny

Skoro przy każdym żądaniu budujesz aplikację od nowa, to przy każdym żądaniu jedną wyrzucasz — a wykres pamięci, który z tego wychodzi (przebieg piłokształtny, a nie wyciek, i to taki, którego `gc_collect_cycles()` nie spłaszczy), opisuje w całości [przegląd frameworków](/pl/docs/frameworks/). To wywołanie zostaje w pętli na tej stronie dlatego, że dobrze robi reszcie twoich śmieci, a nie dlatego, że cokolwiek tu naprawia.

Dwie rzeczy nie są w przypadku Laravela opcjonalne. Daj `memory_limit` porządny zapas, bo zmieścić musi się szczyt tego przebiegu, a domyślna wartość PHP jest na ten wzorzec za ciasna. I ustaw `pool.max_requests = 100`. To recykling ogranicza ten wzrost; przy kilkuset kolejnych żądaniach obejmujących kilka wymian workera przebiegał zupełnie niezauważalnie, więc dla Laravela na Rapirze traktuj ten klucz jako zalecane ustawienie produkcyjne, a nie optymalizację na później.

::: warning Nie wywołuj `HandleExceptions::flushState()`
Wygląda na oczywiste wywołanie sprzątające, a pod Rapirą kładzie ci workera. `Illuminate\Foundation\Bootstrap\HandleExceptions::flushState()` traktuje osobno handler błędów PHPUnita i przy zainstalowanym `phpunit` — czyli w każdym szkielecie, bo to domyślna zależność deweloperska — rzuca wyjątkiem (`PHPUnit\TextUI\Configuration\Registry::get(): … null returned`). Wywołane w ciele pętli, między żądaniami — czyli tam, gdzie każą je wstawiać przepisy na inne serwery — wylatuje poza pętlę: skrypt workera umiera, Rapira uznaje workera za niesprawnego, a klienci dostają `503`. Sprawdzone na własnej skórze. Po prostu tego nie wywołuj.
:::

## Jak to uruchomić

`rapira serve` domyślnie startuje w trybie workera, więc całe polecenie sprowadza się do wskazania skryptu:

::: code-group

```bash [CLI]
rapira serve worker.php
```

```toml [rapira.toml]
[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 100

[http]
listen = "127.0.0.1:8000"
```

:::

Z plikiem konfiguracyjnym polecenie brzmi `rapira serve --config rapira.toml`, a względny `entrypoint` liczy się względem katalogu samego pliku konfiguracyjnego. `max_requests` to klucz z sekcji powyżej — wszystkie klucze i ich wartości domyślne znajdziesz w [Konfiguracji](/pl/docs/configuration).

Na produkcję zbuduj najpierw cache frameworka. Oba polecenia sprawdziliśmy pod tym workerem, a aplikację przetestowaliśmy bez cache'u i z cache'em — ta sama bateria testów przechodziła tak samo:

```bash
php artisan config:cache
php artisan route:cache
```

Te pliki i tak czytane są przy każdym żądaniu, jak reszta rozruchu — OPcache oszczędza ci parsowania, nie wykonania. Po wdrożeniu i tak uruchom oba polecenia ponownie i przeładuj pulę, bo autoloadera i segmentu OPcache działający worker już nie przeczyta od nowa; przeładowanie to sygnał do procesu nadrzędnego ([Model procesów](/pl/docs/process-model)), a cały kształt wdrożenia wokół tego — razem z plikami statycznymi, TLS-em i tym, po co przed Rapirą stawiać reverse proxy — opisuje [przegląd frameworków](/pl/docs/frameworks/).

## Trasy i adresy URL

Rapira dla każdego adresu uruchamia ten sam skrypt wejściowy, więc pod tym workerem `$_SERVER['SCRIPT_NAME']` to `/worker.php`, a nie `/index.php`. Nie ma to wpływu na Laravela: trasowanie rozwiązuje ścieżki poprawnie, niedopasowane ścieżki dostają własną stronę 404 Laravela, a `url()` generuje czyste adresy bezwzględne — schemat, host i ścieżka, bez śladu `worker.php`. **Nie musisz nadpisywać niczego w `$_SERVER` ani zmieniać konfiguracji tras czy adresów**; sprawdziliśmy to osobno, bo to pierwsza rzecz, która psuje się na serwerach mapujących adresy na pliki.

Wbudowana w szkielet trasa `/up` odpowiada jak zwykle kodem `200`, więc naturalnie nadaje się na health check dla load balancera albo kontenera.

## Sesje, CSRF i formularze

Sesje działają w obrębie żądania — sprawdzone na sterowniku plikowym: ciasteczko sesji wychodzi, wraca przy następnym żądaniu, a każdy klient dostaje własną sesję. Przy sterowniku bazodanowym trzeba najpierw rozwiązać sprawę rozszerzeń PDO z sekcji o wymaganiach, ale w samym wyborze sterownika nie ma niczego charakterystycznego dla Rapiry.

**W CSRF nie ma niczego charakterystycznego dla Rapiry.** Token siedzi w sesji, a sesje sprawdziliśmy — działają w obrębie żądania, więc formularz działający pod php-fpm nie ma żadnego związanego z Rapirą powodu, żeby przestać. Nie musisz niczego wykluczać, wyłączać ani przestawiać pod workera. (Testowe trasy z weryfikacji wysyłają POST bez tokenu i właśnie dlatego wyłączyliśmy je z ochrony CSRF, więc pełny obieg tokenu jest wywnioskowany z wyniku dla sesji, a nie zmierzony.)

Wysyłkę formularzy, treści żądań w JSON-ie i przesyłanie plików sprawdziliśmy przez tego samego workera. A kiedy trasa rzuci wyjątkiem, handler wyjątków Laravela renderuje swoją zwykłą `500` — awaria zostaje w obrębie żądania, a worker obsługuje kolejne.

## Alternatywa: tryb klasyczny

Wolisz w ogóle nie utrzymywać skryptu workera? Nie utrzymuj:

```bash
rapira serve --classic public/index.php
```

To wariant bez żadnych zmian. Rapira wykonuje twój dotychczasowy front controller od zera przy każdym żądaniu, w stylu php-fpm, a aplikacja nie ma jak zauważyć różnicy. Rezygnujesz z rezydentnego procesu — autoloader rejestruje się od nowa przy każdym żądaniu, dokładnie jak dziś — a zostaje ci zamiennik php-fpm bez zmian w kodzie i wspólny OPcache. Całą rzecz opisuje [Tryb klasyczny](/pl/docs/classic), a o tym, gdzie oba szczeble stoją na drabinie, mówią [Tryby wykonania](/pl/docs/execution-modes).

::: question Kiedy Rapira będzie wspierać Octane?
Sterownika dla Octane dziś nie ma i nie ma też w zamian nic półdziałającego. Blokadą nie jest szczebel — Symfony i Yii3 trzymają aplikację rezydentnie na tym samym szczeblu SAPI Worker, na którym działa tutaj Laravel (co znaczą poszczególne szczeble, tłumaczą [Tryby wykonania](/pl/docs/execution-modes)). Laravelowi brakuje tego, co robi Octane: rozplątywania stanu między żądaniami — a to sterownik, który ktoś musi napisać. Do tego czasu sprawdzonym rozwiązaniem jest świeża aplikacja przy każdym żądaniu wewnątrz rezydentnego workera i to właśnie opisuje ta strona.
:::

::: question Czemu po prostu sam nie zostawię `$app` rezydentnie?
Bo odtwarzałbyś ręcznie sandbox Octane. Stan do rozplątania między żądaniami siedzi w kontenerze, w rozwiązanych singletonach, w stosie żądania, sesji i uwierzytelniania oraz w statycznych polach samego frameworka — Octane istnieje właśnie dlatego, że pozbieranie tego wszystkiego jest dłubaniną, a pominięcie jednego elementu daje subtelne awarie: nieaktualny obiekt żądania, sesja jednego użytkownika widoczna dla następnego, konfiguracja zmieniona przez jedno żądanie i nigdy nieprzywrócona. Połowicznej wersji tego nie będziemy dokumentować. Jedyny przypadek, który zbadaliśmy do końca, opisuje sekcja o pamięci powyżej: `HandleExceptions::flushState()` wygląda na część odpowiedzi, a w praktyce zabija workera.
:::

::: question Czy muszę podkręcić `memory_limit`?
Tak — daj mu większy zapas niż w php-fpm i połącz to z `pool.max_requests`. Jedno i drugie opisuje [sekcja o pamięci](#pamiec-i-przebieg-piłokształtny) powyżej, a mechanizm pod spodem — [przegląd frameworków](/pl/docs/frameworks/).
:::
