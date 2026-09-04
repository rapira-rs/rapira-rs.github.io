---
title: Żądania i odpowiedzi HTTP
description: "Jak Rapira zamienia żądanie HTTP w superglobale PHP, a odpowiedź PHP z powrotem w bajty lecące do klienta: mapowanie nazw pól, pola powtórzone, limity treści, wyznaczanie granic odpowiedzi i rapira_finish_request()."
faqLevel: 2
---

# Żądania i odpowiedzi HTTP

Serwer HTTP zamienia połączenie klienta w żądanie PHP. Zamienia odpowiedź PHP w dane sieciowe. Używa biblioteki [hyper](https://hyper.rs) w pliku binarnym Rapiry. Przyjmuje HTTP/1.1 i HTTP/1.0 na gnieździe procesu nadrzędnego. Serwer analizuje żądanie, przekazuje je do PHP i wysyła odpowiedź. Nie przekazuje żądań do innego serwera. Middleware może odpowiedzieć przed uruchomieniem PHP. Rapira używa tego mechanizmu dla [plików statycznych](/pl/docs/static-files).

Ta strona opisuje kontrolę żądań, klucze `$_SERVER`, powtórzone pola, limity treści i granice odpowiedzi.

::: info
Serwer przyjmuje nieszyfrowany HTTP. Użyj proxy do zakończenia TLS. Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).
:::

## Sprawdzanie żądania

Serwer HTTP sprawdza każde żądanie przed uruchomieniem PHP. Odpowiada na nieprawidłowe żądanie bez wywołania PHP.

Rapira zwraca `501` dla żądania `CONNECT`. Serwer HTTP nie tworzy tuneli.

Rapira przyjmuje bezwzględny cel, na przykład `GET http://host.example/admin?x=1 HTTP/1.1`. Autorytet celu zastępuje pole `Host`. Rapira najpierw usuwa dane użytkownika z autorytetu. Zapobiega to konfliktowi w `$_SERVER['HTTP_HOST']`. PHP otrzymuje ścieżkę i zapytanie w `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` ogranicza każdy odczyt od klienta. Dotyczy bezczynnego połączenia i nagłówków żądania. Rapira zwraca `408`, jeśli odczyt treści nie postępuje przed upływem limitu. Następnie zamyka połączenie. Wartość domyślna to 60 sekund.

```toml
[http]
keepalive_timeout_secs = 60
```

## Od nazwy nagłówka do klucza `$_SERVER`

