---
title: Symfony
description: "Uruchamianie Symfony w trybie Worker ze skryptem workera, zerowaniem serwisów między żądaniami i wartościami .env w kontenerze."
---

# Symfony

Symfony obsługuje trwały worker. Aplikacja inicjalizuje kernel, przekazuje mu `Request` i otrzymuje `Response`. Rapira inicjalizuje kernel raz dla każdego workera. Następnie każde żądanie wywołuje `handle()` na tym samym kernelu.

Kod aplikacji się nie zmienia. Skrypt workera zastępuje `public/index.php`. Ta strona opisuje ten plik, zerowanie stanu żądania i wartości `.env`.

::: info Zweryfikowano na
- **PHP 8.5.8**: NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15), testy w `dev` i `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2), testy w `dev`

Obie aplikacje bazowe używały pakietu `symfony/skeleton` i jednego workera. Obie używały **tego samego `worker.php`** bez warunków wersji. Testy obejmowały routing, błędy, żądania, sesje, upload plików i 200 kolejnych żądań. Przykłady na tej stronie używają formatu konfiguracji v0.9.
:::

## Zachowanie w trybie Worker

Kernel jest inicjalizowany poza pętlą i pozostaje do ponownego uruchomienia skryptu workera. Autoloader, kontener, router, event dispatcher i połączenia są inicjalizowane raz. Więcej informacji zawierają strony [Tryb Worker](/pl/docs/worker) i [Tryby wykonania](/pl/docs/execution-modes).

Przy każdym żądaniu handler tworzy `Request` ze zmiennych superglobalnych, które wypełnia Rapira. Następnie wywołuje `handle()`, `send()` i `terminate()`. Na koniec wywołuje `services_resetter`, aby wyzerować serwisy ze stanem. Wysyłanie odpowiedzi opisuje strona [HTTP](/pl/docs/http).

Sesje używają natywnych funkcji sesji PHP. Żądanie, które używa sesji, wywołuje `session_start()`, a odpowiedź zawiera ciasteczko sesji. Następne żądanie czyta zapisaną sesję. Testy potwierdziły, że osobni klienci otrzymują osobne sesje.

Każdy proces workera ma jeden kernel. Workery nie dzielą obiektów aplikacji. Liczbę workerów i nadzór nad nimi opisuje [Model procesów](/pl/docs/process-model).

## Wymagania wstępne

Zainstaluj [Rapirę](/pl/docs/intro/installation). Utwórz lub wybierz aplikację Symfony. Umieść skrypt workera obok `composer.json`.

Zainstaluj PHP CLI dla Composera i `bin/console`. Rapira dostarcza PHP jako bibliotekę, a nie jako polecenie `php`. Composer i `bin/console` używają systemowego PHP CLI. Rapira nie używa ani nie zmienia tego CLI.

Aplikacja bazowa wymaga rozszerzeń `ctype` i `iconv`. Zastępuje też ich polyfille PHP, więc oba muszą być natywnymi rozszerzeniami. Systemowe PHP CLI także ich potrzebuje do sprawdzenia platformy przez Composera. Każde wydanie Rapiry zawiera oba rozszerzenia.

Pełną listę rozszerzeń zawiera strona [Instalacja](/pl/docs/intro/installation). Włącz oba rozszerzenia, gdy kompilujesz PHP. Zobacz [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Worker używa też komponentu `symfony/dotenv` z aplikacji bazowej. Usuń wywołanie Dotenv, jeśli środowisko wdrożenia dostarcza wszystkie zmienne środowiskowe. Następnie usuń komponent, jeśli nie używa go żaden inny punkt wejścia. Worker czyta `.env` i tworzy kernel bez `symfony/runtime`. Zachowaj `symfony/runtime`, bo używają go `bin/console` i `public/index.php`.

## Skrypt workera

Zapisz ten plik jako `worker.php` w katalogu głównym projektu. Testy używały go z obiema wersjami Symfony:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->bootEnv(__DIR__ . '/.env');

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

Większość operacji to standardowa inicjalizacja Symfony. Cztery części są specyficzne dla tego workera:

**`(new Dotenv())->bootEnv(...)`.** Standardowy `public/index.php` przekazuje tę operację do `symfony/runtime`. Worker czyta `.env` raz przed utworzeniem kernela. Rapira zachowuje te wartości `$_ENV` między żądaniami.

**Kernel jest inicjalizowany przed pętlą.** `new Kernel(...)`, `boot()` i `getContainer()` działają podczas inicjalizacji workera. Kernel czyta `$_SERVER['APP_ENV']` podczas inicjalizacji workera. Każde żądanie używa tego samego kontenera.

**`$container->has('services_resetter')` przed `get()`.** Identyfikator `services_resetter` jest publiczny w obu obsługiwanych wersjach. Klasa implementacji używa innych przestrzeni nazw w wersjach 7.4 i 8.1. Identyfikator serwisu usuwa potrzebę warunku wersji. Sprawdzenie `has()` zapobiega błędowi, gdy kontener nie definiuje serwisu.

**Pętla i `gc_collect_cycles()`.** `\Rapira\handle_request()` czeka na żądanie, uruchamia handler i zwraca `true`. Podczas zamykania workera zwraca `false` i kończy pętlę. Skrypt zbiera cykle między żądaniami. Pełny kontrakt opisuje [Tryb Worker](/pl/docs/worker).

Jeśli resetter nie wystarcza, użyj `$container->reset()` albo `$kernel->reboot(null)`. Pierwsza opcja usuwa każdy utworzony serwis. Druga opcja usuwa kontener i tworzy nowy.

Po `$kernel->reboot(null)` pobierz nowy kontener przez `$kernel->getContainer()`. Handler nie może używać poprzedniego kontenera. Obie opcje usuwają zapisany stan aplikacji. Używaj ich do szukania wycieku pamięci, a nie jako konfiguracji domyślnej.

## `$_ENV` i środowisko procesu

Rapira zachowuje `$_ENV` do ponownego uruchomienia skryptu workera. Nie odtwarza tej zmiennej superglobalnej przy każdym żądaniu. Wartości wczytane przez `bootEnv()` przed pętlą pozostają dostępne podczas późniejszych żądań. To zachowanie działa także z `variables_order = "GPCS"` i `auto_globals_jit = On`.

Przed pierwszym żądaniem `$_SERVER` zawiera środowisko procesu. Dotenv nie zastępuje zmiennej, którą `$_SERVER` lub `$_ENV` już zawiera. Dlatego zmienna środowiskowa ma pierwszeństwo przed tą samą zmienną w `.env`, także z `variables_order = "GPCS"`.

Na przykład dodaj `usePutenv()`, jeśli kod aplikacji musi odczytać wartości Dotenv przez `getenv()`:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` zapisuje wartości Dotenv w środowisku procesu. Symfony `%env(...)%` może odczytać zachowane wartości `$_ENV` bez tego wywołania. Rapira uruchamia jeden interpreter NTS PHP w każdym procesie. PHP nie wywołuje `putenv()` ze współbieżnych wątków.

