---
title: Żądania i odpowiedzi HTTP
description: "Jak Rapira zamienia żądanie HTTP w superglobale PHP, a odpowiedź PHP z powrotem w bajty lecące do klienta: mapowanie nazw pól, pola powtórzone, limity treści, wyznaczanie granic odpowiedzi i rapira_finish_request()."
faqLevel: 2
---

# Żądania i odpowiedzi HTTP

Front HTTP to ten element Rapiry, który zamienia połączenie klienta w żądanie PHP, a odpowiedź PHP z powrotem w bajty lecące do klienta. Opiera się na bibliotece [hyper](https://hyper.rs) i jest wbudowany w binarkę. Kończy na sobie HTTP/1.1 i HTTP/1.0. Przyjmuje połączenia na gnieździe, które otworzył proces nadrzędny, parsuje żądanie, podaje je do PHP i odsyła to, co PHP wyprodukowało. Nie ma tu żadnego upstreamu: nic nie leci dalej do innego serwera, a każde żądanie obsługiwane jest na miejscu. Middleware stojące przed PHP może odpowiedzieć na żądanie samodzielnie i tak właśnie serwowane są [pliki statyczne](/pl/docs/static-files).

Ta strona opisuje te miejsca, w których przekład między HTTP a PHP nie jest jeden do jednego: co front odrzuca, zanim ruszy PHP, które pole nagłówka ląduje pod którym kluczem `$_SERVER`, co się dzieje, gdy klient wyśle to samo pole dwa razy, jak duża może być treść żądania i jak wyznaczane są granice twojej odpowiedzi w drodze do klienta.

::: info
Front obsługuje wyłącznie nieszyfrowany HTTP. Jeśli potrzebujesz TLS-a, zakończ go na proxy stojącym przed Rapirą — zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).
:::

## Sprawdzanie żądania

Front sprawdza każde żądanie, zanim ruszy PHP. Żądanie, które nie przejdzie kontroli, dostaje odpowiedź od samego frontu i nigdy nie trafia do PHP.

Żądanie `CONNECT` dostaje `501`. Front nie stawia żadnych tuneli.

Front przyjmuje cel żądania w postaci absolutnej, na przykład `GET http://host.example/admin?x=1 HTTP/1.1`. Autorytet z celu zastępuje wtedy pole `Host`, a część userinfo jest z autorytetu usuwana jeszcze wcześniej, więc `$_SERVER['HTTP_HOST']` nie może być sprzeczny z celem żądania. PHP widzi w `$_SERVER['REQUEST_URI']` ścieżkę i zapytanie w postaci origin.

`http.keepalive_timeout_secs` ogranicza każdy odczyt od klienta. Zamyka bezczynne połączenie keep-alive, a przy okazji ogranicza też odczyt nagłówków żądania. Treść żądania, która przez ten czas nie posunie się do przodu, dostaje `408`, a połączenie zostaje zamknięte. Domyślnie to 60 sekund.

```toml
[http]
keepalive_timeout_secs = 60
```

## Od nazwy nagłówka do klucza `$_SERVER`

CGI ma na przekazywanie pól żądania do skryptu jedną regułę: weź nazwę pola, zamień ją na wielkie litery, każdy `-` zastąp `_` i dopisz z przodu `HTTP_` ([RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)). Z `X-Forwarded-For` robi się więc `HTTP_X_FORWARDED_FOR` i to właśnie ten klucz czyta twój kod.

Rejestrując zmienną, PHP dokłada do tego własne przekształcenie: `.` również zamienia się w `_`. Dwa mapowania, każde sprowadzające inny znak do tego samego podkreślenia — a w efekcie trzy różne nazwy przesłane przez klienta trafiają dokładnie pod jeden klucz:

| Nazwa w żądaniu   | Klucz w PHP                         |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Ta kolizja nazw to problem bezpieczeństwa. Jeśli zaufane proxy przed Rapirą ustawia `X-Forwarded-For`, to klient, który wyśle `X_Forwarded_For`, trafi pod ten sam klucz `$_SERVER` — a filtr nagłówków w proxy, wycinający pisownię z myślnikami, wersji z podkreśleniem w ogóle nie zauważy. Klient może wtedy ustawić wartość, którą twoja aplikacja traktuje jako pochodzącą od proxy.
:::

