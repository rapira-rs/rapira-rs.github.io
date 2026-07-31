---
title: Tryb workera
description: Przewodnik po rezydentnym workerze Rapiry — podnieś aplikację raz, potem obsługuj żądania w pętli przez handleRequest() i wiedz, co przeżywa między nimi.
---

# Tryb workera

W [trybie klasycznym](/pl/docs/classic) PHP robi to, co robił od zawsze: skrypt wejściowy wykonuje się od zera, odpowiedź wychodzi, a wszystko, co skrypt zbudował, ląduje w koszu. Rozruch nowoczesnego frameworka — autoloader, kontener, konfiguracja, trasy, połączenia z bazą — kosztuje przy milionowym żądaniu dokładnie tyle samo, co przy pierwszym.

Tryb workera to alternatywa. Proces zostaje przy życiu: twój skrypt raz podnosi aplikację, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie. Za rozruch płacisz raz, przy starcie, a każde następne żądanie zastaje aplikację już rozgrzaną w pamięci. W zamian musisz zacząć myśleć o stanie — bo teraz przeżywa on żądanie.

To szczebel **SAPI Worker** na drabinie trybów wykonania Rapiry, razem z trybem Classic jedyny gotowy dzisiaj. Całą drabinę i sposób na rozpoznanie, jak wysoko wejdzie twoja aplikacja, opisują [Tryby wykonania](/pl/docs/execution-modes); ta strona jest przewodnikiem po szczeblu, z którego skorzystasz od razu.

## Pętla rezydentna

Skrypt workera składa się z trzech części: tego, co podnosisz na samej górze, handlera obsługującego jedno żądanie i pętli, która kręci tym handlerem aż do wyłączenia serwera. Pętlę piszesz w PHP — Rapira podaje ci obiekt handlera, a ty nim sterujesz.

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

Wskaż serwerowi ten plik i gotowe — `rapira serve` domyślnie startuje w trybie workera, a tryb klasyczny trzeba włączyć samodzielnie:

```bash
rapira serve app/worker.php
```

Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli), a ich odpowiedniki w `rapira.toml` — w [Konfiguracji](/pl/docs/configuration).

## Co robi `handleRequest()`

`handleRequest(callable $handler)` to cała umowa między tobą a serwerem i warto przeczytać ją powoli:

- **Blokuje wykonanie**, dopóki do tego workera nie trafi żądanie. Worker zaparkowany na `handleRequest()` nie zjada procesora podczas czekania, a mimo to trzyma w pamięci swój interpreter i twoją podniesioną aplikację.
- **Wypełnia zmienne superglobalne** — `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i resztę — danymi tego żądania, od nowa, zanim ruszy twój handler. Zwykły kod PHP, który je czyta, działa dokładnie tak samo jak pod php-fpm.
- **Wywołuje twój handler bez żadnych argumentów.** Wszystko o żądaniu siedzi w zmiennych superglobalnych, więc sygnatura callbacka to `function (): void`. Resztę, której handler potrzebuje — kontener, aplikację, logger — przechwytujesz przez `use`.
- **Twoje wyjście jest odpowiedzią.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()` — handler tworzy odpowiedź dokładnie tak samo jak klasyczny skrypt. O tym, jak podpięte są dane żądania i wypisywana odpowiedź, mówi [HTTP](/pl/docs/http).
- **Zwraca `true`**, gdy żądanie zostało obsłużone — czyli „kręć się dalej” — i **`false`**, gdy serwer się zamyka. To właśnie jest warunek pętli: kiedy zrobi się fałszywy, wypadasz z pętli i pozwalasz skryptowi się zakończyć.

Żądanie w trybie workera to więc jeden obrót twojej pętli `while`. Rapira domyka je wokół twojego handlera — uruchamia funkcje shutdown i destruktory, opróżnia i zeruje bufory wyjścia, zapisuje i zamyka sesję, a zmienne superglobalne wypełnia na nowo przed kolejnym obrotem — natomiast wszystko, co twój skrypt trzyma poza handlerem, zostaje nietknięte.

