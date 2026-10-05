---
title: Szybki start
description: "Uruchomienie aplikacji PHP w trybach Classic i Worker oraz zapisanie ustawień w rapira.toml."
---

# Szybki start

Uruchom aplikację w trybie Classic. Następnie przekształć ją do trybu Worker. Zapisz ustawienia w pliku konfiguracyjnym. Te kroki wymagają pliku binarnego `rapira` z dołączonym PHP. Więcej informacji zawiera [Instalacja](/pl/docs/intro/installation).

## Tryb Classic

Tryb Classic jest dostępny dla każdej aplikacji. Rapira dołącza skrypt wejściowy przy każdym żądaniu, tak jak php-fpm. Kod nie wymaga zmian.

Utwórz `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Utwórz `rapira.toml` obok katalogu `public`. Klucz `mode` wybiera tryb Classic, a `entrypoint` wskazuje skrypt wejściowy:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Uruchom serwer, podając ścieżkę do pliku:

```bash
rapira serve rapira.toml
```

Rapira nasłuchuje na `127.0.0.1:8000`. Wyślij żądanie z drugiego terminala:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Procesy workerów pozostają aktywne między żądaniami. Rapira tworzy workery raz i zachowuje w każdym workerze zainicjalizowany interpreter PHP. Tryb Classic usuwa stan skryptu po każdym żądaniu. Ten stan obejmuje zmienne, autoloader i obiekty frameworka.

## Tryb Worker

Tryb Worker utrzymuje skrypt aktywny. Skrypt inicjalizuje się raz, a następnie czeka na żądania w pętli. Dla każdego żądania Rapira ponownie wypełnia zmienne superglobalne i wywołuje handler. PHP nadal może odczytać `$_GET` i utworzyć odpowiedź przez `echo`. Więcej informacji zawierają [Tryby wykonania](/pl/docs/execution-modes).

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

`\Rapira\handle_request()` czeka na kolejne żądanie. Funkcja wywołuje handler i zwraca `true`. Podczas zatrzymywania workera `\Rapira\handle_request()` zwraca `false`. Ta wartość kończy pętlę.

Handler odczytuje zmienne superglobalne i odpowiada przez `echo` oraz `header()`. Wywołuj `\Rapira\handle_request()` tylko z pętli najwyższego poziomu skryptu. W innych trybach funkcja rzuca `Rapira\Exception\NotInWorkerModeError`.

Moduł PHP, który rejestruje Rapira, udostępnia `\Rapira\handle_request()`. Dlatego przykład nie wymaga autoloadera. Aplikacja z zależnościami Composera musi wczytać `vendor/autoload.php` przed pętlą.

Zatrzymaj serwer Classic przez `Ctrl-C`, ponieważ oba serwery używają adresu `127.0.0.1:8000`. Zmień `rapira.toml` na tryb Worker:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Uruchom polecenie `curl` kilka razy. Licznik danego workera rośnie, gdy ten sam proces obsłuży kolejne żądanie. Rapira domyślnie tworzy jednego workera na każdy logiczny procesor. System operacyjny wybiera workera dla każdego połączenia. Każdy worker ma oddzielny licznik. Identyfikator procesu w odpowiedzi wskazuje workera, który zwrócił odpowiedź.

Ustaw `processes = 1` w `[http.pool]`, aby utworzyć jednego workera. Nadzór nad pulą opisuje [Model procesów](/pl/docs/process-model).

Obiekty utworzone przed pętlą `while` pozostają w pamięci do ponownego uruchomienia skryptu workera. Obejmują one autoloader Composera, kontener, połączenia, trasy i szablony. Rapira inicjalizuje ten stan raz, a nie dla każdego żądania. Tylko stan żądania jest nowy w każdej iteracji.

::: warning
Skrypt workera musi resetować stan żądania, który pozostaje w pamięci. Ten stan obejmuje właściwości statyczne, wartości globalne i otwarte transakcje. Więcej informacji zawiera [Tryb Worker](/pl/docs/worker).
:::

Handler może wywołać `rapira_finish_request()`, aby wysłać odpowiedź przed zakończeniem handlera. Więcej informacji zawiera strona [HTTP](/pl/docs/http).

## Plik konfiguracyjny

Plik konfiguracyjny zawiera wszystkie ustawienia. Polecenie `rapira serve` przyjmuje tylko ścieżkę do tego pliku. Dodaj liczbę workerów do pliku:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve rapira.toml
```

::: info
Względna wartość `http.pool.entrypoint` używa katalogu pliku konfiguracyjnego jako podstawy. Bieżący katalog jej nie zmienia.
:::

Plik kontroluje też wymianę workerów, limity czasu żądań, logowanie i pidfile nadzorcy. Serwer nie uruchamia się, jeśli plik zawiera nieznany klucz. Wszystkie ustawienia pliku konfiguracyjnego opisuje [Konfiguracja](/pl/docs/configuration), a polecenie opisuje [Wiersz poleceń](/pl/docs/cli).

## Zatrzymywanie serwera

Naciśnij `Ctrl-C`, aby zatrzymać serwer. Terminal wysyła `SIGINT` do procesu nadrzędnego i do każdego workera, więc bieżące żądania zatrzymują się natychmiast. Aby bieżące żądania mogły się zakończyć, wyślij `SIGTERM` tylko do procesu nadrzędnego, na przykład `kill -TERM <master-pid>`. Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).

## Co dalej

- [Tryb Worker](/pl/docs/worker) opisuje trwałą pętlę, stan, wycieki pamięci, wymianę workerów i inicjalizację aplikacji.
- [Konfiguracja](/pl/docs/configuration) wymienia każdy klucz `rapira.toml` i jego wartość domyślną.
- [Frameworki](/pl/docs/frameworks/) zawiera przewodniki integracji dla Symfony, Laravela i Yii3.