## Nazwy kolidujące ze zmienną CGI

Dlatego Rapira sprawdza nazwy pól żądania, zanim zobaczy je jakakolwiek inna warstwa. Nazwa przechodzi, gdy każdy jej bajt mieści się w `[A-Za-z0-9-]`. Kolidują dwa znaki, `_` i `.` — oba sprowadzają się do tego samego klucza `$_SERVER` co pisownia z myślnikiem. Reguła jest jednak listą znaków dozwolonych, a nie listą tych dwóch zakazanych: odrzuca też znak legalny, ale nietypowy, choćby `~`, i pozostanie poprawna, gdyby któreś z mapowań kiedyś się rozszerzyło. O tym, co dzieje się z odrzuconą nazwą, decyduje `http.unsafe_field_names`:

- **`drop`** (domyślnie) — pole znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn` z targetem `http`.
- **`reject`** — żądanie dostaje odpowiedź `400` i nic nie zostaje obsłużone.

```toml
[http]
unsafe_field_names = "drop"
```

Nie ma trzeciej opcji, która wyłącza tę kontrolę, ani wyjątku dla pojedynczej nazwy, bo kolizja, przed którą kontrola chroni, jest problemem bezpieczeństwa — gdzie ten klucz stoi wśród pozostałych ustawień, pokazuje [Konfiguracja](/pl/docs/configuration).

Jeśli twoi klienci naprawdę wysyłają nazwę z podkreśleniem, rozwiązaniem jest zmiana jej na pisownię z `-`. Pola ustawiane przez samo proxy kontrola traktuje tak samo: Rapira nie odróżni pola z podkreśleniem zapisanego przez zaufane proxy od podrobionego przez klienta, więc `X_Forwarded_For` ustawiony przez proxy również znika, zanim ruszy PHP. Proxy stojące przed Rapirą zrobi taką podmianę jedną linijką własnej konfiguracji, a wtedy nazwa jest już zwyczajna i przechodzi nietknięta.

::: tip
`drop` loguje każde usunięcie na poziomie `warn`, ale domyślny poziom logowania to `error`, więc tych linii nie zobaczysz, dopóki go nie podniesiesz. Jeśli w `$_SERVER` nieoczekiwanie brakuje nagłówka, podnieś poziom i zajrzyj najpierw do wpisów z targetem `http` — jak to zrobić, pokazują [Logi](/pl/docs/logging).
:::

## Pola wysłane więcej niż raz

HTTP pozwala klientowi powtórzyć pole, a CGI ma miejsce tylko na jedną wartość na zmienną — powtórzenia trzeba więc scalić w jedną wartość, zanim PHP cokolwiek zobaczy. Rapira scala je tak, jak pozwala na to gramatyka samego pola:

- **Pola listowe** — wartości sklejane są przez `, `, bo taką rekombinację dopuszcza [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) dla pola zdefiniowanego jako lista rozdzielana przecinkami. Z dwóch linii `Accept` wychodzi `text/*, image/*`.
- **`Cookie`** — też lista, ale nie przecinkowa. Jej powtórzenia sklejane są przez `; `, czyli w formie cookie-string, której oczekuje parser PHP — dzięki temu `$_COOKIE` wychodzi poprawnie.
- **Pola jednowartościowe** — `Authorization`, `Proxy-Authorization`, `Content-Type`, `Content-Length`, `Referer` i `From` zachowują wyłącznie **pierwszą** linię, a nadmiarowe znikają z wpisem `warn`. Sklejenie by je zepsuło: druga linia `Authorization` doklejona do pierwszej ląduje w środku poświadczenia, które PHP zaraz zdekoduje z base64. Powtórzony `Content-Length` dostaje `400`, zanim dojdzie do scalania, więc do tej reguły trafia tylko pozostała piątka.
- **`Host`** — więcej niż jedna linia `Host` kończy się odpowiedzią `400`, nigdy scaleniem. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) stawia tu MUST, a poprawną odpowiedź może dać tylko ta warstwa, która terminuje połączenie.

Wartości pól docierają do PHP wszędzie jako surowe bajty. Ciasteczko w latin1 czy podpisany nagłówek zachowują każdy oktet wysłany przez klienta, bo konwersja na UTF-8 po drodze zepsułaby dokładnie te wartości, które zmienić się nie mogą.

## Treść żądania

Treść żądania trafia do pamięci, zanim ruszy PHP, a `http.max_body_size_mb` ogranicza, ile Rapira jej przechowuje. Domyślnie jest to 8 MiB — tyle samo, ile wynosi domyślne `post_max_size` w samym PHP. Treść ponad limit dostaje `413`, a ponieważ reszta wciąż płynie do serwera, ta odpowiedź od razu zamyka połączenie, zamiast próbować użyć go ponownie.

Limit sprawdzany jest dwa razy:

- Najpierw wobec zadeklarowanego `Content-Length`, zanim wczytany zostanie choćby jeden bajt treści.
- Potem jeszcze raz w trakcie odbierania treści, kawałek po kawałku. Żądanie chunked nie deklaruje długości z góry, więc to drugie sprawdzenie jest tym, co ogranicza jego zużycie pamięci.

W żądaniach HTTP/1.1 Rapira honoruje `Expect: 100-continue`: odsyła tymczasową odpowiedź `100 Continue`, a klient dopiero wtedy wysyła wstrzymaną treść. Ważna jest kolejność: sprawdzenie `Content-Length` idzie *pierwsze*, więc klient zapowiadający zbyt dużą treść dostaje `413`, zanim cokolwiek wyśle. Oczekiwanie zgłoszone w żądaniu HTTP/1.0 jest ignorowane, tak jak wymaga tego [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Przesyłanie odpowiedzi

Front nie buforuje treści odpowiedzi. Nagłówki wypisuje, gdy tylko PHP je zatwierdzi, a każdą ramkę treści wtedy, gdy PHP ją wyprodukuje. O tym, kiedy PHP je produkuje, decyduje tryb. W trybach Classic i Worker PHP trzyma całą odpowiedź u siebie i oddaje ją frontowi na koniec żądania albo wcześniej, jeśli skrypt wywoła `rapira_finish_request()`. W trybie Dispatcher PHP oddaje frontowi nagłówki i każdy kawałek treści w miarę, jak kod je wypisuje.

Wyznaczanie granic odpowiedzi należy do serwera, a nie do PHP. `Transfer-Encoding` ustawiony przez twój kod zostaje wyrzucony. `Content-Length` ustawiony przez twój kod znika z linii nagłówków, żeby nieaktualna długość nigdy nie rozsynchronizowała połączenia. W trybach Classic i Worker front deklaruje potem długość treści, którą wyprodukowało PHP. W trybie Dispatcher `Content-Length` z wypisanych przez ciebie nagłówków staje się długością zadeklarowaną w odpowiedzi: front wysyła tę długość i liczy do niej treść. Treść krótsza od zadeklarowanej długości kończy się zamknięciem połączenia, a treść dłuższa zostaje ucięta na tej długości.

Odpowiedź, która nie deklaruje żadnej długości, dostaje granice od frontu. Klient HTTP/1.1 dostaje kodowanie chunked, a klient HTTP/1.0 treść, której koniec wyznacza zamknięcie połączenia.

Odpowiedzi, które z definicji nie mają treści, czyli `204` i `304`, nie dostają `Content-Length` w ogóle. Tak samo traktowana jest odpowiedź na żądanie `HEAD`: front wysyła same nagłówki, bez `Content-Length` i bez ani jednego bajtu treści.

Pola hop-by-hop należą do pojedynczego połączenia, a nie do odpowiedzi, więc PHP też ich nie ustawia ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). Te są wycinane z tego, co wypisał twój kod:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, a do tego dwa pola wyznaczające granicę treści: `Content-Length` i `Transfer-Encoding`.

Jeśli PHP mimo wszystko wyśle nagłówek `Connection`, wycinane są także pola, które w nim wymieniono — dokładnie to znaczy wartość `Connection` — a dzieje się to, zanim Rapira wstawi swój własny `Content-Length`. Dzięki temu `Connection: content-length` nie usunie z odpowiedzi pól wyznaczających granicę treści.

Cała reszta przechodzi tak, jak zapisało ją PHP, z powtórzeniami włącznie: `Set-Cookie`, `Vary` i `Link` mogą się prawidłowo pojawić kilka razy i wszystkie zostaną wysłane. Nagłówek, którego w ogóle nie da się przesłać, znika z wpisem w logu, zamiast wywracać całą odpowiedź, a reszta odpowiedzi i tak zostaje wysłana.

Tymczasowe nagłówki odpowiedzi (1xx) wypisane przez PHP są odrzucane, tak samo jak trailery. Front nie przekazuje dalej ani jednych, ani drugich. `100 Continue` dla żądania z `Expect` nie pochodzi od PHP: tę odpowiedź front wypisuje sam.

Urwana odpowiedź kończy się zerwaniem połączenia, bez czystego zakończenia. Odpowiedź jest urwana wtedy, gdy worker ginie przed końcem treści, gdy treść okazuje się krótsza od długości zadeklarowanej przez PHP albo gdy błąd krytyczny lub nieprzechwycony wyjątek kończy skrypt, który zdążył już coś wypisać. Klient odczytuje wtedy niekompletną wiadomość, więc pozna po niej, że odpowiedź została ucięta.

Odpowiedź z błędem, którą front wypisuje sam, niesie `cache-control: private, no-store` oraz `connection: close` i nie ma treści. Takie są `413` dla zbyt dużej treści żądania i `501` dla `CONNECT`.

::: question Dlaczego to front, a nie PHP, ustawia pola wyznaczające granice odpowiedzi?
O granicach odpowiedzi decydują bajty, które front wypuszcza w sieć. Front bierze długość zadeklarowaną w odpowiedzi i liczy do niej treść. Treść krótsza od zadeklarowanej kończy się zamknięciem połączenia, więc klient nie odczyta następnej odpowiedzi jako dalszego ciągu tej. `Content-Length` ustawiony jako zwykły nagłówek omijałby to liczenie, dlatego zostaje wycięty.
:::

## Wcześniejsze zakończenie odpowiedzi

Gdy odpowiedź jest już gotowa, handlerowi często zostaje jeszcze praca: webhook do wysłania, wpis do kolejki, cache do rozgrzania. Klient nie musi na to czekać.

`rapira_finish_request()` kończy odpowiedź w tym miejscu. Bufory wyjścia PHP zostają wypchnięte do odpowiedzi, odpowiedź trafia do frontu i wychodzi do klienta, a twój handler biegnie dalej, gdy klient ma już całość u siebie. To ten sam kontrakt co `fastcgi_finish_request()`, więc kod pisany pod php-fpm zachowuje się dokładnie tak jak zawsze:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

Sygnatura to `rapira_finish_request(): bool`. Deklaruje ją, razem z całą resztą tego, co Rapira udostępnia PHP, plik [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) — wskaż go swojemu IDE, żeby mieć podpowiadanie i typy.

Funkcja jest zarejestrowana dla całego procesu i działa na aktualnie obsługiwanym żądaniu, więc tryb Classic również ją obsługuje: zachowanie jest takie samo niezależnie od tego, czy skrypt jest rezydentny, czy wykonuje się od nowa przy każdym żądaniu. Co jeszcze różni się między trybami, opisują [Tryby wykonania](/pl/docs/execution-modes).

O dwóch rzeczach warto pamiętać:

- **Wyjście po wywołaniu nie dociera do klienta.** Odpowiedź jest zamknięta, więc `echo` po tej linii zostaje odrzucony — nie czeka w kolejce na późniejsze opróżnienie bufora. Wszystko, co klient ma zobaczyć, musisz wypisać wcześniej.
- **Worker nadal jest zajęty.** Zakończenie odpowiedzi uwalnia *klienta*, a nie proces. Ten worker nie weźmie kolejnego żądania, dopóki twój handler się nie zakończy, więc praca przesunięta za wywołanie to praca, na którą następne żądanie i tak czeka — ilu jest workerów do czekania, opisuje [Model procesów](/pl/docs/process-model). Wywołanie obniża opóźnienie po stronie klienta, ale nie daje współbieżności, więc ciężka praca należy do kolejki.
