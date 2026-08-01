---
title: Tryb workera
description: "Jak napisać skrypt workera Rapiry: pętla rezydentna, kontrakt handleRequest(), co przeżywa między żądaniami i typowe pułapki."
---

# Tryb workera

Tryb workera utrzymuje proces PHP przy życiu między żądaniami: skrypt raz podnosi aplikację, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie. Rozruch wykonuje się jeden raz, przy starcie, a każde następne żądanie zastaje aplikację już rozgrzaną w pamięci. Stan również przeżywa żądanie, więc skrypt workera musi nim zarządzać.

W [trybie klasycznym](/pl/docs/classic) skrypt wejściowy wykonuje się natomiast od zera przy każdym żądaniu, a wszystko, co zbudował, zostaje odrzucone w chwili odesłania odpowiedzi, więc rozruch nowoczesnego frameworka — autoloader, kontener, konfiguracja, trasy, połączenia z bazą — kosztuje tyle samo przy każdym żądaniu.

Tryb workera to tryb **SAPI Worker**, który razem z trybem Classic jest gotowy już dzisiaj, a ta strona jest przewodnikiem po programowaniu w nim. Tryb workera nie wymaga konkretnego frameworka, a jedynie aplikacji, która zniesie jednorazowy rozruch i obsługę wielu żądań — a to potrafi większość nowoczesnych frameworków. Wszystkie cztery tryby oraz to, co decyduje o wyborze dostępnym danej aplikacji, opisują [Tryby wykonania](/pl/docs/execution-modes), a przewodniki po konkretnych frameworkach zebrano w sekcji [Frameworki](/pl/docs/frameworks/).

## Pętla rezydentna

Skrypt workera składa się z trzech części: tego, co podnosisz na samej górze, handlera obsługującego jedno żądanie i pętli, która kręci tym handlerem aż do wyłączenia serwera. Pętlę piszesz w PHP, wokół obiektu handlera, który Rapira zwraca skryptowi.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`rapira serve` domyślnie startuje w trybie workera, więc wystarczy wskazać serwerowi ten skrypt; tryb klasyczny trzeba włączyć samodzielnie:

```bash
rapira serve app/worker.php
```

Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli), a ich odpowiedniki w `rapira.toml` — w [Konfiguracji](/pl/docs/configuration).

## Co robi `handleRequest()`

`handleRequest(callable $handler)` to cała umowa między tobą a serwerem:

- **Blokuje wykonanie**, dopóki do tego workera nie trafi żądanie. Worker czekający w `handleRequest()` nie zjada procesora, a mimo to trzyma w pamięci swój interpreter i twoją podniesioną aplikację.
- **Wypełnia zmienne superglobalne** — `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i resztę — danymi tego żądania, od nowa, zanim ruszy twój handler. Zwykły kod PHP, który je czyta, działa dokładnie tak samo jak pod php-fpm.
- **Wywołuje twój handler bez żadnych argumentów.** Wszystko o żądaniu siedzi w zmiennych superglobalnych, więc sygnatura callbacka to `function (): void`. Resztę, której handler potrzebuje — kontener, aplikację, logger — przechwytujesz przez `use`.
- **Twoje wyjście jest odpowiedzią.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()` — handler tworzy odpowiedź dokładnie tak samo jak klasyczny skrypt. O tym, jak podpięte są dane żądania i wypisywana odpowiedź, mówi [HTTP](/pl/docs/http).
- **Zwraca `true`**, gdy żądanie zostało obsłużone — czyli „kręć się dalej” — i **`false`**, gdy serwer się zamyka. To właśnie jest warunek pętli: kiedy zrobi się fałszywy, wypadasz z pętli i pozwalasz skryptowi się zakończyć.

Żądanie w trybie workera to więc jeden obrót twojej pętli `while`. Rapira domyka je wokół twojego handlera — uruchamia funkcje shutdown i destruktory, opróżnia i zeruje bufory wyjścia, zapisuje i zamyka sesję, a zmienne superglobalne wypełnia na nowo przed kolejnym obrotem — natomiast wszystko, co twój skrypt trzyma poza handlerem, zostaje nietknięte.

## Jeden handler na worker