CGI zmienia nazwę pola na wielkie litery. Zastępuje każdy `-` znakiem `_` i dodaje `HTTP_`. Zobacz [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Dlatego `X-Forwarded-For` staje się `HTTP_X_FORWARDED_FOR`.

PHP wykonuje dodatkową konwersję podczas rejestracji zmiennej. Zastępuje także `.` znakiem `_`. Dlatego trzy nazwy sieciowe wskazują ten sam klucz PHP:

| Nazwa w żądaniu   | Klucz w PHP                         |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Bez obowiązkowej kontroli nazw pól w Rapirze ta kolizja może stwarzać zagrożenie bezpieczeństwa. Proxy może ustawić `X-Forwarded-For`, a klient może wysłać `X_Forwarded_For`. Obie nazwy wskazują ten sam klucz `$_SERVER`. Filtr proxy dla nazwy z łącznikami może nie usunąć nazwy z podkreśleniami. Aplikacja może wtedy zaufać wartości klienta.
:::

## Nazwy kolidujące ze zmienną CGI

Rapira sprawdza nazwy pól przed innym przetwarzaniem. Przyjmuje tylko bajty z `[A-Za-z0-9-]`. Znaki `_` i `.` mogą wskazać ten sam klucz `$_SERVER` co `-`. Lista odrzuca też inne znaki, na przykład `~`. Ustawienie `http.unsafe_field_names` kontroluje odrzucone nazwy:

- **`drop`** (domyślnie) - pole znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn` z targetem `http`.
- **`reject`** - żądanie dostaje odpowiedź `400` i nic nie zostaje obsłużone.

```toml
[http]
unsafe_field_names = "drop"
```

Nie można wyłączyć kontroli ani dodać wyjątków dla pojedynczych nazw. Zobacz [Konfiguracja](/pl/docs/configuration), aby poznać wszystkie ustawienia.

Zmień wymaganą nazwę pola z podkreśleniami na nazwę z myślnikami. Rapira stosuje tę samą regułę do pól proxy. Rapira nie może ustalić źródła pola z podkreśleniami. Skonfiguruj proxy, aby zmieniało nazwę przed wysłaniem.

::: tip
`drop` zapisuje każde usunięcie na poziomie `warn`, ale poziom domyślny to `error`. Ustaw target `http` na `warn`, aby zobaczyć te wpisy. Zobacz [Logi](/pl/docs/logging).
:::

## Pola wysłane więcej niż raz

HTTP pozwala na powtórzone pola, ale CGI udostępnia jedną wartość dla zmiennej. Rapira łączy wartości według składni pola:

- **Pola listowe:** Rapira łączy wartości przecinkiem i spacją. Zobacz [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3).
- Na przykład dwie linie `Accept` stają się `text/*, image/*`.
- **`Cookie`:** Rapira łączy wartości średnikiem i spacją. Parser ciasteczek PHP oczekuje tego formatu.
- **Pola jednowartościowe:** Rapira zachowuje pierwszą linię `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer` lub `From`.
- Usuwa dodatkowe linie i zapisuje wpis `warn`. Dla powtórzonego `Content-Length` zwraca `400`.
- **`Host`:** Rapira zwraca `400` dla wielu linii `Host`. Zobacz [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2).

PHP otrzymuje wartości pól jako niezmienione bajty. Ciasteczko Latin-1 lub podpisane pole zachowuje więc każdy bajt klienta.

## Treść żądania

Rapira odczytuje treść do pamięci przed uruchomieniem PHP. `http.max_body_size_mb` ogranicza pamięć dla jednej treści. Wartość domyślna to 8 MiB, tak samo jak `post_max_size` w PHP. Rapira zwraca `413` dla większej treści i zamyka połączenie. Nie odczytuje pozostałych danych.

Limit sprawdzany jest dwa razy:

- Najpierw Rapira sprawdza zadeklarowany `Content-Length` przed odczytem treści.
- Następnie sprawdza każdy fragment. To sprawdzenie ogranicza żądania chunked bez zadeklarowanej długości.

Rapira obsługuje `Expect: 100-continue` dla HTTP/1.1. Wysyła `100 Continue` przed wysłaniem treści przez klienta. Rapira najpierw sprawdza `Content-Length`. Może więc zwrócić `413` przed przesłaniem zbyt dużej treści. Dla HTTP/1.0 ignoruje to oczekiwanie zgodnie z [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Przesyłanie odpowiedzi

Serwer HTTP nie buforuje treści odpowiedzi. Wysyła nagłówki po zatwierdzeniu ich przez PHP. Następnie wysyła każdy fragment, gdy PHP go utworzy. Tryb określa czas przekazania danych. W trybach Classic i Worker PHP zwykle przekazuje pełną odpowiedź na końcu. `rapira_finish_request()` przekazuje ją wcześniej. W trybie Dispatcher PHP przekazuje nagłówki i fragmenty podczas ich zapisywania.

Serwer kontroluje granice odpowiedzi. Usuwa pola `Transfer-Encoding` i `Content-Length` ustawione przez PHP. W trybach Classic i Worker serwer ustawia długość pełnej treści. W trybie Dispatcher używa `Content-Length` zadeklarowanego przez PHP i porównuje go z treścią. Zamyka połączenie dla krótkiej treści. Długą treść przycina do zadeklarowanej długości.

Dla odpowiedzi bez długości serwer używa przesyłania chunked w HTTP/1.1. W HTTP/1.0 zamyka połączenie po treści.

Serwer pomija `Content-Length` w odpowiedziach `204` i `304`. Pomija też to pole i treść w odpowiedziach `HEAD`.

Serwer usuwa pola specyficzne dla połączenia ustawione przez PHP. To zachowanie definiuje [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1):

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, a do tego dwa pola wyznaczające granicę treści: `Content-Length` i `Transfer-Encoding`.

Gdy PHP wysyła `Connection`, Rapira usuwa również wymienione w nim pola. Dzieje się to przed dodaniem własnego `Content-Length`. Dlatego `Connection: content-length` nie może usunąć granic odpowiedzi.

Serwer wysyła pozostałe pola PHP bez zmian, w tym powtórzone `Set-Cookie`, `Vary` i `Link`. Usuwa nieprawidłowe pole sieciowe i zapisuje wpis. Wysyła pozostałą część odpowiedzi.

Rapira usuwa tymczasowe odpowiedzi i trailery z PHP. Serwer HTTP tworzy odpowiedź `100 Continue` dla żądania `Expect`.

Jeśli worker zakończy się przed końcem treści, serwer zamyka połączenie bez pełnego terminatora. Serwer zamyka połączenie także wtedy, gdy treść jest krótsza od długości zadeklarowanej przez PHP. Błąd krytyczny po rozpoczęciu wysyłania może zakończyć skrypt i uciąć odpowiedź. W trybie Worker nieprzechwycony wyjątek handlera po rozpoczęciu wysyłania ucina odpowiedź, ale pętla działa dalej. Każdy z tych przypadków tworzy niekompletną wiadomość, którą klient może wykryć.

Odpowiedź błędu serwera HTTP nie ma treści. Zawiera `cache-control: private, no-store` i `connection: close`. Przykłady to `413` dla dużej treści i `501` dla `CONNECT`.

::: question Dlaczego to front, a nie PHP, ustawia pola wyznaczające granice odpowiedzi?
Serwer HTTP porównuje rozmiar treści z zadeklarowaną długością. Zamyka połączenie, gdy treść jest zbyt krótka. Dzięki temu klient nie odczyta następnej odpowiedzi jako części bieżącej. Serwer usuwa `Content-Length` z PHP, ponieważ mógłby ominąć liczenie.
:::

## Wcześniejsze zakończenie odpowiedzi

Handler może kontynuować pracę po przygotowaniu odpowiedzi. Może na przykład wysłać webhook, dodać wpis do kolejki lub zaktualizować cache. Klient nie musi czekać na tę pracę.

`rapira_finish_request()` kończy odpowiedź w tym miejscu. PHP opróżnia bufory wyjścia i przekazuje odpowiedź serwerowi HTTP. Serwer wysyła odpowiedź, gdy handler kontynuuje pracę. Funkcja ma ten sam kontrakt co `fastcgi_finish_request()`:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

Sygnatura to `rapira_finish_request(): bool`. Plik [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) deklaruje ją i pozostałe API PHP. Dodaj ten plik do IDE, aby uzyskać uzupełnianie i informacje o typach.

Rapira rejestruje funkcję dla całego procesu. Funkcja działa na bieżącym żądaniu. Dlatego tryb Classic również ją obsługuje. Zobacz [Tryby wykonania](/pl/docs/execution-modes).

Funkcja ma następujące ograniczenia:

- **Wyjście po wywołaniu nie jest wysyłane.** Rapira odrzuca wyjście po zamknięciu odpowiedzi.
- Zapisz wszystkie wymagane dane wyjściowe przed wywołaniem.
- **Worker pozostaje zajęty.** Nie przyjmie kolejnego żądania przed zakończeniem handlera.
- Wywołanie zmniejsza opóźnienie klienta, ale nie zwiększa współbieżności. Przekaż długą pracę do kolejki.
