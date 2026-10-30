---
title: Żądania i odpowiedzi HTTP
description: "Jak Rapira przekazuje żądania HTTP do PHP i zwraca odpowiedzi PHP: pola, limity treści, granice odpowiedzi i rapira_finish_request()."
faqLevel: 2
---

# Żądania i odpowiedzi HTTP

Serwer HTTP zamienia połączenie klienta w żądanie PHP i zamienia odpowiedź PHP w dane sieciowe. Używa biblioteki [hyper](https://hyper.rs) i przyjmuje HTTP/1.1 i HTTP/1.0. Nie przekazuje żądań do innego serwera.

Middleware może odpowiedzieć na żądanie przed uruchomieniem PHP. Rapira używa middleware do obsługi [plików statycznych](/pl/docs/static-files).

::: info
Serwer HTTP przyjmuje nieszyfrowany HTTP. Użyj proxy do zakończenia TLS. Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).
:::

## Sprawdzanie żądania

Serwer HTTP sprawdza każde żądanie przed uruchomieniem PHP. Nie wywołuje PHP dla żądania, które nie przejdzie kontroli.

Rapira zwraca `501` dla żądania `CONNECT`. Serwer HTTP nie tworzy tuneli.

Rapira przyjmuje cel żądania w formie bezwzględnej, na przykład `GET http://host.example/admin?x=1 HTTP/1.1`. Rapira usuwa dane użytkownika z części authority celu. Następnie ta część zastępuje pole `Host`, więc `$_SERVER['HTTP_HOST']` i cel są zgodne. PHP otrzymuje ścieżkę i zapytanie w formie origin-form w `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` ogranicza każdy odczyt od klienta. Dotyczy bezczynnego połączenia i nagłówków żądania. Rapira zwraca `408`, jeśli nie otrzyma danych treści żądania przed upływem limitu. Następnie zamyka połączenie. Wartość domyślna to 60 sekund.

```toml
[http]
keepalive_timeout_secs = 60
```

## Od nazwy nagłówka do klucza `$_SERVER`

