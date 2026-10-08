---
title: Laravel
description: "Uruchamianie Laravela w trybach Classic, Worker i Dispatcher z mostem rapira/laravel opartym na Laravel Octane."
---

# Laravel

Pakiet [`rapira/laravel`](https://github.com/rapira-rs/laravel) łączy Laravela z Rapirą. Jeden skrypt wejściowy obsługuje wszystkie trzy [tryby wykonania](/pl/docs/execution-modes). Klucz `mode` w `rapira.toml` wybiera tryb. Kod aplikacji się nie zmienia.

W trybach Worker i Dispatcher aplikacja inicjalizuje się raz i pozostaje w pamięci. Most używa workera [Laravel Octane](https://laravel.com/docs/octane), aby resetować stan aplikacji między żądaniami. Octane jest zależnością pakietu. Nie uruchamiasz `octane:start`, ponieważ Rapira zastępuje serwer Octane.

::: info Zweryfikowano na
- **rapira/laravel 0.1.1**
- **laravel/framework v13.34.0** i **laravel/octane v2.20.0**
- **PHP 8.5**: SAPI embed

Testy mostu wysyłają prawdziwe żądania HTTP do aplikacji Laravel w każdym z trzech trybów. Testy obejmują trasowanie, stronę 404, wyjątki w trasach, izolację konfiguracji między żądaniami, sesje, ciasteczka, dane formularzy, odpowiedzi strumieniowe i pobieranie plików.
:::

## Wymagania

- PHP 8.4 lub nowszy.
- Laravel 11, 12 lub 13.
- Rapira 0.9 lub nowsza. Zobacz [Instalacja](/pl/docs/intro/installation).

Rapira dostarcza PHP jako bibliotekę, a nie jako polecenie `php`. Zainstaluj PHP CLI dla Composera i `artisan`. Rapira nie używa ani nie zmienia tego CLI.

Nowy projekt `laravel/laravel` używa SQLite oraz sterowników sesji, cache'u i kolejek opartych na bazie danych, więc wymaga `pdo_sqlite`. Wydania Rapiry zawierają `pdo_sqlite`. Pełną listę rozszerzeń zawiera [Instalacja](/pl/docs/intro/installation). Jeśli kompilujesz PHP, włącz rozszerzenia, których potrzebują twoje sterowniki. Zobacz [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

## Instalacja

Zainstaluj pakiet:

```bash
composer require rapira/laravel
```

Laravel automatycznie wykrywa dostawcę usług (service provider) pakietu. Opublikuj skrypt wejściowy i początkową konfigurację serwera w katalogu głównym projektu:

```bash
php artisan vendor:publish --tag=rapira
```

Polecenie tworzy dwa pliki. `worker.php` to skrypt wejściowy dla wszystkich trybów:

```php
<?php

declare(strict_types=1);

use Rapira\Laravel\Runner;

require __DIR__ . '/vendor/autoload.php';

(new Runner(__DIR__))->run();
```

Argument `Runner` to katalog główny aplikacji, czyli katalog, który zawiera `bootstrap/app.php`. `rapira.toml` konfiguruje serwer:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"

[http.pool]
entrypoint = "worker.php"
# "dispatcher", "worker" lub "classic": ten sam worker.php obsługuje wszystkie trzy.
mode = "dispatcher"
```

Uruchom serwer:

```bash
rapira serve rapira.toml
```

Serwer działa na pierwszym planie, a aplikacja jest dostępna pod adresem `http://127.0.0.1:8000/`. Naciśnij `Ctrl-C`, aby zatrzymać serwer.

Względny `entrypoint` używa katalogu pliku konfiguracyjnego jako bazy. Wszystkie klucze i wartości domyślne opisuje [Konfiguracja](/pl/docs/configuration).

## Tryby wykonania

`Runner` odczytuje tryb przy starcie workera i uruchamia odpowiednią pętlę. Aby zmienić tryb, zmień `http.pool.mode`. Zachowaj ten sam `worker.php`.

| Tryb | Czas życia aplikacji | Źródło żądania |
| --- | --- | --- |
| `classic` | Jedno żądanie | Zmienne superglobalne wypełniane przez Rapirę |
| `worker` | Proces workera | Zmienne superglobalne wypełniane przez Rapirę |
| `dispatcher` | Proces workera | Obiekty `Rapira\Http\Exchange` |

**Tryb Classic** uruchamia ten sam cykl życia co `public/index.php` Laravela. Most wczytuje `bootstrap/app.php`, obsługuje żądanie, wysyła odpowiedź i wywołuje `terminate()`. Plik trybu konserwacji `storage/framework/maintenance.php` działa tak samo jak w `public/index.php`. Po żądaniu nie pozostaje żaden stan. Zobacz [tryb Classic](/pl/docs/classic).

**Tryb Worker** utrzymuje jedną aplikację w każdym procesie workera. Rapira wypełnia zmienne superglobalne dla każdego żądania, a most tworzy żądanie przez `Request::capture()`. Odpowiedź wychodzi przez `header()` i wyjście, jak w trybie Classic. Zobacz [tryb Worker](/pl/docs/worker).

**Tryb Dispatcher** utrzymuje jedną aplikację w każdym procesie workera. Most otrzymuje każde żądanie jako obiekt exchange od [dyspozytora](/pl/docs/dispatcher) HTTP. Tworzy z niego `Illuminate\Http\Request` i zapisuje odpowiedź z powrotem do obiektu exchange. Ten tryb jest domyślny.

We wszystkich trybach każdy worker obsługuje jedno żądanie naraz. Octane resetuje aplikację dla każdego żądania, więc dwa żądania nie mogą jednocześnie współdzielić jednej aplikacji.

### Zmienne superglobalne w trybie Dispatcher

W trybie Dispatcher Rapira nie wypełnia `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` ani wartości żądania w `$_SERVER`. Most również ich nie wypełnia. Kod Laravela, który czyta obiekt `Request`, nie potrzebuje tych zmiennych. Sesje i ciasteczka Laravela także działają przez obiekty `Request` i `Response`.

Użyj trybu Worker, jeśli aplikacja lub pakiet wykonuje jedną z tych operacji:

- Czyta zmienne superglobalne bezpośrednio.
- Wysyła nagłówki przez `header()` lub `setcookie()`.
- Używa natywnych sesji PHP (`session_start()`).

Most wypełnia wartości serwera w obiekcie `Request` tak, jakby żądanie obsłużył `public/index.php`. `SCRIPT_NAME` to `/index.php`, a `DOCUMENT_ROOT` to katalog `public/`. Nazwy nagłówków są mapowane na klucze `HTTP_*` według tych samych reguł co w trybie Worker.

## Stan między żądaniami

W trybach Worker i Dispatcher worker Octane inicjalizuje aplikację raz. Dla każdego żądania Octane klonuje aplikację do piaskownicy (sandbox). Następnie uruchamia swoje listenery, które resetują znany stan żądania. Na przykład zmiana konfiguracji w jednym żądaniu nie pojawia się w następnym żądaniu. Testy mostu potwierdzają to zachowanie w obu trybach.

Konfiguracja Octane kontroluje te listenery. Klucz `warm` zawiera listę serwisów do inicjalizacji przed pierwszym żądaniem. Klucz `flush` zawiera listę serwisów do usunięcia po każdym żądaniu. Octane używa swojej domyślnej konfiguracji, jeśli aplikacja nie ma `config/octane.php`. Aby zmienić konfigurację, opublikuj plik:

```bash
php artisan vendor:publish --tag=octane-config
```

Klucz `server` i ustawienia specyficzne dla serwera w tym pliku nie dotyczą Rapiry. Skonfiguruj serwer w `rapira.toml`.

Octane nie resetuje właściwości statycznych, zmiennych globalnych ani singletonów, które przechowują referencję do żądania lub kontenera. Kod aplikacji i pakiety muszą być bezpieczne dla trwałego workera. Zobacz [Dependency injection and Octane](https://laravel.com/docs/octane#dependency-injection-and-octane) w dokumentacji Laravela. Stan, który pozostaje w workerze, opisuje strona [Integracja z frameworkami](/pl/docs/frameworks/).

`Octane::concurrently()` uruchamia swoje zadania jedno po drugim. Magazyn cache Octane i `Octane::table()` wymagają Swoole. Nie są dostępne w Rapirze.

## Trasy i adresy URL

Rapira nie mapuje adresów URL na skrypty PHP. Każde żądanie uruchamia skrypt wejściowy, a Laravel trasuje ścieżkę żądania. Wygenerowane adresy są bezwzględne i nie zawierają ani `worker.php`, ani `index.php`. Nie wymagają nadpisywania `$_SERVER` ani zmian konfiguracji tras lub adresów URL.

Początkowy `rapira.toml` włącza [middleware plików statycznych](/pl/docs/static-files) dla `public/`. Middleware odpowiada na żądania, które pasują do plików w `public/`. Wszystkie pozostałe żądania trafiają do Laravela. Zamiast tego zasoby może serwować CDN lub reverse proxy.

Wbudowana trasa `/up` zwraca `200`. Load balancer lub kontener może jej użyć do kontroli stanu. Rapira może też serwować `/livez` i `/readyz` pod osobnym adresem. Zobacz [Metryki i kontrole stanu](/pl/docs/observability).

Rapira przyjmuje tylko nieszyfrowany HTTP, więc Laravel widzi każde żądanie jako `http`, także gdy żądanie ma nagłówek `X-Forwarded-Proto`. Gdy [proxy kończy TLS](/pl/docs/deployment), skonfiguruj w Laravelu [zaufane proxy](https://laravel.com/docs/requests#configuring-trusted-proxies). Bez tej konfiguracji `url()` tworzy odnośniki `http://`.

## Sesje, CSRF i formularze

Sesje Laravela używają ciasteczka sesji i skonfigurowanego sterownika sesji. Każdy klient otrzymuje osobną sesję. CSRF nie wymaga konfiguracji Rapiry, ponieważ token jest w sesji.

Testy mostu obejmują dane formularzy z zagnieżdżonymi polami i przesyłanie plików. W trybie Dispatcher most parsuje treść formularzy dla `POST`, `PUT`, `PATCH` i `DELETE`, tak jak robi to `Request::createFromGlobals()`.

`http.max_body_size_mb` ogranicza treść żądania przed uruchomieniem PHP, a wartość domyślna to 8 MiB. Rapira zwraca `413` dla większej treści, a Laravel nie otrzymuje żądania. Aby przyjmować większe pliki, zwiększ tę wartość. Zwiększ też `post_max_size` i `upload_max_filesize` w php.ini. Zobacz [Treść żądania](/pl/docs/http#tresc-zadania).

## Odpowiedzi

Most wysyła wszystkie typy odpowiedzi Laravela:

- **Odpowiedzi buforowane** wychodzą razem z nagłówkami i ciasteczkami.
- **Odpowiedzi strumieniowe** (`response()->stream()`) wychodzą w częściach. Callback może wywołać `ob_flush()` lub `flush()`, aby wysłać bieżącą część.
- **Odpowiedzi plikowe** (`response()->download()` i `response()->file()`) wychodzą razem z nagłówkami. W trybie Dispatcher most przekazuje ścieżkę pliku Rapirze, a Rapira czyta plik. Jeśli Rapira nie może wysłać pliku, PHP przesyła go strumieniowo.

Wyjście, które kontroler wypisuje przez `echo`, wychodzi przed treścią odpowiedzi.

W trybach Classic i Worker most wywołuje [`rapira_finish_request()`](/pl/docs/http) po odpowiedzi. Klient otrzymuje odpowiedź, zanim uruchomią się terminable middleware i sprzątanie Octane.

## Błędy

Laravel obsługuje wyjątek w trasie i zwraca swoją zwykłą odpowiedź `500`. Ten sam worker obsługuje następne żądanie.

Wyjątek może wydostać się poza kernel HTTP Laravela, na przykład z callbacku odpowiedzi strumieniowej. Wtedy Octane zgłasza wyjątek przez handler wyjątków Laravela. Klient otrzymuje odpowiedź `500` w postaci zwykłego tekstu, jeśli nagłówki odpowiedzi nie zostały jeszcze wysłane. Odpowiedź zawiera szczegóły wyjątku tylko wtedy, gdy `app.debug` ma wartość `true`.

Po takim wyjątku stan aplikacji może być niepoprawny. Octane zatrzymuje workera, a most kończy swoją pętlę. Następnie Rapira ponownie uruchamia skrypt wejściowy, a nowy worker ponownie inicjalizuje aplikację.

## Środowisko produkcyjne

Utwórz cache frameworka przed uruchomieniem serwera:

```bash
php artisan config:cache
php artisan route:cache
```

Worker może z czasem zwiększać zużycie pamięci. Ustaw limit wymiany workera:

```toml
[http.pool]
entrypoint = "worker.php"
mode = "dispatcher"
processes = 4
max_requests = 500
```

`max_requests` zastępuje workera po losowej liczbie żądań między tą wartością a 1,5 tej wartości. Ogranicza wpływ wycieku pamięci, ale go nie naprawia. Zobacz [Model procesów](/pl/docs/process-model).

W trybach Worker i Dispatcher kod aplikacji pozostaje w pamięci. Po wdrożeniu wyślij `SIGUSR2` do procesu nadrzędnego, aby zastąpić workery. Przy `opcache.validate_timestamps = 0` zamiast tego uruchom Rapirę ponownie. Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).

## Programowanie

W trybach Worker i Dispatcher każdy worker inicjalizuje aplikację raz. Po każdej zmianie kodu uruchom Rapirę ponownie, aby wczytać nowy kod PHP.

Możesz też użyć trybu Classic podczas programowania. Ustaw `mode = "classic"` w `rapira.toml` i zachowaj `entrypoint = "worker.php"`. Tryb Classic inicjalizuje aplikację przy każdym żądaniu, więc zapisane zmiany działają od razu.

::: question Czy mogę uruchomić Laravela w trybie Classic bez mostu?
Tak. Ustaw `entrypoint = "public/index.php"` i `mode = "classic"`. Wtedy każde żądanie uruchamia standardowy `public/index.php`, jak w php-fpm. Tryby Worker i Dispatcher wymagają mostu.
:::