`handleRequest()` wraca po każdym pojedynczym żądaniu, zamiast obsługiwać je w nieskończoność, więc przy życiu trzyma workera pętla wokół niego, a tę pętlę musi dostarczyć sam skrypt workera.

Skrypt workera obsługuje więc dokładnie jeden handler naraz. Jeśli napiszesz dwie pętle jedna po drugiej, do drugiej nigdy nie dojdziesz — pierwsza kończy się dopiero wtedy, gdy `handleRequest()` zwróci `false`, a to znaczy, że serwer już się zamyka. Rozdzielanie ruchu na różne ścieżki kodu robi w środku twój jeden handler; nie wyraża się tego kilkoma pętlami.

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## Co przeżywa między żądaniami

Wszystko, co tworzysz **poza** handlerem, żyje tak długo jak proces workera: autoloader, kontener DI, skompilowane trasy, konfiguracja, otwarte połączenia z bazą i cache'em, rozgrzane pamięci podręczne. Nic z tego nie jest odbudowywane przy każdym żądaniu.

Wszystko, co tworzysz **wewnątrz** handlera, to zwykła praca na potrzeby jednego żądania, zwalniana w chwili, gdy handler wraca, a żądanie zostaje zamknięte.

To, gdzie przebiega granica między jednym a drugim, jest decyzją projektową skryptu workera: stan przeznaczony do współdzielenia ląduje powyżej pętli, a stan należący do jednego żądania zostaje w handlerze albo zostaje wyzerowany przed następnym.

::: warning
Współdzielony jest też stan globalny, czy tego chcesz, czy nie: statyczne właściwości, singletony, rejestry wypełniane leniwie przez biblioteki, `ini_set()`, którego nikt nie cofnął. Pod php-fpm żyły one w obrębie jednego żądania tylko dlatego, że zamykanie żądania w PHP zerowało je wszystkie — statyczne pola, zmienne globalne i `ini_set()` tak samo. Worker Rapiry celowo pomija to zerowanie między żądaniami, więc stan zostaje. Aplikacja, która nie potrafi zrezygnować ze stanu globalnego, działa zamiast tego w [trybie klasycznym](/pl/docs/classic): tryb klasyczny rezygnuje z rozgrzanej aplikacji, którą worker trzyma w pamięci, ale pozostaje zamiennikiem php-fpm bez żadnych zmian w kodzie, a na workera aplikacja przesiądzie się później, kiedy stan zostanie rozplątany.
:::

## Wybór wtyczki

`create_plugin_handler()` przyjmuje obiekt konfiguracji, a o wyborze wtyczki decyduje *klasa* tego obiektu. `HttpHandlerConfig` oznacza, że ten worker obsługuje HTTP, i w zamian dostajesz `HttpHandler`.

Wyjątek `Rapira\RapiraException` poleci w dwóch sytuacjach: gdy do przekazanej klasy konfiguracji nie pasuje żadna wtyczka oraz gdy skrypt w ogóle nie działa w trybie workera — w trybie klasycznym nie ma pętli rezydentnej, więc handler nie mógłby tam zrobić nic poza zgłoszeniem zamknięcia.

Konfiguracja niesie też opis tego, w co celuje, w `$http->config->info` — to `Rapira\PluginInfo` z polami `name` i `description` (dla wtyczki HTTP odpowiednio `http` i `HTTP request handler`):

```php
$http = create_plugin_handler(new HttpHandlerConfig());

echo $http->config->info->name;        // http
echo $http->config->info->description; // HTTP request handler
```

## Podgląd workera przez `getInfo()`

`$http->getInfo()` zwraca `Rapira\Plugin\Http\RuntimeInfo` — własne, żywe liczniki tego workera, odczytane w chwili wywołania:

| Pole       | Co oznacza                                                                     |
| ---------- | ------------------------------------------------------------------------------ |
| `state`    | `starting`, `idle`, `active`, `draining` albo `free` — patrz niżej              |
| `pid`      | Identyfikator procesu tego workera                                              |
| `queued`   | Ile żądań czeka w tej chwili w kolejce tego workera                             |
| `handled`  | Ile żądań ten worker już obsłużył                                               |
| `errors`   | Ile z nich zakończyło się błędem                                                |
| `recycles` | Ile razy worker musiał odbudować swój stan po tym, jak PHP przerwało pracę      |
| `restarts` | Ile razy trzeba było odbudować sam wątek PHP tego workera                       |