CGI zmienia nazwę pola żądania na wielkie litery, zastępuje każdy `-` znakiem `_` i dodaje `HTTP_`. Zobacz [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Dlatego `X-Forwarded-For` staje się `HTTP_X_FORWARDED_FOR`.

PHP wykonuje dodatkową konwersję podczas rejestracji zmiennej. Zastępuje także `.` znakiem `_`. Dlatego te trzy nazwy pól sieciowych wskazują jeden klucz PHP:

| Nazwa w żądaniu   | Klucz w PHP                         |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Bez obowiązkowej kontroli nazw pól w Rapirze ta kolizja może stwarzać zagrożenie bezpieczeństwa. Proxy może ustawić `X-Forwarded-For`, a klient może wysłać `X_Forwarded_For`. Obie nazwy wskazują ten sam klucz `$_SERVER`. Filtr proxy dla nazwy z łącznikami może nie usunąć nazwy z podkreśleniami. Aplikacja może wtedy zaufać wartości od klienta.
:::

Rapira ustawia też zmienne żądania CGI. `SERVER_NAME` pochodzi z `http.server_name`, a wartość domyślna to `localhost`. `SERVER_PORT` pochodzi z `http.server_port`, a wartość domyślna to port TCP z `http.listen` lub `80` dla gniazda Unix. Dla klienta na gnieździe Unix `REMOTE_ADDR` to `127.0.0.1`, a `REMOTE_PORT` to `0`. Rapira nie ustawia `PATH_INFO`.

Rapira przyjmuje tylko nieszyfrowany HTTP. Dlatego `$_SERVER['HTTPS']` jest zawsze puste, a `REQUEST_SCHEME` to zawsze `http`. Za proxy TLS skonfiguruj aplikację, aby odczytywała pola proxy.

## Nazwy kolidujące ze zmienną CGI

Rapira przyjmuje w nazwie pola żądania tylko bajty `A-Z`, `a-z`, `0-9` i `-`. Ta reguła odrzuca `_` i `.`, a także inne znaki, na przykład `~`. `http.unsafe_field_names` ustala działanie dla odrzuconej nazwy:

- **`drop`** to wartość domyślna. W trybach Classic i Worker Rapira usuwa pola, zanim PHP je otrzyma. Zapisuje jeden wpis `warn` dla każdego żądania. W trybie Dispatcher `drop` zachowuje wszystkie nazwy, ponieważ w tym trybie Rapira nie umieszcza pól żądania w `$_SERVER`.
- **`reject`** powoduje, że Rapira zwraca `400` we wszystkich trybach.

```toml
[http]
unsafe_field_names = "drop"
```

Nie można wyłączyć kontroli ani dodać wyjątków dla pojedynczych nazw. Zobacz [Konfiguracja](/pl/docs/configuration), aby poznać wszystkie ustawienia.

Zmień wymaganą nazwę pola z podkreśleniami na nazwę z łącznikami. Rapira stosuje tę samą regułę do pól od proxy. Nie może ustalić, czy pole z podkreśleniami wysłał klient, czy zaufane proxy. Skonfiguruj proxy, aby zmieniało nazwę przed wysłaniem pola.

::: tip
`drop` zapisuje swoje wpisy na poziomie `warn`, ale domyślny poziom logu to `error`. Ustaw target `http` na `warn`, aby zobaczyć te wpisy. Zobacz [Logi](/pl/docs/logging).
:::

## Pola wysłane więcej niż raz

HTTP pozwala na powtórzone pola, ale CGI udostępnia jedną wartość dla każdej zmiennej. Rapira łączy powtórzone wartości według składni pola:

- **Pola listowe:** Rapira łączy wartości przecinkiem i spacją. Na przykład dwie linie `Accept` stają się `text/*, image/*`. [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) pozwala na ten format dla pól z wartościami rozdzielonymi przecinkami.
- **`Cookie`:** Rapira łączy wartości średnikiem i spacją. Parser ciasteczek PHP oczekuje tego formatu.
- **Pola jednowartościowe:** Rapira zachowuje pierwszą linię `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer` lub `From`. Pomija pozostałe linie, ponieważ połączona wartość ma inne znaczenie.
- **`Host`:** Rapira zwraca `400` dla więcej niż jednej linii `Host`. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) wymaga tego zachowania.

Przed tym przetwarzaniem Rapira zwraca `400` dla linii `Content-Length` o różnych wartościach.

PHP otrzymuje wartości pól jako niezmienione bajty. Dlatego ciasteczko Latin-1 lub podpisane pole zachowuje każdy bajt wysłany przez klienta.

## Treść żądania

Rapira odczytuje treść żądania do pamięci przed uruchomieniem PHP. `http.max_body_size_mb` ogranicza pamięć dla jednej treści. Wartość domyślna to 8 MiB, tak samo jak domyślne `post_max_size` w PHP. Rapira zwraca `413` dla większej treści i zamyka połączenie. Nie odczytuje pozostałych danych treści.

Rapira sprawdza limit dwa razy:

- Najpierw Rapira sprawdza zadeklarowany `Content-Length` przed odczytem danych treści.
- Następnie sprawdza limit przy odbiorze każdego fragmentu treści. To drugie sprawdzenie ogranicza żądania chunked bez zadeklarowanej długości.

