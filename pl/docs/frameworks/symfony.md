---
title: Symfony
description: Uruchom aplikację Symfony na szczeblu SAPI Worker w Rapirze — kernel podnoszony raz, services_resetter między żądaniami i pułapka z $_ENV, która ujawnia się wyłącznie na produkcji.
---

# Symfony

Struktura Symfony pasuje do rezydentnego workera: kernel, który podnosisz, `Request`, który mu podajesz, i `Response`, który dostajesz z powrotem. Pod Rapirą kernel podnosi się raz, przy starcie workera, a każde kolejne żądanie to już tylko wywołanie `handle()` na rozgrzanym kontenerze. W samej aplikacji nie zmienia się prawie nic — zmienia się dwadzieścia linii, które zastępują `public/index.php`. Na tej stronie znajdziesz dokładnie ten plik, który przeszedł weryfikację, a do tego dwa szczegóły decydujące o tym, że całość działa: reset między żądaniami i to, jak wartości z `.env` docierają do kontenera.

::: info Zweryfikowano na
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.6.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) — pełna bateria testów w `dev` i w `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) — pełna bateria testów w `dev`

Obie aplikacje to goły `symfony/skeleton` chodzący w jednym procesie workera i obie uruchamiały **ten sam `worker.php`** — bajt w bajt, bez żadnej gałęzi na wersję. Bateria obejmuje routing, 404, query stringi, generowanie URL-i, wysyłkę formularza, treść w JSON-ie, sesje trzymające się między żądaniami, upload pliku, nieprzechwycony wyjątek i 200 żądań pod rząd.
:::

## Co zyskujesz

Kernel podnosi się na górze skryptu, poza pętlą, i zostaje w pamięci na cały czas życia procesu workera: autoloader, skompilowany kontener, router, event dispatcher i każde połączenie otwarte przez twoje bundle powstają raz, a nie raz na żądanie. Na tym polega cała umowa szczebla [SAPI Worker](/pl/docs/worker), a o tym, gdzie stoi on na drabinie, mówią [Tryby wykonania](/pl/docs/execution-modes).

Przy każdym żądaniu handler robi cztery rzeczy, a na koniec sprząta:

1. `Request::createFromGlobals()` — Rapira przed wywołaniem twojego handlera wypełnia od nowa `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i `$_FILES`, więc zwykły konstruktor Symfony czyta dokładnie to samo, co pod php-fpm.
2. `$kernel->handle($request)` — routing, kontroler, odpowiedź, bez zmian.
3. `$response->send()` — wyjście staje się odpowiedzią HTTP (o tym, jak jest ona pakowana w drodze na zewnątrz, mówi [HTTP](/pl/docs/http)).
4. `$kernel->terminate($request, $response)` — uruchamiają się listenery po odpowiedzi, tak samo jak zawsze.

Potem handler zeruje serwisy trzymające stan przez `services_resetter` z kontenera. To nie jest wynalazek Rapiry: dokładnie ten sam reset Symfony robi samo, między kolejnymi wiadomościami Messengera, i od zawsze właśnie tym długo żyjący kernel pozbywa się tego, co narosło w trakcie żądania.

Jeden kernel żyje w jednym procesie workera, a workery to osobne procesy systemowe — w przestrzeni użytkownika nie dzielą ze sobą niczego. Ile ich jest i jak są nadzorowane, opisuje [Model procesów](/pl/docs/process-model).

## Zanim zaczniesz

Potrzebujesz [zainstalowanej Rapiry](/pl/docs/installation) i aplikacji Symfony — świeżej z `composer create-project symfony/skeleton my-app` albo tej, którą już masz. Aplikacji nie trzeba do niczego specjalnie przygotowywać: skrypt workera ląduje obok `composer.json`, a cała reszta zostaje na swoim miejscu. Na maszynie potrzebujesz też zwykłego PHP CLI — do Composera i `bin/console`. Rapira dostarcza PHP jako bibliotekę (`libphp`), a nie jako polecenie `php`, więc te kroki wykonuje systemowy PHP, którego Rapira ani nie używa, ani nie rusza.

