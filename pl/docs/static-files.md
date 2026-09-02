---
title: Pliki statyczne
description: "Serwowanie plików z katalogu, zanim żądanie dotrze do PHP: klucze [http.static], reguły decydujące o tym, na co odpowiada middleware, i cache plików w każdym workerze."
faqLevel: 2
---

# Pliki statyczne

Rapira serwuje pliki z katalogu przez middleware plików statycznych, zanim żądanie dotrze do PHP. Middleware działa we froncie HTTP, przed handlerem PHP: odpowiada na żądanie, które wskazuje plik leżący pod jego katalogiem głównym, a każde inne przepuszcza dalej w nienaruszonej postaci.

## Włączenie middleware

Middleware włączają dwa fragmenty `rapira.toml`: nazwa `static` na liście middleware w sekcji `[http]` oraz sekcja `[http.static]` mówiąca, gdzie leżą pliki.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # required; a relative path resolves against this file's directory
forbid = [".php"]   # optional; an explicit list replaces this default
```

`middleware` trzyma łańcuch middleware w kolejności listy. `static` to na razie jedyna nazwa, jaką ten klucz przyjmuje.

`root` wskazuje katalog, z którego middleware serwuje pliki. Nie ma wartości domyślnej, więc sekcja musi go ustawić. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym, tak samo jak przy `pool.entrypoint`.

`forbid` trzyma rozszerzenia, których middleware nigdy nie zaserwuje. Domyślnie jest to `[".php"]`, a jawna lista zastępuje tę wartość domyślną: `forbid = [".php", ".env"]` trzyma oba rozszerzenia poza odpowiedziami, a `forbid = []` serwuje spod katalogu głównego każdy plik, źródła PHP włącznie. Każdy wpis to rozszerzenie z kropką na początku, długie na co najmniej dwa znaki, bez `/` i bez białych znaków. Wpis o innej postaci przerywa start serwera.

Pozostałe klucze tego pliku opisuje [Konfiguracja](/pl/docs/configuration).

::: question Dlaczego wpis w `forbid` musi wyglądać jak rozszerzenie?
Middleware dopasowuje każdy wpis jako końcówkę nazwy pliku. Ani separator, ani spacja nie mogą kończyć nazwy pliku, więc wpis, który któreś z nich zawiera, nie pasuje do niczego, a plik, którego miał pilnować, zostaje osiągalny. Kontrola odrzuca taki wpis, zamiast przyjąć zabezpieczenie, które nic nie robi.
:::

## Walidacja przy starcie

Serwer sprawdza katalog główny, zanim cokolwiek zaserwuje. Katalog musi istnieć, musi być katalogiem i musi dać się przeszukać użytkownikowi, na którego prawach działa serwer. Katalog, który nie przejdzie którejś z tych kontroli, przerywa start komunikatem z nazwą ścieżki.

Oba fragmenty konfiguracji muszą się ze sobą zgadzać. `middleware = ["static"]` bez sekcji `[http.static]` przerywa start, a sekcja `[http.static]`, której `middleware` nie wymienia, przerywa go tak samo. Nazwa wymieniona na liście `middleware` dwa razy również jest odrzucana.

::: question Dlaczego serwer sprawdza katalog główny dwa razy?
Pierwsza próba czyta metadane katalogu, co pokazuje, że ścieżka istnieje i że jest katalogiem. Druga rozwiązuje w nim `.`, co pokazuje prawo przeszukiwania, którego wymaga każdy odczyt spod tego katalogu. Prawo przeszukiwania katalogu to inny bit niż prawo odczytu, więc katalog, który przechodzi pierwszą próbę, wciąż może oblać drugą. Uprawnienia potrzebne każdemu z tych wywołań opisuje [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html).
:::

## Reguły serwowania

Middleware bierze żądanie pod uwagę tylko wtedy, gdy metodą jest `GET` albo `HEAD`. Każda inna metoda idzie do PHP.

O reszcie decyduje ścieżka:

- Ścieżka z segmentem zaczynającym się od `.` idzie do PHP, więc `/.env`, `/.git/config` i `/../outside.txt` nigdy nie docierają do systemu plików.
- Kontrola `forbid` działa na ścieżce po zdekodowaniu procentowym i porównuje ostatni segment bez rozróżniania wielkości liter, więc przy `forbid` z `.php` do PHP idą tak samo `/index.php`, `/index%2Ephp` i `/Upper.PHP`.
- URL katalogu idzie do PHP. Middleware nie serwuje dla niego żadnego pliku indeksu, z ukośnikiem na końcu czy bez.
- Ścieżka, za którą nie stoi żaden plik, idzie do PHP. Tak samo trafia tam błąd uprawnień oraz nazwa, której system plików nie przyjmuje.
- Każda inna nieudana próba odczytu kończy się odpowiedzią `500`. Takie żądanie nie dociera do PHP, a błąd trafia do logu z celem `http`.

Żądanie, które idzie do PHP, dociera tam z nietkniętą treścią, polami i rozszerzeniami. Co PHP z niego odczytuje, opisują [Żądania i odpowiedzi HTTP](/pl/docs/http).

::: question Dlaczego URL katalogu nie dostaje w odpowiedzi `index.html`?
Przestrzeń adresów należy do PHP: URL katalogu jest trasą aplikacji. Domyślny plik indeksu dawałby dwie odpowiedzi na jeden URL, jedną z systemu plików i jedną z routera, a także uniemożliwiałby skryptowi wejściowemu obsługę `/`.
:::

::: question Jak middleware odróżnia brak pliku od nieudanego odczytu?
Sześć wyników oznacza, że nie ma czego serwować: ścieżka nie istnieje, proces nie ma prawa jej odczytać, ścieżka wskazuje katalog, któryś jej element nie jest katalogiem, nazwa jest za długa dla systemu plików i nazwa zawiera bajt NUL. Każdy z nich jest chybieniem, a żądanie leci dalej do PHP. Każdy inny błąd mówi o pliku, który istnieje i nie daje się odczytać, a z tym PHP też sobie nie poradzi, więc middleware zgłasza `500`.
:::

## Pola odpowiedzi

Pola opisane niżej należą do odpowiedzi, która serwuje plik. Odpowiedź `500` z middleware nie niesie żadnego z nich.

Middleware ustawia `Content-Type` na podstawie rozszerzenia pliku. Nazwa bez znanego rozszerzenia dostaje `application/octet-stream`.

Odpowiedź niesie pola `ETag` i `Last-Modified`. Middleware buduje oba z czasu modyfikacji pliku. Plik bez czasu modyfikacji nie dostaje żadnego z nich, a plik z czasem modyfikacji sprzed epoki nie dostaje `ETag`.

Middleware odpowiada `304 Not Modified`, gdy pole `If-None-Match` albo `If-Modified-Since` żądania pasuje do pliku. Taka odpowiedź niesie wyłącznie `ETag` i `Last-Modified`, a treści nie ma w ogóle.

Odpowiedź niesie też `Accept-Ranges: bytes`. Żądanie z polem `Range` dostaje `206 Partial Content` i pole `Content-Range`. Zakres, którego plik nie potrafi spełnić, dostaje `416 Range Not Satisfiable`, a takie żądanie również nie dociera do PHP.

## Cache plików

Każdy proces workera trzyma zaserwowane pliki w pamięci. Cache nie ma żadnych kluczy konfiguracyjnych, a wartości poniżej są stałe.

Wpis jest świeży przez jedną sekundę. Pierwsze żądanie po tym czasie wykonuje `stat` i odświeża wpis, jeśli czas modyfikacji i długość wciąż zgadzają się z plikiem. Plik, który się zmienił, zostaje odczytany na nowo.

Plik większy niż 256 KiB nigdy nie trafia do cache'u. Taki plik przy każdym żądaniu leci strumieniem prosto z dysku.

Jeden worker trzyma najwyżej 16 MiB. Cache na tym limicie dalej serwuje wpisy, które już ma, i najpierw wyrzuca własne nieświeże wpisy, a dopiero potem odmawia przyjęcia nowego pliku. Koszt pamięci to więc do 16 MiB na każdy proces z `pool.processes`. Restart opróżnia cache.

Każdy worker odświeża własne wpisy, więc zmiana pod katalogiem głównym dociera do klienta najpóźniej po sekundzie. Skasowany i podmieniony plik znikają z cache'u w tym samym oknie. Sama zmiana uprawnień wpisu nie usuwa, bo `stat` podaje ten sam czas modyfikacji i tę samą długość co wcześniej: żeby wyrzucić taki plik z cache'u, skasuj go, podmień albo zrestartuj serwer.

Katalog główny musi leżeć na lokalnym nośniku. Middleware wywołuje `stat` i `open` na tym samym wątku runtime'u, który obsługuje żądania, więc system plików odpowiadający wolno na te wywołania wstrzymuje pozostałe połączenia tego workera.

::: question Jak cache wykrywa zmieniony plik?
Porównuje czas modyfikacji i długość pliku z dwiema wartościami, które zapamiętał, a ETag koduje tę samą parę. Podmiana zachowująca obie wartości nie zostanie wykryta, więc wdrożenie kopiujące pliki musi zostawić na każdym podmienionym pliku nowy czas modyfikacji albo nową długość.
:::

Więcej informacji znajdziesz w [Konfiguracji](/pl/docs/configuration).