W środowisku produkcyjnym ustaw zmienne przez systemd, środowisko uruchomieniowe kontenerów albo orkiestrator. Używaj `.env` tylko podczas programowania.

## Uruchamianie Rapiry

Utwórz `rapira.toml` obok `worker.php`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

Uruchom Rapirę:

```bash
rapira serve rapira.toml
```

`mode = "worker"` wybiera tryb Worker. `rapira serve` działa na pierwszym planie.

Otwórz drugi terminal. Wyślij żądanie:

```bash
curl -i http://127.0.0.1:8000/
```

Naciśnij `Ctrl-C` w pierwszym terminalu, aby zatrzymać Rapirę.

Skryptem wejściowym jest `worker.php`, więc `$_SERVER['SCRIPT_NAME']` zawiera `/worker.php`. Symfony nie znajduje tej wartości na początku URI. Następnie ustawia bazowy URL na `""`. `getPathInfo()` zwraca ścieżkę żądania i routing działa poprawnie. `generateUrl()` tworzy ścieżki bez prefiksu `/worker.php`. Nie trzeba zmieniać `$_SERVER` ani używać `Request::setTrustedProxies()`.

## Środowisko produkcyjne

Ustaw `APP_ENV=prod`. Zainstaluj zależności bez pakietów deweloperskich. Utwórz cache przed uruchomieniem serwera. Testy potwierdziły poprawną inicjalizację przez `php bin/console cache:warmup`. To polecenie kompiluje również kontener przed pierwszym żądaniem:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Sprawdź `DEFAULT_URI` podczas konfiguracji. Aplikacja bazowa ustawia `router.default_uri` na `%env(DEFAULT_URI)%` w każdym środowisku. Wartość domyślna to `http://localhost`. Polecenia konsoli i kod e-maili używają tej wartości, aby tworzyć URL-e poza żądaniem HTTP. Ustaw ją na adres źródłowy aplikacji.