Rapira obsługuje `Expect: 100-continue` dla żądań HTTP/1.1. Wysyła `100 Continue`, zanim klient wyśle treść. Rapira najpierw sprawdza `Content-Length`. Dlatego może zwrócić `413`, zanim klient prześle zbyt dużą treść. Dla HTTP/1.0 Rapira ignoruje to oczekiwanie, jak wymaga [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Przesyłanie odpowiedzi

Tryb określa, kiedy serwer HTTP otrzymuje odpowiedź od PHP:

- W trybach Classic i Worker Rapira przechowuje pełną odpowiedź w pamięci. Wysyła odpowiedź po zakończeniu żądania lub gdy skrypt wywoła `rapira_finish_request()`.
- W trybie Dispatcher Rapira wysyła nagłówki odpowiedzi przy pierwszym zapisie treści lub przy `Exchange::flush()`. Następnie wysyła każdy fragment treści, gdy skrypt go zapisze.

`http.write_timeout_secs` ogranicza czas, przez który jeden zapis do klienta może stać w miejscu. Po upływie limitu Rapira zamyka połączenie. Wartość domyślna to 30 sekund.

Serwer kontroluje granice odpowiedzi. Dlatego nieprawidłowa długość z PHP nie zmienia granic wiadomości. Serwer usuwa te pola ustawione przez PHP: `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE` i `Proxy-Connection`. [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) definiuje te pola specyficzne dla połączenia.

Gdy PHP wysyła `Connection`, Rapira usuwa również każde pole wymienione w nim. Rapira dodaje własny `Content-Length` po tym kroku. Dlatego `Connection: content-length` nie może usunąć granic odpowiedzi.

Następnie Rapira ustawia długość:

- W trybach Classic i Worker Rapira ustawia `Content-Length` na długość pełnej treści.
- W trybie Dispatcher Rapira używa `Content-Length`, który skrypt deklaruje w nagłówkach. Zamyka połączenie, gdy treść jest krótsza, aby klient nie odczytał następnej odpowiedzi jako części bieżącej. Dłuższą treść przycina.
- W trybie Dispatcher Rapira oblicza `Content-Length`, gdy pierwsze `writeBody()` lub `sendFile()` kończy odpowiedź przed wysłaniem nagłówka. Zadeklarowana długość ma pierwszeństwo. Odpowiedź zawierająca tylko trailery otrzymuje długość zero.
- Jeśli nagłówek nie ma zadeklarowanej ani obliczonej długości, Rapira używa kodowania chunked dla HTTP/1.1. Dla HTTP/1.0 zamyka połączenie po treści. Dotyczy to zapisu strumieniowego i wcześniejszego wywołania `Exchange::flush()`.

W odpowiedziach PHP Rapira usuwa `Content-Length` i nie wysyła treści dla `204`, `304` i `HEAD`. Odpowiedzi `HEAD` dla plików statycznych zachowują długość pliku. Zobacz [Pliki statyczne](/pl/docs/static-files).

Rapira wysyła pozostałe pola PHP bez zmian, na przykład powtórzone pola `Set-Cookie`, `Vary` i `Link`. W trybach Classic i Worker usuwa nieprawidłowe pole i zapisuje wpis `debug` w logu, ale wysyła pozostałą część odpowiedzi. Rapira nie wysyła tymczasowych nagłówków (`1xx`) ani trailerów z PHP. Dlatego `103 Early Hints` nie dociera do klienta.

Jeśli worker zatrzyma się przed końcem treści, serwer zamyka połączenie bez pełnego terminatora. Błąd krytyczny po rozpoczęciu wysyłania może także uciąć odpowiedź. W trybie Worker nieprzechwycony wyjątek handlera po rozpoczęciu wysyłania ucina odpowiedź, ale pętla działa dalej. Klient może wykryć każdą niekompletną wiadomość.

::: question Czy `flush()` wysyła wyjście wcześniej w trybach Classic i Worker?
Nie. Funkcja PHP `flush()` nie wysyła danych do klienta. Użyj trybu Dispatcher, aby przesyłać odpowiedź strumieniowo. Gdy buforowana treść przekroczy 1 GiB, Rapira zatrzymuje żądanie, a klient otrzymuje niekompletną odpowiedź.
:::

## Odpowiedzi błędów

Serwer HTTP wysyła odpowiedź błędu, gdy żądanie nie dociera do PHP lub PHP nie wysyła nagłówków odpowiedzi. Ta odpowiedź nie ma treści. Zawiera `cache-control: private, no-store` i `connection: close`.

| Status | Przyczyna |
| --- | --- |
| `400` | Żądanie ma więcej niż jedno pole `Host`. Żądanie HTTP/1.1 nie ma pola `Host` lub ma puste pole `Host`. Nazwa pola jest niebezpieczna i ustawiono `unsafe_field_names = "reject"`. Odczyt treści się nie udał. W trybie Dispatcher treść multipart jest nieprawidłowa. |
| `408` | Żadne dane treści nie dotarły w czasie `http.keepalive_timeout_secs`. |
| `413` | Treść jest większa niż `http.max_body_size_mb` lub treść multipart przekracza limit `[http.uploads]`. |
| `500` | Pula workerów się zatrzymała. W trybie Dispatcher Rapira nie może zapisać przesłanego pliku w `[http.uploads].dir`. |
| `501` | Żądanie używa `CONNECT`. |
| `502` | Worker PHP zatrzymał się przed wysłaniem nagłówków odpowiedzi. |
| `503` | Kolejka workerów była pełna przez 30 sekund. |

Rapira wysyła te statusy bez tych dwóch pól:

- `503`, gdy worker nie może uruchomić swojego skryptu wejściowego. Po każdym nieudanym uruchomieniu worker odpowiada tym statusem na jedno żądanie z kolejki.
- `502`, gdy PHP ustawia końcowy status poniżej `200`, na przykład `101`.
- `500`, gdy skrypt Dispatcher zwalnia wymianę, zanim Rapira wyśle nagłówki odpowiedzi.

## Tryb Dispatcher

W trybie Dispatcher Rapira nie umieszcza pól żądania w `$_SERVER`. Skrypt odczytuje żądanie z obiektu `Rapira\Http\Exchange` i zapisuje odpowiedź jego metodami. Rapira parsuje treść `multipart/form-data`, zanim skrypt ją otrzyma. Zobacz [Tryb Dispatcher](/pl/docs/dispatcher), aby poznać API, przesyłanie plików i `sendFile()`.

## Wcześniejsze zakończenie odpowiedzi

Handler może kontynuować pracę po przygotowaniu odpowiedzi. Może na przykład wysłać webhook, dodać wpis do kolejki lub zaktualizować dane w cache. Klient nie musi czekać na tę pracę.

`rapira_finish_request()` kończy odpowiedź w tym miejscu. PHP opróżnia bufory wyjścia i przekazuje odpowiedź serwerowi HTTP. Serwer HTTP wysyła odpowiedź, gdy handler kontynuuje pracę. Funkcja działa jak funkcja `fastcgi_finish_request()` z php-fpm. Rapira nie udostępnia `fastcgi_finish_request()`. Zastąp każde jej wywołanie wywołaniem `rapira_finish_request()`:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// Ten kod działa po otrzymaniu odpowiedzi przez klienta.
$mailer->sendConfirmation($order);
$metrics->flush();
```

Sygnatura to `rapira_finish_request(): bool`. Plik [`crates/sapi/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php) deklaruje ją oraz pozostałe funkcje i klasy PHP. Skonfiguruj IDE, aby używało tego pliku do uzupełniania i informacji o typach.

`rapira_finish_request()` działa w trybach Classic i Worker. W trybie Dispatcher wywołanie rzuca `\Error`. W tym trybie zakończ wymianę zwróconą przez `receive()`, a następnie kontynuuj pracę. Zobacz [Tryb Dispatcher](/pl/docs/dispatcher) i [Tryby wykonania](/pl/docs/execution-modes).

Funkcja ma następujące ograniczenia:

- **Rapira odrzuca wyjście po wywołaniu.** Zapisz całe wyjście dla klienta przed wywołaniem.
- **Worker dalej wykonuje handler.** Nie może przyjąć kolejnego żądania przed zakończeniem handlera. Dlatego wywołanie może skrócić czas oczekiwania klienta, ale nie zwiększa współbieżności. Przekaż długie operacje do kolejki. Zobacz [Model procesów](/pl/docs/process-model), aby poznać współbieżność workerów.
