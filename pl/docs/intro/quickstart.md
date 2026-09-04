---
title: Szybki start
description: "Uruchomienie aplikacji PHP w trybach Classic i Worker oraz zapisanie ustawień w rapira.toml."
---

# Szybki start

Ten przewodnik uruchamia aplikację w trybie Classic, a następnie przekształca ją do trybu Worker. Potem zapisuje ustawienia w pliku konfiguracyjnym. Te kroki wymagają działającego pliku binarnego `rapira` z dołączonym PHP. Więcej informacji zawiera [Instalacja](/pl/docs/intro/installation).

## Tryb Classic

Tryb Classic jest dostępny dla każdej aplikacji. Rapira dołącza skrypt wejściowy przy każdym żądaniu, tak jak php-fpm. Kod nie wymaga zmian.

Utwórz `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Uruchom serwer. Flaga `--mode classic` wybiera tryb. Argument pozycyjny wskazuje skrypt wejściowy:

```bash
rapira serve --mode classic public/index.php
```

Rapira domyślnie nasłuchuje na `127.0.0.1:8000`. Wyślij żądanie z drugiego terminala:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Procesy worker pozostają aktywne między żądaniami. Rapira tworzy je raz i zachowuje w każdym zainicjalizowany interpreter PHP. Tryb Classic usuwa stan skryptu po każdym żądaniu. Ten stan obejmuje zmienne, autoloader i obiekty frameworka.

## Tryb Worker

Tryb Worker utrzymuje skrypt aktywny. Skrypt inicjalizuje się raz, a następnie czeka na żądania w pętli. Rapira wypełnia zmienne superglobalne i wywołuje handler. PHP może odczytać `$_GET` i utworzyć odpowiedź przez `echo`. Aplikacja inicjalizuje się raz dla każdego procesu. Więcej informacji zawierają [Tryby wykonania](/pl/docs/execution-modes).

Utwórz `worker.php` w katalogu głównym projektu:

```php
<?php

// This value remains available for each request in this worker.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

`\Rapira\handle_request()` czeka na kolejne żądanie. Funkcja wywołuje handler i zwraca `true`. Podczas zatrzymywania workera zwraca `false`, co kończy pętlę. Handler odczytuje zmienne superglobalne i odpowiada przez `echo` oraz `header()`. Wywołuj `\Rapira\handle_request()` tylko z głównej pętli. W innych trybach funkcja rzuca `Rapira\Exception\NotInWorkerModeError`.

Moduł PHP Rapiry udostępnia `\Rapira\handle_request()`. Dlatego przykład nie wymaga autoloadera. Aplikacja z zależnościami Composera musi wczytać `vendor/autoload.php` przed pętlą.

Zatrzymaj serwer Classic przez `Ctrl-C`. Oba serwery używają adresu `127.0.0.1:8000`. Dispatcher jest trybem domyślnym. Wybierz tryb Worker flagą `--mode worker`:

```bash
rapira serve --mode worker worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Uruchom polecenie `curl` kilka razy. Licznik danego workera rośnie, gdy ten sam proces obsłuży kolejne żądanie. Rapira domyślnie tworzy jednego workera na każdy logiczny procesor. System operacyjny wybiera workera dla każdego połączenia. Każdy worker ma oddzielny licznik. Identyfikator procesu w odpowiedzi wskazuje wybranego workera. Użyj `rapira serve --mode worker --processes 1 worker.php`, aby utworzyć jednego workera. Więcej informacji zawiera [Model procesów](/pl/docs/process-model).

Obiekty utworzone przed pętlą `while` pozostają w pamięci do ponownego uruchomienia skryptu workera. Obejmują one autoloader Composera, kontener, połączenia, trasy i szablony. Rapira inicjalizuje ten stan raz. Tylko stan żądania jest nowy w każdej iteracji.

::: warning
Skrypt workera musi resetować stan żądania, który pozostaje w pamięci. Ten stan obejmuje właściwości statyczne, wartości globalne i otwarte transakcje. Więcej informacji zawiera [Tryb Worker](/pl/docs/worker).
:::

Handler może używać `header()`, `http_response_code()` i `echo`. Funkcja `rapira_finish_request()` wysyła odpowiedź przed zakończeniem handlera. Więcej informacji zawiera strona [HTTP](/pl/docs/http).

## Plik konfiguracyjny

Zapisz ustawienia w `rapira.toml` zamiast w wierszu poleceń. Utwórz ten plik obok aplikacji:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
Względna wartość `pool.entrypoint` używa katalogu pliku konfiguracyjnego jako podstawy. Bieżący katalog jej nie zmienia. Flagi wiersza poleceń zastępują wartości z pliku. Na przykład `--processes 1` zmienia tylko liczbę workerów.
:::

Plik kontroluje też skalowanie puli, wymianę workerów, limity czasu, logowanie i pidfile. Nieznany klucz uniemożliwia uruchomienie. Więcej informacji zawierają [Konfiguracja](/pl/docs/configuration) i [Wiersz poleceń](/pl/docs/cli).

## Zatrzymywanie serwera

Naciśnij `Ctrl-C`, aby rozpocząć kontrolowane zatrzymanie. Rapira przestaje przyjmować pracę, kończy bieżące żądania, zatrzymuje rozszerzenia i wychodzi. Naciśnij `Ctrl-C` ponownie, aby wymusić wyjście. `SIGTERM` działa tak samo. Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).

## Co dalej

- [Tryb Worker](/pl/docs/worker) - pętla workera od podszewki: stan, wycieki, recykling i sposób na wystartowanie prawdziwej aplikacji przed pętlą.
- [Konfiguracja](/pl/docs/configuration) - wszystkie klucze, które przyjmuje `rapira.toml`, wraz z wartościami domyślnymi.
- [Frameworki](/pl/docs/frameworks/) - przewodniki integracyjne dla Symfony, Laravela i Yii3.
