---
title: Tryb Worker
description: "Pętla workera Rapiry, kontrakt handle_request(), trwały stan i typowe błędy."
faqLevel: 2
---

# Tryb Worker

Tryb Worker utrzymuje aktywny proces PHP między żądaniami. Skrypt inicjalizuje aplikację raz, a następnie czeka na żądania w pętli. Stan aplikacji pozostaje w pamięci, więc skrypt workera musi nim zarządzać.

W [trybie Classic](/pl/docs/classic) skrypt wejściowy za każdym razem wykonuje się w nowym żądaniu PHP, a Rapira usuwa stan aplikacji po wysłaniu odpowiedzi. Ten stan obejmuje autoloader, kontener, konfigurację, trasy i połączenia z bazą danych.

Tryb Worker nie wymaga określonego frameworka. Wymaga aplikacji, która może obsłużyć wiele żądań po jednej inicjalizacji. Wybór trybu opisuje strona [Tryby wykonania](/pl/docs/execution-modes). Przewodniki dla frameworków zawiera strona [Frameworki](/pl/docs/frameworks/).

## Pętla rezydentna

Skrypt inicjalizuje aplikację i definiuje handler jednego żądania. Następnie wywołuje `\Rapira\handle_request()` w pętli, dopóki funkcja nie zwróci `false`.

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

Dispatcher jest trybem domyślnym. Wybierz tryb Worker przez `mode = "worker"` w tabeli `[http.pool]` pliku `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

Pozostałe klucze opisuje [Konfiguracja](/pl/docs/configuration).

## Kontrakt `handle_request()`

`\Rapira\handle_request(callable $handler): bool` ma następujący kontrakt:

- **Czeka** na żądanie dla tego workera. Oczekujący worker nie używa procesora.
- **Wypełnia dane żądania** w `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`, `$_FILES` oraz `$_REQUEST` przed uruchomieniem handlera. Kod czyta te zmienne superglobalne tak samo jak pod php-fpm.
- **Wywołuje handler bez argumentów.** Użyj sygnatury `function (): void`. Przechwyć zależności, na przykład kontener lub logger, przez `use`. Rapira ignoruje zwracaną wartość.
- **Wyjście handlera jest odpowiedzią.** Handler może używać `echo`, `print`, `header()`, `http_response_code()` i `setcookie()`. Przetwarzanie żądań i odpowiedzi opisuje strona [HTTP](/pl/docs/http).
- **Zwraca `true`** po każdym żądaniu. Zwraca `false`, gdy worker zaczyna się zatrzymywać lub uruchamia aplikację ponownie. Zakończ pętlę i skrypt, gdy funkcja zwróci `false`.
- **Wywołuj ją tylko z pętli najwyższego poziomu skryptu.** Wywołanie z wnętrza handlera rzuca `\Error`. Nie wywołuj jej z funkcji shutdown ani z destruktora.

Żądanie w trybie Worker odpowiada jednej iteracji pętli `while`. Przed każdym wywołaniem handlera Rapira ponownie wypełnia zmienne superglobalne. Po wywołaniu Rapira uruchamia funkcje shutdown żądania, opróżnia bufory wyjścia i zamyka sesję. Rapira wysyła odpowiedź po tych krokach. Wartości, które skrypt przechowuje poza handlerem, pozostają w pamięci.

Przed pierwszym wywołaniem `handle_request()` `$_SERVER` zawiera środowisko procesu i ścieżkę skryptu wejściowego, tak jak pod PHP CLI. Pełną listę zawierają [Tryby wykonania](/pl/docs/execution-modes).

## Jedna pętla na worker

Skrypt workera uruchamia jedną pętlę z jednym handlerem. W przykładzie poniżej druga pętla działa dopiero po zakończeniu pierwszej, a pierwsza pętla kończy się dopiero wtedy, gdy `handle_request()` zwróci `false`. Użyj jednego handlera, który rozdziela wszystkie żądania.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## Stan między żądaniami

Obiekty utworzone **poza** handlerem pozostają do końca cyklu workera. Przykłady to autoloader, kontener, trasy, konfiguracja, otwarte połączenia i dane w pamięci podręcznej. Rapira nie tworzy tego stanu dla każdego żądania.

Wartości utworzone **wewnątrz** handlera należą do jednego żądania. PHP zwalnia je po powrocie handlera i usunięciu ostatnich referencji.

Skrypt workera określa czas życia stanu. Umieść stan aplikacji przed pętlą. Umieść stan żądania w handlerze albo wyzeruj go przed następnym żądaniem.

Otwieraj `php://input` wewnątrz handlera w każdym żądaniu. Strumień `php://input` otwarty we wcześniejszym żądaniu lub podczas inicjalizacji może zwrócić treść późniejszego żądania albo zakończyć proces workera.

::: warning
Stan globalny również pozostaje między żądaniami. Przykłady to właściwości statyczne, singletony, rejestry i zmiany `ini_set()`. php-fpm odrzuca te wartości na końcu każdego żądania. Worker Rapiry je zachowuje.