Użyj tego minimalnego `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` zastępuje workera po losowej liczbie żądań między tą wartością a 1,5 tej wartości. Ogranicza wpływ wycieku pamięci, ale go nie naprawia. `request_terminate_timeout_secs` zatrzymuje workera, gdy jedno żądanie działa dłużej niż ten limit. Nowy worker ponownie inicjalizuje kernel. Względny `entrypoint` używa katalogu pliku konfiguracji jako bazy. Wszystkie ustawienia opisuje [Konfiguracja](/pl/docs/configuration).

Uruchom serwer z `APP_ENV=prod`:

```bash
APP_ENV=prod rapira serve rapira.toml
```

Po wdrożeniu wyślij `SIGUSR2` do procesu nadrzędnego, aby zastąpić workery. Przy `opcache.validate_timestamps = 0` zamiast tego uruchom Rapirę ponownie. Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).

## Zerowanie stanu między żądaniami

`services_resetter` wywołuje `reset()` dla każdego serwisu z tagiem `kernel.reset`. Zainstalowane bundle określają, które serwisy mają ten tag. Przykłady to buforowane handlery logów i kolektory danych debugowych. Te serwisy same rejestrują tag.

Nie zeruje statycznych właściwości aplikacji, wartości globalnych, rejestrów bibliotek ani trwałych zmian `ini_set()`. Ten stan pozostaje w każdym trwałym workerze. Zeruj go w kodzie aplikacji. Tabelę czasu życia stanu zawiera strona [Frameworki](/pl/docs/frameworks/).

Testy z resetterem wykazały stabilne użycie pamięci procesu podczas 200 kolejnych żądań w `dev` i `prod`. Jeśli pamięć rośnie, kod aplikacji lub bundle może zachowywać stan żądania.

## Praca po odesłaniu odpowiedzi

Wywołaj [`rapira_finish_request()`](/pl/docs/http) między `$response->send()` a `$kernel->terminate()`, aby wysłać odpowiedź przed uruchomieniem listenerów po odpowiedzi. Worker wykonuje `terminate()` do powrotu handlera. Może to skrócić oczekiwanie klienta, ale nie zwiększa współbieżności.

## Programowanie

W trybie Worker każdy worker inicjalizuje aplikację raz. Po każdej zmianie kodu uruchom Rapirę ponownie, aby wczytać nowy kod PHP. Możesz też użyć [trybu Classic](/pl/docs/classic) podczas programowania. Tryb Classic uruchamia skrypt wejściowy przy każdym żądaniu. Zmień `rapira.toml` na tryb Classic:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

```bash
rapira serve rapira.toml
```

W trybie Classic ta sama aplikacja jest inicjalizowana przy każdym żądaniu. Dlatego zapisane zmiany działają od razu.

## Błędy i logi

Symfony obsługuje nieprzechwycony wyjątek aplikacji i zwraca własną odpowiedź `500`. `dev` pokazuje stronę wyjątku, a `prod` pokazuje ogólną stronę błędu. Ten sam worker obsługuje następne żądanie. Końcowe zerowanie usuwa zmieniony stan serwisów po wyjątku.

Skonfigurowany logger Symfony kontroluje wyjście wyjątku. Aplikacja bazowa nie zawiera loggera. Rapira zapisuje błędy PHP, których Symfony nie obsługuje. Konfigurację poziomów opisuje strona [Logi](/pl/docs/logging).
