---
title: Yii3
description: "Aplikacja Yii3 na Rapirze w trybie Worker: rezydentny HttpApplicationRunner ze StateResetter, runner tworzony na każde żądanie oraz to, co sprawdzono w routingu, sesjach, przesyłaniu plików i obsłudze błędów."
---

# Yii3

Yii3 jest zaprojektowany do pracy w procesie, który nie kończy się po żądaniu: jego kontener DI ma wbudowany `StateResetter`, runner udostępnia swój kontener w publicznym API, a zbudowanie aplikacji raz i wyzerowanie stanu żądania po każdej odpowiedzi to postać, którą framework ma od początku. Oficjalny runner dla RoadRunnera, [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner), jest zbudowany tak samo. Ta strona opisuje skrypt rezydentnego workera, wariant z runnerem tworzonym na każde żądanie oraz to, co sprawdzono w routingu, sesjach, przesyłaniu plików i obsłudze błędów.

::: info Sprawdzone na
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.8.0**
- szablon **yiisoft/app** 1.4, z **yii-runner-http 3.2.1** (router-fastroute 4.x)

Oba skrypty workera z tej strony uruchomiliśmy na tym stosie i oba przeszły pełen zestaw testów: routing, generowane adresy URL, POST-y z formularza i z ciałem JSON, sesje, przesyłanie plików, obsługę błędów oraz 200 kolejnych żądań.
:::

## Yii3 a tryb Worker

Rezydentny worker potrzebuje dwóch elementów publicznego API.

`ApplicationRunner::getContainer()` zwraca kontener, na którym działa aplikacja, więc nie trzeba po niczym dziedziczyć ani sięgać do prywatnego stanu. `Yiisoft\Di\StateResetter` to zwykły serwis w tym kontenerze: komponenty rejestrują w nim własne callbacki zerujące, a jedno wywołanie `reset()` przywraca je do stanu początkowego — to odpowiedź samego frameworka na serwis, który trzyma stan żądania.

Twój własny serwis trzymający stan żądania też musi zarejestrować callback: dodaj do jego definicji DI klucz `'reset' => function (): void { … }`, dokładnie tak, jak deklarują to `yiisoft/session` i `yiisoft/router`. Domknięcie jest związane z instancją, więc potrafi przywrócić prywatny stan bez odbudowywania obiektu. Co między żądaniami zeruje sama Rapira, a czego nie rusza, opisuje [przegląd frameworków](/pl/docs/frameworks/) oraz [tryb Worker](/pl/docs/worker).

Rezydentny wzorzec sprowadza się więc do trzech kroków: zbuduj runner raz, uruchamiaj go przy każdym żądaniu, a po wszystkim wyzeruj stan kontenera.

## Zanim zaczniesz