Znaczenie mają dwa rozszerzenia, bo skeleton twardo wymaga ich w `composer.json` (`ext-ctype`, `ext-iconv`), *a przy okazji* wypisuje odpowiadające im polyfille w sekcji `replace` — muszą to więc być prawdziwe rozszerzenia, a nie ich namiastki napisane w PHP. Dotyczy to obu PHP: systemowy CLI potrzebuje ich tak samo, bo inaczej `composer create-project` i `composer install` polegną na sprawdzeniu wymagań platformy, zanim Rapira w ogóle wejdzie do gry. PHP dołączane do każdego wydania Rapiry ma oba: `ctype` i `iconv` stoją w linii konfiguracyjnej tego builda, a pełną listę rozszerzeń znajdziesz na stronie [Instalacja](/pl/docs/installation). Jeśli zamiast tego kompilujesz Rapirę przeciwko własnemu PHP, zostaw oba włączone — gdzie ustawia się tę listę, pokazuje [Budowanie ze źródeł](/pl/docs/build-from-source).

Plik workera poniżej korzysta też z `symfony/dotenv`, który skeleton ma w zestawie. Jeśli twoje wdrożenie ustawia prawdziwe zmienne środowiskowe i nie ma żadnego `.env`, skasuj tę linię, a razem z nią cały komponent.

## Skrypt workera

Wrzuć to do katalogu głównego projektu jako `worker.php`. To dokładnie ten plik, który przeszedł weryfikację, co do znaku, na obu głównych wersjach:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

use function Rapira\create_plugin_handler;

require __DIR__ . '/vendor/autoload.php';

// public/index.php delegates this to symfony/runtime; here we do it once, up front.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // The same reset Symfony runs between Messenger messages: every service
        // tagged kernel.reset drops the state it accumulated during the request.
        // In finally: handle() turns application exceptions into a response, but a
        // failing send() or a throwing kernel.terminate listener escapes the handler,
        // and the worker keeps serving — the reset has to run on that path too.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Większość to zwykły rozruch Symfony. Wyjaśnienia wymagają te linie:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** W normalnej aplikacji nigdy tego nie piszesz, bo `public/index.php` oddaje tę robotę `symfony/runtime`. Tutaj rozruch należy do workera, więc to on sam wczytuje `.env` — raz, zanim jeszcze powstanie kernel. `usePutenv()` nie jest ani kosmetyką, ani opcją: bez niego aplikacja psuje się w `prod` w sposób, który `dev` całkowicie zakrywa. O tym jest następna sekcja i to najważniejsza rzecz na tej stronie.

**Kernel powstaje i podnosi się przed pętlą.** `new Kernel(...)`, `boot()` i `getContainer()` wykonują się przy starcie workera, więc `$_SERVER['APP_ENV']` czytane jest jeszcze wtedy, gdy wartości z Dotenv są na miejscu, a kontener jest rozgrzany, zanim w ogóle przyjdzie pierwsze żądanie. Wszystko wewnątrz pętli `while` pracuje potem na tym jednym kontenerze.

**`$container->has('services_resetter')` przed `get()`.** Identyfikator serwisu `services_resetter` jest publiczny i w 7.4, i w 8.1 — dlatego ten sam plik działa na obu. *Klasa*, która za nim stoi, zmieniła między głównymi wersjami przestrzeń nazw (`Symfony\Component\DependencyInjection\ServicesResetter` w 7.4, `Symfony\Component\HttpKernel\DependencyInjection\ServicesResetter` w 8.1), a odwołanie się do serwisu po identyfikatorze sprawia, że ta różnica znika. Zabezpieczenie przez `has()` nic nie kosztuje, a chroni skrypt przed błędem krytycznym na kontenerze, który tego serwisu nie definiuje.

**Pętla i `gc_collect_cycles()`.** `handleRequest()` blokuje wykonanie, dopóki nie przyjdzie żądanie, uruchamia twój handler i zwraca `true` — albo `false`, gdy serwer się zamyka, i to właśnie kończy pętlę. Zbieranie cykli raz na obrót trzyma tę pracę między żądaniami, a nie w środku któregoś z nich. Pełny kontrakt opisuje [Tryb workera](/pl/docs/worker).

