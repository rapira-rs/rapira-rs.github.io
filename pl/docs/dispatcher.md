---
title: Tryb Dispatcher
description: "Pętla dyspozytora HTTP w Rapirze, API Request i Exchange, przesyłane pliki, sendFile() i wyjątki dyspozytora."
faqLevel: 2
---

# Tryb Dispatcher

Tryb Dispatcher utrzymuje aktywny proces PHP między żądaniami, tak jak [tryb Worker](/pl/docs/worker). Skrypt inicjalizuje aplikację raz, a następnie pobiera każde żądanie przez wywołanie API. Rapira nie wypełnia zmiennych superglobalnych dla żądania. Skrypt czyta obiekt żądania i zapisuje odpowiedź przez wywołania metod.

Ta strona to przewodnik programisty dla dyspozytora HTTP. Porównanie trybów zawiera strona [Tryby wykonania](/pl/docs/execution-modes). Pula gRPC również używa trybu Dispatcher. API wywołań gRPC opisuje strona [gRPC](/pl/docs/grpc).

## Pętla odbioru

Skrypt inicjalizuje aplikację i pobiera dyspozytora. Następnie odbiera żądania w pętli, dopóki Rapira nie zamknie dyspozytora.

```php
<?php
// worker.php
use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;
use Rapira\LogLevel;

require __DIR__ . '/vendor/autoload.php';

$app = new App(); // Worker tworzy ten obiekt raz i używa go ponownie.
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break; // Do tego workera nie przychodzą już żądania.
    }

    try {
        $body = $app->handle($exchange->getRequest());
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody($body); // Domyślnie $eos to true, więc to wywołanie kończy odpowiedź.
    } catch (WorkDiscardedException) {
        // Klient odłączył się przed końcem odpowiedzi.
    } catch (\Throwable $e) {
        \Rapira\log('request failed', LogLevel::Error, ['exception' => $e]);
    }

    unset($exchange); // Jeśli odpowiedź się nie zakończyła, Rapira wysyła 500 lub przerywa odpowiedź.
}
```

Dispatcher jest trybem domyślnym. Ustaw go jawnie w tabeli `[http.pool]` pliku `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "dispatcher"
```

```bash
rapira serve rapira.toml
```