## Jeden handler, jeden worker

`handleRequest()` wraca po każdym pojedynczym żądaniu. To nie jest wywołanie w stylu „obsługuj w nieskończoność” — przy życiu trzyma workera dopiero pętla wokół niego, a ta pętla należy do ciebie.

Konsekwencja bywa zaskoczeniem: skrypt workera obsługuje dokładnie jeden handler naraz. Jeśli napiszesz dwie pętle jedna po drugiej, do drugiej nigdy nie dojdziesz — pierwsza kończy się dopiero wtedy, gdy `handleRequest()` zwróci `false`, a to znaczy, że serwer już się zamyka. Rozdzielanie ruchu na różne ścieżki kodu robi w środku twój jeden handler; nie wyraża się tego kilkoma pętlami.

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## Co przeżywa między żądaniami

Wszystko, co tworzysz **poza** handlerem, żyje tak długo jak proces workera: autoloader, kontener DI, skompilowane trasy, konfiguracja, otwarte połączenia z bazą i cache'em, rozgrzane pamięci podręczne. O to właśnie chodzi w trybie workera — za to wszystko przestajesz płacić przy każdym żądaniu.

Wszystko, co tworzysz **wewnątrz** handlera, to zwykła praca na potrzeby jednego żądania, zwalniana w chwili, gdy handler wraca, a żądanie zostaje zamknięte.

Granica między jednym a drugim to decyzja projektowa, którą tryb workera każe ci podjąć. Stan przeznaczony do współdzielenia ląduje na górze; stan należący do jednego żądania zostaje w handlerze — albo zostaje wyzerowany przed następnym.

::: warning
Współdzielone jest też wszystko, co globalne, czy tego chcesz, czy nie: statyczne właściwości, singletony, rejestry wypełniane leniwie przez biblioteki, `ini_set()`, którego nigdy nie cofnąłeś. Pod php-fpm żyły one w obrębie jednego żądania tylko dlatego, że zamykanie żądania w PHP zerowało je wszystkie — statyczne pola, zmienne globalne i `ini_set()` tak samo. Worker Rapiry celowo pomija to zerowanie między kolejnymi zadaniami, więc tutaj nic nie posprząta się samo.
:::

## Wybór wtyczki

`create_plugin_handler()` przyjmuje obiekt konfiguracji, a o wyborze wtyczki decyduje *klasa* tego obiektu. `HttpHandlerConfig` mówi „ten worker obsługuje HTTP” i w zamian dostajesz `HttpHandler`.

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

Pięć stanów opisuje, w którym miejscu cyklu życia stoi worker: **starting** — proces nadrzędny go sforkował, ale worker jeszcze się nie zgłosił; **idle** — zaparkowany, czeka na żądanie i liczy się jako wolna moc; **active** — obsługuje żądanie; **draining** — postanowił zakończyć pracę (wyczerpał swój limit żądań albo został uznany za niesprawnego) i przestał się liczyć jako wolna moc; **free** — do slotu nie jest przypisany żaden worker.

Pamiętaj przy tym, że `queued` to aktualna głębokość kolejki, a nie suma narastająca, i że każdy licznik dotyczy wyłącznie tego procesu: startują od zera razem z workerem, więc worker wstawiony na miejsce poprzednika liczy wszystko od nowa.

Naturalne zastosowanie to malutki endpoint ze statusem:

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

**Stan wyciekający między żądaniami.** To pułapka numer jeden i niemal zawsze właśnie ona odpowiada za to, że aplikacja psuje się w workerze, choć pod php-fpm działała bez zarzutu. Puchnąca tablica statyczna, obiekt żądania zapamiętany w singletonie, logger trzymający kontekst poprzedniego użytkownika — każde z nich to błąd, który wychodzi dopiero przy drugim żądaniu. Sprzątaj jawnie na początku albo na końcu handlera i zeruj to, co zostawiają po sobie biblioteki. Jako siatka bezpieczeństwa działa `pool.max_requests`: worker kończy pracę po N żądaniach, a proces nadrzędny podstawia w jego miejsce świeży. To ogranicza szkody z powolnego wycieku, ale jest siatką, a nie naprawą.