Użyj [trybu Classic](/pl/docs/classic), jeśli aplikacja nie może zerować stanu globalnego. Tryb Classic jest zgodnym zamiennikiem php-fpm. Wybierz tryb Worker po poprawieniu stanu globalnego.
:::

## Funkcje shutdown

Cykl workera to jedno wykonanie skryptu workera, od inicjalizacji do końca skryptu. PHP uruchamia każdą funkcję shutdown zarejestrowaną przez kod inicjalizacji raz, na końcu cyklu. PHP uruchamia każdą funkcję shutdown zarejestrowaną przez handler raz, na końcu tego żądania.

Rejestruj sprzątanie zasobów procesu podczas inicjalizacji. Rejestruj sprzątanie zasobów żądania wewnątrz handlera.

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

Na końcu cyklu PHP najpierw wykonuje funkcje shutdown zarejestrowane podczas inicjalizacji, w kolejności rejestracji. Funkcje zarejestrowane po pętli wykonuje po nich.

Obiekty używają innej reguły. Rapira nie uruchamia wszystkich destruktorów na końcu żądania. PHP niszczy obiekt po usunięciu ostatniej referencji. Po powrocie z handlera PHP niszczy utworzone w nim obiekty tylko wtedy, gdy nie ma już do nich żadnych referencji. Obiekt globalny utworzony podczas inicjalizacji pozostaje między żądaniami. Jego metoda `__destruct()` uruchamia się raz na końcu cyklu.

::: question Dlaczego funkcja shutdown z inicjalizacji nie uruchamia się po pierwszym żądaniu?
PHP przechowuje funkcje shutdown w stanie żądania. Zamknięcie żądania wywołuje funkcje, a następnie zwalnia listę. Przy pierwszym wywołaniu `handle_request()` Rapira usuwa i zapisuje rejestracje inicjalizacji, więc każde żądanie ma tylko własne rejestracje. Na końcu cyklu Rapira przywraca zapisaną listę i dodaje rejestracje utworzone po pętli.
:::

Wyjątek z funkcji shutdown żądania jest nieprzechwyconym wyjątkiem, więc otrzymuje go callback zarejestrowany przez `set_exception_handler()`. Jeśli żaden callback nie obsłuży wyjątku, Rapira zapisuje rekord logu z błędem i zwraca `500`. Jeśli wysyłanie już się rozpoczęło, Rapira zamiast tego ucina odpowiedź. Pętla działa dalej, ale PHP nie uruchamia późniejszych funkcji shutdown tego żądania.

## Duże odpowiedzi

Rapira przechowuje pełną odpowiedź handlera w trybie Worker w pamięci workera. Wysyła odpowiedź po powrocie handlera lub gdy handler wywoła `rapira_finish_request()`. Funkcja PHP `flush()` nie wysyła danych do klienta.

Worker potrzebuje pamięci na pełną odpowiedź. Gdy treść rośnie, worker może użyć do około trzykrotności rozmiaru odpowiedzi. Worker przechowuje odpowiedź w pamięci, dopóki klient jej nie odbierze, i w tym czasie może rozpocząć następne żądanie. Dlatego pobieranie 600 MB zajmuje ponad 600 MB pamięci w jednym workerze. Gdy buforowana treść przekroczy 1 GiB, Rapira zatrzymuje żądanie, a klient otrzymuje niekompletną odpowiedź.

Dla dużych plików i długich strumieni użyj jednej z tych możliwości:

