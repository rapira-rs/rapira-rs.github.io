---
title: Tryb Classic
description: Tryb Classic wykonuje zwykły skrypt wejściowy PHP z nowym stanem przy każdym żądaniu.
---

# Tryb Classic

Tryb Classic wykonuje zwykły skrypt wejściowy PHP. Może to być ten sam plik `public/index.php`, który wykonuje php-fpm. Rapira uruchamia nowe żądanie PHP dla każdego żądania HTTP. Wypełnia zmienne superglobalne i wykonuje skrypt. Wyjście skryptu staje się odpowiedzią. Większość aplikacji może przejść z php-fpm na tryb Classic bez zmian w kodzie.

## Nowy stan przy każdym żądaniu

Każde żądanie ma pełny cykl żądania PHP. Cykl obejmuje inicjalizację żądania, wykonanie skryptu wejściowego i zamknięcie żądania. PHP usuwa stan żądania przed kolejnym żądaniem. Ten stan obejmuje zmienne globalne, właściwości statyczne, kontener wstrzykiwania zależności i mapę tożsamości ORM.

Obiekty i dane żądania nie mogą wpłynąć na późniejsze żądanie. Część stanu zostaje w procesie workera: trwałe połączenia, stan rozszerzeń i katalog roboczy. Aplikacje bez obsługi trwałych procesów mogą działać w trybie Classic.

Aplikacja inicjalizuje autoloader, konfigurację, kontener i trasy dla każdego żądania. Zobacz [Tryby wykonania](/pl/docs/execution-modes).

Każdy worker używa katalogu skryptu wejściowego jako katalogu roboczego. Wywołanie `chdir()` w żądaniu działa też w późniejszych żądaniach tego samego workera, do zakończenia workera. Jeśli żądanie zmienia katalog roboczy, przywróć go przed końcem żądania.

Rapira nie udostępnia funkcji php-fpm `fastcgi_finish_request()`. Użyj `rapira_finish_request()`, aby wysłać odpowiedź przed końcem skryptu. Zobacz [HTTP](/pl/docs/http).

## Wybór trybu

Wybierz tryb Classic przez `mode = "classic"` w tabeli `[http.pool]` pliku `rapira.toml`. Tylko pula HTTP obsługuje tryb Classic. Pełną listę kluczy zawiera [Konfiguracja](/pl/docs/configuration).

Klasyczny skrypt wejściowy to zwykły PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Plik `rapira.toml` dla tego skryptu:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Uruchom Rapirę przez `rapira serve rapira.toml`. Względny `http.pool.entrypoint` używa katalogu pliku konfiguracyjnego jako podstawy. Polecenie opisuje [Wiersz poleceń](/pl/docs/cli).

## Skrypt wejściowy

Rapira nie mapuje adresów URL na skrypty PHP. Każde żądanie uruchamia skonfigurowany skrypt wejściowy. `$_SERVER['REQUEST_URI']` zawiera adres URL dla trasowania aplikacji.

[Middleware plików statycznych](/pl/docs/static-files) może zwracać pliki dla żądań `GET` i `HEAD`. Skrypt wejściowy przetwarza żądania, na które middleware nie odpowiada. CDN lub reverse proxy może też serwować pliki statyczne. Przykład reverse proxy zawiera [Wdrożenie produkcyjne](/pl/docs/deployment).

`SCRIPT_FILENAME` zawiera bezwzględną ścieżkę skryptu wejściowego. `SCRIPT_NAME` zawiera nazwę pliku z początkowym ukośnikiem, na przykład `/index.php`. `DOCUMENT_ROOT` zawiera katalog skryptu wejściowego.

## Przesyłanie plików

PHP analizuje treści `multipart/form-data` i wypełnia `$_FILES`, tak jak w php-fpm. Obowiązują ustawienia `upload_max_filesize` i `post_max_size` z `php.ini`.

Rapira stosuje `http.max_body_size_mb` do pełnej treści żądania przed uruchomieniem PHP. Wartość domyślna to 8 MiB. Rapira zwraca `413` dla większej treści. Jeśli `php.ini` pozwala na większe pliki, zwiększ `http.max_body_size_mb` do wartości `post_max_size`. Zobacz [Treść żądania](/pl/docs/http#tresc-zadania).

Tabela `[http.uploads]` dotyczy tylko trybu Dispatcher. Rapira nie uruchamia się, gdy konfiguracja Classic zawiera tę tabelę. Zobacz [Konfiguracja](/pl/docs/configuration#tabela-http-uploads).

## OPcache

Każde żądanie PHP usuwa stan aplikacji. OPcache zachowuje skompilowany bytecode między żądaniami. Proces nadrzędny uruchamia PHP przed utworzeniem workerów, więc wszystkie workery używają tego samego segmentu pamięci współdzielonej OPcache. Po włączeniu OPcache późniejsze żądania używają bytecode'u z cache'u, a PHP nie kompiluje ponownie niezmienionych skryptów. Konfigurację OPcache opisuje [Wdrożenie produkcyjne](/pl/docs/deployment).

Każdy worker obsługuje jedno żądanie naraz. `http.pool.processes` określa liczbę workerów, która jest też maksymalną liczbą równoczesnych żądań. Zobacz [model procesów](/pl/docs/process-model).

## Wybór między Classic a Worker

Użyj trybu Classic, gdy aplikacja nie może bezpiecznie zachować stanu między żądaniami. Na przykład niektóre aplikacje i biblioteki zewnętrzne zapisują dane żądania we właściwościach statycznych. Tryb Classic zmniejsza też liczbę zmian w aplikacji przy przejściu z php-fpm. Użyj trybu [Worker](/pl/docs/worker), gdy aplikacja obsługuje trwały proces. Tryb Worker usuwa inicjalizację aplikacji z każdego żądania. Wszystkie trzy tryby opisuje [Tryby wykonania](/pl/docs/execution-modes).

::: info
W trybie Classic `Rapira\handle_request()` rzuca `Rapira\Exception\NotInWorkerModeError`. Skrypt Classic kończy się razem ze swoim żądaniem i nie może uruchomić pętli żądań.
:::
