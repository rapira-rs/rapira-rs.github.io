---
title: Yii3
description: Aplikacja Yii3 na szczeblu SAPI Worker w Rapirze — rezydentny HttpApplicationRunner ze StateResetter, prostszy runner tworzony na każde żądanie i to, co udało się sprawdzić w routingu, sesjach, przesyłaniu plików i obsłudze błędów.
---

# Yii3

Spośród trzech opisanych tu frameworków to Yii3 został zaprojektowany dokładnie pod takie użycie. Jego kontener DI ma wbudowany `StateResetter`, runner udostępnia swój kontener w publicznym API, a zasada „zbuduj aplikację raz, po każdej odpowiedzi wyzeruj stan żądania” nie jest sztuczką wymyśloną na potrzeby długo żyjącego serwera — tak framework jest po prostu zbudowany. Oficjalny runner dla RoadRunnera, [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner), działa dokładnie w ten sposób, a to dobry znak: wzorzec opisany niżej to zamierzony sposób pracy w długo żyjącym procesie, a nie sprytne nadużycie frameworka.

::: info Sprawdzone na
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- szablon **yiisoft/app** 1.4, z **yii-runner-http 3.2.1** (router-fastroute 4.x)

Oba skrypty workera z tej strony uruchomiliśmy na tym stosie i oba przeszły pełen zestaw testów: routing, generowane adresy URL, POST-y z formularza i z ciałem JSON, sesje, przesyłanie plików, obsługę błędów oraz 200 kolejnych żądań.
:::

## Dlaczego Yii3 pasuje do szczebla workera

Rezydentnemu workerowi wystarczą dwa elementy publicznego API.

`ApplicationRunner::getContainer()` jest publiczne — runner oddaje ci dokładnie ten kontener, na którym działa twoja aplikacja, więc nie musisz po nim dziedziczyć ani sięgać do prywatnych pól, żeby się do niego dobrać. Z kolei `Yiisoft\Di\StateResetter` to zwykły serwis w tym kontenerze: komponenty rejestrują w nim własne callbacki zerujące, a jedno wywołanie `reset()` przywraca je do stanu początkowego. To odpowiedź samego frameworka na problem „ten obiekt trzyma stan żądania” — i istnieje dlatego, że Yii3 z założenia liczy się z procesem, który nie umiera.

Rezydentny wzorzec sprowadza się więc do trzech linijek: zbuduj runner raz, uruchamiaj go przy każdym żądaniu, a po wszystkim wyzeruj stan kontenera.

## Zanim zaczniesz

