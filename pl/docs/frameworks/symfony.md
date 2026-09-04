---
title: Symfony
description: "Jak uruchomić aplikację Symfony na Rapirze w trybie Worker: skrypt workera, reset serwisów między żądaniami i to, jak wartości z .env docierają do kontenera."
---

# Symfony

Symfony obsługuje trwały worker. Aplikacja inicjalizuje kernel, przekazuje mu `Request` i otrzymuje `Response`.
Rapira inicjalizuje kernel raz dla każdego workera. Następnie każde żądanie wywołuje `handle()` na zainicjalizowanym kontenerze.
Kod aplikacji się nie zmienia. Skrypt workera zastępuje `public/index.php`.
Ta strona opisuje ten plik, zerowanie stanu żądania i wartości `.env`.

::: info Zweryfikowano na
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) - pełna bateria testów w `dev` i w `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) - pełna bateria testów w `dev`

Testy używały dwóch aplikacji utworzonych z pakietu `symfony/skeleton` i jednego procesu workera. Obie aplikacje uruchamiały **ten sam `worker.php`** - bajt w bajt, bez żadnej gałęzi na wersję. Testy obejmowały routing, 404, query stringi, generowanie URL-i, wysyłkę formularza, treść w JSON-ie, sesje trzymające się między żądaniami, upload pliku, nieprzechwycony wyjątek i 200 żądań pod rząd.
:::

## Zachowanie w trybie Worker

Kernel jest inicjalizowany poza pętlą i pozostaje do zakończenia workera. Autoloader, kontener, router, event dispatcher i połączenia powstają raz.
Więcej informacji zawierają strony [tryb Worker](/pl/docs/worker) i [Tryby wykonania](/pl/docs/execution-modes).

Przy każdym żądaniu handler robi cztery rzeczy, a na koniec sprząta:

1. `Request::createFromGlobals()` - Rapira przed wywołaniem twojego handlera wypełnia od nowa `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i `$_FILES`, więc zwykły konstruktor Symfony czyta dokładnie to samo, co pod php-fpm.
2. `$kernel->handle($request)` - routing, kontroler, odpowiedź, bez zmian.
3. `$response->send()` - wyjście staje się odpowiedzią HTTP (o tym, jak jest ona pakowana w drodze na zewnątrz, mówi [HTTP](/pl/docs/http)).
4. `$kernel->terminate($request, $response)` - uruchamiają się listenery po odpowiedzi, tak samo jak zawsze.

Potem handler zeruje serwisy trzymające stan przez `services_resetter` z kontenera - to dokładnie ten sam reset, który Symfony wykonuje między wiadomościami Messengera, i to nim długo żyjący kernel pozbywa się tego, co narosło w trakcie żądania.

Sesje działają jako natywne sesje PHP, dokładnie tak jak pod php-fpm: `session_start()` przy każdym żądaniu, ciasteczko wychodzi razem z odpowiedzią, a dane wczytują się przy następnym. Izolacja między klientami została zweryfikowana: drugi klient z pustym zestawem ciasteczek dostaje własną sesję.

Jeden kernel żyje w jednym procesie workera, a workery to osobne procesy systemowe - w przestrzeni użytkownika nie dzielą ze sobą niczego. Ile ich jest i jak są nadzorowane, opisuje [Model procesów](/pl/docs/process-model).

## Wymagania wstępne

Zainstaluj [Rapirę](/pl/docs/intro/installation) i utwórz lub wybierz aplikację Symfony. Umieść skrypt workera obok `composer.json`.
Zainstaluj PHP CLI dla Composera i `bin/console`. Rapira dostarcza PHP jako bibliotekę, a nie polecenie `php`.
Composer i `bin/console` używają systemowego PHP CLI. Rapira nie używa ani nie zmienia tego CLI.

