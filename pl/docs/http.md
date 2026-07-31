---
title: Żądania i odpowiedzi HTTP
description: Jak Rapira zamienia żądanie HTTP w superglobale PHP, a odpowiedź PHP z powrotem w bajty lecące do klienta — mapowanie nazw pól, pola powtórzone, limity treści, buforowanie i rapira_finish_request().
---

# Żądania i odpowiedzi HTTP

Front HTTP Rapiry opiera się na [Pingorze](https://github.com/cloudflare/pingora) i jest wbudowany w binarkę. Przyjmuje połączenia na gnieździe, które otworzył proces nadrzędny, parsuje żądanie, podaje je do PHP i odsyła to, co PHP wyprodukowało. Nie ma tu żadnego upstreamu: każde żądanie obsługuje lokalnie twój własny kod.

Na co dzień o tej warstwie w ogóle nie myślisz — piszesz `$_GET['page']`, robisz `echo` i to po prostu działa. Ta strona opisuje te miejsca, w których przekład między HTTP a PHP nie jest jeden do jednego: które pole nagłówka ląduje pod którym kluczem `$_SERVER`, co się dzieje, gdy klient wyśle to samo pole dwa razy, jak duża może być treść żądania i jak wyznaczane są granice twojej odpowiedzi w drodze do klienta.

::: info
Front obsługuje wyłącznie nieszyfrowany HTTP. Jeśli potrzebujesz TLS-a, zakończ go na proxy stojącym przed Rapirą — zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).
:::

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

Dlatego Rapira sprawdza nazwy pól żądania, zanim spojrzy na nie cokolwiek innego. Nazwa przechodzi, gdy każdy jej bajt mieści się w `[A-Za-z0-9-]`. Realnie kolidują dwa znaki, `_` i `.` — oba sprowadzają się do klucza `$_SERVER`, który należy do nazwy z myślnikiem. Reguła jest jednak listą znaków dozwolonych, a nie listą tych dwóch zakazanych: odrzuca też znak legalny, ale nietypowy, choćby `~`, i pozostanie poprawna, gdyby któreś z mapowań kiedyś się rozszerzyło. O tym, co dzieje się z odrzuconą nazwą, decyduje `http.unsafe_field_names`:

- **`drop`** (domyślnie) — pole znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn` z targetem `http`.
- **`reject`** — żądanie dostaje odpowiedź `400` i nic nie zostaje obsłużone, więc klient nie ma nawet jak spróbować.

```toml
[http]
unsafe_field_names = "drop"
```

Trzeciej opcji, która wyłącza tę kontrolę, świadomie nie ma. Ta kolizja wraca właśnie na serwerach, które dały zwykły przełącznik do wyłączania, więc Rapira takiego przełącznika nie oferuje — gdzie ten klucz stoi wśród pozostałych ustawień, pokazuje [Konfiguracja](/pl/docs/configuration).

Jeśli twoi klienci naprawdę wysyłają nazwę z podkreśleniem, rozwiązaniem jest zmiana jej na pisownię z `-`. Proxy stojące przed Rapirą zrobi taką podmianę jedną linijką własnej konfiguracji, a wtedy nazwa jest już zwyczajna i przechodzi nietknięta.

::: tip
`drop` loguje każde usunięcie na poziomie `warn`, ale domyślny poziom logowania to `error`, więc tych linii nie zobaczysz, dopóki go nie podniesiesz. Jeśli w `$_SERVER` nieoczekiwanie brakuje nagłówka, podnieś poziom i zajrzyj najpierw do wpisów z targetem `http` — jak to zrobić, pokazują [Logi](/pl/docs/logging).
:::

## Pola wysłane więcej niż raz

HTTP pozwala klientowi powtórzyć pole, a CGI ma miejsce tylko na jedną wartość na zmienną — powtórzenia trzeba więc scalić w jedną wartość, zanim PHP cokolwiek zobaczy. Rapira scala je tak, jak pozwala na to gramatyka samego pola:

- **Pola listowe** — wartości sklejane są przez `, `, bo taką rekombinację dopuszcza [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) dla pola zdefiniowanego jako lista rozdzielana przecinkami. Z dwóch linii `Accept` wychodzi `text/*, image/*`.
- **`Cookie`** — też lista, ale nie przecinkowa. Jej powtórzenia sklejane są przez `; `, czyli w formie cookie-string, której oczekuje parser PHP — dzięki temu `$_COOKIE` wychodzi poprawnie.
- **Pola jednowartościowe** — `Authorization`, `Proxy-Authorization`, `Content-Type`, `Content-Length`, `Referer` i `From` zachowują wyłącznie **pierwszą** linię, a nadmiarowe znikają z wpisem `warn`. Sklejenie by je zepsuło: druga linia `Authorization` doklejona do pierwszej ląduje w środku poświadczenia, które PHP zaraz zdekoduje z base64, i z działającego logowania robi się śmieć.
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

## Jak odpowiedź wychodzi do klienta

Wszystko, co wypisze PHP, czeka w buforze do końca żądania i dopiero wtedy nagłówki odpowiedzi ruszają w sieć. Po to właśnie jest bufor: serwer zna dokładną długość treści, więc może wysłać prawdziwy `Content-Length`. Bez wyznaczonej granicy HTTP/1.1 zostaje z jedyną alternatywą — koniec odpowiedzi wyznacza wtedy zamknięcie połączenia, czyli nowe połączenie do każdego pojedynczego żądania. Z `Content-Length` działa keep-alive i połączenie zostaje otwarte.

Wyznaczanie tej granicy należy więc do serwera, a nie do PHP. `Content-Length` albo `Transfer-Encoding` ustawiony przez twój kod zostaje wyrzucony i zastąpiony tym, co naprawdę mierzy zbuforowana treść, żeby nieaktualna długość nigdy nie rozsynchronizowała połączenia. Odpowiedzi, które z definicji nie mają treści — `204` i `304` — nie dostają `Content-Length` w ogóle.

Pola hop-by-hop należą do pojedynczego połączenia, a nie do odpowiedzi, więc PHP też ich nie ustawia ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). Te są wycinane z tego, co wypisał twój kod:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, a do tego dwa pola wyznaczające granicę treści: `Content-Length` i `Transfer-Encoding`.

Jeśli PHP mimo wszystko wyśle nagłówek `Connection`, wycinane są także pola, które w nim wymieniono — dokładnie to znaczy wartość `Connection` — a dzieje się to, zanim Rapira wstawi swój własny `Content-Length`. Dzięki temu `Connection: content-length` nie usunie z odpowiedzi pól wyznaczających granicę treści.

Cała reszta przechodzi tak, jak zapisało ją PHP, z powtórzeniami włącznie: `Set-Cookie`, `Vary` i `Link` mogą się prawidłowo pojawić kilka razy i wszystkie zostaną wysłane. Nagłówek, którego w ogóle nie da się przesłać, znika z wpisem w logu, zamiast wywracać całą odpowiedź, a reszta odpowiedzi i tak zostaje wysłana.

## Wcześniejsze zakończenie odpowiedzi

Czasem to, co należy do klienta, kończy się długo przed samym żądaniem. Odpowiedź jest gotowa, ale zostaje jeszcze webhook do wystrzelenia, wpis do kolejki, cache do rozgrzania. Kazanie przeglądarce na to czekać tylko dodaje opóźnienie.

`rapira_finish_request()` kończy odpowiedź w tym miejscu. Zbuforowane wyjście zostaje opróżnione, odpowiedź trafia do frontu i wychodzi do klienta, a twój handler biegnie dalej, gdy klient ma już całość u siebie. To ten sam kontrakt co `fastcgi_finish_request()`, więc kod pisany pod php-fpm zachowuje się dokładnie tak jak zawsze:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// The client already has the response; this still runs.
$mailer->sendConfirmation($order);
$metrics->flush();
```

Sygnatura to `rapira_finish_request(): bool`. Deklaruje ją, razem z całą resztą tego, co Rapira udostępnia PHP, plik [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) — wskaż go swojemu IDE, a podpowiadanie i typy dostaniesz za darmo.

O dwóch rzeczach warto pamiętać:

- **Wyjście po wywołaniu nie dociera do klienta.** Odpowiedź jest zamknięta, więc `echo` po tej linii zostaje odrzucony — nie czeka w kolejce na późniejsze opróżnienie bufora. Wszystko, co klient ma zobaczyć, musisz wypisać wcześniej.
- **Worker nadal jest zajęty.** Zakończenie odpowiedzi uwalnia *klienta*, a nie proces. Ten worker nie weźmie kolejnego żądania, dopóki twój handler faktycznie się nie zakończy, więc praca przesunięta za wywołanie to praca, na którą następne żądanie i tak czeka — ilu jest workerów do czekania, opisuje [Model procesów](/pl/docs/process-model). To narzędzie na opóźnienie, a nie na współbieżność; jeśli roboty jest dużo, jej miejsce jest w kolejce.

::: question Moje proxy ustawia `X_Forwarded_For`, a PHP nagle go nie widzi. Co się stało?
Nagłówek został usunięty, bo nazwa z podkreśleniem ląduje pod tym samym kluczem `$_SERVER` co ta z myślnikami, a Rapira nie odróżni nagłówka od twojego proxy od podróbki podrzuconej przez klienta. Zmień w proxy nazwę na `X-Forwarded-For` — ta pisownia jest zwyczajna i przechodzi nietknięta. Podnieś poziom logowania do `warn`, a zobaczysz wpis o usunięciu.
:::

::: question Czy mogę wyłączyć kontrolę nazw pól tylko dla jednego nagłówka?
Nie. Nie ma ani przełącznika wyłączającego, ani wyjątków dla pojedynczych nazw — jedyne dostępne wartości to `drop` i `reject`. Zamiast tego zmień nazwę pola na pisownię z `-` w warstwie stojącej przed Rapirą; to rozwiązuje sprawę porządnie, a nie otwiera dziurę na nowo.
:::

::: question Dlaczego mojego `header('Content-Length: …')` nie ma w odpowiedzi?
Bo wyznaczanie granic odpowiedzi należy do serwera. Rapira buforuje całą treść, więc zna jej prawdziwą długość i to ją wysyła; twoja wartość zostaje odrzucona, a nie przyjęta na wiarę. Tak samo jest z `Transfer-Encoding` i polami hop-by-hop.
:::

::: question Czy `rapira_finish_request()` działa w trybie klasycznym?
Tak — funkcja jest zarejestrowana dla całego procesu i działa na aktualnie obsługiwanym żądaniu, więc zachowuje się tak samo niezależnie od tego, czy skrypt jest rezydentny, czy wykonuje się od nowa przy każdym żądaniu. Co jeszcze różni się między trybami, opisują [Tryby wykonania](/pl/docs/execution-modes).
:::