Gdyby resetter nie wystarczył — a zwykle wystarcza — zostają dwie cięższe opcje: `$container->reset()` czyści każdy serwis, który zdążył powstać, a `$kernel->reboot(null)` wyrzuca kontener i buduje nowy — po czym `$container` przechwycony przez handler jest już nieaktualny, więc jeśli pójdziesz tą drogą, pobierz go ponownie przez `$kernel->getContainer()`. Oba kosztują cię dokładnie ten rozgrzany stan, który daje tryb workera, więc używaj ich, kiedy szukasz wycieku, a nie domyślnie.

## Pułapka `$_ENV`

::: warning
Przy gołym `bootEnv()` — bez `usePutenv()` — aplikacja Symfony z `APP_ENV=prod` zwraca **500 już na pierwszym żądaniu**, i na każdym następnym, z `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. Sprawdzenie tego najpierw w `dev` niczego ci nie powie, bo w `dev` nic się nie psuje.
:::

Winne jest nie Symfony i nie Rapira, tylko samo PHP. Przy domyślnych ustawieniach ini, na których szła weryfikacja (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP przy **każdym** żądaniu na nowo uzbraja flagę JIT dla `$_ENV`. Pierwszy plik skompilowany w trakcie tego żądania, w którym pada `$_ENV`, uruchamia `php_auto_globals_create_env`, a to importuje superglobal na nowo z prawdziwego środowiska procesu — kasując wszystko, co `Dotenv->bootEnv()` włożył tam przy rozruchu workera. Widać to wprost w teście: w środku żądania `$_ENV` z wypełnionej tablicy robi się pusty.

Dlaczego tylko `prod`? Bo tam to pierwsze żądanie leniwie kompiluje kontener i pliki serwisów, więc wyczyszczenie wypada *zanim* `RequestContext` rozwiąże `%env(DEFAULT_URI)%` — a wtedy nie ma już czego rozwiązywać. W `dev` kontener debugowy rozwiązuje odwołania do zmiennych zachłannie, jeszcze w `$kernel->boot()` przy rozruchu, i zapamiętuje wartości, więc czyszczenie przychodzi po tym, jak odpowiedź została już zanotowana. Błąd występuje tam tak samo, tylko że nie ma żadnego skutku.

Naprawia to jedna linia ze skryptu powyżej:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` każe Dotenv zapisać wartości również do *prawdziwego* środowiska procesu — a to dokładnie stamtąd czyta ponowny import, więc wartości go przeżywają. Do tego `EnvVarProcessor` z Symfony i tak sięga w ostateczności po `getenv()`. Rapira uruchamia PHP w wersji NTS w modelu pre-fork, po jednym interpreterze na proces, więc typowe ostrzeżenia o bezpieczeństwie wątkowym `putenv()` w ogóle tu nie obowiązują.

Na produkcji drugie rozwiązanie jest równie dobre, a można się spierać, że lepsze: ustaw prawdziwe zmienne środowiskowe (`Environment=` w systemd, twój runtime kontenerowy, twój orkiestrator), a `.env` zostaw jako wygodę na czas pisania kodu. Tak czy inaczej wartości lądują tam, gdzie ponowny import w środku żądania ich nie skasuje.

To nie jest dziwactwo Rapiry, tylko cecha każdego środowiska PHP z rezydentnym workerem — narażony jest na to każdy framework, który czyta `$_ENV` leniwie. Strona [Frameworki](/pl/docs/frameworks/) opisuje tę pułapkę razem z dwiema pozostałymi, właściwymi dla rezydentnego procesu: destruktor obiektu z rozruchu i `register_shutdown_function()` odpalają się raz, na końcu pierwszego żądania.

## Uruchomienie

```bash
rapira serve worker.php
curl -i http://127.0.0.1:8000/
```