- Zainstalowana Rapira — zobacz [Instalację](/pl/docs/intro/installation).
- Aplikacja Yii3: świeży projekt z szablonu [`yiisoft/app`](https://github.com/yiisoft/app) albo taki, który już masz.

Po stronie PHP nie instalujesz niczego: jedynym nowym plikiem w projekcie jest skrypt workera z listingu niżej, a leży on w katalogu głównym projektu, obok `composer.json`, bo `rootPath` runnera to właśnie katalog główny. Potrzebujesz też zwykłego PHP CLI na maszynie: to przez niego uruchamiasz Composera. Rapira dostarcza PHP jako bibliotekę (`libphp`), a nie jako polecenie `php`, więc te kroki wykonują się na systemowym PHP, którego Rapira ani nie używa, ani nie rusza.

## Rezydentny worker

To wariant zalecany. Zapisz go jako `worker.php` w katalogu głównym projektu:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker keeps serving after an escaped error; the reset has to
        // run on that path too, or state leaks into the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Po kolei:

**`src/bootstrap.php` to bootstrap samego szablonu.** Ładuje autoloader Composera, czyta `.env`, jeśli plik istnieje, i wywołuje `Environment::prepare()` — dokładnie to, co robi `public/index.php`, zanim w ogóle dotknie runnera. Linijka z `vendor/autoload.php` nad nim jest nadmiarowa — `require_once` sprawia, że drugie wywołanie nic nie robi — ale dzięki niej workera da się czytać jak samodzielny skrypt wejściowy.

**Runner powstaje raz, z argumentami z `public/index.php`.** `rootPath`, `debug`, `checkEvents` i `environment` biorą się z `App\Environment` dokładnie tak, jak przekazuje je skrypt wejściowy, więc worker podnosi tę samą aplikację co wejście webowe. `public/index.php` z szablonu przekazuje jeszcze jeden argument — `temporaryErrorHandler` podpięty pod logger `StreamTarget` — i dołącza `c3.php`, gdy włączone jest `APP_C3`. Sprawdzony worker pomija jedno i drugie. Tymczasowy handler obejmuje wyłącznie błędy zgłoszone w trakcie budowania konfiguracji i kontenera; bez niego runner sięga po `ErrorHandler` z `NullLogger` (`HttpApplicationRunner::createTemporaryErrorHandler()`), więc jeśli chcesz mieć w logach awarie z budowy kontenera, przekaż go również tutaj.

**`getContainer()` należy do publicznego API**, więc kontener, który przechwytujesz, jest kontenerem aplikacji — tym samym, z którego runner skorzysta przy każdym żądaniu. `StateResetter` wyciągasz z niego już wewnątrz handlera.

**Na każde żądanie: `run()`, potem `reset()`.** `run()` to dokładnie to samo wywołanie, którego używa skrypt wejściowy; `reset()` przechodzi po zarejestrowanych w kontenerze callbackach i przywraca serwisom trzymającym stan ich pierwotną postać, zanim nadejdzie kolejne żądanie.

**`run()` przy każdym wywołaniu przechodzi całą swoją sekwencję od nowa.** Każde wywołanie rejestruje handler błędów, uruchamia `runBootstrap()`, uruchamia `checkEvents()`, a dopiero potem obsługuje żądanie; runner jest z założenia reentrantny, a przez 200 kolejnych wywołań sprawdziliśmy, że to powtórzenie jest nieszkodliwe. Kontrola zdarzeń robi cokolwiek tylko wtedy, gdy jej flaga jest prawdziwa, a szablon wiąże tę flagę z `Environment::appDebug()`, więc z wyłączonym debugiem przy każdym wywołaniu nic nie robi.

**Rezydentny runner odczytuje każde żądanie od nowa.** `run()` nie zapamiętuje żądania w chwili budowy obiektu. Przy każdym wywołaniu pobiera z kontenera `RequestFactory` i składa nowy `ServerRequest` w standardzie PSR-7 ze zmiennych `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` i strumienia `php://input`, a te zmienne superglobalne Rapira wypełnia od nowa przed każdą iteracją pętli (umowę opisuje [tryb Worker](/pl/docs/worker)).

**Zużycie pamięci pozostaje płaskie.** Przez 200 kolejnych żądań pamięć rezydentna workera nie urosła w żaden istotny sposób, bo aplikacja powstaje raz, a zerowanie jest tanie, więc nie ma tu rozruchu na każde żądanie, po którym trzeba by sprzątać.

## Prostsza alternatywa: nowy runner na każde żądanie

Żeby całkowicie uniknąć stanu rezydentnego, buduj runner *wewnątrz* handlera. Wszystko, co aplikacja wtedy utworzy, należy do jednego żądania:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // A fresh runner per request; constructor arguments mirror public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Kontener powstaje za każdym razem od nowa, więc jest mniej ruchomych części, nie ma zerowania, które można źle napisać, i stan kontenera nie przechodzi z jednego żądania do następnego; właściwości `static`, zmienne globalne i wszystko, co ustawił bootstrap, zostają w pamięci pod każdym workerem i musi je zerować twój własny kod. Ten wariant też przeszedł pełen zestaw testów.

Kontener podnosi się przy każdym żądaniu, więc za każdym razem płacisz czas rozruchu i za każdym razem produkujesz śmieci wielkości całego kontenera. Pamięć workera rośnie, bo te kontenery odkładają się, zanim PHP zwolni je hurtem — to zwykły profil rozruchu na żądanie, a nie wyciek. Połącz ten wzorzec z `pool.max_requests`, żeby worker co jakiś czas kończył pracę i był podmieniany na świeżego; kształty zużycia pamięci opisuje [przegląd frameworków](/pl/docs/frameworks/), a sam klucz — [Konfiguracja](/pl/docs/configuration).

Autoloader i bootstrap szablonu nadal zostają w pamięci, a pętla żądań nadal mieszka w skrypcie workera, więc to wciąż worker — tylko taki, który odrzuca aplikację między żądaniami — a nie [tryb Classic](/pl/docs/classic).

Używaj rezydentnego runnera, chyba że masz powód, żeby tego nie robić: to rozwiązanie samego frameworka na długo żyjący proces, pamięć trzyma się płasko, a zerowanie to jedno wywołanie. Runnera tworzonego na każde żądanie użyj wtedy, gdy twój bootstrap ma zależności kolejnościowe, nad którymi wolisz się nie zastanawiać: kod, który musi wykonać się przed zbudowaniem kontenera, albo rozruchowa robota przy każdym żądaniu, której callback `StateResetter` nie cofnie. Późniejsza zmiana jednego wariantu na drugi dotyczy wyłącznie skryptu workera.

## Jak to uruchomić

```bash
rapira serve --mode worker worker.php
```

`--mode worker` wybiera tryb Worker. Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli).

