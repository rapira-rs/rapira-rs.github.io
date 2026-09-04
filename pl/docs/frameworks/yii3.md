---
title: Yii3
description: "Aplikacja Yii3 na Rapirze w trybie Worker: rezydentny HttpApplicationRunner ze StateResetter, runner tworzony na każde żądanie oraz to, co sprawdzono w routingu, sesjach, przesyłaniu plików i obsłudze błędów."
---

# Yii3

Yii3 obsługuje trwałe procesy. Jego kontener DI udostępnia `StateResetter`, a runner zapewnia publiczny dostęp do kontenera.
Worker może raz zainicjalizować aplikację i zerować stan po każdej odpowiedzi.
Oficjalny runner [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) używa tego samego rozwiązania.
Ta strona opisuje trwały worker, wariant na każde żądanie i wyniki testów.

::: info Sprawdzone na
- **PHP 8.5.8** - NTS, embed SAPI
- **Rapira 0.8.0**
- szablon **yiisoft/app** 1.4, z **yii-runner-http 3.2.1** (router-fastroute 4.x)

Oba skrypty workera z tej strony uruchomiliśmy na tym stosie i oba przeszły pełen zestaw testów: routing, generowane adresy URL, POST-y z formularza i z ciałem JSON, sesje, przesyłanie plików, obsługę błędów oraz 200 kolejnych żądań.
:::

## Yii3 a tryb Worker

Rezydentny worker potrzebuje dwóch elementów publicznego API.

`ApplicationRunner::getContainer()` zwraca kontener aplikacji. Worker nie wymaga podklasy ani dostępu do prywatnego stanu.
`Yiisoft\Di\StateResetter` jest serwisem tego kontenera. Komponenty rejestrują callbacki zerujące stan żądania.
Jedno wywołanie `reset()` uruchamia te callbacki.

Serwis aplikacji ze stanem żądania również musi zarejestrować callback. Dodaj `'reset' => function (): void { … }` do jego definicji DI.
`yiisoft/session` i `yiisoft/router` używają tej samej metody. Domknięcie może wyzerować prywatny stan bez tworzenia nowego obiektu.
Czas życia stanu opisują [przegląd frameworków](/pl/docs/frameworks/) i [tryb Worker](/pl/docs/worker).

Rezydentny wzorzec sprowadza się więc do trzech kroków: zbuduj runner raz, uruchamiaj go przy każdym żądaniu, a po wszystkim wyzeruj stan kontenera.

## Zanim zaczniesz

- Zainstalowana Rapira - zobacz [Instalację](/pl/docs/intro/installation).
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
        // The worker continues after an error leaves run().
        // Reset state before the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Po kolei:

**`src/bootstrap.php` to bootstrap samego szablonu.** Ładuje autoloader Composera, czyta `.env`, jeśli plik istnieje, i wywołuje `Environment::prepare()` - dokładnie to, co robi `public/index.php`, zanim w ogóle dotknie runnera. Linijka z `vendor/autoload.php` nad nim jest nadmiarowa - `require_once` sprawia, że drugie wywołanie nic nie robi - ale dzięki niej workera da się czytać jak samodzielny skrypt wejściowy.

**Worker tworzy runner raz z argumentami z `public/index.php`.**
Przekazuje `rootPath`, `debug`, `checkEvents` i `environment` z `App\Environment`. Dlatego inicjalizuje tę samą aplikację.
Szablon przekazuje też `temporaryErrorHandler` z loggerem `StreamTarget`. Wczytuje `c3.php`, gdy włączono `APP_C3`.
Testowany worker pomija obie części.
Tymczasowy handler zapisuje błędy tworzenia konfiguracji i kontenera.
Bez niego `HttpApplicationRunner::createTemporaryErrorHandler()` tworzy `ErrorHandler` z `NullLogger`.
Przekaż handler szablonu, aby zapisywać awarie tworzenia kontenera.

**`getContainer()` należy do publicznego API**, więc kontener, który przechwytujesz, jest kontenerem aplikacji - tym samym, z którego runner skorzysta przy każdym żądaniu. `StateResetter` wyciągasz z niego już wewnątrz handlera.

**Na każde żądanie: `run()`, potem `reset()`.** `run()` to dokładnie to samo wywołanie, którego używa skrypt wejściowy; `reset()` przechodzi po zarejestrowanych w kontenerze callbackach i przywraca serwisom trzymającym stan ich pierwotną postać, zanim nadejdzie kolejne żądanie.

**`run()` powtarza pełną sekwencję przy każdym wywołaniu.** Rejestruje handler, wywołuje `runBootstrap()` i `checkEvents()`, a następnie obsługuje żądanie.
Testy potwierdziły tę sekwencję podczas 200 wywołań.
Kontrola zdarzeń działa tylko przy prawdziwej fladze. Szablon pobiera flagę z `Environment::appDebug()`.

**Rezydentny runner odczytuje każde żądanie od nowa.** `run()` nie zapamiętuje żądania w chwili budowy obiektu. Przy każdym wywołaniu pobiera z kontenera `RequestFactory` i składa nowy `ServerRequest` w standardzie PSR-7 ze zmiennych `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` i strumienia `php://input`, a te zmienne superglobalne Rapira wypełnia od nowa przed każdą iteracją pętli (umowę opisuje [tryb Worker](/pl/docs/worker)).

**Zużycie pamięci pozostało stabilne.** Testy nie wykazały istotnego wzrostu pamięci podczas 200 kolejnych żądań.
Aplikacja jest inicjalizowana raz, a każde żądanie wykonuje jedno zerowanie.