- Zainstalowana Rapira — zobacz [Instalację](/pl/docs/installation).
- Aplikacja Yii3: świeży projekt z szablonu [`yiisoft/app`](https://github.com/yiisoft/app) albo taki, który już masz.

Po stronie PHP nie instalujesz niczego. Nie ma pakietu runtime'owego, adaptera ani warstwy pośredniej — jedynym nowym plikiem w projekcie jest skrypt workera z listingu niżej, a leży on w katalogu głównym projektu, obok `composer.json`, bo `rootPath` runnera to właśnie katalog główny.

## Rezydentny worker

To wariant zalecany. Zapisz go jako `worker.php` w katalogu głównym projektu:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker keeps serving after an escaped error; the reset has to
        // run on that path too, or state leaks into the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Po kolei:

**`src/bootstrap.php` to bootstrap samego szablonu.** Ładuje autoloader Composera, czyta `.env`, jeśli plik istnieje, i wywołuje `Environment::prepare()` — dokładnie to, co robi `public/index.php`, zanim w ogóle dotknie runnera. Linijka z `vendor/autoload.php` nad nim to czysta asekuracja (`require_once`, więc nic nie kosztuje), która przy okazji pozwala czytać workera jak samodzielny skrypt wejściowy.

**Runner powstaje raz, z argumentami z `public/index.php`.** `rootPath`, `debug`, `checkEvents` i `environment` biorą się z `App\Environment` dokładnie tak, jak przekazuje je front controller, więc worker podnosi tę samą aplikację co wejście webowe. `public/index.php` z szablonu przekazuje jeszcze jeden argument — `temporaryErrorHandler` podpięty pod logger `StreamTarget` — i dołącza `c3.php`, gdy włączone jest `APP_C3`. Sprawdzony worker pomija jedno i drugie. Tymczasowy handler obejmuje wyłącznie błędy zgłoszone w trakcie budowania konfiguracji i kontenera; bez niego runner sięga po `ErrorHandler` z `NullLogger` (`HttpApplicationRunner::createTemporaryErrorHandler()`), więc jeśli chcesz mieć w logach awarie z budowy kontenera, przekaż go również tutaj.

**`getContainer()` należy do publicznego API**, więc kontener, który przechwytujesz, jest kontenerem aplikacji — tym samym, z którego runner skorzysta przy każdym żądaniu. `StateResetter` wyciągasz z niego już wewnątrz handlera.

**Na każde żądanie: `run()`, potem `reset()`.** `run()` to dokładnie to samo wywołanie, którego używa front controller; `reset()` przechodzi po zarejestrowanych w kontenerze callbackach i przywraca serwisom trzymającym stan ich pierwotną postać, zanim nadejdzie kolejne żądanie.

**Rezydentny runner i tak widzi każde nowe żądanie.** To bywa zaskoczeniem, więc powiedzmy wprost: `run()` nie zapamiętuje żądania w chwili budowy obiektu. Przy każdym wywołaniu prosi kontener o `RequestFactory` i składa świeży `ServerRequest` w standardzie PSR-7 ze zmiennych `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` i strumienia `php://input` — a te zmienne superglobalne Rapira wypełnia od nowa przed każdym obrotem pętli (umowę opisuje [Tryb workera](/pl/docs/worker)). Obiekty rezydentne, żądanie za każdym razem świeże.

**Pamięć trzyma płaski poziom.** Przez 200 kolejnych żądań pamięć rezydentna workera nie urosła w żaden istotny sposób — aplikacja powstaje raz, a zerowanie jest tanie, więc nie ma tu rozruchu na każde żądanie, po którym trzeba by sprzątać. To praktyczna przewaga tego wzorca nad następnym.

## Prostsza alternatywa: nowy runner na każde żądanie

Jeśli wolisz w ogóle nie zaprzątać sobie głowy stanem rezydentnym, buduj runner *wewnątrz* handlera. Wszystko, co aplikacja wtedy utworzy, należy do jednego żądania:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$http = create_plugin_handler(new HttpHandlerConfig());

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

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Mniej ruchomych części, żadnego zerowania, które można źle napisać, i zero szans na to, że stan przecieknie z jednego żądania do następnego — kontener powstaje za każdym razem od nowa. Ten wariant też przeszedł pełen zestaw testów.

Cena jest uczciwa i właśnie dlatego ten wzorzec jest na stronie *drugi*: kontener podnosisz przy każdym żądaniu, więc za każdym razem płacisz za rozruch i za każdym razem produkujesz śmieci wielkości całego kontenera. Pamięć workera rośnie, bo te kontenery odkładają się, zanim PHP zwolni je hurtem — to zwykły profil rozruchu na żądanie, a nie wyciek, ale profil, któremu warto postawić granicę. Połącz ten wzorzec z `pool.max_requests`, żeby worker co jakiś czas kończył pracę i był podmieniany na świeżego; kształty zużycia pamięci opisuje [przegląd frameworków](/pl/docs/frameworks/), a sam klucz — [Konfiguracja](/pl/docs/configuration).

Autoloader i bootstrap szablonu nadal zostają w pamięci, a pętla nadal należy do ciebie — to wciąż worker, tylko taki, który świadomie wyrzuca swoją aplikację między żądaniami, a nie [tryb klasyczny](/pl/docs/classic).

## Jak to uruchomić

```bash
rapira serve worker.php
```

To całe polecenie — tryb workera jest domyślny. Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli).

Na produkcji przenieś to do pliku `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Każdy klucz, wraz z wartością domyślną i zakresem, opisuje [Konfiguracja](/pl/docs/configuration); [Wdrożenie produkcyjne](/pl/docs/deployment) daje gotową jednostkę systemd i reverse proxy przed serwerem.

## Co zostało sprawdzone

Oba wzorce przeszły ten sam zestaw testów na szablonie `yiisoft/app`. Oto, co z niego wyszło:

**Routing działa bez grzebania w `$_SERVER`.** Rapira ustawia `SCRIPT_NAME` na nazwę pliku skryptu wejściowego — `/worker.php`, a nie `/index.php` — a FastRoute i tak dopasował zagnieżdżone ścieżki z parametrami zapytania. Ścieżka `/` wyrenderowała stronę główną szablonu, a nieznana ścieżka — frameworkowe 404. Nigdzie nie trzeba było nadpisywać `SCRIPT_NAME`, `REQUEST_URI` ani `DOCUMENT_ROOT`.

**Generowane adresy URL są czyste.** `UrlGeneratorInterface::generate()` zwracał zwykłe ścieżki aplikacji — nazwa pliku skryptu workera nigdzie do nich nie przecieka.

**Sesje należą do żądania i są poprawnie odizolowane.** Klient trzymający ciasteczka widział licznik rosnący 1, 2 w kolejnych żądaniach; nowy klient, który zaraz potem uderzył w ten sam endpoint, dostał świeżą sesję znowu od 1. Tak samo jest we wzorcu rezydentnym, gdzie kontener przeżywa żądanie.

**Dane z formularzy, ciała JSON i przesyłane pliki docierają na miejsce.** Pola w `$_POST`, ładunek JSON odczytany z `php://input` i plik wysłany jako multipart, z plikiem tymczasowym czytelnym w trakcie żądania — `ServerRequest` w standardzie PSR-7, który yii-runner-http składa ze zmiennych superglobalnych, niesie to wszystko.

