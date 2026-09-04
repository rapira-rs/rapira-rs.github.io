---
title: Tryb Worker
description: "Pętla workera Rapiry, kontrakt handle_request(), trwały stan i typowe błędy."
faqLevel: 2
---

# Tryb Worker

Tryb Worker utrzymuje aktywny proces PHP między żądaniami. Skrypt inicjalizuje aplikację raz, a następnie czeka na żądania w pętli. Stan aplikacji również pozostaje w pamięci. Skrypt workera musi więc nim zarządzać.

W [trybie Classic](/pl/docs/classic) skrypt wejściowy wykonuje się od zera przy każdym żądaniu. Wszystko, co zbudował, zostaje odrzucone po wysłaniu odpowiedzi. Autoloader, kontener, konfiguracja, trasy i połączenia z bazą danych są uruchamiane dla każdego żądania.

Ta strona zawiera przewodnik programowania dla trybu Worker. Tryb Worker nie wymaga określonego frameworka. Wymaga aplikacji, która może obsłużyć wiele żądań po jednej inicjalizacji. Wymagania trybów opisuje strona [Tryby wykonania](/pl/docs/execution-modes). Przewodniki dla frameworków zawiera strona [Frameworki](/pl/docs/frameworks/).

## Pętla rezydentna

Skrypt workera składa się z trzech części. Pierwsza część inicjalizuje aplikację. Druga część definiuje handler jednego żądania. Trzecia część uruchamia handler do zatrzymania workera. Użyj `\Rapira\handle_request()` w pętli PHP.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Dispatcher jest trybem domyślnym. Wybierz tryb Worker jednym z tych ustawień:

- `--mode worker` w wierszu poleceń, obok skryptu wejściowego.
- `mode = "worker"` w sekcji `[pool]` pliku `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli), a ich odpowiedniki w `rapira.toml` w [Konfiguracji](/pl/docs/configuration).

## Kontrakt `handle_request()`

`\Rapira\handle_request(callable $handler): bool` ma następujący kontrakt:

- **Czeka** na żądanie dla tego workera. Oczekujący worker nie używa procesora.
- Zachowuje interpreter i zainicjalizowaną aplikację w pamięci.
- **Wypełnia dane żądania** w `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`, `$_FILES` oraz `$_REQUEST` przed uruchomieniem handlera.
- Zwykły kod PHP może czytać je tak samo jak pod php-fpm.
- **Wywołuje handler bez argumentów.** Dane żądania znajdują się w zmiennych superglobalnych. Sygnatura funkcji to `function (): void`.
- Przechwyć kontener, logger i inne zależności przez `use`.
- **Używa wyjścia handlera jako odpowiedzi.** Handler może używać `echo`, `print`, `header()`, `http_response_code()` i `setcookie()`.
- Przetwarzanie żądań i odpowiedzi opisuje strona [HTTP](/pl/docs/http).
- **Zwraca `true`** po żądaniu, więc pętla działa dalej. Zwraca **`false`**, gdy worker zaczyna się zatrzymywać.
- Zakończ pętlę i skrypt, gdy funkcja zwróci `false`.
- **Wywołuj ją tylko z pętli najwyższego poziomu.** Nie wywołuj jej z funkcji shutdown ani z destruktora.

Żądanie w trybie Worker odpowiada jednej iteracji pętli `while`. Rapira wykonuje zamknięcie żądania wokół handlera. Uruchamia funkcje shutdown, opróżnia bufory, zamyka sesję i ponownie wypełnia zmienne superglobalne. Wartości spoza handlera pozostają w pamięci. Rapira nie uruchamia wszystkich destruktorów na końcu żądania. PHP niszczy obiekt po usunięciu jego ostatniej referencji.

## Jeden handler na worker

`handle_request()` wraca po każdym żądaniu. Skrypt workera musi zawierać pętlę, która utrzymuje aktywnego workera.

Skrypt workera uruchamia jeden handler naraz. Druga kolejna pętla nie może działać przed zakończeniem pierwszej. Pierwsza pętla kończy się, gdy `handle_request()` zwróci `false`. Worker już się wtedy zatrzymuje. Rozdzielaj żądania wewnątrz jednego handlera zamiast używać wielu pętli.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## Stan między żądaniami

Obiekty utworzone **poza** handlerem pozostają do ponownego uruchomienia skryptu workera. Przykłady to autoloader, kontener, trasy, konfiguracja, otwarte połączenia i dane w pamięci podręcznej.

Wartości utworzone **wewnątrz** handlera należą do jednego żądania. PHP zwalnia je po powrocie handlera i usunięciu ostatnich referencji.

Skrypt workera określa czas życia stanu. Umieść stan aplikacji przed pętlą. Umieść stan żądania w handlerze albo wyzeruj go przed następnym żądaniem.

::: warning
Stan globalny również pozostaje między żądaniami. Obejmuje właściwości statyczne, singletony, rejestry i trwałe zmiany `ini_set()`. php-fpm zeruje te wartości podczas zamykania żądania. Worker Rapiry ich nie zeruje. Użyj [trybu Classic](/pl/docs/classic), jeśli aplikacja nie może zerować stanu globalnego. Tryb Classic zastępuje php-fpm. Wybierz tryb Worker po poprawieniu stanu globalnego.
:::

## Funkcje shutdown

Funkcja shutdown zarejestrowana podczas inicjalizacji uruchamia się raz na końcu cyklu workera. Nie uruchamia się po każdym żądaniu. Funkcja shutdown zarejestrowana przez handler uruchamia się raz na końcu tego żądania.

Sprzątanie zasobów należących do całego procesu rejestruj przy rozruchu, a sprzątanie zasobów jednego żądania w handlerze.

```php
register_shutdown_function(static function (): void {
    // Runs once when the worker cycle ends.
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // Runs at the end of this request.
    });
};