Pięć stanów opisuje, w którym miejscu cyklu życia stoi worker: **starting** — proces nadrzędny go sforkował, ale worker jeszcze się nie zgłosił; **idle** — zaparkowany, czeka na żądanie i liczy się jako wolna moc; **active** — obsługuje żądanie; **draining** — jest na wylocie (wyczerpał swój limit żądań albo został uznany za niesprawnego) i przestał się liczyć jako wolna moc; **free** — do slotu nie jest przypisany żaden worker.

Pamiętaj przy tym, że `queued` to aktualna głębokość kolejki, a nie suma narastająca, i że każdy licznik dotyczy wyłącznie tego procesu: startują od zera razem z workerem, więc worker wstawiony na miejsce poprzednika liczy wszystko od nowa.

Na tych licznikach można oprzeć niewielki endpoint ze statusem:

```php
$handler = static function () use ($http): void {
    $info = $http->getInfo();
    header('Content-Type: application/json');
    echo json_encode([
        'pid' => $info->pid,
        'state' => $info->state,
        'queued' => $info->queued,
        'handled' => $info->handled,
        'errors' => $info->errors,
    ]);
};
```

## Pułapki

**Stan wyciekający między żądaniami.** Aplikacja, która psuje się w workerze, choć pod php-fpm działa bez zarzutu, zwykle przecieka stanem między żądaniami. Puchnąca tablica statyczna, obiekt żądania zapamiętany w singletonie, logger trzymający kontekst poprzedniego użytkownika — każde z nich to błąd, który wychodzi dopiero przy drugim żądaniu. Sprzątaj jawnie na początku albo na końcu handlera i zeruj to, co zostawiają po sobie biblioteki. `pool.max_requests` sprawia, że worker kończy pracę po N żądaniach, a proces nadrzędny podstawia w jego miejsce świeży, co ogranicza szkody z powolnego wycieku, ale go nie usuwa.

**Niezebrane cykle referencji.** Zliczanie referencji w PHP zwalnia większość rzeczy natychmiast, ale cykle znikają dopiero wtedy, gdy uruchomi się kolektor cykli. Wywołanie `gc_collect_cycles()` raz na obrót pętli — tak jak w skrypcie wyżej — nie jest wymagane, ale sprząta je w przewidywalnym momencie: między żądaniami, a nie w środku któregoś z nich.

**Żądania, które nigdy się nie kończą.** Worker uwięziony w zawieszonym żądaniu tkwi w nim w nieskończoność i przez ten czas nie obsługuje niczego innego. `pool.request_terminate_timeout_secs` nakłada na pojedyncze żądanie limit czasu rzeczywistego i ubija workera, który go przekroczy. Ten klucz i `pool.max_requests` opisuje [Konfiguracja](/pl/docs/configuration), a to, co proces nadrzędny robi po śmierci workera — [Model procesów](/pl/docs/process-model).

**Nieprzechwycony wyjątek dotyczy żądania, nie workera.** Nieprzechwycony wyjątek w handlerze trafia do licznika `errors` i kończy się odpowiedzią `500` — chyba że handler zdążył wcześniej ustalić status. Tak czy inaczej pętla kręci się dalej, więc wyjątek nie pociąga workera za sobą. Inaczej jest z błędem krytycznym: zwija on rezydentny skrypt, więc worker uruchamia go od góry i jeszcze raz podnosi twoją aplikację. To właśnie zlicza licznik `recycles`.

**Praca po odesłaniu odpowiedzi.** Jeśli chcesz odesłać odpowiedź i pracować dalej — opróżnić kolejkę, dopisać wpis do audytu — dokładnie do tego służy `rapira_finish_request()`. Opisuje ją strona [HTTP](/pl/docs/http).

## Stub dla IDE

Każda klasa i funkcja, którą Rapira wystawia do PHP, jest zadeklarowana w [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). To wiążąca deklaracja API — sygnatury, typy właściwości, przeznaczenie każdej klasy — a przy okazji gotowy stub dla IDE: wrzuć ten plik do projektu, a edytor zacznie podpowiadać `create_plugin_handler()`, `handleRequest()` i całą resztę, zamiast podkreślać je jako nieznane.