Znaczenie mają dwa rozszerzenia, bo plik `composer.json` aplikacji bazowej wymaga ich (`ext-ctype`, `ext-iconv`), *a przy okazji* wypisuje odpowiadające im polyfille w sekcji `replace` - muszą to więc być prawdziwe rozszerzenia, a nie ich namiastki napisane w PHP. Potrzebują ich obie kompilacje PHP, systemowy CLI też: inaczej `composer create-project` i `composer install` polegną na sprawdzeniu wymagań platformy, zanim Rapira w ogóle wejdzie do gry. PHP dołączane do każdego wydania Rapiry ma oba: `ctype` i `iconv` stoją w linii konfiguracyjnej tego builda, a pełną listę rozszerzeń znajdziesz na stronie [Instalacja](/pl/docs/intro/installation). Jeśli zamiast tego kompilujesz Rapirę przeciwko własnemu PHP, zostaw oba włączone - gdzie ustawia się tę listę, pokazuje [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Plik workera poniżej korzysta też z `symfony/dotenv`, który zawiera aplikacja bazowa. Jeśli twoje wdrożenie ustawia prawdziwe zmienne środowiskowe i nie ma żadnego `.env`, skasuj tę linię, a razem z nią cały komponent. Worker nie przechodzi przez `symfony/runtime` - sam wczytuje `.env` i sam buduje kernel - ale zostaw pakiet zainstalowany, bo `bin/console` i `public/index.php` nadal z niego korzystają.

## Skrypt workera

Wrzuć to do katalogu głównego projektu jako `worker.php`. To skrypt, który przeszedł weryfikację na obu głównych wersjach, uaktualniony do bieżącego API workera:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // Symfony uses the same reset between Messenger messages.
        // Each service with the kernel.reset tag removes request state.
        // The finally block also resets state when send() or terminate() throws.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Większość to zwykły rozruch Symfony. Cztery linie są specyficzne dla tego układu:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** Standardowy `public/index.php` przekazuje tę operację do `symfony/runtime`.
Worker czyta `.env` raz przed utworzeniem kernela. `usePutenv()` zachowuje te wartości, jeśli PHP odtworzy `$_ENV` podczas żądania.
Więcej informacji zawiera sekcja [`$_ENV` i `variables_order`](#env-i-variables-order).

**Kernel jest inicjalizowany przed pętlą.** `new Kernel(...)`, `boot()` i `getContainer()` działają podczas inicjalizacji workera.
Dlatego kernel czyta `$_SERVER['APP_ENV']`, zanim żądanie może usunąć wartości Dotenv. Każde żądanie używa tego samego kontenera.

**`$container->has('services_resetter')` przed `get()`.** Identyfikator `services_resetter` jest publiczny w obu obsługiwanych wersjach.
Klasa implementacji używa innych przestrzeni nazw w wersjach 7.4 i 8.1. Identyfikator serwisu usuwa potrzebę warunku wersji.
Sprawdzenie `has()` zapobiega błędowi, gdy kontener nie definiuje serwisu.

**Pętla i `gc_collect_cycles()`.** `\Rapira\handle_request()` blokuje wykonanie, dopóki nie przyjdzie żądanie, uruchamia twój handler i zwraca `true`. Zwraca `false`, gdy worker zaczyna się wygaszać, i to właśnie kończy pętlę. Zbieranie cykli raz na obrót trzyma tę pracę między żądaniami, a nie w środku któregoś z nich. Pełny kontrakt opisuje [tryb Worker](/pl/docs/worker).

Jeśli resetter nie wystarcza, użyj `$container->reset()` albo `$kernel->reboot(null)`. Pierwsza opcja usuwa wszystkie utworzone serwisy.
Druga opcja usuwa kontener i tworzy nowy.
Po `$kernel->reboot(null)` pobierz nowy kontener przez `$kernel->getContainer()`. Handler nie może używać poprzedniego kontenera.
Obie opcje usuwają zapisany stan aplikacji. Używaj ich do szukania wycieku, a nie jako ustawienia domyślnego.

## `$_ENV` i `variables_order`

::: warning
Testowana aplikacja bazowa używała `bootEnv()` bez `usePutenv()`.
Przy `variables_order = "GPCS"` i `auto_globals_jit = On` każde żądanie w `prod` zwracało **500**.
Błąd występował, gdy `RequestContext` odczytywał `DEFAULT_URI` podczas żądania.
Wyjątek to `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. Ta sama aplikacja w `dev` nie kończyła się błędem.
:::

Ten wynik powoduje PHP. Przy `variables_order = "GPCS"` i `auto_globals_jit = On` PHP zeruje flagę JIT `$_ENV` dla każdego żądania.
Pierwszy skompilowany plik używający `$_ENV` wywołuje `php_auto_globals_create_env`. Ta funkcja ponownie importuje `$_ENV` ze środowiska procesu.
Operacja usuwa wartości dodane przez `Dotenv->bootEnv()` podczas inicjalizacji. Testy wykazały, że `$_ENV` staje się puste podczas żądania.

W `prod` pierwsze żądanie kompiluje kontener i pliki serwisów. PHP czyści `$_ENV`, zanim `RequestContext` rozwiąże `%env(DEFAULT_URI)%`.
W `dev` kontener rozwiązuje i zapisuje wartości podczas `$kernel->boot()`. PHP czyści `$_ENV` po tej operacji.
Zerowanie występuje w obu środowiskach, ale tylko `prod` używa wyczyszczonej wartości.

Użyj tego wywołania:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` zapisuje wartości Dotenv w środowisku procesu. Późniejszy import odczytuje te wartości.
Symfony `EnvVarProcessor` może również odczytać je przez `getenv()`.
Rapira uruchamia jeden interpreter NTS PHP w każdym procesie. Dlatego współbieżne wątki PHP nie wywołują `putenv()`.

W środowisku produkcyjnym ustaw zmienne przez systemd, kontener albo orkiestrator.
Używaj `.env` tylko podczas programowania. Zarówno `usePutenv()`, jak i środowisko wdrożenia zapisują wartości w środowisku procesu.
Dlatego późniejszy import zachowuje te wartości.

To zachowanie dotyczy każdego trwałego środowiska PHP, które czyta `$_ENV` podczas żądania.
To i inne zachowania opisuje strona [Frameworki](/pl/docs/frameworks/).

## Uruchamianie Rapiry

Uruchom Rapirę:

```bash
rapira serve --mode worker worker.php
```

`--mode worker` wybiera tryb Worker. `127.0.0.1:8000` to domyślny adres nasłuchu.
`rapira serve` działa na pierwszym planie.

Otwórz drugi terminal. Wyślij żądanie:

```bash
curl -i http://127.0.0.1:8000/
```

Naciśnij `Ctrl-C` w pierwszym terminalu, aby zatrzymać Rapirę.

Skryptem wejściowym jest `worker.php`, więc `$_SERVER['SCRIPT_NAME']` zawiera `/worker.php`. Symfony nie znajduje tej wartości na początku URI.
Następnie ustawia bazowy URL na `""`. `getPathInfo()` zwraca ścieżkę żądania i routing działa poprawnie.
`generateUrl()` tworzy ścieżki bez prefiksu `/worker.php`. Nie trzeba zmieniać `$_SERVER` ani używać `Request::setTrustedProxies()`.

## Wyjście na produkcję

Ustaw `APP_ENV=prod`. Zainstaluj zależności bez pakietów deweloperskich.
Utwórz cache przed uruchomieniem serwera. Testy potwierdziły poprawną inicjalizację przez `php bin/console cache:warmup`.
To polecenie kompiluje również kontener przed pierwszym żądaniem:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Przy okazji sprawdź `DEFAULT_URI`. W aplikacji bazowej plik `config/packages/routing.yaml` ustawia `router.default_uri` na `%env(DEFAULT_URI)%` w **każdym** środowisku, a `.env` przynosi tam `http://localhost` - to właśnie z tej wartości powstają URL-e generowane poza żądaniem HTTP: w poleceniach konsolowych i w mailach. Wskaż nią swój prawdziwy adres.

Mały `rapira.toml`, żeby to uruchomić:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` zastępuje workera po określonej liczbie żądań. Ogranicza wpływ wycieku pamięci, ale go nie naprawia.
`request_terminate_timeout_secs` ogranicza czas jednego żądania.
Uruchom serwer poleceniem `APP_ENV=prod rapira serve --config rapira.toml`.
Względny `entrypoint` używa katalogu pliku. Wszystkie ustawienia opisuje [Konfiguracja](/pl/docs/configuration).

## Zerowanie stanu między żądaniami

`services_resetter` wywołuje `reset()` dla każdego serwisu z tagiem `kernel.reset`. Zainstalowane bundle określają te serwisy.
Przykłady to buforowane handlery logów i kolektory danych debugowych. Serwisy same rejestrują tag.

Nie zeruje statycznych właściwości aplikacji, wartości globalnych, rejestrów bibliotek ani trwałych zmian `ini_set()`.
Ten stan pozostaje w każdym trwałym workerze. Zeruj go w kodzie aplikacji.
Czas życia stanu opisuje strona [Frameworki](/pl/docs/frameworks/).

Testy z resetterem wykazały stabilne użycie pamięci podczas 200 kolejnych żądań w `dev` i `prod`.
Jeśli pamięć rośnie, kod aplikacji lub bundle może zachowywać stan żądania.

## Praca po odesłaniu odpowiedzi

Wywołaj [`rapira_finish_request()`](/pl/docs/http) między `$response->send()` a `$kernel->terminate()`, aby wysłać odpowiedź przed późniejszymi listenerami.
Worker wykonuje `terminate()` do powrotu handlera. Może to skrócić oczekiwanie klienta, ale nie zwiększa współbieżności.

## Codzienna praca nad kodem

`rapira serve` działa na pierwszym planie i inicjalizuje aplikację raz. Dlatego **zastąp workera, aby wczytać zmieniony kod PHP**.
Podczas programowania uruchamiaj serwer ponownie po każdej zmianie. Możesz też użyć [trybu Classic](/pl/docs/classic):

```bash
rapira serve --mode classic public/index.php
```

Ta sama aplikacja działa w trybie Classic i uruchamia się przy każdym żądaniu. Dlatego zmiany działają od razu, a każde żądanie obejmuje pełny rozruch. Na serwerze produkcyjnym wdrożony kod przejmuje pracę dzięki przeładowaniu kroczącemu (`SIGUSR2` do procesu nadrzędnego). Bieżące żądania mogą się zakończyć, ale bezczynne połączenia keep-alive są zamykane. Przy `opcache.validate_timestamps = 0` segment OPcache procesu nadrzędnego przeżywa całą pulę. W tej konfiguracji wdrożenie wymaga pełnego restartu. Więcej informacji zawierają [model procesów](/pl/docs/process-model) i [wdrożenie produkcyjne](/pl/docs/deployment).

Symfony obsługuje nieprzechwycony wyjątek aplikacji i zwraca własną odpowiedź `500`. `dev` pokazuje stronę wyjątku.
`prod` pokazuje ogólną stronę błędu. Ten sam worker obsługuje następne żądanie.
Końcowe zerowanie usuwa zmieniony stan serwisów. Skonfigurowany logger Symfony kontroluje wyjście wyjątku. Aplikacja bazowa nie zawiera loggera.
Rapira zapisuje błędy PHP, które opuszczają framework, na przykład opisany wyżej `EnvNotFoundException`. Poziomy opisuje strona [Logi](/pl/docs/logging).