- [Tryb Dispatcher](/pl/docs/dispatcher). `Exchange::writeBody()` z `$eos = false` wysyła każdą część, gdy skrypt ją zapisze. `Exchange::sendFile()` wysyła plik z dysku, a worker nie przechowuje pliku w pamięci. Zobacz [Wysyłanie pliku](/pl/docs/dispatcher#wysyłanie-pliku).
- Reverse proxy, które wysyła plik. Handler ustawia pole odpowiedzi i nie wysyła treści, na przykład pole [`X-Accel-Redirect`](https://nginx.org/en/docs/http/ngx_http_core_module.html#internal) serwera nginx. Rapira przekazuje to pole do proxy bez zmian. Proxy czyta plik i wysyła go do klienta.

Więcej informacji zawiera [Przesyłanie odpowiedzi](/pl/docs/http#przesyłanie-odpowiedzi).

## Tylko w trybie Worker

`handle_request()` potrzebuje rezydentnej pętli, którą ma wyłącznie tryb Worker. W trybie Classic i w trybie Dispatcher rzuca `Rapira\Exception\NotInWorkerModeError`. Wszystkie klasy wyjątków Rapiry implementują interfejs znacznikowy `Rapira\Exception\RapiraThrowable`. Niektóre błędy użycia to zwykłe `\Error` lub `\ValueError`, a `catch` dla `RapiraThrowable` ich nie przechwytuje. Przykładem jest wywołanie `handle_request()` wewnątrz jego handlera.

`Rapira\get_mode()` zwraca [tryb](/pl/docs/execution-modes) bieżącego procesu jako przypadek `Rapira\Mode`. Skrypt działający w więcej niż jednym trybie odczytuje go, zanim wejdzie w pętlę:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Typowe problemy

**Stan żądania pozostaje między żądaniami.** Jeśli aplikacja zawodzi tylko w trybie Worker, szukaj stanu żądania, który pozostaje. Przykłady to rosnąca tablica statyczna, obiekt żądania w singletonie albo stare dane użytkownika w loggerze.

Zeruj ten stan na początku albo na końcu handlera. Zeruj też stan żądania w bibliotekach. `http.pool.max_requests` uruchamia ponownie aplikację, gdy obsłuży ona więcej żądań niż ta liczba. Ogranicza to skutek wycieku pamięci, ale go nie naprawia.

**Niezebrane cykle referencji.** Zliczanie referencji w PHP natychmiast zwalnia większość wartości. Cykle referencji zwalnia dopiero kolektor cykli. Przykład wywołuje `gc_collect_cycles()` między żądaniami. To wywołanie jest opcjonalne, ale zapewnia przewidywalny czas zbierania.

**Żądania, które się nie kończą.** Worker nie może obsłużyć innego żądania podczas wykonywania bieżącego żądania. `http.pool.request_terminate_timeout_secs` ogranicza czas trwania jednego żądania. Gdy żądanie przekroczy limit, Rapira zatrzymuje workera i uruchamia nowy. Ten klucz i `http.pool.max_requests` opisuje [Konfiguracja](/pl/docs/configuration). Sekwencję zatrzymania opisuje [Model procesów](/pl/docs/process-model).

**Inicjalizacja zawodzi.** Skrypt workera musi wywołać `handle_request()` i otrzymać żądanie. Nieprzechwycony wyjątek podczas inicjalizacji może zakończyć skrypt wcześniej. Rapira liczy to jako nieudany rozruch. Worker czeka wtedy do 5 sekund na żądanie, odpowiada na nie kodem `503` i ponownie uruchamia skrypt.

Po pięciu kolejnych nieudanych rozruchach Rapira zapisuje w logu `worker keeps failing to boot; flagged unhealthy`, a worker kończy działanie. Proces nadrzędny uruchamia nowego workera po opóźnieniu. Przy starcie serwera, jeśli żaden worker puli nie zakończył rozruchu ani nie obsłużył żądania, serwer zamiast tego zatrzymuje się z [kodem wyjścia](/pl/docs/cli#kody-wyjscia) 70. Nadzór nad workerami opisuje [Model procesów](/pl/docs/process-model).

**Skrypt zawodzi przy pierwszym żądaniu.** Rapira liczy niepowodzenie także wtedy, gdy skrypt otrzyma dokładnie jedno żądanie, a potem zakończy się z niezerowym statusem wyjścia. Błąd krytyczny ustawia status wyjścia 255. Rapira natychmiast ponownie uruchamia skrypt. Nieudane rozruchy i te niepowodzenia mają wspólny licznik, a skrypt, który otrzyma drugie żądanie, zeruje ten licznik. Po pięciu kolejnych niepowodzeniach Rapira zapisuje w logu `worker keeps failing at its first unit; flagged unhealthy`, a worker kończy działanie. Proces nadrzędny uruchamia nowego workera po opóźnieniu, a serwer działa dalej.

**Nieprzechwycony wyjątek dotyczy jednego żądania, nie workera.** Jeśli handler rzuci wyjątek, Rapira najpierw wywołuje callback zarejestrowany przez `set_exception_handler()`. Jeśli żaden callback nie obsłuży wyjątku, Rapira zwraca `500`, chyba że handler wysłał już nagłówek odpowiedzi. W obu przypadkach pętla działa dalej. Wywołanie `exit()` lub `die()` w handlerze kończy tylko bieżące żądanie, a Rapira wysyła wyjście jako odpowiedź. Błąd krytyczny kończy skrypt workera, a Rapira uruchamia skrypt ponownie z nową inicjalizacją.

**Praca po odesłaniu odpowiedzi.** `rapira_finish_request()` wysyła odpowiedź przed zakończeniem handlera. Handler może potem wykonać dodatkową pracę, na przykład zapisać wpis audytu. Więcej informacji zawiera strona [HTTP](/pl/docs/http).

## Stuby dla IDE

Rapira deklaruje funkcje i klasy PHP w plikach stubów w katalogach `crates/sapi` i `crates/plugins`. API workera znajduje się w [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). Wspólne klasy wyjątków znajdują się w [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Te pliki deklarują sygnatury, typy właściwości i przeznaczenie klas. Dodaj je do projektu, aby włączyć uzupełnianie w IDE dla `\Rapira\handle_request()`, `\Rapira\get_mode()` i innych API.