## Nowy runner dla każdego żądania

Żeby całkowicie uniknąć stanu rezydentnego, buduj runner *wewnątrz* handlera. Wszystko, co aplikacja wtedy utworzy, należy do jednego żądania:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // Create one runner for each request.
    // Use the same arguments as public/index.php.
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

Kontener jest inicjalizowany dla każdego żądania. Dodaje to czas inicjalizacji i tworzy obiekty, które PHP musi zwolnić.
Pamięć może rosnąć do czasu zwolnienia kilku starych kontenerów. To cykliczne zachowanie nie zawsze jest wyciekiem.
Ustaw `pool.max_requests`, aby okresowo zastępować workery.
To zachowanie opisuje [przegląd frameworków](/pl/docs/frameworks/), a ustawienie opisuje [Konfiguracja](/pl/docs/configuration).

Autoloader i bootstrap szablonu nadal zostają w pamięci, a pętla żądań nadal mieszka w skrypcie workera, więc to wciąż worker - tylko taki, który odrzuca aplikację między żądaniami - a nie [tryb Classic](/pl/docs/classic).

Domyślnie używaj trwałego runnera. Jest zgodny z projektem frameworka, miał stabilną pamięć i wymaga jednego wywołania zerowania.
Użyj runnera na żądanie, jeśli kolejność inicjalizacji uniemożliwia pełny callback `StateResetter`.
Zmiana między wariantami wymaga zmiany tylko skryptu workera.

## Uruchamianie Rapiry

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

## Wyniki testów

Oba wzorce przeszły ten sam zestaw testów na szablonie `yiisoft/app`. Wyniki:

**Routing działa bez nadpisywania `$_SERVER`.** Rapira ustawia `SCRIPT_NAME` na nazwę pliku skryptu wejściowego - `/worker.php`, a nie `/index.php` - a FastRoute i tak dopasował zagnieżdżone ścieżki z parametrami zapytania. Ścieżka `/` wyrenderowała stronę główną szablonu, a nieznana ścieżka - frameworkowe 404. Nigdzie nie trzeba było nadpisywać `SCRIPT_NAME`, `REQUEST_URI` ani `DOCUMENT_ROOT`.

**Generowane adresy URL są czyste.** `UrlGeneratorInterface::generate()` zwracał zwykłe ścieżki aplikacji - nazwa pliku skryptu workera nigdzie do nich nie przecieka.

**Sesje należą do żądania i są poprawnie odizolowane.** Klient trzymający ciasteczka widział licznik rosnący 1, 2 w kolejnych żądaniach; nowy klient, który zaraz potem uderzył w ten sam endpoint, dostał świeżą sesję znowu od 1. Tak samo jest we wzorcu rezydentnym, gdzie kontener przeżywa żądanie.

**Dane z formularzy, ciała JSON i przesyłane pliki docierają na miejsce.** Pola w `$_POST`, ładunek JSON odczytany z `php://input` i plik wysłany jako multipart, z plikiem tymczasowym czytelnym w trakcie żądania - `ServerRequest` w standardzie PSR-7, który yii-runner-http składa ze zmiennych superglobalnych, niesie to wszystko.

**Rzucony wyjątek to 500, a worker pracuje dalej.** Akcję, która rzuca wyjątek, przechwytuje `ErrorCatcher` i renderuje odpowiedź błędu tak samo jak wszędzie indziej; wyjątek trafia do logów, a kolejne żądanie ten sam proces workera obsługuje już normalnie. Nieprzechwycony wyjątek jest w Rapirze awarią żądania, a nie workera - co powoduje awarię workera, a co nie, opisuje [tryb Worker](/pl/docs/worker).

## CSRF

Szablon aplikacji wstawia `CsrfTokenMiddleware` do domyślnego łańcucha middleware, a token jest trzymany w sesji - czyli w jedynym kawałku stanu, który testy naprawdę przećwiczyły: świeżym przy każdym żądaniu i odizolowanym per klient. Pętla workera w żaden sposób nie dotyka obiegu tokenu, więc POST potrzebuje go tutaj dokładnie tak samo jak wszędzie indziej. Jeśli po przejściu na workera POST-y zaczną wracać odrzucone, sprawdź najpierw token; naprawa jest ta sama co zawsze (wyrenderuj token w formularzu, odeślij go z powrotem), a nie zmiana w skrypcie workera.

## Tryb Classic jako rozwiązanie zapasowe

Yii3 działa też ze zwykłym skryptem wejściowym:

```bash
rapira serve --mode classic public/index.php
```

Ten sam kod, żadnego skryptu workera, świeży stan przy każdym żądaniu. Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

Skrypt workera to dodatkowy punkt wejścia, a nie zamiennik zwykłego skryptu wejściowego. Zostaw `public/index.php`: uruchamia go tryb Classic i nadal przydaje się przy pracy lokalnej z wbudowanym serwerem PHP.

`public/index.php` z szablonu ma gałąź `PHP_SAPI === 'cli-server'`, która serwuje pliki statyczne i przepisuje `SCRIPT_NAME`. Powstała z myślą o wbudowanym serwerze deweloperskim PHP i pod Rapirą nigdy się nie uruchamia, bo `PHP_SAPI` ma tu wartość `rapira` (`fastcgi` na PHP 8.4 - zobacz [Instalację](/pl/docs/intro/installation)), więc może zostać tak, jak jest.