Na produkcji przenieś to do pliku `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Każdy klucz, wraz z wartością domyślną i zakresem, opisuje [Konfiguracja](/pl/docs/configuration); [Wdrożenie produkcyjne](/pl/docs/deployment) daje gotową jednostkę systemd i reverse proxy przed serwerem.

## Co zostało sprawdzone

Oba wzorce przeszły ten sam zestaw testów na szablonie `yiisoft/app`. Wyniki:

**Routing działa bez nadpisywania `$_SERVER`.** Rapira ustawia `SCRIPT_NAME` na nazwę pliku skryptu wejściowego — `/worker.php`, a nie `/index.php` — a FastRoute i tak dopasował zagnieżdżone ścieżki z parametrami zapytania. Ścieżka `/` wyrenderowała stronę główną szablonu, a nieznana ścieżka — frameworkowe 404. Nigdzie nie trzeba było nadpisywać `SCRIPT_NAME`, `REQUEST_URI` ani `DOCUMENT_ROOT`.

**Generowane adresy URL są czyste.** `UrlGeneratorInterface::generate()` zwracał zwykłe ścieżki aplikacji — nazwa pliku skryptu workera nigdzie do nich nie przecieka.

**Sesje należą do żądania i są poprawnie odizolowane.** Klient trzymający ciasteczka widział licznik rosnący 1, 2 w kolejnych żądaniach; nowy klient, który zaraz potem uderzył w ten sam endpoint, dostał świeżą sesję znowu od 1. Tak samo jest we wzorcu rezydentnym, gdzie kontener przeżywa żądanie.

**Dane z formularzy, ciała JSON i przesyłane pliki docierają na miejsce.** Pola w `$_POST`, ładunek JSON odczytany z `php://input` i plik wysłany jako multipart, z plikiem tymczasowym czytelnym w trakcie żądania — `ServerRequest` w standardzie PSR-7, który yii-runner-http składa ze zmiennych superglobalnych, niesie to wszystko.

**Rzucony wyjątek to 500, a worker pracuje dalej.** Akcję, która rzuca wyjątek, przechwytuje `ErrorCatcher` i renderuje odpowiedź błędu tak samo jak wszędzie indziej; wyjątek trafia do logów, a kolejne żądanie ten sam proces workera obsługuje już normalnie. Nieprzechwycony wyjątek jest w Rapirze awarią żądania, a nie workera — co powoduje awarię workera, a co nie, opisuje [tryb Worker](/pl/docs/worker).

## CSRF

Szablon aplikacji wstawia `CsrfTokenMiddleware` do domyślnego łańcucha middleware, a token jest trzymany w sesji — czyli w jedynym kawałku stanu, który testy naprawdę przećwiczyły: świeżym przy każdym żądaniu i odizolowanym per klient. Pętla workera w żaden sposób nie dotyka obiegu tokenu, więc POST potrzebuje go tutaj dokładnie tak samo jak wszędzie indziej. Jeśli po przejściu na workera POST-y zaczną wracać odrzucone, sprawdź najpierw token; naprawa jest ta sama co zawsze (wyrenderuj token w formularzu, odeślij go z powrotem), a nie zmiana w skrypcie workera.

## Tryb Classic jako rozwiązanie zapasowe

Yii3 działa też ze zwykłym skryptem wejściowym:

```bash
rapira serve --mode classic public/index.php
```

Ten sam kod, żadnego skryptu workera, świeży stan przy każdym żądaniu. Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

Skrypt workera to dodatkowy punkt wejścia, a nie zamiennik zwykłego skryptu wejściowego. Zostaw `public/index.php`: uruchamia go tryb Classic i nadal przydaje się przy pracy lokalnej z wbudowanym serwerem PHP.

`public/index.php` z szablonu ma gałąź `PHP_SAPI === 'cli-server'`, która serwuje pliki statyczne i przepisuje `SCRIPT_NAME`. Powstała z myślą o wbudowanym serwerze deweloperskim PHP i pod Rapirą nigdy się nie uruchamia, bo `PHP_SAPI` ma tu wartość `rapira` (`fastcgi` na PHP 8.4 — zobacz [Instalację](/pl/docs/intro/installation)), więc może zostać tak, jak jest.