To całe polecenie — tryb workera jest domyślny, a `127.0.0.1:8000` to domyślny adres nasłuchu. `rapira serve` zostaje na pierwszym planie, a `Ctrl-C` domyka trwające żądania i kończy pracę.

Jedna rzecz, którą na innych zestawach zwykle trzeba naprawiać, a tutaj **nie**: skryptem wejściowym jest `worker.php`, a nie `index.php`, więc `$_SERVER['SCRIPT_NAME']` to `/worker.php`. `Request` z Symfony szuka tej nazwy na początku URI, nie znajduje jej i schodzi z bazowym URL-em do `""` — czyli dokładnie tak, jak trzeba. `getPathInfo()` zwraca prawdziwą ścieżkę, trasy się dopasowują, a `generateUrl()` produkuje czyste ścieżki, bez prefiksu `/worker.php` gdziekolwiek w nich. Nie trzeba nadpisywać `$_SERVER` ani sięgać po `Request::setTrustedProxies()`.

## Wyjście na produkcję

Ustaw `APP_ENV=prod`, zainstaluj zależności bez tych deweloperskich i rozgrzej cache, zanim wystartuje serwer — `php bin/console cache:warmup` w weryfikacji podnosił aplikację czysto i to on sprawia, że pierwsze żądanie jest tanie, zamiast być tym, które kompiluje kontener:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Przy okazji sprawdź `DEFAULT_URI`. Plik `config/packages/routing.yaml` ze skeletonu ustawia `router.default_uri` na `%env(DEFAULT_URI)%` w **każdym** środowisku, a `.env` przynosi tam `http://localhost` — dobre na laptopie, złe na produkcji. To właśnie z tej wartości powstają URL-e generowane poza żądaniem HTTP: w poleceniach konsolowych i w mailach. Wskaż nią swój prawdziwy adres.