Pozostałe klucze puli opisuje [Konfiguracja](/pl/docs/configuration#http-pool).

## Odbiór żądania

W workerze HTTP `\Rapira\get_dispatcher()` zwraca `Rapira\Http\HttpDispatcher`. W trybach Classic i Worker rzuca `Rapira\Exception\NoDispatcherError`. W skrypcie, który obsługuje więcej niż jeden tryb, sprawdź tryb przez `\Rapira\get_mode()`.

| Metoda | Działanie |
| --- | --- |
| `receive(int $timeout = -1): Exchange` | Czeka na następne żądanie. Limit czasu jest w mikrosekundach. `-1` czeka bez limitu, a `0` nie czeka. Po przekroczeniu limitu rzuca `Rapira\Exception\TimeoutException`. |
| `tryReceive(): ?Exchange` | Zwraca następne żądanie albo `null`, gdy żadne żądanie nie czeka. Nie czeka. |
| `getInfo(): HttpDispatcherInfo` | Zwraca `pendingCount()`, czyli liczbę żądań w kolejce tego workera, oraz `activeCount()`, które wynosi `0` lub `1`. |
| `name(): string` | Zwraca `http`. |

Podczas oczekiwania `receive()` blokuje wątek PHP. Worker nie używa procesora podczas oczekiwania. Licznik PHP `max_execution_time` nie liczy tego oczekiwania i startuje od nowa dla każdego żądania. Rapira pomija żądanie z kolejki, gdy jego klient odłączył się, zanim żądanie dotarło do PHP.

## Jedna wymiana naraz

Każdy worker obsługuje jedną wymianę naraz. Zakończ odpowiedź bieżącej wymiany przed ponownym wywołaniem `receive()` lub `tryReceive()`. W przeciwnym razie wywołanie rzuca `\Error`. Fibery nie zmieniają tej reguły. Aby obsługiwać więcej żądań jednocześnie, zwiększ `http.pool.processes`.

Te wywołania kończą odpowiedź:

- `writeBody()` lub `sendFile()` z `$eos = true`, co jest wartością domyślną.
- `writeTrailers()`.

Gdy Rapira wykryje anulowanie otwartej wymiany, `receive()` i `tryReceive()` odrzucają ją przed odebraniem kolejnej pracy. W tym przypadku nie rzucają błędu `\Error` otwartej wymiany. Gdy kod usuwa ostatnią referencję do otwartej wymiany, na przykład przez `unset($exchange)`, Rapira kończy odpowiedź. Jeśli nagłówek odpowiedzi nie został wysłany, Rapira wysyła `500` z pustą treścią. Jeśli nagłówek odpowiedzi został wysłany, Rapira przerywa odpowiedź.

Wysłanie wszystkich bajtów zadeklarowanych w `Content-Length` z `$eos = false` nie finalizuje wymiany. Sfinalizuj ją przed następnym wywołaniem odbioru. Zamknięcie połączenia po dostarczeniu pełnej odpowiedzi nie anuluje wymiany. PHP nadal może ją sfinalizować. Rozłączenie przed dostarczeniem pełnej odpowiedzi może ją anulować.

`http.pool.request_terminate_timeout_secs` liczy czas od powrotu z `receive()` lub `tryReceive()`. Rapira kończy i zastępuje workera, który przekroczy ten limit. Ten klucz opisuje [Konfiguracja](/pl/docs/configuration#http-pool).

## Koniec pętli

Podczas zatrzymania, przeładowania lub zastąpienia po `http.pool.max_requests` Rapira zamyka dyspozytora. Gdy dyspozytor jest zamknięty, a jego kolejka jest pusta, `receive()` i `tryReceive()` rzucają `Rapira\Exception\ClosedException`. Każde kolejne wywołanie rzuca go ponownie. Przechwyć ten wyjątek, wyjdź z pętli i pozwól skryptowi wejściowemu się zakończyć.

Nieprzechwycony wyjątek lub błąd krytyczny kończy skrypt wejściowy. Rapira wtedy ponownie uruchamia skrypt wejściowy w tym samym workerze. Klient otwartej wymiany otrzymuje odpowiedź błędu lub niekompletną odpowiedź.

::: question Co się dzieje, gdy skrypt wejściowy zakończy się przed `ClosedException`?
Jeśli skrypt odebrał co najmniej jedno żądanie, Rapira ponownie uruchamia skrypt wejściowy w tym samym workerze. Jeśli skrypt zakończył się przed odebraniem żądania, Rapira liczy nieudany rozruch. Jeśli żądanie przyjdzie w ciągu pięciu sekund, Rapira odpowiada na nie kodem `503`. Następnie Rapira ponownie uruchamia skrypt. Po pięciu kolejnych nieudanych rozruchach worker kończy działanie jako niesprawny.
:::

## Żądanie

`$exchange->getRequest()` zwraca obiekt `Rapira\Http\Request` tylko do odczytu. Każde wywołanie zwraca ten sam obiekt.

| Właściwość | Typ | Wartość |
| --- | --- | --- |
| `method` | `string` | Metoda żądania, na przykład `GET`. |
| `uri` | `string` | Bezwzględny URI, na przykład `http://example.com/a?b=1`. Schemat to zawsze `http`. Bez części authority Rapira używa adresu serwera. |
| `target` | `string` | Cel żądania. Dla żądania w formie origin-form to ścieżka i zapytanie, na przykład `/a?b=1`. |
| `authority` | `?string` | Wartość `Host`. Dla żądania HTTP/1.0 bez `Host` jest to `null`. |
| `protocol` | `string` | `HTTP/1.1` lub `HTTP/1.0`. |
| `headers` | `array<string, list<string>>` | Pola żądania. Nazwy są pisane małymi literami. Każda nazwa ma listę wartości. |
| `body` | `string` lub `Multipart` | Pełna treść albo `Rapira\Http\Multipart` dla treści `multipart/form-data`. |
| `remote` | `InetAddress` lub `UnixAddress` | Adres klienta. `Rapira\InetAddress` ma `ip` i `port`. `Rapira\UnixAddress` ma `path`. |
| `server` | `InetAddress` lub `UnixAddress` | Adres nasłuchu. |
| `tls` | `?Rapira\Tls` | Zawsze `null`. Rapira nie ma nasłuchu TLS. |
| `receivedAt` | `float` | Czas Unix w sekundach, w którym Rapira odebrała żądanie. |

Rapira wczytuje pełną treść do pamięci, zanim PHP otrzyma żądanie. `http.max_body_size_mb` ogranicza rozmiar treści. Sprawdzanie żądania opisuje strona [HTTP](/pl/docs/http).

W trybie Dispatcher `$_SERVER` zachowuje wartości ze startu skryptu wejściowego. Rapira nie zmienia go dla każdego żądania. Zobacz [`$_SERVER` przed pierwszym żądaniem](/pl/docs/execution-modes#server-przed-pierwszym-zadaniem).

## Odpowiedź

`Rapira\Http\Exchange` ma te metody. `$headers` i `$trailers` mają kształt `array<string, list<string>>`: każda nazwa pola ma listę wartości.

| Metoda | Działanie |
| --- | --- |
| `writeHead(int $status, array $headers = []): void` | Ustawia status i pola. Status musi mieć wartość od 100 do 599. Rapira nie przekazuje nagłówka odpowiedzi `1xx`. Status `101` daje klientowi `502`. Rapira wysyła nagłówek odpowiedzi przy pierwszym zapisie treści, przy `flush()` lub przy `writeTrailers()`. |
| `writeBody(string $content, bool $eos = true): void` | Zapisuje dane treści. Bez `writeHead()` status to `200`. Ustaw `$eos` na `false`, aby zapisać więcej danych później. |
| `sendFile(string $path, int $offset = 0, ?int $length = null, bool $eos = true): void` | Wysyła plik lub część pliku jako dane treści. Zobacz [Wysyłanie pliku](#wysyłanie-pliku). |
| `writeTrailers(array $trailers): void` | Kończy odpowiedź. Wywołaj ją po `writeHead()` lub po zapisie treści. Rapira nie wysyła pól trailer do klienta. |
| `flush(): void` | Natychmiast wysyła nagłówek odpowiedzi. Bez `writeHead()` status to `200`. |
| `isFinalized(): bool` | Zwraca `true`, gdy wymiana jest sfinalizowana lub Rapira wykryje jej anulowanie. |
| `isCancelled(): bool` | Zwraca `true`, gdy Rapira wykryje anulowanie wymiany. Zamknięcie połączenia po dostarczeniu pełnej odpowiedzi jej nie anuluje. |

Ustaw `content-length` w `writeHead()`, gdy znasz rozmiar treści. Zapis poza tę długość wysyła część, która się mieści, kończy odpowiedź i rzuca `ContentLengthExceededError`. Bez `content-length` serwer HTTP sam dzieli treść na ramki. Reguły ramkowania i pola, które Rapira usuwa, opisuje [Przesyłanie odpowiedzi](/pl/docs/http#przesyłanie-odpowiedzi).

Aby przesłać odpowiedź strumieniowo, wywołaj `writeBody()` z `$eos = false` dla każdej części. Następnie wywołaj `writeBody('')`, aby zakończyć odpowiedź.

Ogranicz każdy fragment `writeBody()` do maksymalnie 1 GiB. Większy fragment rzuca `\Error` i kończy odpowiedź jako uciętą. Limit dotyczy każdego fragmentu, a nie całej odpowiedzi strumieniowej.

Wolny klient może zapełnić kanał odpowiedzi. Zapis blokuje wtedy wątek PHP do czasu zwolnienia miejsca lub zamknięcia kanału. Blokuje to wszystkie Fibery PHP w tym workerze.

## Przesyłane pliki

Rapira parsuje treść `multipart/form-data`, zanim PHP otrzyma żądanie. `Request::$body` jest wtedy obiektem `Rapira\Http\Multipart`:

| Klasa | Właściwości |
| --- | --- |
| `Multipart` | `fields`, lista `FormField`. `files`, lista `UploadedFile`. |
| `FormField` | `name`, `value`, `headers`. |
| `UploadedFile` | `name`, `clientFilename`, `clientMediaType`, `headers`, `tmpPath`, `size`. |

Rapira zapisuje każdą część z plikiem do pliku tymczasowego w podkatalogu `rapira-spool-<pid>` katalogu `http.uploads.dir`. `UploadedFile::$tmpPath` zawiera ścieżkę tego pliku. Rapira usuwa pliki tymczasowe po zakończeniu odpowiedzi. Aby zachować plik, przenieś go przez `rename()` przed zakończeniem odpowiedzi.

Dla nieprawidłowej treści Rapira zwraca `400`. Gdy treść przekracza limit, zwraca `413`. Skrypt nie otrzymuje tych żądań. Limity opisuje [Tabela `[http.uploads]`](/pl/docs/configuration#tabela-http-uploads).

## Wysyłanie pliku

`sendFile()` czyta tylko pliki poniżej katalogu głównego sendfile. Domyślny katalog główny to katalog `http.pool.entrypoint`. Rapira rozwiązuje dowiązania symboliczne, zanim porówna ścieżkę z katalogiem głównym. Ustawienie katalogu głównego opisuje [Tabela `[http.sendfile]`](/pl/docs/configuration#tabela-http-sendfile).

Plik otwiera host. PHP `open_basedir` nie ogranicza tej operacji. Ścieżkę ogranicza skonfigurowany katalog główny sendfile.

Wywołanie rzuca `Rapira\Http\Exception\FileNotSendableException` i nie zapisuje danych w tych warunkach:

- Ścieżka jest poza katalogiem głównym.
- Plik nie istnieje lub nie jest zwykłym plikiem.
- Przesunięcie lub długość wykracza poza koniec pliku.

Rapira nie ustawia dla pliku pól `content-type`, `etag` ani pól zakresu. Ustaw potrzebne pola przez `writeHead()`.

```php
$exchange->writeHead(200, ['content-type' => ['application/pdf']]);
$exchange->sendFile(__DIR__ . '/files/report.pdf');
```

Umieść `report.pdf` w katalogu `files/` obok skryptu wejściowego. Ta ścieżka znajduje się w domyślnym katalogu głównym. Niestandardowy katalog główny również musi zawierać ten plik.

## Wyjątki

Każda klasa wyjątku w przestrzeniach nazw `Rapira` implementuje `Rapira\Exception\RapiraThrowable`. Zwykłe `\Error` i `\ValueError` go nie implementują.

| Wyjątek | Rzuca go | Przyczyna |
| --- | --- | --- |
| `Rapira\Exception\ClosedException` | `receive()`, `tryReceive()` | Rapira zamknęła dyspozytora. Żądania już nie przychodzą. |
| `Rapira\Exception\TimeoutException` | `receive()` | Żadne żądanie nie przyszło przed upływem limitu czasu. |
| `Rapira\Exception\NoDispatcherError` | `\Rapira\get_dispatcher()` | Proces nie działa w trybie Dispatcher. |
| `Rapira\Exception\WorkDiscardedException` | Metody zapisu | Rapira anulowała wymianę, zanim PHP ją sfinalizował. |
| `Rapira\Exception\AlreadyFinalizedError` | `writeBody()`, `sendFile()`, `writeTrailers()`, `flush()` | Odpowiedź już się zakończyła. |
| `Rapira\Http\Exception\HeadAlreadyWrittenError` | `writeHead()` | Nagłówek odpowiedzi jest już ustawiony lub odpowiedź już się zakończyła. |
| `Rapira\Http\Exception\HeadNotWrittenError` | `writeTrailers()` | Nie ma jeszcze nagłówka odpowiedzi ani danych treści. |
| `Rapira\Http\Exception\ContentLengthExceededError` | `writeBody()`, `sendFile()` | Zapis wykracza poza zadeklarowany `content-length`. |
| `Rapira\Http\Exception\FileNotSendableException` | `sendFile()` | Rapira nie może wysłać pliku. |
| `\Error` | `receive()`, `tryReceive()` | Poprzednia wymiana jest nadal otwarta. |
| `\Error` | `writeBody()` | Jeden fragment przekracza 1 GiB. Rapira kończy odpowiedź jako uciętą. |
| `\Error` | `rapira_finish_request()` | Funkcja nie jest dostępna w trybie Dispatcher. Zamiast tego zakończ wymianę. |
| `\ValueError` | Kilka metod | Argument jest nieprawidłowy. Przykłady to status poza zakresem od 100 do 599, pole nieprawidłowe w sieci lub pole trailer takie jak `content-type`. |

## Wyjście z `echo`

W trybie Dispatcher `echo`, `print` i inne wyjście PHP nie trafiają do klienta. Rapira zapisuje każde wywołanie wyjścia w logu w celu `php` na poziomie `info`. Domyślny poziom logu `error` ukrywa te wpisy. Zapisuj odpowiedź przez metody wymiany. Pokazanie celu `php` opisuje strona [Logi](/pl/docs/logging#nadpisania-dla-poszczegolnych-celow).

## Stuby dla IDE

Rapira deklaruje funkcje i klasy PHP w plikach stubów. Interfejsy dyspozytora i funkcje podstawowe znajdują się w [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). Typy HTTP i klasy wyjątków HTTP znajdują się w [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/plugins/http/rapira_http.stub.php). Pozostałe klasy wyjątków znajdują się w [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Dodaj te pliki do projektu, aby włączyć uzupełnianie w IDE.