while (\Rapira\handle_request($handler)) {
}
```

Na koniec cyklu jako pierwsze uruchamiają się rejestracje z rozruchu, w kolejności rejestrowania. Funkcja zarejestrowana przez skrypt już po pętli idzie za nimi.

Obiekty używają innej reguły. Rapira nie uruchamia wszystkich destruktorów na końcu żądania. PHP niszczy obiekt po usunięciu ostatniej referencji. Dlatego obiekt lokalny zostaje zniszczony po powrocie handlera. Obiekt globalny utworzony podczas inicjalizacji pozostaje między żądaniami. Jego metoda `__destruct()` uruchamia się raz na końcu cyklu.

::: question Dlaczego funkcja shutdown zarejestrowana przy rozruchu nie uruchamia się na koniec pierwszego żądania?
PHP przechowuje funkcje shutdown w stanie żądania. Zamknięcie żądania wywołuje funkcje, a następnie zwalnia listę. Przy pierwszym wywołaniu `handle_request()` Rapira usuwa i zapisuje rejestracje inicjalizacji. Każde żądanie zawiera potem tylko własne rejestracje. Na końcu cyklu Rapira przywraca zapisaną listę. Następnie dodaje rejestracje utworzone po pętli. Końcowe zamknięcie uruchamia najpierw rejestracje inicjalizacji. Potem uruchamia późniejsze rejestracje.
:::

## Tylko w trybie Worker

`handle_request()` potrzebuje rezydentnej pętli, którą ma wyłącznie tryb Worker. W trybie Classic i w trybie Dispatcher rzuca `Rapira\Exception\NotInWorkerModeError`. Każda klasa, którą rzuca Rapira, implementuje interfejs znacznikowy `Rapira\Exception\RapiraThrowable`, więc jeden `catch` obejmuje je wszystkie.

`Rapira\get_mode()` zwraca [tryb](/pl/docs/execution-modes) bieżącego procesu jako przypadek `Rapira\Mode`. Skrypt działający w więcej niż jednym trybie odczytuje go, zanim wejdzie w pętlę:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Typowe problemy

**Stan zachowany między żądaniami.** Sprawdź stan żądania, jeśli aplikacja nie działa tylko w trybie Worker. Przykłady to rosnąca tablica statyczna, obiekt żądania w singletonie albo stare dane użytkownika w loggerze. Zeruj ten stan na początku albo na końcu handlera. Zeruj też stan żądania w bibliotekach. `pool.max_requests` zastępuje workera po określonej liczbie żądań. Ogranicza wyciek pamięci, ale go nie naprawia.

**Niezebrane cykle referencji.** Zliczanie referencji w PHP natychmiast zwalnia większość wartości. Cykle zwalnia dopiero kolektor cykli. Przykład wywołuje `gc_collect_cycles()` między żądaniami. To wywołanie jest opcjonalne, ale zapewnia przewidywalny czas zbierania.

**Żądania, które się nie kończą.** Worker nie może obsłużyć innego żądania podczas wykonywania bieżącego żądania. `pool.request_terminate_timeout_secs` ogranicza czas jednego żądania. Rapira kończy workera, który przekroczy tę wartość. Ten klucz i `pool.max_requests` opisuje [Konfiguracja](/pl/docs/configuration). Obsługę zakończenia opisuje [Model procesów](/pl/docs/process-model).

**Nieprzechwycony wyjątek dotyczy jednego żądania, nie workera.** Rapira zwraca `500` dla nieprzechwyconego wyjątku handlera, jeśli handler nie wysłał jeszcze nagłówka odpowiedzi. Rapira nie może zmienić statusu po wysłaniu nagłówka odpowiedzi. Pętla działa dalej, więc wyjątek nie zatrzymuje workera. Błąd krytyczny kończy skrypt rezydentny. Następnie worker ponownie uruchamia skrypt i inicjalizuje aplikację.

**Praca po odesłaniu odpowiedzi.** `rapira_finish_request()` wysyła odpowiedź przed zakończeniem handlera. Handler może potem zapisać wpis audytu. Więcej informacji zawiera strona [HTTP](/pl/docs/http).

## Stuby dla IDE

Rapira deklaruje funkcje i klasy PHP w plikach stubów katalogu `crates/php_sys`. API workera znajduje się w [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). Klasy wyjątków znajdują się w [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). Te pliki definiują sygnatury, typy właściwości i przeznaczenie klas. Służą też jako stuby IDE. Dodaj je do projektu, aby włączyć uzupełnianie API Rapiry.