Mały `rapira.toml`, żeby to uruchomić:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` to higiena, a nie naprawa: wymienia workera po tylu żądaniach, żeby powolny wyciek gdzieś w drzewie zależności nigdy nie rósł bez końca. `request_terminate_timeout_secs` nakłada na pojedyncze żądanie limit czasu rzeczywistego, bo rezydentny worker inaczej tkwiłby w zawieszonym żądaniu w nieskończoność. Uruchamiasz to poleceniem `rapira serve --config rapira.toml`. Wszystkie te klucze — i cała reszta — są opisane na stronie [Konfiguracja](/pl/docs/configuration); względny `entrypoint` liczy się od katalogu z plikiem konfiguracyjnym.

## Co zeruje się między żądaniami

`services_resetter` wywołuje `reset()` na każdym serwisie oznaczonym tagiem `kernel.reset`. Które to serwisy, zależy od zainstalowanych bundle'i — buforujące handlery logów, kolektory danych debugowych i podobne zbieracze z pojedynczego żądania rejestrują ten tag same z siebie i właśnie dlatego jedno wywołanie obejmuje tak wiele.

Nie obejmuje natomiast stanu, który trzymasz sam: statycznych właściwości, zapamiętanych wartości globalnych, rejestru wypełnianego leniwie przez jakąś bibliotekę, `ini_set()`, którego nigdy nie cofnąłeś. To wszystko przeżywa żądanie pod każdym rezydentnym workerem i wyzerowanie tego należy do ciebie. Tabelę tego, co przeżywa, a co nie, znajdziesz na stronie [Frameworki](/pl/docs/frameworks/).

Z resetterem na miejscu weryfikacja pokazała, że pamięć rezydentna trzyma się płasko przez 200 kolejnych żądań, tak samo w `dev`, jak i w `prod` — kernel utrzymuje stały zestaw roboczy, zamiast rosnąć z każdym żądaniem. Tak samo powinno to wyglądać u ciebie; jeśli pamięć u ciebie rośnie, coś w twoim własnym kodzie albo w którymś bundle trzyma się żądań.

## Praca po odesłaniu odpowiedzi

Jeśli chcesz uwolnić klienta, zanim ruszą listenery po odpowiedzi, wywołaj [`rapira_finish_request()`](/pl/docs/http) między `$response->send()` a `$kernel->terminate($request, $response)` — odpowiedź wychodzi, a `terminate()` pracuje dalej w workerze, na którego klient już nie czeka. Pamiętaj tylko, że sam worker jest zajęty aż do powrotu twojego handlera, więc to narzędzie na opóźnienia, a nie sposób na współbieżność.

## Codzienna praca nad kodem

`rapira serve` działa na pierwszym planie, a twoja aplikacja podnosi się raz, więc **zmieniony kod PHP nie wejdzie w życie, dopóki nie wymienisz workerów**. W trakcie aktywnego pisania najprościej zatrzymać serwer i uruchomić go od nowa albo puścić front controller na szczeblu [Classic](/pl/docs/classic), gdzie skrypt wykonuje się od zera za każdym razem, a każdy zapis pliku widać natychmiast:

```bash
rapira serve --classic public/index.php
```

To ta sama aplikacja, tylko szczebel niżej — po prostu płaci koszt rozruchu przy każdym żądaniu, czyli dokładnie to, czego chcesz przy iterowaniu, i dokładnie to, czego nie chcesz na produkcji. Na działającym serwerze produkcyjnym wdrożony kod przejmuje pracę bez zrywania połączeń dzięki przeładowaniu kroczącemu (`SIGUSR2` do procesu nadrzędnego) — chyba że masz `opcache.validate_timestamps = 0`, bo wtedy segment OPcache procesu nadrzędnego przeżywa całą pulę i wdrożenie wymaga pełnego restartu; zobacz [Model procesów](/pl/docs/process-model) i [wdrożenie produkcyjne](/pl/docs/deployment).

Nieprzechwycony wyjątek nigdy nie wychodzi poza Symfony: framework odpowiada na niego własnym `500` — pełną stroną wyjątku w `dev`, ogólną stroną błędu w `prod` — a worker obsługuje dalej. Gdzie wyląduje ślad stosu, zależy od twojego loggera; goły skeleton nie ma żadnego. Do logu Rapiry na stderr trafia to, co ucieknie z samego PHP, jak wspomniany wyżej `EnvNotFoundException` — jak podkręcić poziom, pokazują [Logi](/pl/docs/logging).

::: question Czy potrzebuję `symfony/runtime`?
Do workera nie. W normalnej aplikacji odpowiada on za wczytanie `.env` i zbudowanie kernela z `public/index.php`, a `worker.php` robi obie te rzeczy sam i wprost. Mimo to zostaw pakiet zainstalowany — `bin/console` i `public/index.php` nadal przez niego przechodzą, a chcesz mieć oba sprawne.
:::

::: question Czy sesje działają?
Tak, jako natywne sesje PHP, dokładnie tak jak pod php-fpm: `session_start()` przy każdym żądaniu, ciasteczko wychodzi w odpowiedzi, a dane sesji wczytują się przy następnym. To przeszło weryfikację w baterii testów — łącznie z tym, że drugi klient z pustym zestawem ciasteczek dostaje własną sesję, a nie cudzą.
:::

::: question Czy to naprawdę ten sam `worker.php` na 7.4 i 8.1?
Bajt w bajt — obie zweryfikowane aplikacje uruchamiały identyczne pliki, bez jednego sprawdzenia wersji. Jedyna różnica między głównymi wersjami, która mogłaby tu wyjść — przeniesienie klasy `ServicesResetter` do innej przestrzeni nazw — jest niewidoczna, bo skrypt odwołuje się do serwisu przez jego publiczny identyfikator.
:::

::: question Kontroler rzucił nieprzechwyconym wyjątkiem. Straciłem workera?
Nie. Obsługa błędów Symfony zamienia go w odpowiedź `500`, a ten sam proces workera bierze kolejne żądanie — sprawdzone, pid workera nie zmienił się mimo awarii. Po wyjątku martwić się warto o serwis, który został z wyciekłym albo zepsutym stanem — i właśnie od tego jest reset na końcu handlera.
:::
