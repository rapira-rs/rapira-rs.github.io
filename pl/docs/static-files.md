---
title: Pliki statyczne
description: "Serwowanie plików z katalogu, zanim żądanie dotrze do PHP: klucze [http.static], reguły decydujące o tym, na co odpowiada middleware, i cache plików w każdym workerze."
faqLevel: 2
---

# Pliki statyczne

Rapira uruchamia middleware plików statycznych przed PHP. Odpowiada, gdy ścieżka wskazuje plik w katalogu głównym.
Pozostałe żądania przekazuje bez zmian do następnego handlera.

## Konfiguracja middleware

Dwa fragmenty `rapira.toml` włączają middleware. Dodaj `static` do listy `[http].middleware`.
Następnie dodaj sekcję `[http.static]` z katalogiem plików.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Required. Relative paths use this file's directory.
forbid = [".php"]   # Optional. This list replaces the default.
```

`middleware` trzyma łańcuch middleware w kolejności listy. `static` to na razie jedyna nazwa, jaką ten klucz przyjmuje.

`root` określa katalog plików. Nie ma wartości domyślnej.
Ścieżka względna używa katalogu pliku konfiguracyjnego. `pool.entrypoint` używa tej samej reguły.

`forbid` zawiera przyrostki nazw plików, których middleware nie serwuje. Domyślna wartość to `[".php"]`.
Jawna lista zastępuje tę wartość. Na przykład `forbid = [".php", ".env"]` blokuje oba przyrostki.

::: danger
`forbid = []` zezwala na wszystkie pliki, w tym kod źródłowy PHP.
Nie używaj tej wartości dla publicznego katalogu głównego. Może ujawnić kod aplikacji i osadzone sekrety.
:::

Każdy wpis zaczyna się kropką, ma co najmniej dwa znaki i nie zawiera `/` ani spacji.
Nieprawidłowy wpis zatrzymuje uruchamianie serwera.

Pozostałe klucze tego pliku opisuje [Konfiguracja](/pl/docs/configuration).

::: question Dlaczego wpis w `forbid` musi być przyrostkiem?
Middleware porównuje każdy wpis z końcem nazwy pliku. Rapira akceptuje tylko przyrostki z co najmniej dwoma znakami, które zaczynają się od `.` i nie zawierają ukośników ani białych znaków.
:::

## Walidacja przy starcie

Serwer sprawdza katalog główny przed przyjęciem żądań. Ścieżka musi istnieć, być katalogiem i zezwalać użytkownikowi na przeszukiwanie.
Błąd zatrzymuje uruchamianie i wskazuje ścieżkę.

Oba fragmenty konfiguracji muszą występować razem. Wpis `"static"` wymaga `[http.static]`, a sekcja wymaga wpisu.
Rapira odrzuca też powtórzone nazwy middleware.

::: question Dlaczego serwer sprawdza katalog główny dwa razy?
Pierwsza kontrola czyta metadane i potwierdza typ katalogu. Druga rozwiązuje `.` i sprawdza prawo przeszukiwania.
Prawa przeszukiwania i odczytu używają innych bitów. Dlatego pierwsza kontrola może przejść, a druga zakończyć się błędem.
Zobacz dokumentację [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html).
:::

## Reguły serwowania

Middleware bierze żądanie pod uwagę tylko wtedy, gdy metodą jest `GET` albo `HEAD`. Każda inna metoda idzie do PHP.

O reszcie decyduje ścieżka:

- Ścieżka z segmentem zaczynającym się od `.` idzie do PHP, więc `/.env`, `/.git/config` i `/../outside.txt` nigdy nie docierają do systemu plików.
- Kontrola `forbid` działa na ścieżce po zdekodowaniu procentowym i porównuje ostatni segment bez rozróżniania wielkości liter, więc przy `forbid` z `.php` do PHP idą tak samo `/index.php`, `/index%2Ephp` i `/Upper.PHP`.
- URL katalogu idzie do PHP. Middleware nie serwuje dla niego żadnego pliku indeksu, z ukośnikiem na końcu czy bez.
- Ścieżka, za którą nie stoi żaden plik, idzie do PHP. Tak samo trafia tam błąd uprawnień oraz nazwa, której system plików nie przyjmuje.
- Każda inna nieudana próba odczytu kończy się odpowiedzią `500`. Takie żądanie nie dociera do PHP, a błąd trafia do logu z celem `http`.

PHP otrzymuje przekazane żądanie bez zmian. Zobacz [Żądania i odpowiedzi HTTP](/pl/docs/http).

::: question Dlaczego URL katalogu nie dostaje w odpowiedzi `index.html`?
PHP kontroluje przestrzeń adresów, więc URL katalogu jest trasą aplikacji. Automatyczny indeks utworzyłby dwie możliwe odpowiedzi.
Uniemożliwiłby też skryptowi wejściowemu przetworzenie `/`.
:::

::: question Jak middleware odróżnia brak pliku od nieudanego odczytu?
Sześć wyników oznacza brak dostępnego pliku. Ścieżka może nie istnieć, być niedostępna lub wskazywać katalog.
Element ścieżki może mieć zły typ. Nazwa może być za długa lub zawierać bajt NUL.
W tych przypadkach żądanie trafia do PHP. Dla innych błędów odczytu middleware zwraca `500`.
:::

## Pola odpowiedzi

Pola opisane niżej należą do odpowiedzi, która serwuje plik. Odpowiedź `500` z middleware nie niesie żadnego z nich.

Middleware ustawia `Content-Type` na podstawie rozszerzenia pliku. Nazwa bez znanego rozszerzenia dostaje `application/octet-stream`.

Odpowiedź zawiera `ETag` i `Last-Modified`. Middleware tworzy `Last-Modified` z czasu modyfikacji.
Tworzy `ETag` z czasu i długości. Plik bez czasu modyfikacji nie otrzymuje tych pól.
Czas sprzed epoki wyłącza tylko `ETag`.

Middleware odpowiada `304 Not Modified`, gdy pole `If-None-Match` pasuje do `ETag`. Żądanie bez pola `If-None-Match` dostaje `304 Not Modified`, gdy czas modyfikacji pliku nie jest późniejszy niż czas z pola `If-Modified-Since`. Taka odpowiedź niesie wyłącznie `ETag` i `Last-Modified`, a treści nie ma w ogóle.

Odpowiedź niesie też `Accept-Ranges: bytes`. Żądanie z polem `Range` dostaje `206 Partial Content` i pole `Content-Range`. Zakres, którego plik nie potrafi spełnić, dostaje `416 Range Not Satisfiable`, a takie żądanie również nie dociera do PHP.

## Cache plików

Każdy worker przechowuje zaserwowane pliki w pamięci. Cache nie jest konfigurowalny.

Wpis cache'u jest ważny przez sekundę. Potem następne żądanie używa `stat` do porównania pliku.
Worker zachowuje wpis z tym samym czasem i długością. Zmieniony plik odczytuje ponownie.

Plik większy niż 256 KiB nigdy nie trafia do cache'u. Taki plik przy każdym żądaniu leci strumieniem prosto z dysku.

Jeden worker przechowuje do 16 MiB. Pełny cache nadal serwuje bieżące wpisy.
Cache usuwa wygasłe wpisy, zanim pominie nowy wpis. Każdy worker używa do 16 MiB dla cache'u.
Restart opróżnia cache.

Każdy worker sprawdza własne wpisy. Usunięty plik wpływa na odpowiedzi najpóźniej po sekundzie.
Zmieniony lub zastąpiony plik wpływa na odpowiedzi najpóźniej po jednej sekundzie, jeśli zmieni się jego czas modyfikacji lub długość.
Zmiana uprawnień nie usuwa wpisu, jeśli czas i długość nie zmieniają się.
Usuń plik, aby usunąć wpis. Zastąpienie usuwa wpis tylko przy nowym czasie modyfikacji lub nowej długości.
Możesz też ponownie uruchomić serwer.

Katalog główny musi używać lokalnego nośnika. Middleware wykonuje `stat` i `open` w wątku obsługi żądań.
Wolny system plików opóźnia inne połączenia workera.

::: question Jak cache wykrywa zmieniony plik?
Cache porównuje czas i długość z zapisanymi wartościami. ETag zawiera te same wartości.
Cache nie wykrywa wymiany zachowującej obie wartości. Zmień czas lub długość każdego zastąpionego pliku.
:::

Więcej informacji znajdziesz w [Konfiguracji](/pl/docs/configuration).
