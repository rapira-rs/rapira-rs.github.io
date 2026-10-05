---
title: Pliki statyczne
description: "Serwowanie plików, zanim żądanie dotrze do PHP: klucze [http.static], reguły middleware i cache plików w każdym workerze."
faqLevel: 2
---

# Pliki statyczne

Middleware plików statycznych serwuje pliki z katalogu, zanim żądanie dotrze do PHP. Odpowiada na żądanie, którego ścieżka wskazuje plik w jego katalogu głównym. Każde inne żądanie wysyła bez zmian do PHP.

## Konfiguracja middleware

Dwa fragmenty `rapira.toml` włączają middleware. Dodaj `static` do listy `middleware` w sekcji `[http]`. Następnie dodaj tabelę `[http.static]`, która ustawia katalog plików.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Wymagany. Ścieżki względne używają katalogu tego pliku.
forbid = [".php"]   # Opcjonalny. Ta lista zastępuje wartość domyślną.
```

`middleware` trzyma łańcuch middleware w kolejności listy. `static` to na razie jedyna nazwa, jaką ten klucz przyjmuje.

`root` określa katalog z plikami do serwowania. Nie ma wartości domyślnej, więc tabela musi go ustawić. Ścieżka względna używa katalogu pliku konfiguracyjnego jako bazy, tak samo jak `http.pool.entrypoint`.

`forbid` zawiera przyrostki nazw plików, których middleware nie serwuje. Domyślna wartość to `[".php"]`. Jawna lista zastępuje tę wartość. Na przykład `forbid = [".php", ".env"]` blokuje oba przyrostki.

::: danger
Wartość `forbid = []` zezwala na wszystkie pliki w katalogu głównym, w tym na pliki źródłowe PHP. Nie używaj tej wartości dla publicznego katalogu głównego. Może ujawnić kod aplikacji i osadzone sekrety.
:::

Każdy wpis zaczyna się kropką i ma co najmniej dwa znaki. Nie może zawierać `/` ani białych znaków. Nieprawidłowy wpis zatrzymuje inicjalizację serwera.

Pozostałe klucze pliku konfiguracyjnego opisuje [Konfiguracja](/pl/docs/configuration).

## Walidacja przy inicjalizacji

Serwer sprawdza katalog główny, zanim przyjmie żądania. Katalog główny musi istnieć i być katalogiem. Konto serwera musi mieć dla niego prawo przeszukiwania. Nieudana kontrola zatrzymuje inicjalizację i wskazuje ścieżkę.

Oba fragmenty konfiguracji muszą występować razem. Wpis `"static"` w middleware wymaga tabeli `[http.static]`, a tabela wymaga wpisu. Rapira odrzuca też powtórzone i nieznane nazwy middleware.

::: question Dlaczego serwer sprawdza katalog główny dwa razy?
Pierwsza kontrola czyta metadane katalogu głównego. Potwierdza, że ścieżka istnieje i jest katalogiem. Druga kontrola rozwiązuje `.` wewnątrz katalogu głównego. Sprawdza prawo przeszukiwania, którego wymaga dostęp do plików.

Prawa przeszukiwania i odczytu katalogu używają innych bitów. Dlatego pierwsza kontrola może przejść, a druga zakończyć się błędem. Wymagane prawa opisuje [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html).
:::

## Reguły serwowania

Middleware bierze żądanie pod uwagę tylko wtedy, gdy metodą jest `GET` albo `HEAD`. Każda inna metoda idzie do PHP.

Middleware stosuje te reguły ścieżki:

- Ścieżka z segmentem, który zaczyna się od `.`, idzie do PHP. Dlatego `/.env`, `/.git/config` i `/../outside.txt` nie mają dostępu do plików.
- Kontrola `forbid` działa na ścieżce po dekodowaniu procentowym i nie rozróżnia wielkości liter. Gdy `.php` jest zabronione, `/index.php`, `/index%2Ephp` i `/Upper.PHP` idą do PHP.
- Ścieżka z kodowaniem procentowym, które nie dekoduje się do UTF-8, idzie do PHP. Na przykład `/%FF.css` idzie do PHP.
- URL katalogu idzie do PHP. Middleware nie serwuje pliku indeksu.
- Brak pliku, błąd uprawnień lub nieprawidłowa nazwa pliku powoduje, że żądanie idzie do PHP. Nieprawidłowa nazwa pliku jest za długa lub zawiera bajt NUL.
- Każdy inny błąd odczytu zwraca `500`. PHP nie otrzymuje żądania, a Rapira zapisuje błąd w logu z celem `http`.

Żądanie, które idzie do PHP, dociera bez zmian. Co PHP z niego czyta, opisuje strona [Żądania i odpowiedzi HTTP](/pl/docs/http).

::: question Dlaczego URL katalogu nie dostaje w odpowiedzi `index.html`?
PHP kontroluje przestrzeń adresów, więc URL katalogu jest trasą aplikacji. Automatyczny plik indeksu utworzyłby dwie możliwe odpowiedzi. System plików mógłby zwrócić jedną odpowiedź, a router aplikacji inną. Skrypt wejściowy nie otrzymałby żądań dla `/`.
:::

## Pola odpowiedzi

Pola opisane niżej występują w odpowiedzi, która serwuje plik. Odpowiedź `500` z middleware ich nie zawiera.

Middleware ustawia `Content-Type` na podstawie rozszerzenia pliku. Nazwa bez znanego rozszerzenia dostaje `application/octet-stream`.

Odpowiedź zawiera pola `ETag` i `Last-Modified`. Middleware tworzy `Last-Modified` z czasu modyfikacji pliku. Tworzy `ETag` z czasu modyfikacji i długości pliku. Plik bez czasu modyfikacji nie dostaje żadnego z tych pól.

Middleware zwraca `304 Not Modified`, gdy `If-None-Match` pasuje do `ETag`. Żądanie bez `If-None-Match` dostaje `304 Not Modified`, gdy czas modyfikacji pliku nie jest późniejszy niż czas z `If-Modified-Since`. Ta odpowiedź zawiera tylko `ETag` i `Last-Modified`. Nie ma treści.

Odpowiedź zawiera też `Accept-Ranges: bytes`. Żądanie z `Range` może dostać `206 Partial Content` i pole `Content-Range`. Rapira zwraca `416 Range Not Satisfiable` dla nieprawidłowego zakresu lub dla więcej niż jednego zakresu. PHP nie otrzymuje tego żądania.

Niespełniony warunek `If-Match` lub `If-Unmodified-Since` zwraca `412 Precondition Failed`.

Middleware nie ustawia `Cache-Control`. Ustaw to pole w reverse proxy, gdy klienci go potrzebują.

## Cache plików

Każdy proces workera przechowuje w pamięci pliki, które serwuje. Cache nie jest konfigurowalny. Używa tych stałych wartości:

- Wpis cache'u jest ważny przez jedną sekundę.
- Cache nie przechowuje pliku większego niż 256 KiB. Taki plik przy każdym żądaniu idzie strumieniem z dysku.
- Każdy worker przechowuje najwyżej 16 MiB. Dlatego cache może użyć 16 MiB pamięci na każdy proces z `http.pool.processes`.

Po jednej sekundzie następne żądanie pliku wykonuje na nim `stat`. Worker zachowuje wpis, gdy czas modyfikacji i długość są takie same. W przeciwnym razie odczytuje plik ponownie. Rapira przestaje serwować usunięty plik najpóźniej po jednej sekundzie.

Pełny cache nadal serwuje swoje wpisy. Najpierw usuwa wygasłe wpisy. Jeśli nadal jest pełny, nie zapisuje nowego pliku.

Nowy proces workera zaczyna z pustym cache'em. Dlatego przeładowanie, wymiana workera lub restart czyści cache.

Katalog główny musi używać lokalnego nośnika. Middleware wykonuje `stat` i `open` w wątku, który obsługuje żądania. Wolny system plików opóźnia inne połączenia w tym workerze.

::: question Dlaczego cache nie wykrywa mojego zmienionego pliku?
Cache porównuje tylko czas modyfikacji i długość pliku. `ETag` zawiera te same wartości. Cache nie wykrywa zastąpienia, które zachowuje obie wartości. Zmiana uprawnień też zachowuje wpis. Aby usunąć wpis, usuń plik, zmień jego czas modyfikacji lub [przeładuj](/pl/docs/process-model#sygnały) serwer.
:::
