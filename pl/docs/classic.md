---
title: Tryb Classic
description: "Tryb Classic wykonuje zwykły skrypt wejściowy PHP od zera przy każdym żądaniu, tak jak robi to php-fpm, za każdym razem od czystego stanu."
---

# Tryb Classic

Tryb Classic wykonuje zwykły skrypt wejściowy PHP. Na przykład php-fpm wykonuje plik `public/index.php` przy każdym żądaniu.
Rapira uruchamia nowe żądanie PHP dla każdego żądania HTTP. Wypełnia zmienne superglobalne i wykonuje skrypt.
Wyjście skryptu staje się odpowiedzią. Rapira może zastąpić php-fpm bez zmian aplikacji.

## Świeży stan przy każdym żądaniu

Każde żądanie ma pełny cykl PHP. Obejmuje inicjalizację, wykonanie skryptu wejściowego i zamknięcie żądania.
PHP usuwa stan przed kolejnym żądaniem. Obejmuje on zmienne globalne, właściwości statyczne, kontener DI i mapę ORM.

Obiekty i dane żądania nie wpływają na kolejne żądanie. Wyjątkiem są trwałe połączenia i stan rozszerzeń w procesie workera.
Aplikacje bez obsługi trwałych procesów mogą działać w trybie Classic.
Rapira nie udostępnia funkcji php-fpm `fastcgi_finish_request()`. Użyj `rapira_finish_request()`, aby wysłać odpowiedź przed końcem skryptu.
Zobacz [HTTP](/pl/docs/http).

Aplikacja inicjalizuje autoloader, konfigurację, kontener i trasy dla każdego żądania. Zobacz [Tryby wykonania](/pl/docs/execution-modes).

## Konfiguracja trybu Classic

Wybierz tryb na jeden z tych sposobów:

- `--mode classic` w wierszu poleceń, obok skryptu wejściowego.
- `mode = "classic"` w sekcji `[pool]` pliku `rapira.toml`.

`--mode` zastępuje `pool.mode` z pliku. Inne argumenty CLI także zastępują odpowiednie wartości.
Pełną listę kluczy zawiera [Konfiguracja](/pl/docs/configuration).

Klasyczny skrypt wejściowy to zwykły PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Wybierz tryb przez CLI lub plik:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
```

:::

Uruchom `rapira serve --config rapira.toml`, aby użyć pliku konfiguracyjnego.
Względny `pool.entrypoint` używa katalogu pliku. Względna ścieżka CLI używa bieżącego katalogu.
Pozostałe opcje opisuje [Wiersz poleceń](/pl/docs/cli).

## Skrypt wejściowy

Rapira nie mapuje adresów URL na skrypty PHP. Każde żądanie uruchamia skonfigurowany skrypt wejściowy.
`$_SERVER['REQUEST_URI']` zawiera adres dla trasowania aplikacji.
[Middleware plików statycznych](/pl/docs/static-files) może zwracać pliki dla żądań `GET` i `HEAD`.
Skrypt wejściowy przetwarza pozostałe żądania.

`SCRIPT_FILENAME` zawsze zawiera ścieżkę skryptu. `SCRIPT_NAME` zawiera nazwę z początkowym ukośnikiem, na przykład `/index.php`.
`DOCUMENT_ROOT` zawiera katalog skryptu. CDN lub reverse proxy może też serwować pliki statyczne.
Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).

## OPcache

Każde żądanie resetuje stan aplikacji, ale nie skompilowany bytecode. Proces nadrzędny uruchamia PHP przed utworzeniem workerów.
OPcache tworzy jeden segment pamięci współdzielonej. Każdy worker używa tego samego mapowania.
Po włączeniu OPcache pula używa skryptów z cache'u między żądaniami. PHP nie analizuje ponownie skryptu wejściowego.

Tryby Classic i Worker używają tego samego typu puli. Proces nadrzędny tworzy workery, a każdy obsługuje jedno żądanie naraz.
Liczba workerów określa maksymalną liczbę równoczesnych żądań. Zobacz [model procesów](/pl/docs/process-model).

::: info
W trybie Classic `Rapira\handle_request()` rzuca `Rapira\Exception\NotInWorkerModeError`. Skrypt kończy się z żądaniem i nie może uruchomić pętli.
Użyj trybu [Worker](/pl/docs/worker) dla skryptów workera.
:::

## Wybór między Classic a Worker

Użyj Classic, gdy aplikacja nie może bezpiecznie zachować stanu między żądaniami. Dotyczy to bibliotek zapisujących dane w polach statycznych.
Classic zmniejsza też liczbę zmian podczas migracji z php-fpm.
Użyj trybu [Worker](/pl/docs/worker), gdy aplikacja obsługuje trwały proces. Worker usuwa inicjalizację z każdego żądania.
Zobacz [Tryby wykonania](/pl/docs/execution-modes).