**Rzucony wyjątek to 500, a worker pracuje dalej.** Akcję, która rzuca wyjątek, przechwytuje `ErrorCatcher` i renderuje odpowiedź błędu tak samo jak wszędzie indziej; wyjątek trafia do logów, a kolejne żądanie ten sam proces workera obsługuje już normalnie. Nieprzechwycony wyjątek jest w Rapirze awarią żądania, a nie workera — co kładzie workera, a co nie, opisuje [Tryb workera](/pl/docs/worker).

## Ochrona CSRF nadal działa

Szablon aplikacji wstawia `CsrfTokenMiddleware` do domyślnego łańcucha middleware, a token siedzi w sesji — czyli w jedynym kawałku stanu, który testy naprawdę przećwiczyły: świeżym przy każdym żądaniu i odizolowanym per klient. Pętla workera w żaden sposób nie dotyka obiegu tokenu, więc POST potrzebuje go tutaj dokładnie tak samo jak wszędzie indziej. Jeśli po przesiadce na workera twoje POST-y zaczną wracać odrzucone, token sprawdź w pierwszej kolejności — a naprawa jest ta sama co zawsze (wyrenderuj token w formularzu, odeślij go z powrotem), nie polega na zmianie skryptu workera.

## Furtka awaryjna: tryb klasyczny

Jeśli worker to na razie nie jest to, czego chcesz, Yii3 świetnie radzi sobie jako zwykły front controller:

```bash
rapira serve --classic public/index.php
```

Ten sam kod, żadnego skryptu workera, świeży stan przy każdym żądaniu — co daje ten szczebel i ile kosztuje, opisuje [Tryb klasyczny](/pl/docs/classic).

Jedna ciekawostka, jeśli zajrzysz do tego pliku: `public/index.php` z szablonu ma gałąź `PHP_SAPI === 'cli-server'`, która serwuje pliki statyczne i przepisuje `SCRIPT_NAME`. Powstała z myślą o wbudowanym serwerze deweloperskim PHP i pod Rapirą po prostu nigdy się nie uruchamia, bo `PHP_SAPI` ma tu wartość `rapira` (`fastcgi` na PHP 8.4 — zobacz [Instalację](/pl/docs/installation)). Zostaw ją w spokoju; tutaj jest martwa.

::: question Który wzorzec wybrać?
Rezydentny, chyba że masz powód, żeby tego nie robić. To rozwiązanie samego frameworka na długo żyjący proces, pamięć trzyma się płasko, a zerowanie to jedno wywołanie. Po runner tworzony na każde żądanie sięgnij wtedy, gdy twój bootstrap ma zależności kolejnościowe, nad którymi wolisz się nie zastanawiać — kod, który musi wykonać się przed zbudowaniem kontenera, albo rozruchową robotę na każde żądanie, której callback `StateResetter` nie cofnie. Możesz zacząć od niego i przesiąść się później; zmienia się wyłącznie skrypt workera.
:::

::: question Czy we wzorcu rezydentnym `checkEvents` i reszta bootstrapu wykonują się przy każdym żądaniu?
Tak — `run()` przy każdym wywołaniu przechodzi swoją wewnętrzną sekwencję od nowa: rejestracja handlera błędów, `runBootstrap()`, `checkEvents()`, a na końcu obsługa żądania. Przez 200 kolejnych wywołań sprawdziliśmy, że jest to nieszkodliwe — runner jest z założenia reentrantny. Sama kontrola zdarzeń robi cokolwiek tylko wtedy, gdy jej flaga jest prawdziwa, a w szablonie tą flagą jest `Environment::appDebug()` — z wyłączonym debugiem każde wywołanie schodzi na pusto.
:::

::: question Czy `public/index.php` jest mi jeszcze potrzebny?
Zostaw go. Nic nie kosztuje, to do niego wracasz w [trybie klasycznym](/pl/docs/classic) i nadal przydaje się przy pracy lokalnej z wbudowanym serwerem PHP. Skrypt workera to dodatkowy skrypt wejściowy, a nie zamiennik front controllera.
:::

::: question Co dokładnie zeruje `StateResetter::reset()`?
Dokładnie to, co zarejestrowały w nim serwisy z twojego kontenera — i o to właśnie chodzi w tym, że jest serwisem kontenera, a nie hakiem frameworka. Komponenty Yii3 trzymające stan rejestrują swoje callbacki zerujące; jeśli piszesz serwis przechowujący stan żądania, zarejestruj też swój — kluczem `'reset' => function (): void { … }` w definicji DI tego serwisu, dokładnie tak, jak deklarują to `yiisoft/session` i `yiisoft/router`; domknięcie jest związane z instancją, więc potrafi przywrócić prywatny stan bez odbudowywania obiektu. Co między żądaniami zeruje sama Rapira, a czego celowo nie rusza, opisuje [przegląd frameworków](/pl/docs/frameworks/) oraz [Tryb workera](/pl/docs/worker).
:::