**Śmieci, do których nie przyznaje się żadne żądanie.** Zliczanie referencji w PHP zwalnia większość rzeczy natychmiast, ale cykle znikają dopiero wtedy, gdy uruchomi się kolektor cykli. Wywołanie `gc_collect_cycles()` raz na obrót pętli — tak jak w kanonicznym skrypcie wyżej — sprząta je w przewidywalnym momencie: między żądaniami, a nie w środku któregoś z nich.

**Żądania, które nigdy się nie kończą.** Rezydentny worker potrafi tkwić w zawieszonym żądaniu w nieskończoność, a przez ten czas nie obsługuje nikogo. `pool.request_terminate_timeout_secs` nakłada na pojedyncze żądanie limit czasu rzeczywistego i ubija workera, który go przekroczy. Oba klucze opisuje [Konfiguracja](/pl/docs/configuration), a to, co proces nadrzędny robi po śmierci workera — [Model procesów](/pl/docs/process-model).

**Nieprzechwycony wyjątek dotyczy żądania, nie workera.** Nieprzechwycony wyjątek w handlerze trafia do licznika `errors` i kończy się odpowiedzią `500` — chyba że handler zdążył wcześniej ustalić status. Tak czy inaczej pętla kręci się dalej: wyjątek nie pociąga workera za sobą, więc awaria, o której czytasz w logach, niekoniecznie cokolwiek zatrzymała. Inaczej jest z błędem krytycznym: zwija on rezydentny skrypt, więc worker uruchamia go od góry i jeszcze raz podnosi twoją aplikację. To właśnie zlicza licznik `recycles`.

**Praca po odesłaniu odpowiedzi.** Chcesz odesłać odpowiedź i pracować dalej — opróżnić kolejkę, dopisać wpis do audytu? Dokładnie do tego służy `rapira_finish_request()`. Opisuje je strona [HTTP](/pl/docs/http).

## Stub dla IDE

Każda klasa i funkcja, którą Rapira wystawia do PHP, jest zadeklarowana w [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). To wiążąca deklaracja API — sygnatury, typy właściwości, przeznaczenie każdej klasy — a przy okazji gotowy stub dla IDE: wrzuć ten plik do projektu, a edytor zacznie podpowiadać `create_plugin_handler()`, `handleRequest()` i całą resztę, zamiast podkreślać je jako nieznane.

::: question Czy do trybu workera potrzebuję specjalnego frameworka?
Nie — potrzebujesz aplikacji, która zniesie to, że podnosisz ją raz i każesz jej obsłużyć wiele żądań. Większość nowoczesnych frameworków to potrafi, a szczegóły dla tych, które już opisaliśmy, znajdziesz w [przewodnikach po frameworkach](/pl/docs/frameworks/).
:::

::: question Czy `gc_collect_cycles()` w pętli jest obowiązkowe?
Obowiązkowe nie jest, ale to dobry domyślny wybór. Bez niego cykle referencji zbierają się do chwili, aż kolektor PHP sam uzna, że pora ruszyć — być może w środku obsługi czyjegoś żądania. Wywołanie go między żądaniami trzyma tę pracę w przewidywalnym miejscu.
:::

::: question Moja aplikacja nie potrafi zrezygnować ze stanu globalnego. Czy mogę używać Rapiry?
Tak: uruchom ją w [trybie klasycznym](/pl/docs/classic). Tracisz przewagę rozgrzanego workera, ale zostaje ci zamiennik php-fpm działający bez żadnych zmian w kodzie, a na workera przesiądziesz się później, kiedy rozplączesz stan.
:::
